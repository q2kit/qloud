import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import '@/lib/i18n';

import type { PreviewLink } from '../preview-api';
import { PreviewContent } from './preview-content';

const pause = vi.fn();
const load = vi.fn();
beforeEach(() => {
  pause.mockClear();
  load.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(load);
});
afterEach(() => {
  vi.restoreAllMocks();
});

it.each(['video', 'audio'] as const)(
  'keeps the %s source after StrictMode effect replay, refreshes it and releases it on close',
  (kind) => {
    const link: PreviewLink = {
      kind,
      url: 'https://storage.example/old',
      expires_at: new Date(Date.now() + 300000).toISOString(),
      thumbnail: null,
    };
    const onError = vi.fn();
    const view = render(
      <StrictMode>
        <PreviewContent link={link} name="media" onError={onError} />
      </StrictMode>,
    );
    const player = view.container.querySelector(kind);
    expect(player).toHaveAttribute('src', link.url);
    view.rerender(
      <StrictMode>
        <PreviewContent
          link={{ ...link, url: 'https://storage.example/new' }}
          name="media"
          onError={onError}
        />
      </StrictMode>,
    );
    expect(player).toHaveAttribute('src', 'https://storage.example/new');
    view.unmount();
    expect(player).not.toHaveAttribute('src');
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  },
);
