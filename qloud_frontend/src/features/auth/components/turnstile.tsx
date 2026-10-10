import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/app/theme-provider';

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileOptions {
  sitekey: string;
  theme: 'light' | 'dark';
  size: 'flexible' | 'compact';
  language: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const NORMAL_WIDGET_WIDTH = 300;

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not load'));
    };
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Ask for a fresh token, e.g. after the server rejected the last one. */
  reset: () => void;
}

interface TurnstileProps {
  /** Public site key from GET /api/v1/config; `null` renders nothing. */
  siteKey: string | null;
  /** Receives the token, or `''` once it expires or the check fails. */
  onToken: (token: string) => void;
}

/**
 * Cloudflare Turnstile widget (bot check on signup and password reset).
 * Renders nothing when the server does not check tokens.
 */
export const Turnstile = React.forwardRef<TurnstileHandle, TurnstileProps>(
  function Turnstile({ siteKey, onToken }, ref) {
    const { i18n } = useTranslation();
    const { theme } = useTheme();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const widgetRef = React.useRef<string | undefined>(undefined);
    const onTokenRef = React.useRef(onToken);
    onTokenRef.current = onToken;
    const language = i18n.resolvedLanguage ?? 'vi';

    React.useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetRef.current) window.turnstile?.reset(widgetRef.current);
        onTokenRef.current('');
      },
    }));

    React.useEffect(() => {
      if (!siteKey || !containerRef.current) return;
      const container = containerRef.current;
      let cancelled = false;
      // `theme` may be "system"; the resolved one is the class on <html>.
      const resolvedTheme = document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light';
      void loadTurnstile().then(
        (turnstile) => {
          if (cancelled) return;
          widgetRef.current = turnstile.render(container, {
            sitekey: siteKey,
            theme: resolvedTheme,
            // The normal widget needs 300px; narrow phones get the compact one.
            size:
              container.clientWidth >= NORMAL_WIDGET_WIDTH
                ? 'flexible'
                : 'compact',
            language,
            callback: (token) => {
              onTokenRef.current(token);
            },
            'expired-callback': () => {
              onTokenRef.current('');
            },
            'error-callback': () => {
              onTokenRef.current('');
            },
          });
        },
        () => {
          onTokenRef.current('');
        },
      );
      return () => {
        cancelled = true;
        if (widgetRef.current) window.turnstile?.remove(widgetRef.current);
        widgetRef.current = undefined;
        onTokenRef.current('');
      };
    }, [siteKey, language, theme]);

    if (!siteKey) return null;
    return <div ref={containerRef} className="min-h-[65px]" />;
  },
);
