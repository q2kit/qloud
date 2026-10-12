import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import { ApiError } from '@/lib/api/errors';

import type {
  UploadApi,
  UploadedNode,
  UploadSession,
  UploadSessionDetail,
} from './api';
import {
  MAX_ATTEMPTS,
  MAX_PARTS_IN_FLIGHT,
  UploadEngine,
  type PartRequest,
  type EngineDeps,
} from './engine';
import { useUploadStore } from './store';

const MiB = 1024 * 1024;

/** A request the test finishes by hand: ok(), fail(status) or drop() (network error). */
class FakeRequest implements PartRequest {
  status = 0;
  url = '';
  body: Blob | null = null;
  aborted = false;
  dropped = false;
  upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open(_method: string, url: string) {
    this.url = url;
  }
  send(body: Blob) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  ok() {
    this.status = 200;
    this.onload?.();
  }
  fail(status: number) {
    this.status = status;
    this.onload?.();
  }
  drop() {
    this.dropped = true;
    this.onerror?.();
  }
}

function apiError(status: number, code: string) {
  return new ApiError(status, { error: { code, message: code, details: {} } });
}

function session(id: string, size: number, partSize = 8 * MiB): UploadSession {
  return {
    id,
    part_size: partSize,
    part_count: size === 0 ? 0 : Math.ceil(size / partSize),
    size,
  } as UploadSession;
}

/** Only the fields the engine reads. */
function detailWith(
  parts: { part_number: number; size: number }[],
): UploadSessionDetail {
  return {
    parts: parts.map((part) => ({ ...part, etag: '"e"' })),
  } as unknown as UploadSessionDetail;
}

function nodeFor(id: string): UploadedNode {
  return { id: `node-${id}`, name: `node-${id}` } as UploadedNode;
}

