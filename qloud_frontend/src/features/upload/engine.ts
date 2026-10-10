/**
 * The upload engine (upload.md, ADR-0003): files go to S3 in parts through presigned
 * URLs; the server only creates, completes and cancels sessions. Plain TypeScript: the
 * tray reads the store, the engine writes it. Requests, timers and the network are
 * injected so tests can drive every path.
 */
import { ApiError } from '@/lib/api/errors';

import {
  type OnConflict,
  type UploadApi,
  type UploadedNode,
  type UploadSession,
} from './api';
import { fingerprint } from './fingerprint';
import { useUploadStore, type UploadItem } from './store';

/** At most this many parts in flight over the whole queue, whatever the number of files. */
export const MAX_PARTS_IN_FLIGHT = 4;
/** Sessions being created at once, so the next file is ready when parts free up. */
const MAX_PREPARING = 2;
/** Part URLs are asked for in batches (upload.md). */
export const URL_BATCH = 20;
/** Retries per part on a network or server error, with exponential backoff. */
export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
/** Presigned part URLs live an hour; ask again a little before. */
const URL_LIFETIME_MS = 55 * 60 * 1000;
const SPEED_WINDOW_MS = 5000;
/** The part of XMLHttpRequest the engine uses (a fake in tests). */
export interface PartRequest {
  status: number;
  upload: { onprogress: ((event: { loaded: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  open: (method: string, url: string) => void;
  send: (body: Blob) => void;
  abort: () => void;
}

export interface EngineDeps {
  api: UploadApi;
  fingerprint?: (file: File) => Promise<string>;
  createRequest: () => PartRequest;
  /** A file reached its folder: refresh that folder's listing. */
  onUploaded: (node: UploadedNode, parentId: string) => void;
  isOnline: () => boolean;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  newId: () => string;
}

interface Session {
  id: string;
  partSize: number;
  partCount: number;
}

interface Flight {
  request?: PartRequest;
  loaded: number;
}

/** What the engine keeps per file beyond the store: the File and the part bookkeeping. */
interface Runtime {
  file: File;
  onConflict: OnConflict;
  session?: Session;
  preparing: boolean;
  completing: boolean;
  pending: number[];
  done: Map<number, number>;
  flights: Map<number, Flight>;
  urls: Map<number, { url: string; expires: number }>;
  /** One batch request at a time; parts it covers wait for it instead of asking again. */
  urlFetch: { parts: Set<number>; done: Promise<void> } | null;
  attempts: Map<number, number>;
  /** Parts waiting out a backoff: neither pending nor in flight, but not done either. */
  retrying: Set<number>;
  /** Bumped by pause/cancel so late callbacks from older requests are ignored. */
  generation: number;
}

export type ConflictChoice = 'rename' | 'skip';

export class UploadEngine {
  private readonly runtimes = new Map<string, Runtime>();
  private lifecycle = 0;
  private readonly samples: { at: number; bytes: number }[] = [];
  /** "Apply to the rest": how later name conflicts in this queue are answered. */
  private conflictPolicy: ConflictChoice | null = null;

  constructor(private readonly deps: EngineDeps) {}

  private get store() {
    return useUploadStore.getState();
  }

  private item(id: string): UploadItem | undefined {
    return this.store.items.find((item) => item.id === id);
  }

  /** Attach a reselected file to its existing server session, without a new reservation. */
  async restore(file: File, session: UploadSession): Promise<boolean> {
    const lifecycle = this.lifecycle;
    const hash = await (this.deps.fingerprint ?? fingerprint)(file);
    if (lifecycle !== this.lifecycle) return false;
    if (hash !== session.fingerprint || file.size !== session.size)
      return false;
    if (this.store.items.some((item) => item.sessionId === session.id))
      return true;
    const [id] = this.enqueue([file], session.parent_id ?? '', session);
    if (id) await this.resync(id);
    return true;
  }

  /** Queue files for a folder; returns their ids in the store. */
  add(files: File[], parentId: string): string[] {
    const ids = this.enqueue(files, parentId);
    this.pump();
    return ids;
  }

  private enqueue(
    files: File[],
    parentId: string,
    session?: UploadSession,
  ): string[] {
    if (!this.store.items.some((item) => item.status === 'conflict'))
      this.conflictPolicy = null;
    const items: UploadItem[] = files.map((file) => ({
      id: this.deps.newId(),
      name: file.name,
      size: file.size,
      type: file.type,
      parentId,
      status: session ? 'paused' : 'queued',
      sessionId: session?.id,
      loaded: 0,
    }));
    items.forEach((item, index) => {
      const file = files[index];
      if (!file) return;
      this.runtimes.set(item.id, {
        file,
        onConflict: 'fail',
        session: session ? toSession(session) : undefined,
        preparing: false,
        completing: false,
        pending: [],
        done: new Map(),
        flights: new Map(),
        urls: new Map(),
        urlFetch: null,
        attempts: new Map(),
        retrying: new Set(),
        generation: 0,
      });
    });
    this.store.add(items);
    return items.map((item) => item.id);
  }

  // --- scheduling ---------------------------------------------------------------

  private inFlight(): number {
    let count = 0;
    for (const runtime of this.runtimes.values()) count += runtime.flights.size;
    return count;
  }

  /** Start whatever can start: sessions, parts up to the limit, completions. */
  pump(): void {
    if (this.store.offline) return;
    const items = this.store.items;
    let preparing = [...this.runtimes.values()].filter(
      (runtime) => runtime.preparing,
    ).length;
    for (const item of items) {
      const runtime = this.runtimes.get(item.id);
      if (!runtime) continue;
      if (
        item.status === 'queued' &&
        !runtime.preparing &&
        preparing < MAX_PREPARING
      ) {
        preparing += 1;
        void this.prepare(item.id);
      }
    }
    for (const item of items) {
      const runtime = this.runtimes.get(item.id);
      if (!runtime || runtime.preparing || item.status !== 'uploading')
        continue;
      while (
        runtime.pending.length > 0 &&
        this.inFlight() < MAX_PARTS_IN_FLIGHT
      ) {
        const part = runtime.pending.shift();
        if (part !== undefined) void this.sendPart(item.id, part);
      }
      if (
        runtime.pending.length === 0 &&
        runtime.flights.size === 0 &&
        runtime.retrying.size === 0 &&
        !runtime.completing
      ) {
        void this.complete(item.id);
      }
    }
  }

  private async prepare(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.preparing = true;
    const generation = runtime.generation;
    try {
      const hash = await (this.deps.fingerprint ?? fingerprint)(runtime.file);
      if (generation !== runtime.generation) return;
      const session = await this.deps.api.create({
        parentId: this.item(id)?.parentId ?? '',
        file: runtime.file,
        fingerprint: hash,
        onConflict: runtime.onConflict,
      });
      if (generation !== runtime.generation) {
        // Paused or cancelled while the session was being created: keep it for later.
        runtime.session = toSession(session);
        if (this.item(id)?.status === 'cancelled')
          void this.deps.api.abort(session.id).catch(() => undefined);
        return;
      }
      runtime.session = toSession(session);
      runtime.pending = range(runtime.session.partCount);
      this.store.patch(id, {
        status: 'uploading',
        sessionId: session.id,
        error: undefined,
      });
    } catch (error) {
      if (generation !== runtime.generation) return;
      if (error instanceof ApiError && error.code === 'name_conflict') {
        if (this.conflictPolicy)
          this.applyConflictChoice(id, this.conflictPolicy);
        else this.store.patch(id, { status: 'conflict' });
      } else {
        this.store.patch(id, { status: 'error', error: errorCode(error) });
      }
    } finally {
      runtime.preparing = false;
      this.pump();
    }
  }

  // --- parts ------------------------------------------------------------------------

  private async urlFor(id: string, part: number): Promise<string> {
    const runtime = this.runtimes.get(id);
    if (!runtime?.session) throw new Error('no session');
    const sessionId = runtime.session.id;
    const valid = (): string | undefined => {
      const cached = runtime.urls.get(part);
      return cached && cached.expires > this.deps.now()
        ? cached.url
        : undefined;
    };
    const ready = valid();
    if (ready) return ready;
    // Parts that start together share one batch request instead of each asking.
    if (runtime.urlFetch?.parts.has(part)) {
      await runtime.urlFetch.done;
      const url = valid();
      if (url) return url;
    }
    // This part and the next waiting ones, so most parts need no request of their own.
    const batch = [
      part,
      ...runtime.pending.filter((number) => !runtime.urls.has(number)),
    ].slice(0, URL_BATCH);
    const fetch = {
      parts: new Set(batch),
      done: this.deps.api.partUrls(sessionId, batch).then((urls) => {
        const expires = this.deps.now() + URL_LIFETIME_MS;
        for (const { part_number, url } of urls)
          runtime.urls.set(part_number, { url, expires });
      }),
    };
    runtime.urlFetch = fetch;
    try {
      await fetch.done;
    } finally {
      if (runtime.urlFetch === fetch) runtime.urlFetch = null;
    }
    const url = valid();
    if (!url) throw new Error('no part url');
    return url;
  }

  private async sendPart(id: string, part: number): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime?.session) return;
    const generation = runtime.generation;
    const flight: Flight = { loaded: 0 };
    runtime.flights.set(part, flight);
    let url: string;
    try {
      url = await this.urlFor(id, part);
    } catch (error) {
      if (generation !== runtime.generation) return;
      runtime.flights.delete(part);
      this.failPart(id, part, errorCode(error));
      return;
    }
    if (generation !== runtime.generation) return;

    const { partSize } = runtime.session;
    const body = runtime.file.slice((part - 1) * partSize, part * partSize);
    const request = this.deps.createRequest();
    flight.request = request;
    request.upload.onprogress = (event) => {
      if (generation !== runtime.generation) return;
      this.recordProgress(event.loaded - flight.loaded);
      flight.loaded = event.loaded;
      this.syncLoaded(id);
    };
    request.onload = () => {
      if (generation !== runtime.generation) return;
      runtime.flights.delete(part);
      if (request.status >= 200 && request.status < 300) {
        this.recordProgress(body.size - flight.loaded);
        runtime.done.set(part, body.size);
        runtime.attempts.delete(part);
        this.syncLoaded(id);
        this.pump();
      } else if (request.status === 403) {
        // Most likely the presigned URL expired: ask for a new one and go again.
        runtime.urls.delete(part);
        this.failPart(id, part, 'url_expired');
      } else {
        this.failPart(id, part, 'upload_failed');
      }
    };
    request.onerror = () => {
      if (generation !== runtime.generation) return;
      runtime.flights.delete(part);
      if (!this.deps.isOnline()) {
        runtime.pending.unshift(part);
        this.goOffline();
        return;
      }
      this.failPart(id, part, 'upload_failed');
    };
    request.open('PUT', url);
    request.send(body);
  }

  /** A part failed: retry later with backoff, or give the file up after MAX_ATTEMPTS. */
  private failPart(id: string, part: number, code: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    const attempts = (runtime.attempts.get(part) ?? 0) + 1;
    runtime.attempts.set(part, attempts);
    this.syncLoaded(id);
    if (attempts > MAX_ATTEMPTS) {
      this.stop(id);
      this.store.patch(id, { status: 'error', error: 'upload_failed' });
      this.pump();
      return;
    }
    const generation = runtime.generation;
    // An expired URL needs no wait; anything else backs off: 1, 2, 4, 8, 16 seconds.
    const wait =
      code === 'url_expired' ? 0 : (BACKOFF_MS[attempts - 1] ?? 16000);
    runtime.retrying.add(part);
    this.deps.setTimeout(() => {
      if (generation !== runtime.generation) return;
      runtime.retrying.delete(part);
      runtime.pending.unshift(part);
      this.pump();
    }, wait);
    this.pump();
  }

  private syncLoaded(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    let loaded = 0;
    for (const size of runtime.done.values()) loaded += size;
    for (const flight of runtime.flights.values()) loaded += flight.loaded;
    this.store.patch(id, { loaded });
  }

  private recordProgress(bytes: number): void {
    const now = this.deps.now();
    this.samples.push({ at: now, bytes });
    while (this.samples[0] && this.samples[0].at < now - SPEED_WINDOW_MS)
      this.samples.shift();
    const total = this.samples.reduce((sum, sample) => sum + sample.bytes, 0);
    this.store.setSpeed(Math.max(0, total / (SPEED_WINDOW_MS / 1000)));
  }

  // --- completion -------------------------------------------------------------------

  private async complete(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    const item = this.item(id);
    if (!runtime?.session || !item) return;
    runtime.completing = true;
    const generation = runtime.generation;
    this.store.patch(id, { status: 'completing' });
    try {
      const node = await this.deps.api.complete(runtime.session.id);
      if (generation !== runtime.generation) return;
      this.store.patch(id, {
        status: 'done',
        loaded: item.size,
        error: undefined,
      });
      this.runtimes.delete(id); // the File is no longer needed
      this.deps.onUploaded(node, item.parentId);
    } catch (error) {
      if (generation !== runtime.generation) return;
      const code = errorCode(error);
      if (code === 'upload_incomplete') {
        // The server is missing parts after all: ask which, and send those again.
        runtime.completing = false;
        await this.resync(id);
        return;
      }
      this.store.patch(id, { status: 'error', error: code });
    } finally {
      runtime.completing = false;
      this.pump();
    }
  }

  /** Part state comes from S3 (ListParts): upload only what is missing. */
  private async resync(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime?.session) return;
    runtime.preparing = true;
    const generation = runtime.generation;
    try {
      const detail = await this.deps.api.detail(runtime.session.id);
      if (generation !== runtime.generation) return;
      runtime.done = new Map(
        detail.parts.map((part) => [part.part_number, part.size]),
      );
      runtime.pending = range(runtime.session.partCount).filter(
        (part) => !runtime.done.has(part),
      );
      runtime.attempts.clear();
      this.syncLoaded(id);
      this.store.patch(id, { status: 'uploading', error: undefined });
    } catch (error) {
      if (generation !== runtime.generation) return;
      this.store.patch(id, { status: 'error', error: errorCode(error) });
    } finally {
      runtime.preparing = false;
    }
    this.pump();
  }

  // --- user actions -------------------------------------------------------------------

  /** Abort the file's requests; the parts they carried go back to waiting. */
  private stop(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.generation += 1;
    for (const [part, flight] of runtime.flights) {
      flight.request?.abort();
      runtime.pending.unshift(part);
    }
    runtime.flights.clear();
    // Parts waiting out a backoff go back to waiting too.
    runtime.pending = [
      ...new Set([...runtime.pending, ...runtime.retrying]),
    ].sort((a, b) => a - b);
    runtime.retrying.clear();
    runtime.preparing = false;
    runtime.completing = false;
    this.syncLoaded(id);
  }

  pause(id: string): void {
    const status = this.item(id)?.status;
    if (status !== 'queued' && status !== 'uploading') return;
    this.stop(id);
    this.store.patch(id, { status: 'paused' });
    this.pump();
  }

  resume(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || this.item(id)?.status !== 'paused') return;
    if (runtime.session) {
      this.store.patch(id, { status: 'uploading' });
      void this.resync(id);
    } else {
      this.store.patch(id, { status: 'queued' });
      this.pump();
    }
  }

