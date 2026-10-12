import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction, openItemMenu } from './drive';

// API-seeded real stack. RECENT_LIVE keeps Chromium visible and records review images.
test.use({ launchOptions: { slowMo: process.env.RECENT_LIVE ? 250 : 0 } });
// Limit connection bursts when seeding API data in parallel dev-server runs.
const SEED_BATCH_SIZE = 2;
const item = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });
async function csrf(page: Page) {
  const cookies = await page.context().cookies();
  return {
    'X-CSRFToken':
      cookies.find((cookie) => cookie.name === 'csrftoken')?.value ?? '',
  };
}
async function root(page: Page) {
  return (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
}
async function folder(page: Page, parent: string, name: string) {
  const response = await page.request.post('/api/v1/folders', {
    headers: await csrf(page),
    data: { parent_id: parent, name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
async function file(
  page: Page,
  parent: string,
  name: string,
  content = 'Recent file',
) {
  const headers = await csrf(page);
  const created = await page.request.post('/api/v1/uploads', {
    headers,
    data: {
      parent_id: parent,
      filename: name,
      mime_type: 'text/plain',
      size: Buffer.byteLength(content),
      fingerprint: `recent-${name}`,
    },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()) as { id: string };
  if (content) {
    const signed = await page.request.post(
      `/api/v1/uploads/${session.id}/parts`,
      { headers, data: { part_numbers: [1] } },
    );
    expect(signed.status()).toBe(200);
    const { parts } = (await signed.json()) as { parts: { url: string }[] };
    const put = await page.request.put(parts[0].url, {
      data: Buffer.from(content),
    });
    expect(put.status()).toBe(200);
  }
  const complete = await page.request.post(
    `/api/v1/uploads/${session.id}/complete`,
    { headers },
  );
  expect(complete.status()).toBe(200);
  return (await complete.json()) as { id: string };
}

async function navigateRecent(page: Page, isMobile: boolean) {
  if (isMobile)
    await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await page.getByRole('link', { name: 'Gần đây', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gần đây');
}

test('Recent shares the browser, downloads files and opens their folders without recording opens', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const rootId = await root(page);
  const nested = await folder(page, rootId, 'Dự án');
  await file(page, rootId, 'ghi-chú.txt');
  const report = await file(page, nested.id, 'báo-cáo.txt');
  await file(page, rootId, 'mới-nhất.txt');
  await page.goto('/recent');
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option').first()).toHaveAttribute(
    'aria-label',
    'mới-nhất.txt',
  );
  await expect(item(page, 'Dự án')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Sửa gần đây nhất' }),
  ).toHaveCount(0);
  await page
    .getByTestId('folder-content')
    .dblclick({ position: { x: 10, y: 300 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await expect(item(page, 'báo-cáo.txt')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (process.env.RECENT_LIVE) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        localStorage.setItem('qloud-theme', theme);
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'qloud-theme' }),
        );
      }, theme);
      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /dark/ : /^$/,
      );
      await page.screenshot({
        path: `../qloud_docs/assets/m2-09-recent-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  const before = await page.request.get(`/api/v1/nodes/${report.id}`);
  const timestamp = ((await before.json()) as { updated_at: string })
    .updated_at;
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chooseItemAction(page, 'báo-cáo.txt', 'Tải xuống'),
  ]);
  expect(download.suggestedFilename()).toBe('báo-cáo.txt');
  const after = await page.request.get(`/api/v1/nodes/${report.id}`);
  expect(((await after.json()) as { updated_at: string }).updated_at).toBe(
    timestamp,
  );
  await chooseItemAction(page, 'báo-cáo.txt', 'Mở thư mục chứa tệp');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dự án');
  await expect(item(page, 'báo-cáo.txt')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(item(page, 'báo-cáo.txt')).toBeFocused();
  await page.reload();
  await expect(item(page, 'báo-cáo.txt')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await navigateRecent(page, isMobile);
  await chooseItemAction(page, 'ghi-chú.txt', 'Mở thư mục chứa tệp');
  await expect(page).toHaveURL(/\/drive\?select=[0-9a-f]{32}$/);
  await expect(item(page, 'ghi-chú.txt')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Recent refreshes after upload, rename and move; empty state and view preference remain shared', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const rootId = await root(page);
  const destination = await folder(page, rootId, 'Đích');
  await page.goto('/recent');
  await expect(page.getByText('Chưa có tệp gần đây')).toBeVisible();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('new'),
  });
  await expect(item(page, 'note.txt')).toBeVisible();
  await page
    .getByRole('region', { name: 'Tải lên' })
    .getByRole('button', { name: 'Đóng khay tải lên' })
    .click();
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await chooseItemAction(page, 'note.txt', 'Mở thư mục chứa tệp');
  await expect(
    page.getByRole('button', { name: 'Dạng danh sách' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await chooseItemAction(page, 'note.txt', 'Đổi tên');
  const rename = page.getByRole('dialog', { name: 'Đổi tên' });
  await rename.getByLabel('Tên').fill('renamed.txt');
  await rename.getByRole('button', { name: 'Lưu' }).click();
  await expect(item(page, 'renamed.txt')).toBeVisible();
  await navigateRecent(page, isMobile);
  await expect(item(page, 'renamed.txt')).toBeVisible();
  await expect(item(page, 'note.txt')).toHaveCount(0);
  const response = await page.request.get('/api/v1/recent');
  const body = (await response.json()) as { results: { id: string }[] };
  await chooseItemAction(page, 'renamed.txt', 'Mở thư mục chứa tệp');
  await chooseItemAction(page, 'renamed.txt', 'Di chuyển…');
  const move = page.getByRole('dialog', { name: 'Di chuyển 1 mục' });
  await move.getByRole('button', { name: 'Đích', exact: true }).click();
  const moved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/v1/nodes/move'),
  );
  await move.getByRole('button', { name: 'Di chuyển tới đây' }).click();
  expect((await moved).status()).toBe(200);
  await expect(
    page.getByRole('status').filter({ hasText: 'Đã di chuyển' }),
  ).toContainText('Đích');
  await expect(item(page, 'renamed.txt')).toHaveCount(0);
  await navigateRecent(page, isMobile);
  await expect(item(page, 'renamed.txt')).toBeVisible();
  const node = await page.request.get(`/api/v1/nodes/${body.results[0].id}`);
  expect(((await node.json()) as { parent_id: string }).parent_id).toBe(
    destination.id,
  );
  await chooseItemAction(page, 'renamed.txt', 'Mở thư mục chứa tệp');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Đích');
});

test('Recent cursor pages stop at 100 files', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  for (let start = 0; start < 105; start += SEED_BATCH_SIZE) {
    await Promise.all(
      Array.from(
        { length: Math.min(SEED_BATCH_SIZE, 105 - start) },
        (_, offset) =>
          file(page, parent, `file-${String(start + offset)}.txt`, ''),
      ),
    );
  }
  await page.goto('/recent');
  await expect(page.getByRole('option')).toHaveCount(50);
  await page.getByRole('button', { name: 'Tải thêm', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(100);
  await expect(
    page.getByRole('button', { name: 'Tải thêm', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('option')).toHaveCount(50);
});

test('file location links reveal files beyond cursor pages and virtualized rows', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await signUpVerifiedViaApi(page);
  const rootId = await root(page);
  const parent = await folder(page, rootId, 'Thư mục chứa');
  for (let start = 0; start < 205; start += SEED_BATCH_SIZE) {
    await Promise.all(
      Array.from(
        { length: Math.min(SEED_BATCH_SIZE, 205 - start) },
        (_, offset) =>
          file(page, parent.id, `a-${String(start + offset)}.txt`, ''),
      ),
    );
  }
  const target = await file(page, parent.id, 'z-target.txt', '');
  await page.goto('/recent');
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await page
    .getByRole('button', { name: 'Thao tác khác với z-target.txt' })
    .click();
  await page.getByRole('menuitem', { name: 'Mở thư mục chứa tệp' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/drive/folders/${parent.id.replaceAll('-', '')}\\?select=${target.id.replaceAll('-', '')}$`,
    ),
  );
  const selected = item(page, 'z-target.txt');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toBeInViewport();
  await expect(selected).toBeFocused();
  if (process.env.RECENT_LIVE) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        localStorage.setItem('qloud-theme', theme);
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'qloud-theme' }),
        );
      }, theme);
      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /dark/ : /^$/,
      );
      await page.screenshot({
        path: `../qloud_docs/assets/m2-09-location-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        animations: 'disabled',
      });
    }
  }
  await page.reload();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toBeInViewport();
  await expect(selected).toBeFocused();
  await page.getByRole('button', { name: 'Dạng lưới' }).click();
  await page.reload();
  await expect(selected).toBeInViewport();
  await selected.getByRole('button').click();
  await expect(
    page.getByRole('menuitem', { name: 'Mở thư mục chứa tệp' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toBeInViewport();
  await page.goto(`/drive?select=${target.id.replaceAll('-', '')}`);
  await expect(page.getByRole('alert')).toContainText('Không tìm thấy tệp');
});

test('item menu opens after pointer release without accidentally opening a folder', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const rootId = await root(page);
  await folder(page, rootId, 'Dự án');
  await file(page, rootId, 'ghi-chú.txt');
  if (!isMobile) await page.setViewportSize({ width: 800, height: 740 });
  await page.goto('/drive');
  for (const view of ['Dạng lưới', 'Dạng danh sách']) {
    await page.getByRole('button', { name: view }).click();
    await item(page, 'ghi-chú.txt').click();
    const menu = await openItemMenu(page, 'ghi-chú.txt');
    await expect(menu.getByText('Tải xuống', { exact: true })).toBeVisible();
    await expect(
      menu.getByText('Mở thư mục chứa tệp', { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    const trigger = item(page, 'Dự án').getByRole('button');
    const box = await trigger.boundingBox();
    if (!box) throw new Error('Folder menu trigger is missing');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(item(page, 'ghi-chú.txt')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.mouse.up();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page).toHaveURL(/\/drive$/);
    await expect(
      page.locator('[data-node-id][aria-selected="true"]'),
    ).toHaveAttribute('aria-label', 'Dự án');
    if (process.env.RECENT_LIVE && view === 'Dạng lưới') {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
          localStorage.setItem('qloud-theme', theme);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'qloud-theme' }),
          );
        }, theme);
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^$/,
        );
        await page.screenshot({
          path: `../qloud_docs/assets/m2-09-menu-${theme}-${isMobile ? '360' : '800'}.png`,
          animations: 'disabled',
        });
      }
    }
    await page.keyboard.press('Escape');
  }
  if (isMobile) await item(page, 'Dự án').getByRole('button').tap();
  else await item(page, 'Dự án').getByRole('button').click();
  await page.getByRole('menuitem', { name: /^Mở\s*↵$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dự án');
});