function file(name: string, size: number): File {
  // Content does not matter; only `size` and slicing do.
  return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

let requests: FakeRequest[];
let online: boolean;
let api: { [K in keyof UploadApi]: Mock<UploadApi[K]> };
let uploaded: string[];
let ids: number;

function engine(
  fingerprint: EngineDeps['fingerprint'] = (file) =>
    Promise.resolve(`hash-${file.name}`),
) {
  return new UploadEngine({
    api,
    fingerprint,
    createRequest: () => {
      const request = new FakeRequest();
      requests.push(request);
      return request;
    },
    onUploaded: (node) => {
      uploaded.push(node.name);
    },
    isOnline: () => online,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    newId: () => `item-${String((ids += 1))}`,
  });
}

const items = () => useUploadStore.getState().items;
const status = (id: string) => items().find((item) => item.id === id)?.status;
const flush = () => vi.advanceTimersByTimeAsync(0);
/** Requests still waiting for an answer. */
const open = () =>
  requests.filter(
    (request) => !request.aborted && !request.dropped && request.status === 0,
  );

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  online = true;
  uploaded = [];
  ids = 0;
  let sessions = 0;
  api = {
    create: vi.fn(({ file: f }: { file: File }) => {
      sessions += 1;
      return Promise.resolve(session(`s${String(sessions)}`, f.size));
    }),
    partUrls: vi.fn((id: string, parts: number[]) =>
      Promise.resolve(
        parts.map((part) => ({
          part_number: part,
          url: `https://s3.test/${id}/${String(part)}`,
        })),
      ),
    ),
    detail: vi.fn(() => Promise.resolve(detailWith([]))),
    complete: vi.fn((id: string) => Promise.resolve(nodeFor(id))),
    abort: vi.fn(() => Promise.resolve()),
  };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('upload engine', () => {
  it('sends a file in parts through presigned URLs, then completes it', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add(
      [file('big.bin', 8 * MiB * 2 + 10)],
      'folder-1',
    );
    await flush();

    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'folder-1', onConflict: 'fail' }),
    );
    // One batch of URLs for all three parts.
    expect(api.partUrls).toHaveBeenCalledTimes(1);
    expect(api.partUrls).toHaveBeenCalledWith('s1', [1, 2, 3]);
    expect(requests.map((request) => request.body?.size)).toEqual([
      8 * MiB,
      8 * MiB,
      10,
    ]);
    expect(status(id)).toBe('uploading');

    requests[0]?.progress(4 * MiB);
    expect(items()[0]?.loaded).toBe(4 * MiB);
    for (const request of requests) request.ok();
    await flush();
    expect(api.complete).toHaveBeenCalledWith('s1');
    expect(status(id)).toBe('done');
    expect(items()[0]?.loaded).toBe(8 * MiB * 2 + 10);
    expect(uploaded).toEqual(['node-s1']);
  });

  it(`keeps at most ${String(MAX_PARTS_IN_FLIGHT)} parts in flight over the whole queue`, async () => {
    const uploader = engine();
    uploader.add([file('a.bin', 8 * MiB * 3), file('b.bin', 8 * MiB * 3)], 'f');
    await flush();
    expect(open()).toHaveLength(MAX_PARTS_IN_FLIGHT);
    // The first file's parts go first, in order.
    expect(
      open().map((request) => request.url.split('/').slice(-2).join('/')),
    ).toEqual(['s1/1', 's1/2', 's1/3', 's2/1']);
    open()[0]?.ok();
    await flush();
    expect(open()).toHaveLength(MAX_PARTS_IN_FLIGHT);
  });

  it('retries a failed part with backoff, then gives the file up', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add([file('a.bin', 10)], 'f');
    await flush();
    requests[0]?.fail(500);
    await flush();
    expect(open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(open()).toHaveLength(1); // after 1 s

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      open()[0]?.drop();
      await vi.advanceTimersByTimeAsync(16_000);
    }
    expect(status(id)).toBe('uploading');
    open()[0]?.fail(503);
    await flush();
    expect(status(id)).toBe('error');
    expect(items()[0]?.error).toBe('upload_failed');

    // "Retry" carries on from what storage has.
    api.detail.mockResolvedValueOnce(detailWith([]));
    uploader.retry(id);
    await flush();
    expect(api.detail).toHaveBeenCalledWith('s1');
    open()[0]?.ok();
    await flush();
    expect(status(id)).toBe('done');
  });

  it('asks for a fresh URL when storage refuses an expired one', async () => {
    const uploader = engine();
    uploader.add([file('a.bin', 10)], 'f');
    await flush();
    requests[0]?.fail(403);
    await flush();
    expect(api.partUrls).toHaveBeenCalledTimes(2);
    open()[0]?.ok();
    await flush();
    expect(api.complete).toHaveBeenCalled();
  });

  it('pauses, then resumes with only the parts storage lacks', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add([file('a.bin', 8 * MiB * 3)], 'f');
    await flush();
    requests[0]?.ok();
    await flush();
    uploader.pause(id);
    expect(status(id)).toBe('paused');
    expect(requests[1]?.aborted).toBe(true);
    expect(requests[2]?.aborted).toBe(true);

    api.detail.mockResolvedValueOnce(
      detailWith([{ part_number: 1, size: 8 * MiB }]),
    );
    uploader.resume(id);
    await flush();
    expect(status(id)).toBe('uploading');
    expect(items()[0]?.loaded).toBe(8 * MiB);
    const resent = open();
    expect(resent.map((request) => request.url.split('/').at(-1))).toEqual([
      '2',
      '3',
    ]);
    for (const request of resent) request.ok();
    await flush();
    expect(status(id)).toBe('done');
  });

  it('cancels: aborts requests and the session', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add([file('a.bin', 10)], 'f');
    await flush();
    uploader.cancel(id);
    await flush();
    expect(requests[0]?.aborted).toBe(true);
    expect(api.abort).toHaveBeenCalledWith('s1');
    expect(status(id)).toBe('cancelled');
    // A late answer from the aborted request changes nothing.
    requests[0]?.ok();
    await flush();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('holds everything while offline and carries on when back', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add([file('a.bin', 10)], 'f');
    await flush();
    online = false;
    requests[0]?.drop();
    await flush();
    expect(useUploadStore.getState().offline).toBe(true);
    expect(status(id)).toBe('uploading');
    expect(open()).toHaveLength(0);

    online = true;
    uploader.online();
    await flush();
    expect(useUploadStore.getState().offline).toBe(false);
    open()[0]?.ok();
    await flush();
    expect(status(id)).toBe('done');
  });

  it('completes an empty file without any part', async () => {
    const uploader = engine();
    const [id = ''] = uploader.add([file('empty.txt', 0)], 'f');
    await flush();
    expect(requests).toHaveLength(0);
    expect(api.complete).toHaveBeenCalledWith('s1');
    expect(status(id)).toBe('done');
  });

  it('asks about a taken name: keep both renames, skip drops; "for all" answers the rest', async () => {
    api.create.mockImplementation(
      ({ file: f, onConflict }: { file: File; onConflict: string }) =>
        onConflict === 'fail'
          ? Promise.reject(apiError(409, 'name_conflict'))
          : Promise.resolve(session(`renamed-${f.name}`, f.size)),
    );
    const uploader = engine();
    const [a = '', b = '', c = ''] = uploader.add(
      [file('a.txt', 1), file('b.txt', 1), file('c.txt', 1)],
      'f',
    );
    await flush();
    expect([status(a), status(b)]).toEqual(['conflict', 'conflict']);

    uploader.resolveConflict(a, 'skip');
    await flush();
    expect(status(a)).toBe('skipped');
    uploader.resolveConflict(b, 'rename', true);
    await flush();
    // c was checked after the answer: the same choice applies without asking.
    const renamed = api.create.mock.calls.map(
      ([input]) => input as { file: File; onConflict: string },
    );
    expect(
      renamed.some(
        ({ file: f, onConflict }) =>
          f.name === 'b.txt' && onConflict === 'rename',
      ),
    ).toBe(true);
    for (const request of open()) request.ok();
    await flush();
    expect([status(b), status(c)]).toEqual(['done', 'done']);
  });

  it('replaces all conflicts and later conflicts using the same choice', async () => {
    api.create.mockImplementation(({ file: f, onConflict }) =>
      onConflict === 'fail'
        ? Promise.reject(apiError(409, 'name_conflict'))
        : Promise.resolve(session(`replaced-${f.name}`, f.size)),
    );
    const uploader = engine();
    const ids = uploader.add(
      [file('a.txt', 0), file('b.txt', 0), file('c.txt', 0)],
      'f',
    );
    await flush();
    uploader.resolveConflict(ids[0] ?? '', 'replace', true);
    await flush();
    expect(ids.map(status)).toEqual(['done', 'done', 'done']);
    expect(
      api.create.mock.calls.filter(([input]) => input.onConflict === 'replace'),
    ).toHaveLength(3);
  });

  it('reports errors the user has to act on, with their code', async () => {
    api.create.mockRejectedValueOnce(apiError(413, 'quota_exceeded'));
    const uploader = engine();
    const [id = ''] = uploader.add([file('a.txt', 1)], 'f');
    await flush();
    expect(status(id)).toBe('error');
    expect(items()[0]?.error).toBe('quota_exceeded');
    // No retry on its own…
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.create).toHaveBeenCalledTimes(1);
    // …but the user may, once there is room.
    uploader.retry(id);
    await flush();
    expect(api.create).toHaveBeenCalledTimes(2);
  });
});

