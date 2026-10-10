import type { TFunction } from 'i18next';

import { AuthApiError } from './api';

export interface AuthErrorMessages {
  /** Message shown above the form, if any. */
  form?: string;
  /** Messages shown under the matching input. */
  fields: Partial<Record<string, string>>;
  /** allauth error codes, for screens that react to a specific failure. */
  codes: string[];
}

/** The emailed key is wrong, used or expired: only a new email helps. */
export const INVALID_LINK_CODES = [
  'invalid_or_expired_key',
  'invalid_password_reset',
];

// Codes with a message of our own; anything else falls back to the server's
// message, which is already in the UI language (requests send Accept-Language).
const FORM_CODES: Record<string, string> = {
  email_password_mismatch: 'auth.errors.invalidCredentials',
  invalid_login: 'auth.errors.invalidCredentials',
  too_many_login_attempts: 'auth.errors.rateLimited',
  captcha_invalid: 'auth.errors.captchaInvalid',
  invalid_or_expired_key: 'auth.errors.invalidLink',
  invalid_password_reset: 'auth.errors.invalidLink',
};

const FIELD_CODES: Record<string, string> = {
  email_taken: 'auth.errors.emailTaken',
};

const STATUS_MESSAGES: Record<number, string> = {
  401: 'auth.errors.accountUnavailable',
  403: 'auth.errors.signupClosed',
  429: 'auth.errors.rateLimited',
};

export function authErrorMessages(
  error: unknown,
  t: TFunction,
): AuthErrorMessages {
  if (!(error instanceof AuthApiError)) {
    return { form: t('auth.errors.generic'), fields: {}, codes: [] };
  }
  const statusKey = STATUS_MESSAGES[error.status];
  if (statusKey && error.errors.length === 0) {
    return { form: t(statusKey), fields: {}, codes: [] };
  }
  const messages: AuthErrorMessages = {
    fields: {},
    codes: error.errors.map((item) => item.code),
  };
  for (const item of error.errors) {
    const formKey = FORM_CODES[item.code];
    const fieldKey = FIELD_CODES[item.code];
    if (formKey) {
      messages.form ??= t(formKey);
    } else if (item.param && item.param !== 'turnstile_token') {
      messages.fields[item.param] ??= fieldKey ? t(fieldKey) : item.message;
    } else {
      messages.form ??= item.message || t('auth.errors.generic');
    }
  }
  if (!messages.form && Object.keys(messages.fields).length === 0) {
    messages.form = t(statusKey ?? 'auth.errors.generic');
  }
  return messages;
}

/** The `next` target after signing in; only same-site paths are followed. */
export function safeNextPath(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
