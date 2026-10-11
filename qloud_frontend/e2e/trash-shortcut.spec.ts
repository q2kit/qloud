import { expect, test } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.TRASH_LIVE ? 180 : 0 } });

test('Delete moves selected Drive nodes to Trash and Undo restores them', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const csrf =
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'csrftoken',
    )?.value ?? '';
  for (const name of ['Tài liệu', 'Ảnh dự án']) {
    const response = await page.request.post('/api/v1/folders', {
      headers: { 'X-CSRFToken': csrf },
      data: { parent_id: me.root_folder_id, name },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto('/drive');
  await page.getByRole('option', { name: 'Tài liệu', exact: true }).click();
  await page.keyboard.press('Control+a');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    if (process.env.TRASH_LIVE)
      await page.screenshot({
        path: `../qloud_docs/assets/m4-04-delete-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
  }
  await page.keyboard.press('Shift+Delete');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.getByText('Đã chuyển vào thùng rác')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: 'Tài liệu', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(
    page.getByRole('option', { name: 'Tài liệu', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: 'Ảnh dự án', exact: true }),
  ).toBeVisible();
});
