import { StrictMode } from 'react';
import { fireEvent, render } from '@testing-library/react';
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

it.each(['video', 'audio'] as const)(
  'preserves the %s position and user playback intent across a source refresh',
  (kind) => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue();
    const onError = vi.fn();
    const link: PreviewLink = {
      kind,
      url: 'https://storage.example/old',
      expires_at: null,
      thumbnail: null,
    };
    const view = render(
      <PreviewContent link={link} name="media" onError={onError} />,
    );
    const player = view.container.querySelector<HTMLMediaElement>(kind);
    if (!player) throw new Error('Missing media player');
    fireEvent.loadedMetadata(player);
    player.currentTime = 42;
    fireEvent.timeUpdate(player);
    fireEvent.play(player);
    view.rerender(
      <PreviewContent
        link={{ ...link, url: 'https://storage.example/new' }}
        name="media"
        onError={onError}
      />,
    );
    // Browser events from cleanup arrive after setup resets the source to zero.
    player.currentTime = 0;
    fireEvent.pause(player);
    fireEvent.timeUpdate(player);
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(42);
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.pause(player);
    player.currentTime = 17;
    fireEvent.timeUpdate(player);
    view.rerender(
      <PreviewContent
        link={{ ...link, url: 'https://storage.example/paused' }}
        name="media"
        onError={onError}
      />,
    );
    player.currentTime = 0;
    fireEvent.pause(player);
    fireEvent.timeUpdate(player);
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(17);
    expect(play).toHaveBeenCalledTimes(1);
    view.unmount();
  },
);
