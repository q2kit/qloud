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
