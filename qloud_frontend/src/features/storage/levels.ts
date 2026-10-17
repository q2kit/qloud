import type { StorageLevel } from './api';

export const LEVEL_BAR: Record<StorageLevel, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  critical: 'bg-destructive',
  full: 'bg-destructive',
};

export const LEVEL_TEXT: Record<StorageLevel, string> = {
  normal: 'text-muted-foreground',
  warning: 'text-warning',
  critical: 'text-destructive',
  full: 'text-destructive',
};

/** A CSS width for a bar segment, clamped to 0–100%. */
export function barWidth(percent: number): string {
  return `${Math.min(100, Math.max(0, percent)).toFixed(2)}%`;
}
