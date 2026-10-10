import { expect, type Page } from '@playwright/test';

const AUTH = '/api/auth/browser/v1';
export const E2E_PASSWORD = 'qloud-e2e-password';

/**
 * Sign a fresh account in through the real API; the cookies land in the page's
 * browser context. E2E runs Django with test settings: no Turnstile or limits.
 */
export async function signUpViaApi(page: Page): Promise<string> {
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  await page.request.get(`${AUTH}/config`);
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'csrftoken')?.value;
  const response = await page.request.post(`${AUTH}/auth/signup`, {
    data: { email, password: E2E_PASSWORD, turnstile_token: '' },
    headers: { 'X-CSRFToken': csrf ?? '' },
  });
  expect(response.status()).toBe(200);
  return email;
}

/** Sign up and verify the address through the link in the email (uploads need it). */
export async function signUpVerifiedViaApi(page: Page): Promise<string> {
  const email = await signUpViaApi(page);
  const { linkFromEmail } = await import('./mailpit');
  await page.goto(await linkFromEmail(email, '/verify-email/'));
  await expect(
    page.getByRole('heading', { name: 'Đã xác thực email' }),
  ).toBeVisible();
  return email;
}
