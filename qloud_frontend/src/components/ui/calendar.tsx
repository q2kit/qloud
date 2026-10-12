import { DayPicker } from '@daypicker/react';
import { enUS, vi } from '@daypicker/react/locale';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

const CHEVRONS = {
  left: ChevronLeft,
  right: ChevronRight,
  up: ChevronUp,
  down: ChevronDown,
};

/** shadcn-style calendar on DayPicker, in the app's language and tokens. */
function Calendar({
  className,
  classNames,
  ...props
}: React.ComponentProps<typeof DayPicker>): React.JSX.Element {
  const { i18n } = useTranslation();
  return (
    <DayPicker
      locale={i18n.language === 'vi' ? vi : enUS}
      showOutsideDays
      className={cn('w-fit text-sm', className)}
      classNames={{
        months: 'relative flex flex-col',
        month: 'space-y-3',
        month_caption:
          'flex h-8 items-center justify-center font-medium capitalize',
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
        button_previous:
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40',
        button_next:
          'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-center text-xs font-normal text-muted-foreground',
        week: 'mt-1 flex',
        day: 'size-9 p-0 text-center',
        day_button:
          'inline-flex size-9 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        today: 'font-semibold text-primary',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
        outside: 'text-muted-foreground opacity-50',
        disabled:
          'text-muted-foreground opacity-40 [&>button]:hover:bg-transparent',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation = 'left', className: chevron }) => {
          const Icon = CHEVRONS[orientation];
          return <Icon className={cn('size-4', chevron)} />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
