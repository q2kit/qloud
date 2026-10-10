/** Public Turnstile site key; empty (as in tests and E2E) turns the widget off. */
export const turnstileSiteKey: string =
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
