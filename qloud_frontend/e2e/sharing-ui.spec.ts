import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction, openItemMenu } from './drive';
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

async function captures(page: Page, kind: string, mobile: boolean) {
  if (!process.env.SHARING_CAPTURE) return;
  if (kind === 'dialog')
    await page.getByRole('dialog').evaluate((element) => {
      element.scrollTop = 0;
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /dark/ : /^(?!.*dark).*$/,
    );
    await page.screenshot({
      path: `../qloud_docs/assets/m5-05-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}
async function openItem(page: Page, name: string) {
  await chooseItemAction(page, name, 'Mở');
}
test('owner shares, changes roles, creates links and revokes access through UI', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const headers = await csrf(page);
  const folderResponse = await page.request.post('/api/v1/folders', {
    headers,
    data: { parent_id: await root(page), name: 'Shared project' },
  });
  expect(folderResponse.status()).toBe(201);
  const folder = (await folderResponse.json()) as { id: string };
  await upload(
    page,
    folder.id,
    'Readme.txt',
    'text/plain',
    Buffer.from('Project content'),
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
    await page.goto('/drive');
    await chooseItemAction(page, 'Shared project', 'Chia sẻ');
    const dialog = page.getByRole('dialog', { name: 'Chia sẻ Shared project' });
    await dialog.getByLabel('Email người nhận').fill(email);
    await dialog.getByRole('button', { name: 'Chia sẻ', exact: true }).click();
    await expect(
      dialog.getByRole('combobox', { name: `Quyền của ${email}` }),
    ).toHaveValue('viewer');
    await dialog.getByRole('button', { name: 'Tạo link', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Sao chép link', exact: true }),
    ).toBeVisible();
    await captures(page, 'dialog', isMobile);
    await recipient.goto('/shared');
    await expect(
      recipient.getByRole('option', { name: 'Shared project', exact: true }),
    ).toBeVisible();
    await expect(recipient.getByText(/Chủ sở hữu · Người xem/)).toBeVisible();
    await captures(recipient, 'shared', isMobile);
    await openItem(recipient, 'Shared project');
    const viewerMenu = await openItemMenu(recipient, 'Readme.txt');
    await expect(
      viewerMenu.getByText('Tải xuống', { exact: true }),
    ).toBeVisible();
    await expect(viewerMenu.getByText('Đổi tên', { exact: true })).toHaveCount(
      0,
    );
    await expect(viewerMenu.getByText('Chia sẻ', { exact: true })).toHaveCount(
      0,
    );
    await recipient.keyboard.press('Escape');
    await dialog
      .getByRole('combobox', { name: `Quyền của ${email}` })
      .selectOption('editor');
    await expect(
      dialog.getByRole('combobox', { name: `Quyền của ${email}` }),
    ).toHaveValue('editor');
    await recipient.reload();
    const editorMenu = await openItemMenu(recipient, 'Readme.txt');
    await expect(
      editorMenu.getByText('Đổi tên', { exact: true }),
    ).toBeVisible();
    await editorMenu.getByText('Chia sẻ', { exact: true }).click();
    await expect(
      recipient.getByText('Chỉ chủ sở hữu quản lý link công khai.'),
    ).toBeVisible();
    await recipient.getByRole('button', { name: 'Đóng', exact: true }).click();
    const links = await page.request.get(`/api/v1/nodes/${folder.id}/links`);
    const link = (
      (await links.json()) as { results: { token: string }[] }
    ).results.at(0);
    if (!link) throw new Error('Missing link');
    const visitorContext = await browser.newContext({
      baseURL,
      locale: 'vi-VN',
      viewport: page.viewportSize(),
      isMobile,
      hasTouch: isMobile,
    });
    try {
      const visitor = await visitorContext.newPage();
      const privateRequests: string[] = [];
      visitor.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/api/v1/nodes/')) privateRequests.push(path);
      });
      await visitor.goto(`/s/${link.token}`);
      await expect(
        visitor.getByRole('heading', { name: 'Shared project' }),
      ).toBeVisible();
      await expect(
        visitor.getByRole('option', { name: 'Readme.txt', exact: true }),
      ).toBeVisible();
      await captures(visitor, 'public-folder', isMobile);
      await visitor
        .getByRole('button', {
          name: 'Thao tác khác với Readme.txt',
          exact: true,
        })
        .click();
      await visitor
        .getByRole('menuitem', { name: 'Xem trước', exact: true })
        .click();
      await expect(
        visitor.getByRole('dialog', { name: 'Readme.txt' }),
      ).toBeVisible();
      await expect(
        visitor.getByText('Project content', { exact: true }),
      ).toBeVisible();
      const downloaded = visitor.waitForEvent('download');
      await visitor
        .getByRole('button', { name: 'Tải xuống', exact: true })
        .click();
      const download = await downloaded;
      const path = await download.path();
      if (!path) throw new Error('Missing download');
      expect(await readFile(path)).toEqual(Buffer.from('Project content'));
      expect(privateRequests).toEqual([]);
      await dialog
        .getByRole('button', { name: 'Thu hồi link', exact: true })
        .click();
      await expect(
        dialog.getByText('Đã thu hồi', { exact: true }),
      ).toBeVisible();
      await visitor.goto(`/s/${link.token}`);
      await expect(
        visitor.getByRole('heading', { name: 'Nội dung không còn khả dụng' }),
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
    await dialog
      .getByRole('button', { name: `Thu hồi quyền của ${email}`, exact: true })
      .click();
    await expect(
      dialog.getByRole('combobox', { name: `Quyền của ${email}` }),
    ).toHaveCount(0);
    await recipient.goto('/shared');
    await expect(
      recipient.getByRole('heading', { name: 'Chưa có mục được chia sẻ' }),
    ).toBeVisible();
    await recipient.goto(`/drive/folders/${folder.id.replaceAll('-', '')}`);
    await expect(
      recipient.getByRole('heading', { name: 'Không tìm thấy thư mục' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test('public file opens anonymously, denies outside scope and expires', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const headers = await csrf(page);
  const file = await upload(
    page,
    await root(page),
    'Public.txt',
    'text/plain',
    Buffer.from('Public file content'),
  );
  const response = await page.request.post(`/api/v1/nodes/${file.id}/links`, {
    headers,
    data: {},
  });
  expect(response.status()).toBe(201);
  const link = (await response.json()) as { token: string };
  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  try {
    const visitor = await context.newPage();
    await visitor.goto(`/s/${link.token}`);
    await expect(
      visitor.getByRole('dialog', { name: 'Public.txt' }),
    ).toBeVisible();
    await expect(
      visitor.getByText('Public file content', { exact: true }),
    ).toBeVisible();
    await captures(visitor, 'public-file', isMobile);
    await visitor.keyboard.press('Escape');
    await expect(visitor.getByRole('dialog')).toHaveCount(0);
    // Closing the viewer shows the folder-link layout without sorting.
    await expect(
      visitor.getByRole('heading', { name: 'Public.txt' }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('button', { name: 'Báo cáo vi phạm' }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('option', { name: 'Public.txt', exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('button', { name: /Sắp xếp|Tên \(A/ }),
    ).toHaveCount(0);
    await captures(visitor, 'public-file-page', isMobile);
    const outside = await root(page);
    expect(
      (
        await visitor.request.get(
          `/api/v1/public/links/${link.token}?node_id=${outside}`,
        )
      ).status(),
    ).toBe(404);
    await visitor.goto(
      `/s/${link.token}?folder=${outside.replaceAll('-', '')}`,
    );
    await expect(
      visitor.getByRole('heading', { name: 'Nội dung không còn khả dụng' }),
    ).toBeVisible();
    const expiredResponse = await page.request.post(
      `/api/v1/nodes/${file.id}/links`,
      {
        headers,
        data: { expires_at: new Date(Date.now() + 2000).toISOString() },
      },
    );
    expect(expiredResponse.status()).toBe(201);
    const expiring = (await expiredResponse.json()) as { token: string };
    await expect
      .poll(async () =>
        (
          await visitor.request.get(`/api/v1/public/links/${expiring.token}`)
        ).status(),
      )
      .toBe(404);
    await visitor.goto(`/s/${expiring.token}`);
    await expect(
      visitor.getByRole('heading', { name: 'Nội dung không còn khả dụng' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
