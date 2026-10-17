import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { openDriveFolder } from './drive';

test.use({
  launchOptions: { slowMo: process.env.M810_CAPTURE ? 250 : 0 },
});

/** M810_CAPTURE=1 saves light and dark screenshots for the PR. */
async function capture(page: Page, kind: string, mobile: boolean) {
  if (!process.env.M810_CAPTURE) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
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
      path: `../qloud_docs/assets/m8-10-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      animations: 'disabled',
    });
  }
}

async function createFolder(page: Page, parent: string, name: string) {
  const csrf =
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'csrftoken',
    )?.value ?? '';
  const response = await page.request.post('/api/v1/folders', {
    headers: { 'X-CSRFToken': csrf },
    data: { parent_id: parent, name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function openSharingTab(page: Page, name: string) {
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await page.getByRole('tab', { name: 'Chia sẻ' }).click();
  return page
    .getByRole('dialog', { name: 'Chi tiết', exact: true })
    .or(page.getByRole('complementary', { name: 'Chi tiết', exact: true }));
}

test('sharing tab shows a new recipient and their access in subfolders', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const team = await createFolder(page, me.root_folder_id, 'Team');
  await createFolder(page, team, 'Notes');

  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  let email: string;
  try {
    email = await signUpVerifiedViaApi(await context.newPage());
  } finally {
    await context.close();
  }

  await page.goto('/drive');
  let panel = await openSharingTab(page, 'Team');
  await expect(panel.getByText('Chưa chia sẻ với ai.')).toBeVisible();
  await panel.getByRole('button', { name: 'Quản lý quyền truy cập' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chia sẻ Team' });
  await dialog.getByLabel('Email người nhận').fill(email);
  await dialog.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
  await expect(
    dialog.getByRole('combobox', { name: `Quyền của ${email}` }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Tạo liên kết', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Sao chép liên kết', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.getByText(email)).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Sao chép liên kết' }),
  ).toBeVisible();
  await capture(page, 'sharing-tab', isMobile);

  await panel.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await openDriveFolder(page, 'Team');
  panel = await openSharingTab(page, 'Notes');
  await expect(panel.getByText(email)).toBeVisible();
  await expect(panel.getByText('Quyền từ thư mục Team')).toBeVisible();
  await capture(page, 'sharing-tab-inherited', isMobile);
});
