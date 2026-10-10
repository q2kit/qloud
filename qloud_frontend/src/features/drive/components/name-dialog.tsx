import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormField } from '@/features/auth/components/form-field';

interface NameDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  initialName: string;
  /** Select the name without its extension, so typing keeps `.pdf`. */
  keepExtension?: boolean;
  error?: string;
  pending?: boolean;
  onSubmit: (name: string) => void;
  onOpenChange: (open: boolean) => void;
}

/** "New folder" and "Rename": one name field, Enter to confirm, Esc to cancel. */
export function NameDialog({
  open,
  title,
  onOpenChange,
  ...form
}: NameDialogProps): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-soft outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const input =
              event.currentTarget instanceof HTMLElement
                ? event.currentTarget.querySelector('input')
                : null;
            if (!input) return;
            input.focus();
            const dot = form.keepExtension ? input.value.lastIndexOf('.') : -1;
            input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
          }}
        >
          <Dialog.Title className="text-base font-semibold">
            {title}
          </Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {/* Radix unmounts the content when closed, so each opening starts fresh. */}
          <NameForm {...form} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NameForm({
  submitLabel,
  initialName,
  error,
  pending = false,
  onSubmit,
}: Omit<
  NameDialogProps,
  'open' | 'title' | 'onOpenChange'
>): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = React.useState(initialName);
  return (
    <form
      className="mt-4 space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(name);
      }}
    >
      <FormField
        label={t('drive.fields.name')}
        name="name"
        autoComplete="off"
        value={name}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button type="button" variant="ghost">
            {t('drive.actions.cancel')}
          </Button>
        </Dialog.Close>
        <Button type="submit" disabled={pending || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
