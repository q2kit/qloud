import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { linkFromEmail } from './mailpit';

async function csrf(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}
async function upload(
  page: Page,
  parent: string,
  name: string,
  mime: string,
  bytes: Buffer,
) {
  const headers = await csrf(page);
  const created = await page.request.post('/api/v1/uploads', {
    headers,
    data: {
      parent_id: parent,
      filename: name,
      mime_type: mime,
      size: bytes.length,
      fingerprint: `preview-${name}`,
    },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()) as { id: string; part_size: number };
  const count = Math.ceil(bytes.length / session.part_size);
  const signed = await page.request.post(
    `/api/v1/uploads/${session.id}/parts`,
    {
      headers,
      data: {
        part_numbers: Array.from({ length: count }, (_, index) => index + 1),
      },
    },
  );
  const parts = (await signed.json()) as {
    parts: { part_number: number; url: string }[];
  };
  for (const part of parts.parts) {
    const start = (part.part_number - 1) * session.part_size;
    expect(
      (
        await page.request.put(part.url, {
          data: bytes.subarray(start, start + session.part_size),
        })
      ).ok(),
    ).toBe(true);
  }
  const complete = await page.request.post(
    `/api/v1/uploads/${session.id}/complete`,
    { headers },
  );
  expect(complete.status()).toBe(200);
  return (await complete.json()) as { id: string };
}

test('file grant email opens without parent access and respects revocation', async ({
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
  const bytes = Buffer.from('Only this file is shared.');
  const file = await upload(page, folder, 'Granted.txt', 'text/plain', bytes);
  await upload(
    page,
    folder,
    'Private sibling.txt',
    'text/plain',
    Buffer.from('Private sibling'),
  );
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
    const created = await page.request.post(`/api/v1/nodes/${file.id}/shares`, {
      headers,
      data: { email, role: 'viewer' },
    });
    expect(created.status()).toBe(201);
    const share = ((await created.json()) as { id: string }).id;
    const link = await linkFromEmail(email, '/drive/files/');
    expect(new URL(link).pathname).toBe(
      `/drive/files/${file.id.replaceAll('-', '')}`,
    );
    const requests: string[] = [];
    recipient.on('request', (request) =>
      requests.push(new URL(request.url()).pathname),
    );
    await recipient.goto(link);
    const dialog = recipient.getByRole('dialog', { name: 'Granted.txt' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(bytes.toString(), { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Tệp trước', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Tệp sau', exact: true }),
    ).toBeDisabled();
    await expect(
      recipient.getByText('Email shared folder', { exact: true }),
    ).toHaveCount(0);
    await expect(
      recipient.getByText('Private sibling.txt', { exact: true }),
    ).toHaveCount(0);
    expect(requests.some((path) => path.endsWith('/children'))).toBe(false);
    expect(
      (await recipient.request.get(`/api/v1/nodes/${folder}`)).status(),
    ).toBe(404);
    const downloaded = recipient.waitForEvent('download');
    await dialog
      .getByRole('button', { name: 'Tải xuống', exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('Granted.txt');
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('Missing download path');
    expect(await readFile(downloadPath)).toEqual(bytes);
    if (process.env.SHARED_FILE_CAPTURE) {
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
          path: `../qloud_docs/assets/m5-08-file-${theme}-${isMobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await recipient.keyboard.press('Escape');
    await expect(recipient).toHaveURL(/\/drive$/);
    await expect(dialog).toHaveCount(0);
    expect(
      (
        await page.request.delete(`/api/v1/shares/${share}`, { headers })
      ).status(),
    ).toBe(204);
    await recipient.goto(link);
    await expect(
      recipient.getByRole('heading', { name: 'Không thể xem trước tệp này.' }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(
      (await recipient.request.get(`/api/v1/nodes/${file.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await recipient.request.get(`/api/v1/nodes/${file.id}/preview`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await recipient.request.get(`/api/v1/nodes/${file.id}/download`)
      ).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});