  /** After an error: carry on from what storage has, or start the session again. */
  retry(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || this.item(id)?.status !== 'error') return;
    runtime.attempts.clear();
    if (runtime.session) {
      this.store.patch(id, { status: 'uploading', error: undefined });
      void this.resync(id);
    } else {
      this.store.patch(id, { status: 'queued', error: undefined });
      this.pump();
    }
  }

  cancel(id: string): void {
    const runtime = this.runtimes.get(id);
    const status = this.item(id)?.status;
    if (!runtime || status === 'done' || status === 'cancelled') return;
    this.stop(id);
    this.store.patch(id, { status: 'cancelled', loaded: 0 });
    if (runtime.session)
      void this.deps.api.abort(runtime.session.id).catch(() => undefined);
    this.runtimes.delete(id);
    this.pump();
  }

  /** "Keep both" (a ` (n)` name) or "skip"; `forAll` answers later conflicts too. */
  resolveConflict(id: string, choice: ConflictChoice, forAll = false): void {
    if (forAll) {
      this.conflictPolicy = choice;
      for (const item of this.store.items) {
        if (item.status === 'conflict')
          this.applyConflictChoice(item.id, choice);
      }
    } else {
      this.applyConflictChoice(id, choice);
    }
    this.pump();
  }

  private applyConflictChoice(id: string, choice: ConflictChoice): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    if (choice === 'skip') {
      this.store.patch(id, { status: 'skipped' });
      this.runtimes.delete(id);
    } else {
      runtime.onConflict = 'rename';
      this.store.patch(id, { status: 'queued' });
    }
  }

  pauseAll(): void {
    for (const item of this.store.items) this.pause(item.id);
  }

  resumeAll(): void {
    for (const item of this.store.items) this.resume(item.id);
  }

  retryFailed(): void {
    for (const item of this.store.items) this.retry(item.id);
  }

  /** Stop local work on logout; server sessions remain resumable on the next visit. */
  dispose(): void {
    this.lifecycle += 1;
    for (const id of this.runtimes.keys()) this.stop(id);
    this.runtimes.clear();
    useUploadStore.setState(useUploadStore.getInitialState(), true);
  }

  // --- network ------------------------------------------------------------------------

  /** The network went away: hold every part; `online()` picks them up again. */
  goOffline(): void {
    if (this.store.offline) return;
    this.store.setOffline(true);
    for (const item of this.store.items) {
      if (item.status === 'uploading') {
        const runtime = this.runtimes.get(item.id);
        if (!runtime) continue;
        runtime.generation += 1;
        for (const [part, flight] of runtime.flights) {
          flight.request?.abort();
          runtime.pending.unshift(part);
        }
        runtime.flights.clear();
        runtime.pending = [...new Set(runtime.pending)].sort((a, b) => a - b);
        this.syncLoaded(item.id);
      }
    }
  }

  online(): void {
    if (!this.store.offline) return;
    this.store.setOffline(false);
    this.pump();
  }
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function toSession(session: {
  id: string;
  part_size: number;
  part_count: number;
}): Session {
  return {
    id: session.id,
    partSize: session.part_size,
    partCount: session.part_count,
  };
}

/** A stable code for the tray's message: the API's own, or `upload_failed`. */
function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'upload_failed';
}
