import { expect, test, type Locator, type Page } from '@playwright/test';

import { signUpViaApi, signUpVerifiedViaApi } from './auth';

// M8-12: the floating "+" replaces the header "Create" button below `lg`.
test.use({
  launchOptions: {
    slowMo: process.env.M812_CAPTURE
      ? Number(process.env.M812_SLOWMO ?? '250')
      : 0,
  },
});

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'the floating button only exists on small screens');
});

/** M812_CAPTURE=1 saves light and dark screenshots for the PR (M812_SLOWMO: ms). */
async function capture(page: Page, kind: string) {
  if (!process.env.M812_CAPTURE) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
    );
    await page.screenshot({
      path: `../qloud_docs/assets/m8-12-${kind}-${theme}-360.png`,
      animations: 'disabled',
    });
  }
}

function fab(page: Page): Locator {
  return page.locator('[data-create-fab]');
}

async function noHorizontalScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function headers(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}

test('the floating button creates a folder and uploads above the tray', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  await page.goto('/drive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Drive của tôi',
  );

  // One "Create" button: the floating one, round, at least 44px, bottom right.
  const button = page.getByRole('button', { name: 'Tạo mới' });
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('data-create-fab', '');
  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (!box || !viewport) return;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x + box.width).toBeGreaterThan(viewport.width - 32);
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 32);
  await noHorizontalScroll(page);

  await button.click();
  await expect(
    page.getByRole('menuitem', { name: 'Thư mục mới' }),
  ).toBeVisible();
  await capture(page, 'menu');
  await page.getByRole('menuitem', { name: 'Thư mục mới' }).click();
  const dialog = page.getByRole('dialog', { name: 'Thư mục mới' });
  await dialog.getByLabel('Tên').fill('Ảnh');
  await dialog.getByRole('button', { name: 'Tạo' }).click();
  await expect(
    page.getByRole('option', { name: 'Ảnh', exact: true }),
  ).toBeVisible();

  await button.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Tải tệp lên' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  const tray = page.getByRole('region', { name: 'Tải lên' });
  await expect(tray.getByText('Đã tải lên 1 tệp')).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'note.txt', exact: true }),
  ).toBeVisible();

  // The button moves up instead of covering the tray.
  await expect(async () => {
    const [fabBox, trayBox] = await Promise.all([
      button.boundingBox(),
      tray.boundingBox(),
    ]);
    expect(fabBox && trayBox).toBeTruthy();
    if (fabBox && trayBox)
      expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(trayBox.y);
  }).toPass();
  await noHorizontalScroll(page);
  await capture(page, 'tray');

  // The modal details sheet hides it.
  await page.getByRole('option', { name: 'note.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await expect(page.getByRole('dialog', { name: 'Chi tiết' })).toBeVisible();
  await expect(fab(page)).toHaveCount(0);
});

test('a viewer cannot create in a shared folder', async ({
  page,
  browser,
  baseURL,
}) => {
  await signUpViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const created = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: me.root_folder_id, name: 'Team' },
  });
  expect(created.status()).toBe(201);
  const team = ((await created.json()) as { id: string }).id;

  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile: true,
    hasTouch: true,
  });
  try {
    const viewer = await context.newPage();
    const email = await signUpViaApi(viewer);
    expect(
      (
        await page.request.post(`/api/v1/nodes/${team}/shares`, {
          headers: await headers(page),
          data: { email, role: 'viewer' },
        })
      ).status(),
    ).toBe(201);

    await viewer.goto(`/shared/folders/${team.replaceAll('-', '')}`);
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('Team');
    await fab(viewer).click();
    for (const name of ['Thư mục mới', 'Tải tệp lên', 'Tải thư mục lên'])
      await expect(viewer.getByRole('menuitem', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
  } finally {
    await context.close();
  }
});

test('trash and settings keep the header button', async ({ page }) => {
  await signUpViaApi(page);
  for (const path of ['/trash', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Tạo mới' })).toBeVisible();
    await expect(fab(page)).toHaveCount(0);
  }
});
