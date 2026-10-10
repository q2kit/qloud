import { expect, test } from '@playwright/test';

import { E2E_PASSWORD, signUpViaApi } from './auth';

test('language and theme follow the account to another browser', async ({
  page,
  browser,
}) => {
  const email = await signUpViaApi(page);

  await page.goto('/settings');
  const preferences = page.getByRole('region', {
    name: 'Ngôn ngữ và giao diện',
  });
  await preferences.getByText('Tối').click();
  await preferences.getByText('English').click();

  // Applied at once…
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  // …and kept after a reload.
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // A fresh browser (Vietnamese, light) picks the profile up on sign-in.
  const other = await browser.newContext({
    locale: 'vi-VN',
    colorScheme: 'light',
  });
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await otherPage.getByLabel('Email').fill(email);
  await otherPage.getByLabel('Mật khẩu').fill(E2E_PASSWORD);
  await otherPage.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(otherPage.locator('html')).toHaveAttribute('lang', 'en');
  await expect(otherPage.locator('html')).toHaveClass(/\bdark\b/);
  await other.close();
});

test('the display name is saved to the profile', async ({ page }) => {
  await signUpViaApi(page);
  await page.goto('/settings');
  await page.getByLabel('Tên hiển thị').fill('Người kiểm thử');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã lưu.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Người kiểm thử');
  await page.getByRole('button', { name: 'Tài khoản' }).click();
  await expect(page.getByRole('menu')).toContainText('Người kiểm thử');
});
