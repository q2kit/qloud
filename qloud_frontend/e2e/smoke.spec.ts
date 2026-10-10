import { expect, test, type Page } from '@playwright/test';

import { signUpViaApi } from './auth';

// Runs in both the desktop and the 360px mobile project. On mobile the sidebar
// (with the language and theme switchers) lives in the navigation drawer.
async function openNavigationIfMobile(
  page: Page,
  isMobile: boolean,
): Promise<void> {
  if (!isMobile) return;
  await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Điều hướng chính' }),
  ).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('application shell', () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaApi(page);
  });

  test('renders navigation and reports the real backend as healthy', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    await openNavigationIfMobile(page, isMobile);

    await expect(
      page.getByRole('navigation', { name: 'Điều hướng chính' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Drive');
    // Served by Django through the vite preview proxy, not mocked.
    await expect(page.getByText('Hoạt động bình thường')).toBeVisible();
  });

  test('sidebar navigation stays inside the shell', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    await openNavigationIfMobile(page, isMobile);

    await page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Gần đây' })
      .click();

    await expect(page).toHaveURL(/\/recent$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gần đây');
    // The header title follows the route.
    await expect(page.getByRole('banner')).toContainText('Gần đây');
    await openNavigationIfMobile(page, isMobile);
    await expect(
      page.getByRole('navigation', { name: 'Điều hướng chính' }),
    ).toBeVisible();
  });

  test('unknown paths show the not-found page', async ({ page }) => {
    await page.goto('/khong-ton-tai');

    await expect(
      page.getByRole('heading', { name: 'Không tìm thấy trang' }),
    ).toBeVisible();
  });
});

test.describe('preferences', () => {
  test.beforeEach(async ({ page }) => {
    await signUpViaApi(page);
  });

  test('language choice applies immediately and survives a reload', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await openNavigationIfMobile(page, isMobile);

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
    isMobile,
  }) => {
    const themeColor = page.locator('meta[name="theme-color"]');
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expect(themeColor).toHaveAttribute('content', '#fafaf9');
    await openNavigationIfMobile(page, isMobile);

    await page.getByRole('button', { name: 'Giao diện' }).click();
    await page.getByRole('menuitemradio', { name: 'Tối' }).click();

    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(themeColor).toHaveAttribute('content', '#1c1917');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(themeColor).toHaveAttribute('content', '#1c1917');
  });
});

test.describe('mobile layout (360px)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Mobile project only');
  test.beforeEach(async ({ page }) => {
    await signUpViaApi(page);
  });

  test('opens the navigation drawer and the details bottom sheet', async ({
    page,
  }) => {
    await page.goto('/');
    expect(page.viewportSize()?.width).toBe(360);
    // The fixed desktop sidebar is hidden on small screens.
    await expect(
      page.getByRole('navigation', { name: 'Điều hướng chính' }),
    ).toBeHidden();
    await expectNoHorizontalScroll(page);

    await openNavigationIfMobile(page, true);
    const drawer = page.getByRole('dialog', { name: 'Điều hướng chính' });
    await expect(drawer.getByRole('link', { name: 'Thùng rác' })).toBeVisible();
    await expect(
      drawer.getByRole('group', { name: 'Tùy chọn hiển thị' }),
    ).toBeVisible();
    await drawer.getByRole('button', { name: 'Đóng điều hướng' }).click();
    await expect(drawer).toBeHidden();

    await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
    const sheet = page.getByRole('dialog', { name: 'Chi tiết' });
    await expect(sheet).toBeVisible();
    // A bottom sheet: full width, anchored to the bottom of the viewport.
    const box = await sheet.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(360);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(740, 0);
    await expectNoHorizontalScroll(page);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('pages do not scroll horizontally', async ({ page }) => {
    for (const path of ['/', '/recent', '/settings', '/khong-ton-tai']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});
