import { delay, http, HttpResponse } from 'msw';

import type { DriveNode } from '@/features/drive/api';

import { testUser } from './auth';

export const ROOT_ID = '0190c0de-0000-7000-8000-00000000f000';

/** An in-memory folder tree behind the drive endpoints (M2-02, M2-05). */
export class FakeDrive {
  nodes = new Map<string, DriveNode>();
  requests: URL[] = [];
  /** Milliseconds every write waits, to observe optimistic updates. */
  writeDelay = 0;
  failChildren = false;
  private counter = 0;

  constructor() {
    this.nodes.set(
      ROOT_ID,
      this.make({ id: ROOT_ID, name: 'Drive', parent_id: null }),
    );
  }

  private make(
    fields: Partial<DriveNode> & Pick<DriveNode, 'name'>,
  ): DriveNode {
    this.counter += 1;
    const stamp = new Date(Date.UTC(2026, 9, 1, 0, this.counter)).toISOString();
    return {
      id: `0190c0de-0000-7000-8000-${String(this.counter).padStart(12, '0')}`,
      kind: 'folder',
      parent_id: ROOT_ID,
      is_root: fields.parent_id === null,
      size: 0,
      mime_type: null,
      created_at: stamp,
      updated_at: stamp,
      ...fields,
    };
  }

  folder(name: string, parent = ROOT_ID): DriveNode {
    const node = this.make({ name, parent_id: parent });
    this.nodes.set(node.id, node);
    return node;
  }

  file(
    name: string,
    parent = ROOT_ID,
    size = 1234,
    mime = 'application/pdf',
  ): DriveNode {
    const node = this.make({
      name,
      parent_id: parent,
      kind: 'file',
      size,
      mime_type: mime,
    });
    this.nodes.set(node.id, node);
    return node;
  }

  private children(parent: string, ordering: string): DriveNode[] {
    const field = ordering.replace('-', '') as 'name' | 'size' | 'updated_at';
    const sign = ordering.startsWith('-') ? -1 : 1;
    const compare = (a: DriveNode, b: DriveNode): number =>
      field === 'name'
        ? a.name.localeCompare(b.name, 'en', { numeric: true })
        : field === 'size'
          ? a.size - b.size
          : a.updated_at.localeCompare(b.updated_at);
    return [...this.nodes.values()]
      .filter((node) => node.parent_id === parent)
      .sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'folder'
            ? -1
            : 1
          : sign * compare(a, b),
      );
  }

  private detail(node: DriveNode) {
    const breadcrumb = [];
    let parent = node.parent_id ? this.nodes.get(node.parent_id) : undefined;
    while (parent) {
      breadcrumb.unshift({ id: parent.id, name: parent.name });
      parent = parent.parent_id ? this.nodes.get(parent.parent_id) : undefined;
    }
    const editable = !node.is_root;
    return {
      ...node,
      breadcrumb,
      capabilities: {
        can_edit: editable,
        can_trash: editable,
        can_share: editable,
      },
    };
  }

  private conflict(
    parent: string | null,
    name: string,
    except?: string,
  ): boolean {
    return [...this.nodes.values()].some(
      (node) =>
        node.parent_id === parent &&
        node.id !== except &&
        node.name.toLowerCase() === name.toLowerCase(),
    );
  }

  handlers() {
    const notFound = () =>
      HttpResponse.json(
        { error: { code: 'not_found', message: 'Not found.', details: {} } },
        { status: 404 },
      );
    const nameConflict = () =>
      HttpResponse.json(
        { error: { code: 'name_conflict', message: 'Taken.', details: {} } },
        { status: 409 },
      );
    return [
      http.get('/api/v1/me', () =>
        HttpResponse.json({
          id: testUser.id,
          email: testUser.email,
          display_name: '',
          avatar_url: null,
          locale: 'en',
          theme: 'system',
          root_folder_id: ROOT_ID,
        }),
      ),
      http.get('/api/v1/nodes/:id', ({ params }) => {
        const node = this.nodes.get(String(params.id));
        return node ? HttpResponse.json(this.detail(node)) : notFound();
      }),
      http.get('/api/v1/nodes/:id/children', ({ params, request }) => {
        const url = new URL(request.url);
        this.requests.push(url);
        if (this.failChildren) {
          return HttpResponse.json(
            { error: { code: 'error', message: 'Down.', details: {} } },
            { status: 500 },
          );
        }
        if (!this.nodes.has(String(params.id))) return notFound();
        const ordering = url.searchParams.get('ordering') ?? 'name';
        const size = Number(url.searchParams.get('page_size') ?? 50);
        const start = Number(url.searchParams.get('cursor') ?? 0);
        const all = this.children(String(params.id), ordering);
        const next = new URL(url);
        next.searchParams.set('cursor', String(start + size));
        return HttpResponse.json({
          results: all.slice(start, start + size),
          next: start + size < all.length ? next.toString() : null,
          previous: null,
        });
      }),
      http.post('/api/v1/folders', async ({ request }) => {
        const body = (await request.json()) as {
          parent_id: string;
          name: string;
        };
        await delay(this.writeDelay);
        if (this.conflict(body.parent_id, body.name)) return nameConflict();
        return HttpResponse.json(this.folder(body.name, body.parent_id), {
          status: 201,
        });
      }),
      http.patch('/api/v1/nodes/:id', async ({ params, request }) => {
        const body = (await request.json()) as { name: string };
        await delay(this.writeDelay);
        const node = this.nodes.get(String(params.id));
        if (!node) return notFound();
        if (this.conflict(node.parent_id, body.name, node.id))
          return nameConflict();
        const renamed = { ...node, name: body.name };
        this.nodes.set(node.id, renamed);
        return HttpResponse.json(this.detail(renamed));
      }),
      http.get('/api/v1/nodes/:id/download', ({ params }) =>
        HttpResponse.json({
          url: `https://storage.example/${String(params.id)}?signed`,
          expires_at: '2026-10-10T00:05:00Z',
        }),
      ),
    ];
  }
}
