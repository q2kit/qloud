import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.TRASH_LIVE ? 180 : 0 } });
const item = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });
async function headers(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}
async function root(page: Page): Promise<string> {
  return (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
}
async function folder(
  page: Page,
  parent: string,
  name: string,
): Promise<string> {
  const response = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: parent, name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}
async function file(page: Page, parent: string, name: string): Promise<string> {
  const created = await page.request.post('/api/v1/uploads', {
    headers: await headers(page),
    data: {
      parent_id: parent,
      filename: name,
      size: 3,
      mime_type: 'text/plain',
      fingerprint: `trash-${name}`,
    },
  });
  expect(created.status()).toBe(201);
  const session = ((await created.json()) as { id: string }).id;
  const urls = await page.request.post(`/api/v1/uploads/${session}/parts`, {
    headers: await headers(page),
    data: { part_numbers: [1] },
  });
  const url = ((await urls.json()) as { parts: { url: string }[] }).parts[0]
    .url;
  expect(
    (await page.request.put(url, { data: Buffer.from('abc') })).status(),
  ).toBe(200);
  const complete = await page.request.post(
    `/api/v1/uploads/${session}/complete`,
    { headers: await headers(page) },
  );
  expect(complete.status()).toBe(200);
  return ((await complete.json()) as { id: string }).id;
}
async function trashViaApi(page: Page, ids: string[]): Promise<void> {
  const response = await page.request.post('/api/v1/nodes/trash', {
    headers: await headers(page),
    data: { node_ids: ids },
  });
  expect(response.status()).toBe(200);
}
async function navigateTrash(page: Page, mobile: boolean): Promise<void> {
  if (mobile) await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await page.getByRole('link', { name: 'Thùng rác', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thùng rác');
}

test('Drive trash action and undo survive navigation; Trash restores selected items', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  await folder(page, parent, 'Tài liệu');
  await page.goto('/drive');
  await item(page, 'Tài liệu').click();
  await page
    .getByRole('button', { name: 'Chuyển vào thùng rác', exact: true })
    .click();
  await expect(page.getByText('Đã chuyển vào thùng rác')).toBeVisible();
  await expect(item(page, 'Tài liệu')).toHaveCount(0);
  await navigateTrash(page, isMobile);
  await expect(item(page, 'Tài liệu')).toBeVisible();
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
  await page.goto('/drive');
  await item(page, 'Tài liệu').click();
  await page
    .getByRole('button', { name: 'Chuyển vào thùng rác', exact: true })
    .click();
  await expect(page.getByText('Đã chuyển vào thùng rác')).toBeVisible();
  await navigateTrash(page, isMobile);
  await item(page, 'Tài liệu').click();
  await page.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
  await page.goto('/drive');
  await expect(item(page, 'Tài liệu')).toBeVisible();
});

test('nested trash groups stay separate; permanent deletion removes S3 bytes', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await folder(page, await root(page), 'Dự án');
  const child = await file(page, parent, 'ghi-chú.txt');
  const download = await page.request.get(`/api/v1/nodes/${child}/download`);
  const url = ((await download.json()) as { url: string }).url;
  await trashViaApi(page, [child]);
  await trashViaApi(page, [parent]);
  await page.goto('/trash');
  await expect(item(page, 'Dự án')).toBeVisible();
  await expect(item(page, 'ghi-chú.txt')).toBeVisible();
  await item(page, 'Dự án').click();
  await page.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await expect(item(page, 'Dự án')).toHaveCount(0);
  await expect(item(page, 'ghi-chú.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await item(page, 'ghi-chú.txt').click();
  await page
    .getByRole('button', { name: 'Xóa vĩnh viễn', exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('button', { name: 'Hủy' }).click();
  await expect(item(page, 'ghi-chú.txt')).toBeVisible();
  await page
    .getByRole('button', { name: 'Xóa vĩnh viễn', exact: true })
    .click();
  await confirmation
    .getByRole('button', { name: 'Xóa vĩnh viễn', exact: true })
    .click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
});

test('multi-selection and empty trash work in both themes without horizontal overflow', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  const a = await folder(page, parent, 'Tài liệu dự án');
  const b = await folder(page, parent, 'Hình ảnh cũ');
  const c = await file(page, parent, 'ghi-chú.txt');
  await trashViaApi(page, [a, b, c]);
  await page.goto('/trash');
  await item(page, 'Tài liệu dự án').click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /dark/ : /^$/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (process.env.TRASH_LIVE)
      await page.screenshot({
        path: `../qloud_docs/assets/m4-03-trash-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
  }
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
  await trashViaApi(page, [a, b, c]);
  await page.reload();
  await expect(item(page, 'ghi-chú.txt')).toBeVisible();
  await page
    .getByRole('button', { name: 'Dọn sạch thùng rác', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Dọn sạch thùng rác', exact: true })
    .click();
  await expect(page.getByText('Thùng rác trống')).toBeVisible();
});
