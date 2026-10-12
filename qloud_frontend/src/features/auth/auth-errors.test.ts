import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';

import { AuthApiError } from './api';
import { authErrorMessages, safeNextPath } from './auth-errors';

const t = i18n.getFixedT('en');

describe('authErrorMessages', () => {
  it('uses our own wording for known codes', () => {
    const error = new AuthApiError(400, [
      { code: 'email_password_mismatch', message: 'x', param: 'password' },
    ]);
    expect(authErrorMessages(error, t)).toEqual({
      form: 'The email or password is incorrect.',
      fields: {},
      codes: ['email_password_mismatch'],
    });
  });

  it('puts field errors under their field, keeping server wording for others', () => {
    const error = new AuthApiError(400, [
      { code: 'email_taken', message: 'Taken', param: 'email' },
      {
        code: 'password_too_short',
        message: 'Too short (server)',
        param: 'password',
      },
    ]);
    expect(authErrorMessages(error, t).fields).toEqual({
      email: 'This email is already registered.',
      password: 'Too short (server)',
    });
  });

  it('shows a failed bot check above the form', () => {
    const error = new AuthApiError(400, [
      { code: 'captcha_invalid', message: 'x', param: 'turnstile_token' },
    ]);
    expect(authErrorMessages(error, t).form).toBe(
      "Couldn't complete verification. Please try again.",
    );
  });

  it.each([
    [429, 'Too many attempts. Please wait a minute and try again.'],
    [403, 'Qloud is not accepting new accounts right now.'],
    [401, "Couldn't sign in to this account."],
  ])('explains a bare %i', (status, message) => {
    expect(authErrorMessages(new AuthApiError(status, []), t).form).toBe(
      message,
    );
  });

  it('falls back to a generic message for network failures', () => {
    expect(authErrorMessages(new TypeError('Failed to fetch'), t).form).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/trash', '/trash'],
    ['/drive?x=1', '/drive?x=1'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });
});
