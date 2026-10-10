import { expect, test } from '@playwright/test';

// The main auth path; M1-07 covers the remaining flows (email links, OAuth).
test('a visitor is sent to login, signs up, uses Drive and signs out', async ({
  page,
}) => {
  const email = `e2e-${crypto.randomUUID()}@example.com`;

  await page.goto('/trash');
  await expect(page).toHaveURL(/\/login\?next=%2Ftrash$/);
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();

  await page.getByRole('link', { name: 'Đăng ký' }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Ftrash$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill('qloud-e2e-password');
  await page.getByRole('button', { name: 'Đăng ký' }).click();

  await expect(
    page.getByRole('heading', { name: 'Kiểm tra hộp thư của bạn' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vào Drive' }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thùng rác');

  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Signing in again with the new password brings the user back.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill('qloud-e2e-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('auth pages fit a 360px screen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile project only');
  for (const path of [
    '/login',
    '/signup',
    '/password/reset',
    '/password/reset/k',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
