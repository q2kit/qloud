import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.SHARING_LIVE ? 250 : 0 } });

async function csrf(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}

async function createFolder(page: Page, parent: string, name: string) {
  const response = await page.request.post('/api/v1/folders', {
    headers: await csrf(page),
    data: { parent_id: parent, name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

test('sharing API grants viewer/editor access and revokes it on the real stack', async ({
  page,
  browser,
  isMobile,
  baseURL,
}) => {
  await signUpVerifiedViaApi(page);
  const root = (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
  const folder = await createFolder(page, root, 'API shared folder');
  await createFolder(page, folder, 'Visible child');
  const recipientContext = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    isMobile,
    hasTouch: isMobile,
  });
  const recipient = await recipientContext.newPage();
  try {
    const email = await signUpVerifiedViaApi(recipient);
    const created = await page.request.post(`/api/v1/nodes/${folder}/shares`, {
      headers: await csrf(page),
      data: { email, role: 'viewer' },
    });
    expect(created.status()).toBe(201);
    const share = ((await created.json()) as { id: string }).id;
    const shared = await recipient.request.get('/api/v1/shared-with-me');
    expect(shared.status()).toBe(200);
    expect(
      (
        (await shared.json()) as {
          results: { id: string; effective_role: string }[];
        }
      ).results,
    ).toEqual([
      expect.objectContaining({ id: folder, effective_role: 'viewer' }),
    ]);
    expect(
      (await recipient.request.get(`/api/v1/nodes/${folder}`)).status(),
    ).toBe(200);
    await recipient.goto(`/drive/folders/${folder.replaceAll('-', '')}`);
    await expect(
      recipient.getByRole('option', { name: 'Visible child', exact: true }),
    ).toBeVisible();
    if (process.env.SHARING_CAPTURE) {
      for (const theme of ['light', 'dark']) {
        await recipient.evaluate((value) => {
          localStorage.setItem('qloud-theme', value);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'qloud-theme' }),
          );
        }, theme);
        await expect(recipient.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^$/,
        );
        await recipient.screenshot({
          path: `../qloud_docs/assets/m5-02-shared-${theme}-${isMobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    const childRequest = {
      headers: await csrf(recipient),
      data: {
        parent_id: folder,
        name: 'Recipient folder',
      },
    };
    expect(
      (await recipient.request.post('/api/v1/folders', childRequest)).status(),
    ).toBe(404);
    expect(
      (
        await recipient.request.post(`/api/v1/nodes/${folder}/shares`, {
          headers: await csrf(recipient),
          data: { email, role: 'editor' },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch(`/api/v1/shares/${share}`, {
          headers: await csrf(page),
          data: { role: 'editor' },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await recipient.request.post('/api/v1/folders', childRequest)).status(),
    ).toBe(201);
    await recipient.reload();
    await expect(
      recipient.getByRole('option', { name: 'Recipient folder', exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.request.delete(`/api/v1/shares/${share}`, {
          headers: await csrf(page),
        })
      ).status(),
    ).toBe(204);
    expect(
      (await recipient.request.get(`/api/v1/nodes/${folder}`)).status(),
    ).toBe(404);
    expect(
      (await recipient.request.post('/api/v1/folders', childRequest)).status(),
    ).toBe(404);
    expect(
      (
        (await (
          await recipient.request.get('/api/v1/shared-with-me')
        ).json()) as {
          results: unknown[];
        }
      ).results,
    ).toEqual([]);
  } finally {
    await recipientContext.close();
  }
});
