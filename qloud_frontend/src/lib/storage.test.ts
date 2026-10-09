import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStorage, writeStorage } from './storage';

describe('storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reads and writes values', () => {
    writeStorage('key', 'value');

    expect(readStorage('key')).toBe('value');
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(readStorage('key')).toBeNull();
    expect(() => {
      writeStorage('key', 'value');
    }).not.toThrow();
  });
});
