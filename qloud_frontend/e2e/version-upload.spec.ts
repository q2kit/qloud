import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';

// Optional live run: M701_LIVE=1 ... --headed --workers=1.
test.use({ launchOptions: { slowMo: process.env.M701_LIVE ? 350 : 0 } });

async function seed(page: Page) {
  const headers = {
    'X-CSRFToken':
      (await page.context().cookies()).find((c) => c.name === 'csrftoken')
        ?.value ?? '',
  };
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const bytes = Buffer.from('Nội dung phiên bản đầu tiên');
  const created = await page.request.post('/api/v1/uploads', {
    headers,
    data: {
      parent_id: me.root_folder_id,
      filename: 'Báo cáo.txt',
      size: bytes.length,
      mime_type: 'text/plain',
      fingerprint: 'version-seed',
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
  const node = (await complete.json()) as { id: string };
  const oldDownload = (await (
    await page.request.get(`/api/v1/nodes/${node.id}/download`)
  ).json()) as { url: string };
  return { node, bytes, oldDownload };
}

async function capture(page: Page, mobile: boolean) {
  if (!process.env.M701_CAPTURE) return;
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
      path: `../qloud_docs/assets/m7-01-replace-${theme}-${mobile ? '360' : 'desktop'}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}

test('replace a taken name, retain the same file and refresh its preview and download', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const { node, bytes, oldDownload } = await seed(page);
  await page.goto('/drive');
  const item = page.getByRole('option', { name: 'Báo cáo.txt', exact: true });
  await expect(item).toBeVisible();
  await item.click();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Báo cáo.txt', exact: true });
  await expect(viewer).toContainText(bytes.toString());
  await page.getByRole('button', { name: 'Đóng trình xem' }).click();

  const latest = Buffer.from('Nội dung phiên bản mới — M7-01');
  await page.getByTestId('upload-input').setInputFiles({
    name: 'Báo cáo.txt',
    mimeType: 'text/plain',
    buffer: latest,
  });
  const conflict = page.getByRole('dialog', { name: 'Trùng tên' });
  await expect(
    conflict.getByRole('button', { name: 'Thay thế', exact: true }),
  ).toBeVisible();
  await capture(page, isMobile);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/uploads') && r.status() === 201,
  );
  await conflict.getByRole('button', { name: 'Thay thế', exact: true }).click();
  const session = (await (await created).json()) as { target_node_id: string };
  expect(session.target_node_id).toBe(node.id);
  await expect(
    page.getByRole('region', { name: 'Tải lên' }).getByText('Đã tải lên 1 tệp'),
  ).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
  await item.click();
  await page.keyboard.press('Enter');
  await expect(viewer).toContainText(latest.toString());
  const download = (await (
    await page.request.get(`/api/v1/nodes/${node.id}/download`)
  ).json()) as { url: string };
  expect(
    (await (await page.request.get(download.url)).body()).equals(latest),
  ).toBe(true);
  expect(
    (await (await page.request.get(oldDownload.url)).body()).equals(bytes),
  ).toBe(true);
});
