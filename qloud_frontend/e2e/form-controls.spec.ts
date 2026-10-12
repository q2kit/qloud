import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction } from './drive';

test.use({
  launchOptions: { slowMo: process.env.CONTROLS_LIVE ? 300 : 0 },
});

async function headers(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}

/** Screenshots for the PR, only when CONTROLS_CAPTURE is set. */
async function capture(page: Page, kind: string, mobile: boolean) {
  if (!process.env.CONTROLS_CAPTURE) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
    );
    await page.screenshot({
      path: `../qloud_docs/assets/form-controls-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      animations: 'disabled',
    });
  }
}

test('share dialog uses the Select and the date-time picker for an expiring link', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const created = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: me.root_folder_id, name: 'Kế hoạch' },
  });
  expect(created.status()).toBe(201);
  await page.goto('/drive');
  await chooseItemAction(page, 'Kế hoạch', 'Chia sẻ');
  const dialog = page.getByRole('dialog', { name: 'Chia sẻ Kế hoạch' });

  const role = dialog.getByRole('combobox', { name: 'Quyền' });
  await expect(role).toHaveText('Người xem');
  await role.click();
  await expect(
    page.getByRole('option', { name: 'Người chỉnh sửa' }),
  ).toBeVisible();
  await capture(page, 'select', isMobile);
  await page.getByRole('option', { name: 'Người chỉnh sửa' }).click();
  await expect(role).toHaveText('Người chỉnh sửa');

  const expiry = dialog.getByRole('button', { name: /^Thời gian hết hạn/ });
  await expiry.click();
  // Past days cannot be picked; choose the last day of next month.
  await page.getByRole('button', { name: 'Đến tháng tiếp theo' }).click();
  const days = page.locator('[role="gridcell"]:not([data-outside]) button');
  await days.last().click();
  await page.getByRole('combobox', { name: 'Giờ' }).click();
  await page.getByRole('option', { name: '09', exact: true }).click();
  await page.getByRole('combobox', { name: 'Phút' }).click();
  await page.getByRole('option', { name: '30', exact: true }).click();
  await capture(page, 'date-time', isMobile);
  await page.getByRole('button', { name: 'Xong', exact: true }).click();
  await expect(expiry).toHaveAccessibleName(/09:30/);

  await dialog
    .getByRole('button', { name: 'Tạo liên kết', exact: true })
    .click();
  await expect(dialog.getByText(/^Hết hạn: /)).toBeVisible();
  await expect(expiry).toHaveAccessibleName(/^Thời gian hết hạn/);
});
