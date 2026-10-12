import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { openDriveFolder } from './drive';

async function csrf(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
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
  return ((await response.json()) as { id: string }).id;
}
async function upload(page: Page, parent: string, name: string) {
  const headers = await csrf(page);
  const bytes = Buffer.from('Qloud search preview');
  const created = await page.request.post('/api/v1/uploads', {
    headers,
    data: {
      parent_id: parent,
      filename: name,
      mime_type: 'text/plain',
      size: bytes.length,
      fingerprint: `search-${crypto.randomUUID()}`,
    },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()) as { id: string };
  const signed = await page.request.post(
    `/api/v1/uploads/${session.id}/parts`,
    { headers, data: { part_numbers: [1] } },
  );
  const parts = (await signed.json()) as { parts: { url: string }[] };
  expect(
    (await page.request.put(parts.parts[0].url, { data: bytes })).ok(),
  ).toBe(true);
  const complete = await page.request.post(
    `/api/v1/uploads/${session.id}/complete`,
    { headers },
  );
  expect(complete.status()).toBe(200);
}
async function palette(page: Page) {
  await page.getByRole('button', { name: /Tìm kiếm và chạy lệnh/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tìm kiếm và câu lệnh' });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  return dialog;
}
async function capture(page: Page, kind: string, mobile: boolean) {
  if (!process.env.SEARCH_CAPTURE) return;
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
      path: `../qloud_docs/assets/m6-02-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}

test('palette finds unaccented names, opens a folder and preserves search URL filters', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  await folder(page, parent, 'Báo cáo nhóm');
  await upload(page, parent, 'Báo cáo Q3.txt');
  await page.goto('/drive');
  let dialog = await palette(page);
  await dialog.getByRole('combobox').fill('bao cao');
  await expect(
    dialog.getByRole('option', { name: 'Báo cáo Q3.txt' }),
  ).toBeVisible();
  await capture(page, 'palette', isMobile);
  await dialog.getByRole('option', { name: 'Báo cáo nhóm' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Báo cáo nhóm',
  );
  await page.keyboard.press('Control+k');
  dialog = page.getByRole('dialog', { name: 'Tìm kiếm và câu lệnh' });
  await dialog.getByRole('combobox').fill('bao cao');
  await dialog.getByRole('option', { name: 'Xem tất cả kết quả' }).click();
  await expect(page).toHaveURL(/\/search\?q=bao\+cao$/);
  await expect(
    page.getByRole('option', { name: 'Báo cáo Q3.txt', exact: true }),
  ).toBeVisible();
  await capture(page, 'results', isMobile);
  await page.getByLabel('Loại', { exact: true }).selectOption('document');
  await expect(
    page.getByRole('option', { name: 'Báo cáo nhóm', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Người sở hữu', { exact: true }).selectOption('me');
  await page.getByLabel('Sửa từ ngày').fill('2020-01-01');
  await expect(page).toHaveURL(/modified_after=/);
  await page.reload();
  await expect(page.getByLabel('Loại', { exact: true })).toHaveValue(
    'document',
  );
  await expect(page.getByLabel('Người sở hữu', { exact: true })).toHaveValue(
    'me',
  );
  await expect(page.getByLabel('Sửa từ ngày')).toHaveValue('2020-01-01');
  await page.goBack();
  await expect(page.getByLabel('Sửa từ ngày')).toHaveValue('');
  await page
    .getByRole('option', { name: 'Báo cáo Q3.txt', exact: true })
    .click();
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await expect(page).toHaveURL(/\/drive\/files\/[0-9a-f]{32}$/);
  await expect(
    page.getByText('Qloud search preview', { exact: true }),
  ).toBeVisible();
});

test('search includes inherited shares, excludes private nodes and handles revoked access', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  const shared = await folder(page, parent, 'Shared parent');
  await folder(page, shared, 'Báo cáo shared folder');
  await upload(page, shared, 'Báo cáo shared.txt');
  await folder(page, parent, 'Báo cáo private');
  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    isMobile,
    hasTouch: isMobile,
  });
  const recipient = await context.newPage();
  try {
    const email = await signUpVerifiedViaApi(recipient);
    const response = await page.request.post(`/api/v1/nodes/${shared}/shares`, {
      headers: await csrf(page),
      data: { email, role: 'viewer' },
    });
    expect(response.status()).toBe(201);
    const share = ((await response.json()) as { id: string }).id;
    await recipient.goto('/search?q=bao+cao&owner=others');
    await expect(
      recipient.getByRole('option', {
        name: 'Báo cáo shared.txt',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recipient.getByRole('option', { name: 'Báo cáo private', exact: true }),
    ).toHaveCount(0);
    await openDriveFolder(recipient, 'Báo cáo shared folder');
    await recipient.goto('/search?q=bao+cao&owner=others');
    await recipient
      .getByRole('option', { name: 'Báo cáo shared.txt', exact: true })
      .click();
    await recipient
      .getByRole('button', { name: 'Xem trước', exact: true })
      .click();
    await expect(
      recipient.getByText('Qloud search preview', { exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.request.delete(`/api/v1/shares/${share}`, {
          headers: await csrf(page),
        })
      ).status(),
    ).toBe(204);
    await recipient.goto('/search?q=bao+cao&owner=others');
    await expect(
      recipient.getByText('Không tìm thấy kết quả', { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
