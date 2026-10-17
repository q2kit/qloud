const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal units (1 KB = 1000 B), like the plans in quota.md; locale-aware digits. */
export function formatBytes(bytes: number, locale: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${UNITS[unit] ?? 'B'}`;
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** "5 minutes ago" in the locale; the full time belongs in a tooltip (formatDate). */
export function formatRelative(
  iso: string,
  locale: string,
  now = Date.now(),
): string {
  let value = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size)
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
        Math.round(value),
        unit,
      );
    value /= size;
  }
  return formatDate(iso, locale);
}
