import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { openDriveFolder } from './drive';

test.use({ launchOptions: { slowMo: process.env.DRIVE_BLANK_LIVE ? 250 : 0 } });

const item = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });

async function createViaApi(page: Page, parent: string, name: string) {
  const cookies = await page.context().cookies();
  const response = await page.request.post('/api/v1/folders', {
    headers: {
      'X-CSRFToken':
        cookies.find((cookie) => cookie.name === 'csrftoken')?.value ?? '',
    },
    data: { parent_id: parent, name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

async function seed(page: Page) {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const parent = await createViaApi(page, me.root_folder_id, 'Dự án');
  return { root: me.root_folder_id, parent: parent.id };
}

/** Point near the bottom, below the old 50vh interaction area. */
async function bottom(page: Page) {
  const area = page.getByTestId('folder-content');
  const rect = await area.boundingBox();
  if (!rect) throw new Error('folder content not laid out');
  const metrics = await page.locator('main').evaluate((main) => ({
    bottom:
      main.getBoundingClientRect().bottom -
      parseFloat(getComputedStyle(main).paddingBottom),
    viewport: window.innerHeight,
    height: document.documentElement.scrollHeight,
  }));
  expect(Math.abs(rect.y + rect.height - metrics.bottom)).toBeLessThan(2);
  expect(metrics.height).toBeLessThanOrEqual(metrics.viewport + 1);
  return { x: rect.x + 20, y: rect.y + rect.height - 12 };
}

async function openCreate(
  page: Page,
  point: { x: number; y: number },
  isMobile: boolean,
) {
  await page.mouse.dblclick(point.x, point.y);
  const dialog = page.getByRole('dialog', { name: 'Thư mục mới' });
  if (isMobile) {
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Tạo mới' }).click();
    await page.getByRole('menuitem', { name: 'Thư mục mới' }).click();
  }
  await expect(dialog).toBeVisible();
}

for (const view of ['grid', 'list'] as const) {
  test(`bottom blank area creates folders and keeps selection/open behavior in ${view}`, async ({
    page,
    isMobile,
  }) => {
    const { parent } = await seed(page);
    await page.goto(`/drive/folders/${parent.replaceAll('-', '')}`);
    await expect(page.getByText('Thư mục này đang trống')).toBeVisible();
    if (view === 'list')
      await page.getByRole('button', { name: 'Dạng danh sách' }).click();
    let point = await bottom(page);
    await openCreate(page, point, isMobile);
    const dialog = page.getByRole('dialog', { name: 'Thư mục mới' });
    await expect(dialog.getByLabel('Tên')).toBeFocused();
    if (process.env.DRIVE_BLANK_LIVE && view === 'grid') {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
          localStorage.setItem('qloud-theme', theme);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'qloud-theme' }),
          );
        }, theme);
        await expect(dialog).toHaveCSS(
          'color',
          theme === 'dark' ? 'rgb(250, 250, 249)' : 'rgb(28, 25, 23)',
        );
        await page.screenshot({
          path: `../qloud_docs/assets/m2-11-blank-${theme}-${isMobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.evaluate(() => {
        localStorage.setItem('qloud-theme', 'light');
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'qloud-theme' }),
        );
      });
    }
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    await expect(page.getByRole('option')).toHaveCount(0);
    await openCreate(page, point, isMobile);
    await dialog.getByLabel('Tên').fill('Con');
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(item(page, 'Con')).toBeVisible();
    await page.reload();
    await expect(item(page, 'Con')).toBeVisible();
    point = await bottom(page);

    // Single click still clears selection, including the extended bottom area.
    await item(page, 'Con').click();
    await page.mouse.click(point.x, point.y);
    await expect(item(page, 'Con')).toHaveAttribute('aria-selected', 'false');
    if (!isMobile) {
      const child = await item(page, 'Con').boundingBox();
      if (!child) throw new Error('child not laid out');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(child.x + child.width - 10, child.y + 10, {
        steps: 8,
      });
      await expect(page.getByTestId('selection-box')).toBeVisible();
      await page.mouse.up();
      await expect(item(page, 'Con')).toHaveAttribute('aria-selected', 'true');
      await expect(dialog).toBeHidden();
    }

    // Existing name-conflict validation is reused.
    await openCreate(page, point, isMobile);
    await dialog.getByLabel('Tên').fill('con');
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(
      dialog.getByText('Đã có một mục cùng tên trong thư mục này.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Hủy' }).click();
    if (isMobile) {
      await item(page, 'Con').click();
      await item(page, 'Con').dblclick();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dự án');
      await page.touchscreen.tap(point.x, point.y);
      await page.touchscreen.tap(point.x, point.y);
      await expect(dialog).toBeHidden();
    }
    await openDriveFolder(page, 'Con');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Con');
    await expect(dialog).toBeHidden();

    // Root uses the same gesture and correct parent.
    await page.goto('/drive');
    await expect(item(page, 'Dự án')).toBeVisible();
    point = await bottom(page);
    await openCreate(page, point, isMobile);
    await dialog.getByLabel('Tên').fill('Ở gốc');
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
    await expect(item(page, 'Ở gốc')).toBeVisible();
  });
}

test('dropping at the bottom uploads to the current folder; a child remains a separate target', async ({
  page,
}) => {
  const { parent } = await seed(page);
  await createViaApi(page, parent, 'Con');
  await page.goto(`/drive/folders/${parent.replaceAll('-', '')}`);
  await expect(item(page, 'Con')).toBeVisible();
  const point = await bottom(page);
  await page.mouse.move(point.x, point.y);
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error('no bottom drop target');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(['bottom upload'], 'bottom.txt', { type: 'text/plain' }),
    );
    for (const type of ['dragenter', 'dragover', 'drop'])
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
      );
  }, point);
  await expect(item(page, 'bottom.txt')).toBeVisible({ timeout: 30_000 });

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['child upload'], 'child.txt', { type: 'text/plain' }),
    );
    return transfer;
  });
  await item(page, 'Con').dispatchEvent('dragenter', { dataTransfer });
  await item(page, 'Con').dispatchEvent('dragover', { dataTransfer });
  await expect(page.getByText('Thả để tải lên vào "Con"')).toBeVisible();
  await item(page, 'Con').dispatchEvent('drop', { dataTransfer });
  await expect(
    page.getByRole('region', { name: 'Tải lên' }).getByText('Đã tải lên 2 tệp'),
  ).toBeVisible();
  await expect(item(page, 'child.txt')).toHaveCount(0);
  await openDriveFolder(page, 'Con');
  await expect(item(page, 'child.txt')).toBeVisible();
  await expect(item(page, 'bottom.txt')).toHaveCount(0);
});

test('long lists still scroll to the last item', async ({ page }) => {
  const { parent } = await seed(page);
  for (let index = 0; index < 35; index += 1)
    await createViaApi(
      page,
      parent,
      `Folder ${String(index).padStart(2, '0')}`,
    );
  await page.goto(`/drive/folders/${parent.replaceAll('-', '')}`);
  await expect(item(page, 'Folder 00')).toBeVisible();
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await item(page, 'Folder 34').scrollIntoViewIfNeeded();
  await expect(item(page, 'Folder 34')).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('desktop double click stays enabled in a narrow window', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'This checks resizing a desktop window, not a touch device',
  );
  const { parent } = await seed(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/drive/folders/${parent.replaceAll('-', '')}`);
  await expect(page.getByText('Thư mục này đang trống')).toBeVisible();
  const point = await bottom(page);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.getByRole('dialog', { name: 'Thư mục mới' })).toBeVisible();
});
