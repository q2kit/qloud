import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { fingerprint } from './fingerprint';

beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>(
    'node:crypto',
  );
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

it('matches the same file and distinguishes content, name, size and modification time', async () => {
  const f = (content: string, name = 'a.txt', lastModified = 123) =>
    new File([content], name, { lastModified });
  const original = await fingerprint(f('abc'));
  expect(await fingerprint(f('abc'))).toBe(original);
  for (const changed of [
    f('abd'),
    f('abcd'),
    f('abc', 'b.txt'),
    f('abc', 'a.txt', 124),
  ])
    expect(await fingerprint(changed)).not.toBe(original);
  expect(await fingerprint(f('', 'a'.repeat(255)))).toMatch(/^[a-f0-9]{64}$/);
});

it('only samples the first MiB of a large file', async () => {
  const data = new Uint8Array(1024 * 1024 + 10);
  const first = new File([data], 'big', { lastModified: 123 });
  data[data.length - 1] = 1;
  const second = new File([data], 'big', { lastModified: 123 });
  expect(await fingerprint(second)).toBe(await fingerprint(first));
});
