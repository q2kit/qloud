import { expect, test, type Page } from '@playwright/test';
import { signUpViaApi } from './auth';

test.use({
  launchOptions: { slowMo: process.env.SHORTCUTS_LIVE ? 300 : 0 },
});

/** Screenshots for the PR, only when SHORTCUTS_CAPTURE is set. */
async function capture(page: Page) {
  if (!process.env.SHORTCUTS_CAPTURE) return;
  for (const [width, size] of [
    [1280, 'desktop'],
    [360, '360'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('qloud-theme', value);
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'qloud-theme' }),
        );
      }, theme);
      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `../qloud_docs/assets/m8-08-shortcuts-${theme}-${size}.png`,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('keyboard shortcuts: ? sheet, Shift+N, G then T, and no shortcuts while typing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signUpViaApi(page);
  await page.goto('/drive');
  await expect(
    page.getByRole('heading', { name: 'Drive của tôi' }),
  ).toBeVisible();

  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Phím tắt' });
  await expect(sheet).toBeVisible();
  for (const group of [
    'Chung',
    'Điều hướng',
    'Chọn',
    'Thao tác với mục',
    'Trình xem file',
  ])
    await expect(sheet.getByRole('heading', { name: group })).toBeVisible();
  await capture(page);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.keyboard.press('Shift+N');
  const create = page.getByRole('dialog', { name: 'Thư mục mới' });
  await expect(create).toBeVisible();
  // Typing a name, "s" and "?" included, never triggers a shortcut.
  await create.getByLabel('Tên').fill('');
  await create.getByLabel('Tên').pressSequentially('sổ tay?');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await create.getByLabel('Tên').fill('Sổ tay');
  await create.getByRole('button', { name: 'Tạo' }).click();
  const folder = page.getByRole('option', { name: 'Sổ tay', exact: true });
  await expect(folder).toBeVisible();

  // "s" typed in the palette search box stays text.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Tìm kiếm và câu lệnh' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('s');
  await expect(palette.getByRole('combobox')).toHaveValue('s');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/trash$/);
  await page.keyboard.press('g');
  await page.keyboard.press('d');
  await expect(page).toHaveURL(/\/drive$/);
});