it('restores the same session after reload and sends only missing parts', async () => {
  const uploader = engine();
  const f = file('resumed.bin', 9 * MiB);
  const existing = {
    ...session('old-session', f.size),
    parent_id: 'original-folder',
    fingerprint: 'hash-resumed.bin',
  };
  api.detail.mockResolvedValueOnce(
    detailWith([{ part_number: 1, size: 8 * MiB }]),
  );
  expect(await uploader.restore(f, existing)).toBe(true);
  await flush();
  expect(api.create).not.toHaveBeenCalled();
  expect(api.detail).toHaveBeenCalledWith('old-session');
  expect(open().map((r) => r.url)).toEqual(['https://s3.test/old-session/2']);
  expect(items()[0]?.loaded).toBe(8 * MiB);
  expect(items()[0]?.parentId).toBe('original-folder');
  // A second selection cannot schedule the same session twice.
  expect(await uploader.restore(f, existing)).toBe(true);
  expect(items()).toHaveLength(1);
  open()[0]?.ok();
  await flush();
  expect(api.complete).toHaveBeenCalledWith('old-session');
});

it('refuses a different file without creating a session or sending bytes', async () => {
  const uploader = engine();
  expect(
    await uploader.restore(file('wrong.bin', 10), {
      ...session('old', 10),
      fingerprint: 'hash-original.bin',
    }),
  ).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
  expect(api.detail).not.toHaveBeenCalled();
  expect(items()).toHaveLength(0);
});

it('does not schedule resumed parts until the server has answered, even when another file finishes', async () => {
  const uploader = engine();
  const [id = ''] = uploader.add([file('a.bin', 9 * MiB)], 'f');
  await flush();
  uploader.pause(id);
  let resolveDetail: (detail: UploadSessionDetail) => void = () => undefined;
  api.detail.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
  );
  uploader.resume(id);
  uploader.add([file('empty', 0)], 'f');
  await flush();
  expect(open()).toHaveLength(0);
  expect(api.complete).not.toHaveBeenCalledWith('s1');
  resolveDetail(detailWith([{ part_number: 1, size: 8 * MiB }]));
  await flush();
  expect(open().map((r) => r.url)).toEqual(['https://s3.test/s1/2']);
});

it('stops requests on logout but leaves server sessions available for reload', async () => {
  const uploader = engine();
  uploader.add([file('a.bin', 10)], 'f');
  await flush();
  uploader.dispose();
  expect(requests[0]?.aborted).toBe(true);
  expect(items()).toHaveLength(0);
  expect(api.abort).not.toHaveBeenCalled();
  requests[0]?.ok();
  await flush();
  expect(api.complete).not.toHaveBeenCalled();
});

it('ignores a file selection that finishes hashing after logout', async () => {
  let resolveHash: (value: string) => void = () => undefined;
  const uploader = engine(
    () =>
      new Promise((resolve) => {
        resolveHash = resolve;
      }),
  );
  const restoring = uploader.restore(file('a.bin', 10), {
    ...session('old', 10),
    fingerprint: 'hash',
  });
  uploader.dispose();
  resolveHash('hash');
  expect(await restoring).toBe(false);
  expect(items()).toHaveLength(0);
  expect(api.detail).not.toHaveBeenCalled();
});
