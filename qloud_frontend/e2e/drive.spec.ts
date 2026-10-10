import { expect, test, type Page } from '@playwright/test';

import { signUpViaApi } from './auth';

// S-05 against the real backend (files-folders.md acceptance criteria).
test.beforeEach(async ({ page }) => {
  await signUpViaApi(page);
});

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Tạo mới' }).click();
  await page.getByRole('menuitem', { name: 'Thư mục mới' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thư mục mới' });
  await dialog.getByLabel('Tên').fill(name);
  await dialog.getByRole('button', { name: 'Tạo' }).click();
  await expect(dialog).toBeHidden();
}

function item(page: Page, name: string) {
  return page.getByRole('option', { name, exact: true });
}

test('nested folders, breadcrumb and reload', async ({ page }) => {
  await page.goto('/drive');
  await expect(page.getByText('Thư mục này đang trống')).toBeVisible();

  for (const name of ['Dự án', 'Thiết kế', 'Logo']) {
    await createFolder(page, name);
    await item(page, name).dblclick();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  }
  await expect(page).toHaveURL(/\/drive\/folders\/[0-9a-f-]{36}$/);

  // The path survives a reload: it comes from the server, not from navigation history.
  await page.reload();
  const crumbs = page.getByRole('navigation', { name: 'Đường dẫn thư mục' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logo');
  await expect(
    crumbs.getByRole('link', { name: 'Drive của tôi' }),
  ).toBeVisible();
  await expect(crumbs.getByRole('link', { name: 'Thiết kế' })).toBeVisible();

  await crumbs.getByRole('link', { name: 'Thiết kế' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thiết kế');
  await expect(item(page, 'Logo')).toBeVisible();
});

test('rename, and a clashing name is refused', async ({ page }) => {
  await page.goto('/drive');
  await createFolder(page, 'Báo cáo');
  await createFolder(page, 'Nháp');

  await item(page, 'Nháp').click();
  await page.keyboard.press('F2');
  const dialog = page.getByRole('dialog', { name: 'Đổi tên' });
  await dialog.getByLabel('Tên').fill('báo cáo');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Đổi tên' })
      .getByText('Đã có một mục cùng tên trong thư mục này.'),
  ).toBeVisible();

  await page
    .getByRole('dialog', { name: 'Đổi tên' })
    .getByLabel('Tên')
    .fill('Bản nháp');
  await page
    .getByRole('dialog', { name: 'Đổi tên' })
    .getByRole('button', { name: 'Lưu' })
    .click();
  await expect(item(page, 'Bản nháp')).toBeVisible();
  await page.reload();
  await expect(item(page, 'Bản nháp')).toBeVisible();
  await expect(item(page, 'Báo cáo')).toBeVisible();
});

test('the list view and sort order are remembered', async ({ page }) => {
  await page.goto('/drive');
  for (const name of ['file2', 'file10', 'File1'])
    await createFolder(page, name);
  await expect(page.getByRole('option')).toHaveText([
    /^File1/,
    /^file2/,
    /^file10/,
  ]);

  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await page.getByRole('button', { name: /Tên \(A → Z\)|Sắp xếp/ }).click();
  await page.getByRole('menuitemradio', { name: 'Tên (Z → A)' }).click();
  await expect(page.getByRole('option')).toHaveText([
    /^file10/,
    /^file2/,
    /^File1/,
  ]);

  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Dạng danh sách' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('option')).toHaveText([
    /^file10/,
    /^file2/,
    /^File1/,
  ]);
});

test('an unknown folder says so', async ({ page }) => {
  await page.goto('/drive/folders/01a12567-4ae6-774f-ac0d-99128521dccf');
  await expect(page.getByText('Không tìm thấy thư mục')).toBeVisible();
  await page.getByRole('link', { name: 'Về Drive' }).click();
  await expect(page).toHaveURL(/\/drive$/);
});

test.describe('selecting and moving (M2-07b)', () => {
  test('drag several items into a folder, then back via the breadcrumb', async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      'HTML drag and drop needs a mouse; touch uses the Move dialog',
    );
    await page.goto('/drive');
    for (const name of ['Đích', 'Một', 'Hai']) await createFolder(page, name);

    await item(page, 'Hai').click();
    await item(page, 'Một').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.getByText('2 mục đã chọn')).toBeVisible();
    await item(page, 'Một').dragTo(item(page, 'Đích'));
    await expect(page.getByRole('option')).toHaveText([/^Đích/]);

    await item(page, 'Đích').dblclick();
    await expect(page.getByRole('option')).toHaveText([/^Hai/, /^Một/]);
    await item(page, 'Hai').dragTo(
      page
        .getByRole('navigation', { name: 'Đường dẫn thư mục' })
        .getByRole('link', { name: 'Drive của tôi' }),
    );
    await expect(page.getByRole('option')).toHaveText([/^Một/]);
    await page.goto('/drive');
    await expect(page.getByRole('option')).toHaveText([/^Đích/, /^Hai/]);
  });

  test('the Move dialog, and a folder cannot go inside itself', async ({
    page,
  }) => {
    await page.goto('/drive');
    await createFolder(page, 'Cha');
    await item(page, 'Cha').dblclick();
    await createFolder(page, 'Con');
    await page
      .getByRole('navigation', { name: 'Đường dẫn thư mục' })
      .getByRole('link', { name: 'Drive của tôi' })
      .click();
    await createFolder(page, 'Ghi chú');

    // Right click: the item menu.
    await item(page, 'Cha').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Di chuyển/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Di chuyển 1 mục' });
    await expect(dialog.getByRole('button', { name: 'Cha' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Hủy' }).click();

    await item(page, 'Ghi chú').click();
    await page.getByRole('button', { name: 'Di chuyển…' }).click();
    await dialog.getByRole('button', { name: 'Cha' }).click();
    await dialog.getByRole('button', { name: 'Con' }).click();
    await dialog.getByRole('button', { name: 'Di chuyển tới đây' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã di chuyển' }),
    ).toHaveText('Đã di chuyển 1 mục tới "Con".');
    await expect(page.getByRole('option')).toHaveText([/^Cha/]);
  });
});

test('every folder has its own link: new tab and bookmark', async ({
  page,
  context,
  isMobile,
}) => {
  await page.goto('/drive');
  await createFolder(page, 'Ảnh');
  await item(page, 'Ảnh').dblclick();
  await createFolder(page, 'Hè 2026');
  const link = page.url();
  await page
    .getByRole('navigation', { name: 'Đường dẫn thư mục' })
    .getByRole('link', { name: 'Drive của tôi' })
    .click();

  // A saved link opened in another tab lands on the same folder.
  const bookmark = await context.newPage();
  await bookmark.goto(link);
  await expect(bookmark.getByRole('heading', { level: 1 })).toHaveText('Ảnh');
  await expect(bookmark.getByRole('option')).toHaveText([/^Hè 2026/]);
  await bookmark.close();

  test.skip(isMobile, 'Middle click needs a mouse');
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    item(page, 'Ảnh').click({ button: 'middle' }),
  ]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(link);
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('Ảnh');
  // This tab stays where it was.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Drive của tôi',
  );
});
