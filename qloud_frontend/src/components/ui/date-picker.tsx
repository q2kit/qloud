import { CalendarDays, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_STEP = 5;
const MINUTES = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, i) => i * MINUTE_STEP,
);
const pad = (value: number) => String(value).padStart(2, '0');

/** yyyy/mm/dd, the same in every language. */
const formatDay = (date: Date) =>
  `${String(date.getFullYear())}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

interface TriggerProps {
  id?: string;
  label: string;
  text: string | null;
  placeholder: string;
  onClear?: () => void;
}

function Trigger({
  id,
  label,
  text,
  placeholder,
  onClear,
}: TriggerProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="relative min-w-0">
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={text ? `${label}: ${text}` : label}
          className={cn(
            'flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background pr-9 pl-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !text && 'text-muted-foreground',
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{text ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      {text && onClear && (
        <button
          type="button"
          aria-label={t('datePicker.clear')}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** A day, shown in the user's language; `null` when cleared. */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  placeholder: string;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const text = value ? formatDay(value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger
        id={id}
        label={label}
        text={text}
        placeholder={placeholder}
        onClear={() => {
          onChange(null);
        }}
      />
      <PopoverContent className="w-auto">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          defaultMonth={value ?? undefined}
          autoFocus
          onSelect={(day) => {
            onChange(day ?? null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A future moment: a day plus hour and minute (5-minute steps). A new day keeps
 * the time already chosen, or the current time, so "tomorrow" means 24 hours.
 */
export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  placeholder: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const today = startOfDay(new Date());
  const text = value
    ? `${formatDay(value)} ${pad(value.getHours())}:${pad(value.getMinutes())}`
    : null;
  const setTime = (hours: number, minutes: number) => {
    const next = new Date(value ?? new Date());
    next.setHours(hours, minutes, 0, 0);
    onChange(next);
  };
  const pickDay = (day: Date | undefined) => {
    if (!day) return;
    const base = value ?? new Date(Date.now() + MINUTE_STEP * 60_000);
    const minutes = value
      ? base.getMinutes()
      : Math.ceil(base.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
    const next = new Date(day);
    next.setHours(base.getHours(), minutes, 0, 0);
    onChange(next);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Trigger
        id={id}
        label={label}
        text={text}
        placeholder={placeholder}
        onClear={() => {
          onChange(null);
        }}
      />
      <PopoverContent className="w-auto">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          defaultMonth={value ?? today}
          disabled={{ before: today }}
          autoFocus
          onSelect={pickDay}
        />
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="mr-auto text-muted-foreground">
            {t('datePicker.time')}
          </span>
          <Select
            disabled={!value}
            value={value ? String(value.getHours()) : undefined}
            onValueChange={(hour) => {
              setTime(Number(hour), value?.getMinutes() ?? 0);
            }}
          >
            <SelectTrigger
              className="h-9 w-18"
              aria-label={t('datePicker.hour')}
            >
              <SelectValue placeholder="--" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {HOURS.map((hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {pad(hour)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span aria-hidden="true">:</span>
          <Select
            disabled={!value}
            value={value ? String(value.getMinutes()) : undefined}
            onValueChange={(minute) => {
              setTime(value?.getHours() ?? 0, Number(minute));
            }}
          >
            <SelectTrigger
              className="h-9 w-18"
              aria-label={t('datePicker.minute')}
            >
              <SelectValue placeholder="--" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {[...new Set([...MINUTES, value?.getMinutes() ?? 0])]
                .sort((a, b) => a - b)
                .map((minute) => (
                  <SelectItem key={minute} value={String(minute)}>
                    {pad(minute)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('datePicker.done')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
