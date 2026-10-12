import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Turnstile,
  type TurnstileHandle,
} from '@/features/auth/components/turnstile';
import { useAppConfig } from '@/lib/use-app-config';
import { ApiError } from '@/lib/api/errors';
import { reasons, useCreateReport, type ReportReason } from './api';

export function ReportDialog({
  token,
  node,
  onClose,
}: {
  token: string;
  node: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const config = useAppConfig();
  const submit = useCreateReport(token, node.id);
  const captcha = React.useRef<TurnstileHandle>(null);
  const [reason, setReason] = React.useState<ReportReason>('other');
  const [message, setMessage] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [captchaToken, setCaptchaToken] = React.useState('');
  const siteKey = config.data?.turnstile_site_key ?? null;
  const error =
    submit.error instanceof ApiError
      ? t(
          `report.errors.${submit.error.status === 429 ? 'throttled' : submit.error.status === 404 ? 'unavailable' : submit.error.code === 'captcha_invalid' ? 'captcha' : 'failed'}`,
        )
      : t('report.errors.failed');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !submit.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          data-report-dialog
          className="fixed top-1/2 left-1/2 z-[70] max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-soft outline-none"
        >
          <Dialog.Title className="break-words text-lg font-semibold">
            {t('report.title', { name: node.name })}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {t('report.description')}
          </Dialog.Description>
          {submit.isSuccess ? (
            <p role="status" className="mt-4">
              {t('report.success')}
            </p>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit.mutate(
                  {
                    reason,
                    message,
                    email: email.trim(),
                    turnstile_token: captchaToken,
                  },
                  {
                    onError: () => {
                      captcha.current?.reset();
                      setCaptchaToken('');
                    },
                  },
                );
              }}
            >
              <fieldset disabled={submit.isPending} className="space-y-4">
                <div className="text-sm">
                  <label htmlFor="report-reason">{t('report.reason')}</label>
                  <Select
                    value={reason}
                    disabled={submit.isPending}
                    onValueChange={(next) => {
                      const value = reasons.find((item) => item === next);
                      if (value) setReason(value);
                    }}
                  >
                    <SelectTrigger id="report-reason" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {reasons.map((item) => (
                        <SelectItem key={item} value={item}>
                          {t(`report.reasons.${item}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="block text-sm">
                  {t('report.message')}
                  <textarea
                    maxLength={2000}
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                    }}
                    className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3"
                  />
                </label>
                <label className="block text-sm">
                  {t('report.email')}
                  <input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                  />
                </label>
                <Turnstile
                  ref={captcha}
                  siteKey={siteKey}
                  onToken={setCaptchaToken}
                />
              </fieldset>
              {config.isError && (
                <p role="alert">{t('report.errors.failed')}</p>
              )}
              {submit.isError && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={
                  submit.isPending ||
                  !config.isSuccess ||
                  (Boolean(siteKey) && !captchaToken)
                }
              >
                {t(submit.isPending ? 'report.sending' : 'report.send')}
              </Button>
            </form>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              disabled={submit.isPending}
              onClick={onClose}
            >
              {t('sharing.close')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
