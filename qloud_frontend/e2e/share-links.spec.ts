import { expect, test } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.LINK_LIVE ? 250 : 0 } });

test('public folder link confines anonymous access and revokes on the real stack', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const headers = {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
  const root = (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
  const folderResponse = await page.request.post('/api/v1/folders', {
    headers,
    data: { parent_id: root, name: 'Public API folder' },
  });
  expect(folderResponse.status()).toBe(201);
  const folder = ((await folderResponse.json()) as { id: string }).id;
  const payload = Buffer.from('public link content');
  const uploadResponse = await page.request.post('/api/v1/uploads', {
    headers,
    data: {
      parent_id: folder,
      filename: 'public.txt',
      size: payload.length,
      mime_type: 'text/plain',
      fingerprint: crypto.randomUUID(),
    },
  });
  expect(uploadResponse.status()).toBe(201);
  const session = ((await uploadResponse.json()) as { id: string }).id;
  const partsResponse = await page.request.post(
    `/api/v1/uploads/${session}/parts`,
    { headers, data: { part_numbers: [1] } },
  );
  expect(partsResponse.status()).toBe(200);
  const part = ((await partsResponse.json()) as { parts: { url: string }[] })
    .parts[0];
  expect((await page.request.put(part.url, { data: payload })).ok()).toBe(true);
  const done = await page.request.post(`/api/v1/uploads/${session}/complete`, {
    headers,
  });
  expect(done.status()).toBe(200);
  const file = ((await done.json()) as { id: string }).id;
  const created = await page.request.post(`/api/v1/nodes/${folder}/links`, {
    headers,
    data: { expires_at: new Date(Date.now() + 120_000).toISOString() },
  });
  expect(created.status()).toBe(201);
  const link = (await created.json()) as { id: string; token: string };
  await page.goto(`/drive/folders/${folder.replaceAll('-', '')}`);
  await expect(
    page.getByRole('option', { name: 'public.txt', exact: true }),
  ).toBeVisible();
  if (process.env.LINK_CAPTURE) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('qloud-theme', value);
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'qloud-theme' }),
        );
      }, theme);
      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
      );
      await page.screenshot({
        path: `../qloud_docs/assets/m5-03-link-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  const anonymous = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  try {
    const visitor = await anonymous.newPage();
    const path = `/api/v1/public/links/${link.token}`;
    expect((await visitor.request.get('/api/v1/me')).status()).toBe(403);
    const detail = await visitor.request.get(path);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: folder,
      parent_id: null,
      breadcrumb: [],
      capabilities: { can_edit: false, can_trash: false, can_share: false },
    });
    const children = await visitor.request.get(`${path}/children`);
    expect(await children.json()).toMatchObject({
      results: [{ id: file, name: 'public.txt' }],
    });
    for (const suffix of ['', '/download', '/preview']) {
      expect(
        (
          await visitor.request.get(`${path}${suffix}`, {
            params: { node_id: root },
          })
        ).status(),
      ).toBe(404);
    }
    const preview = await visitor.request.get(`${path}/preview`, {
      params: { node_id: file },
    });
    expect(preview.status()).toBe(200);
    const previewData = (await preview.json()) as { kind: string; url: string };
    expect(previewData.kind).toBe('text');
    await visitor.goto(previewData.url);
    await expect(visitor.locator('body')).toContainText('public link content');
    const download = await visitor.request.get(`${path}/download`, {
      params: { node_id: file },
    });
    expect(download.status()).toBe(200);
    const downloadData = (await download.json()) as { url: string };
    expect(await (await visitor.request.get(downloadData.url)).body()).toEqual(
      payload,
    );
    expect(
      (
        await page.request.delete(`/api/v1/links/${link.id}`, { headers })
      ).status(),
    ).toBe(204);
    for (const suffix of ['', '/children', '/download', '/preview']) {
      expect(
        (
          await visitor.request.get(`${path}${suffix}`, {
            params: { node_id: file },
          })
        ).status(),
      ).toBe(404);
    }
  } finally {
    await anonymous.close();
  }
});
