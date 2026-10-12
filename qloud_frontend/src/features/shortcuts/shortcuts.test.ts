import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortcutDispatcher, SEQUENCE_TIMEOUT } from './dispatcher';
import {
  ariaKeyshortcuts,
  comboKeys,
  matchesCombo,
  matchesShortcut,
  shortcutLabel,
} from './keys';

let clock = 0;
const dispatcher = new ShortcutDispatcher(() => clock);
const removers: (() => void)[] = [];

function on(
  id: Parameters<ShortcutDispatcher['register']>[0]['id'],
  options = {},
) {
  const run = vi.fn();
  removers.push(dispatcher.register({ id, run, options }));
  return run;
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  // Dispatch first so the event has its target, as on the window listener.
  target.dispatchEvent(event);
  dispatcher.handle(event);
  return event;
}

function element(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  removers.push(() => {
    host.remove();
  });
  return host;
}

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  clock = 0;
});

describe('ShortcutDispatcher', () => {
  it('runs a shortcut and prevents the browser default', () => {
    const share = on('share');
    const event = press('s');
    expect(share).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['input', '<input />'],
    ['textarea', '<textarea></textarea>'],
    ['select', '<select></select>'],
    ['contenteditable', '<div contenteditable="true"></div>'],
    ['plaintext-only', '<div contenteditable="plaintext-only"></div>'],
  ])('ignores keys typed in %s', (_name, html) => {
    const share = on('share');
    const field = element(html).firstElementChild;
    if (!field) throw new Error('missing field');
    const event = press('s', {}, field);
    expect(share).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets an allowed Ctrl/⌘ binding run from a text field, never a single key', () => {
    const palette = on('palette', { allowInInput: true });
    const field = element('<input />').querySelector('input');
    if (!field) throw new Error('missing input');
    press('/', {}, field);
    expect(palette).not.toHaveBeenCalled();
    press('k', { ctrlKey: true }, field);
    press('k', { metaKey: true }, field);
    expect(palette).toHaveBeenCalledTimes(2);
  });

  it('ignores IME composition, auto-repeat and handled events', () => {
    const share = on('share');
    press('s', { isComposing: true });
    press('s', { keyCode: 229 });
    press('s', { repeat: true });
    const handled = new KeyboardEvent('keydown', {
      key: 's',
      cancelable: true,
    });
    handled.preventDefault();
    dispatcher.handle(handled);
    expect(share).not.toHaveBeenCalled();
  });

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
    'waits while a %s is open',
    (role) => {
      const share = on('share');
      element(`<div role="${role}"></div>`);
      press('s');
      expect(share).not.toHaveBeenCalled();
    },
  );

  it('runs inside the overlay a shortcut belongs to, not inside another one', () => {
    const details = on('details', { within: '[data-sheet]' });
    const sheet = element(
      '<div role="dialog" data-sheet><button></button></div>',
    );
    const button = sheet.querySelector('button');
    if (!button) throw new Error('missing button');
    press('i', {}, button);
    expect(details).toHaveBeenCalledOnce();
    element('<div role="dialog"></div>');
    press('i', {}, button);
    expect(details).toHaveBeenCalledOnce();
  });

  it('keeps the Drive list available but leaves other listboxes to typeahead', () => {
    const share = on('share');
    const list = element(
      '<div role="listbox" data-shortcut-scope><div role="option" tabindex="0"></div></div>',
    );
    const option = list.querySelector('[role="option"]');
    if (!option) throw new Error('missing option');
    press('s', {}, option);
    expect(share).toHaveBeenCalledOnce();
  });

  it('needs the exact modifiers: no Ctrl/⌘/Alt on single keys, Shift where named', () => {
    const upload = on('upload');
    const uploadFolder = on('uploadFolder');
    press('u', { ctrlKey: true });
    press('u', { altKey: true });
    expect(upload).not.toHaveBeenCalled();
    press('U', { shiftKey: true });
    expect(uploadFolder).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
    press('u');
    expect(upload).toHaveBeenCalledOnce();
  });

  it('runs a G sequence within a second, and the second key is not a shortcut of its own', () => {
    const goDrive = on('goDrive');
    const download = on('download');
    press('g');
    clock += SEQUENCE_TIMEOUT;
    press('d');
    expect(goDrive).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });

  it('drops a G sequence after the timeout or another key', () => {
    const goTrash = on('goTrash');
    press('g');
    clock += SEQUENCE_TIMEOUT + 1;
    press('t');
    press('g');
    press('x');
    press('t');
    expect(goTrash).not.toHaveBeenCalled();
  });

  it('gives a shared key to the latest enabled registration', () => {
    const page = on('download');
    const viewer = on('download');
    on('download', { enabled: false });
    press('d');
    expect(viewer).toHaveBeenCalledOnce();
    expect(page).not.toHaveBeenCalled();
  });
});

describe('keys', () => {
  const event = (key: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key, ...init });

  it('matches by event.key, so other layouts work, and implies Shift for symbols', () => {
    expect(matchesCombo(event('?', { shiftKey: true }), { key: '?' })).toBe(
      true,
    );
    // AZERTY: the key printing "a" is where QWERTY has "q".
    expect(matchesShortcut(event('a', { ctrlKey: true }), 'selectAll')).toBe(
      true,
    );
    expect(matchesShortcut(event('Delete', { shiftKey: true }), 'trash')).toBe(
      false,
    );
    expect(
      matchesShortcut(event('Enter', { metaKey: true }), 'openInNewTab'),
    ).toBe(true);
    expect(matchesShortcut(event('Enter', { metaKey: true }), 'open')).toBe(
      false,
    );
  });

  it('labels keys for the platform', () => {
    expect(shortcutLabel('palette', true)).toBe('⌘K');
    expect(shortcutLabel('palette', false)).toBe('Ctrl+K');
    expect(shortcutLabel('newFolder', true)).toBe('⇧N');
    expect(shortcutLabel('newFolder', false)).toBe('Shift+N');
    expect(shortcutLabel('goSettings', false)).toBe('G ,');
    expect(comboKeys({ key: 'Enter', mod: true }, true)).toEqual(['⌘', '↵']);
    expect(comboKeys({ key: 'Enter', mod: true }, false)).toEqual([
      'Ctrl',
      '↵',
    ]);
  });

  it('describes one-press bindings for aria-keyshortcuts', () => {
    expect(ariaKeyshortcuts('palette')).toBe('Control+K Meta+K /');
    expect(ariaKeyshortcuts('uploadFolder')).toBe('Shift+U');
    expect(ariaKeyshortcuts('toggleSelection')).toBe(
      'Control+Space Meta+Space',
    );
    expect(ariaKeyshortcuts('goDrive')).toBeUndefined();
  });
});
