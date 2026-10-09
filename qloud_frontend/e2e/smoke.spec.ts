import { expect, test } from '@playwright/test';

test.describe('application shell', () => {
  test('renders navigation and reports the real backend as healthy', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('navigation', { name: 'Điều hướng chính' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Drive');
    // Served by Django through the vite preview proxy, not mocked.
    await expect(page.getByText('Hoạt động bình thường')).toBeVisible();
  });

  test('sidebar navigation stays inside the shell', async ({ page }) => {
    await page.goto('/');

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Gần đây' })
      .click();

    await expect(page).toHaveURL(/\/recent$/);
    await expect(
      page.getByRole('navigation', { name: 'Điều hướng chính' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gần đây');
  });

  test('unknown paths show the not-found page', async ({ page }) => {
    await page.goto('/khong-ton-tai');

    await expect(page.getByText('Không tìm thấy trang')).toBeVisible();
  });
});

test.describe('preferences', () => {
  test('language choice applies immediately and survives a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');

    await page.getByRole('button', { name: 'Ngôn ngữ' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('dark theme applies immediately and survives a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    await page.getByRole('button', { name: 'Giao diện' }).click();
    await page.getByRole('menuitemradio', { name: 'Tối' }).click();

    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  });
});
