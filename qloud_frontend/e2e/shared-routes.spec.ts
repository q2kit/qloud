import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction, openDriveFolder } from './drive';
import { linkFromEmail } from './mailpit';

// M8-22: what others share opens under /shared; /drive only holds one's own data.

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

const compact = (id: string) => id.replaceAll('-', '');

async function share(page: Page, nodeId: string, email: string) {
  const response = await page.request.post(`/api/v1/nodes/${nodeId}/shares`, {
    headers: await csrf(page),
    data: { email, role: 'viewer' },
  });
  expect(response.status()).toBe(201);
}

/** Desktop double click; touch devices use the item menu. */
async function previewFile(page: Page, name: string, mobile: boolean) {
  if (mobile) await chooseItemAction(page, name, 'Xem trước');
  else await page.getByRole('option', { name, exact: true }).dblclick();
  await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
}

async function closePreview(page: Page, name: string) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name, exact: true })).toHaveCount(0);
}

test('shared files and folders open and close under /shared', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const drive = await root(page);
  const teamResponse = await page.request.post('/api/v1/folders', {
    headers: await csrf(page),
    data: { parent_id: drive, name: 'Team' },
  });
  expect(teamResponse.status()).toBe(201);
  const team = (await teamResponse.json()) as { id: string };
  await upload(page, team.id, 'plan.txt', 'text/plain', Buffer.from('Plan'));
  const solo = await upload(
    page,
    drive,
    'solo.txt',
    'text/plain',
    Buffer.from('Solo'),
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
    await share(page, solo.id, email);
    await share(page, team.id, email);

    // A file shared on its own previews over the list; Esc stays on /shared.
    await recipient.goto('/shared');
    await previewFile(recipient, 'solo.txt', isMobile);
    await expect(recipient).toHaveURL(
      new RegExp(`/shared\\?preview=${compact(solo.id)}$`),
    );
    await closePreview(recipient, 'solo.txt');
    await expect(recipient).toHaveURL(/\/shared$/);

    // A shared folder opens under /shared, with a trail back to the list.
    await openDriveFolder(recipient, 'Team');
    await expect(recipient).toHaveURL(
      new RegExp(`/shared/folders/${compact(team.id)}$`),
    );
    await expect(
      recipient
        .getByRole('navigation', { name: 'Đường dẫn thư mục' })
        .getByRole('link', { name: 'Được chia sẻ với tôi' }),
    ).toBeVisible();
    await previewFile(recipient, 'plan.txt', isMobile);
    await closePreview(recipient, 'plan.txt');
    await expect(recipient).toHaveURL(
      new RegExp(`/shared/folders/${compact(team.id)}$`),
    );

    // Old /drive links and the email link both land under /shared.
    await recipient.goto(`/drive/folders/${compact(team.id)}`);
    await expect(recipient).toHaveURL(
      new RegExp(`/shared/folders/${compact(team.id)}$`),
    );
    const link = await linkFromEmail(
      email,
      `/shared/folders/${compact(team.id)}`,
    );
    await recipient.goto(link);
    await expect(
      recipient.getByRole('heading', { level: 1, name: 'Team' }),
    ).toBeVisible();
    await recipient.goto(
      await linkFromEmail(email, `/shared/files/${compact(solo.id)}`),
    );
    await expect(recipient).toHaveURL(
      new RegExp(`/shared\\?preview=${compact(solo.id)}$`),
    );
    await closePreview(recipient, 'solo.txt');
    await expect(recipient).toHaveURL(/\/shared$/);
  } finally {
    await context.close();
  }
});
