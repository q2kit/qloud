import { expect, test } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { linkFromEmail } from './mailpit';

test('share notification email opens the granted folder and respects revocation', async ({
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
    data: { parent_id: root, name: 'Email shared folder' },
  });
  expect(folderResponse.status()).toBe(201);
  const folder = ((await folderResponse.json()) as { id: string }).id;
  expect(
    (
      await page.request.post('/api/v1/folders', {
        headers,
        data: { parent_id: folder, name: 'Email visible child' },
      })
    ).status(),
  ).toBe(201);
  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  try {
    const recipient = await context.newPage();
    const email = await signUpVerifiedViaApi(recipient);
    const created = await page.request.post(`/api/v1/nodes/${folder}/shares`, {
      headers,
      data: { email, role: 'viewer' },
    });
    expect(created.status()).toBe(201);
    const share = ((await created.json()) as { id: string }).id;
    const link = await linkFromEmail(email, '/drive/folders/');
    expect(new URL(link).pathname).toBe(
      `/drive/folders/${folder.replaceAll('-', '')}`,
    );
    await recipient.goto(link);
    await expect(
      recipient.getByRole('option', {
        name: 'Email visible child',
        exact: true,
      }),
    ).toBeVisible();
    if (process.env.EMAIL_CAPTURE) {
      for (const theme of ['light', 'dark']) {
        await recipient.evaluate((value) => {
          localStorage.setItem('qloud-theme', value);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'qloud-theme' }),
          );
        }, theme);
        await expect(recipient.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
        );
        await recipient.screenshot({
          path: `../qloud_docs/assets/m5-04-email-${theme}-${isMobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    expect(
      (
        await page.request.delete(`/api/v1/shares/${share}`, { headers })
      ).status(),
    ).toBe(204);
    await recipient.goto(link);
    await expect(
      recipient.getByRole('heading', { name: 'Không tìm thấy thư mục' }),
    ).toBeVisible();
    expect(
      (await recipient.request.get(`/api/v1/nodes/${folder}`)).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});
