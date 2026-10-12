import { expect, test, type Page } from '@playwright/test';

import { E2E_PASSWORD, signUpViaApi } from './auth';
import { linkFromEmail } from './mailpit';

const AUTH = '/api/auth/browser/v1';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

/** Pick the identity on the fake provider's page (e2e/oauth-provider.ts). */
async function approveOAuth(
  page: Page,
  identity: { email: string; name: string; verified?: boolean },
) {
  await expect(page.getByRole('heading', { name: /^Fake / })).toBeVisible();
  await page.getByLabel('Email').fill(identity.email);
  await page.getByLabel('Name').fill(identity.name);
  await page.getByLabel('Verified').setChecked(identity.verified ?? true);
  await page.getByRole('button', { name: 'Allow' }).click();
}

function linkedAccount(page: Page, provider: string) {
  return page
    .getByRole('region', { name: 'Tài khoản liên kết' })
    .getByRole('listitem')
    .filter({ hasText: provider });
}

test.describe('email verification', () => {
  test('the link in the signup email verifies the address', async ({
    page,
  }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Đăng ký' }).click();
    await expect(
      page.getByRole('heading', { name: 'Kiểm tra hộp thư của bạn' }),
    ).toBeVisible();

    await page.goto(await linkFromEmail(email, '/verify-email/'));
    await expect(
      page.getByRole('heading', { name: 'Đã xác thực email' }),
    ).toBeVisible();
    const addresses = await page.request.get(`${AUTH}/account/email`);
    expect(await addresses.json()).toMatchObject({
      data: [{ email, verified: true }],
    });

    await page.getByRole('link', { name: 'Vào Drive' }).click();
    await expect(page).toHaveURL(/\/drive$/);
  });

  test('a broken link says so', async ({ page }) => {
    await page.goto('/verify-email/not-a-key');
    await expect(
      page.getByRole('heading', { name: 'Không thể xác thực email' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  });
});

test('a password reset signs out every old session', async ({
  page,
  browser,
}) => {
  // This browser stays signed in while another one resets the password.
  const email = await signUpViaApi(page);
  await page.goto('/trash');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thùng rác');

  const other = await browser.newContext({ locale: 'vi-VN' });
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await otherPage.getByRole('link', { name: 'Quên mật khẩu?' }).click();
  await expect(
    otherPage.getByRole('heading', { name: 'Quên mật khẩu' }),
  ).toBeVisible();
  await otherPage.getByLabel('Email').fill(email);
  await otherPage.getByRole('button', { name: 'Gửi liên kết' }).click();
  await expect(
    otherPage.getByRole('heading', { name: 'Kiểm tra hộp thư của bạn' }),
  ).toBeVisible();

  const link = await linkFromEmail(email, '/password/reset/');
  await otherPage.goto(link);
  await otherPage.getByLabel('Mật khẩu mới').fill('qloud-e2e-new-password');
  await otherPage.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(
    otherPage.getByRole('heading', { name: 'Đã đổi mật khẩu' }),
  ).toBeVisible();

  // The link is single use.
  await otherPage.goto(link);
  await otherPage.getByLabel('Mật khẩu mới').fill('qloud-e2e-other-password');
  await otherPage.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await expect(
    otherPage.getByText('Liên kết không hợp lệ hoặc đã hết hạn.'),
  ).toBeVisible();

  // The old password is refused, the new one works.
  await signIn(otherPage, email, E2E_PASSWORD);
  await expect(
    otherPage.getByText('Email hoặc mật khẩu không đúng.'),
  ).toBeVisible();
  await otherPage.getByLabel('Mật khẩu').fill('qloud-e2e-new-password');
  await otherPage.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(otherPage).toHaveURL(/\/drive$/);
  await other.close();

  // The first browser's session is gone.
  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=%2Ftrash$/);
});

test.describe('OAuth', () => {
  test('GitHub creates a new account', async ({ page }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await page.goto('/login?next=%2Fsettings');
    await page.getByRole('button', { name: 'Tiếp tục với GitHub' }).click();
    await approveOAuth(page, {
      email,
      name: 'Người dùng GitHub',
    });

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByLabel('Tên hiển thị')).toHaveValue(
      'Người dùng GitHub',
    );
    await expect(linkedAccount(page, 'GitHub')).toContainText(
      email.split('@')[0] ?? '',
    );
    // No password yet: the account can only set one.
    await expect(
      page.getByRole('heading', { name: 'Đặt mật khẩu' }),
    ).toBeVisible();
  });

  test('Google signs into the account that has the verified email', async ({
    page,
    browser,
  }) => {
    const existing = await browser.newContext();
    const email = await signUpViaApi(await existing.newPage());
    await existing.close();

    await page.goto('/login?next=%2Fsettings');
    await page.getByRole('button', { name: 'Tiếp tục với Google' }).click();
    await approveOAuth(page, {
      email,
      name: 'Người dùng Google',
    });

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('main')).toContainText(email);
    await expect(
      linkedAccount(page, 'Google').getByRole('button', {
        name: 'Gỡ liên kết',
      }),
    ).toBeVisible();
  });

  test('an unverified provider email does not take over an account', async ({
    page,
    browser,
  }) => {
    const existing = await browser.newContext();
    const email = await signUpViaApi(await existing.newPage());
    await existing.close();

    await page.goto('/login');
    await page.getByRole('button', { name: 'Tiếp tục với GitHub' }).click();
    await approveOAuth(page, {
      email,
      name: 'Người lạ',
      verified: false,
    });

    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByText('Email này đã đăng ký Qloud.', { exact: false }),
    ).toBeVisible();
    // Still signed out.
    await page.goto('/trash');
    await expect(page).toHaveURL(/\/login\?next=%2Ftrash$/);
  });

  test('a signed-in user links and unlinks GitHub in settings', async ({
    page,
  }) => {
    await signUpViaApi(page);
    await page.goto('/settings');
    const github = linkedAccount(page, 'GitHub');
    await expect(github).toContainText('Chưa liên kết');

    await github.getByRole('button', { name: 'Liên kết' }).click();
    await approveOAuth(page, {
      email: `e2e-${crypto.randomUUID()}@example.com`,
      name: 'Tài khoản phụ',
    });

    await expect(page).toHaveURL(/\/settings$/);
    await github.getByRole('button', { name: 'Gỡ liên kết' }).click();
    await expect(github).toContainText('Chưa liên kết');
  });
});

test('too many attempts show a friendly message', async ({ page }) => {
  // Real limits are off in E2E (all tests share one IP and one Redis); the
  // server side of the 429 is covered by the backend tests.
  await page.route(`**${AUTH}/auth/login`, (route) =>
    route.fulfill({ status: 429, json: { status: 429 } }),
  );
  await signIn(page, 'e2e-limited@example.com', E2E_PASSWORD);
  await expect(
    page.getByText(
      'Bạn đã thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
