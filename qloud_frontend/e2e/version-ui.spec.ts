import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signUpViaApi, signUpVerifiedViaApi } from './auth';

test.use({
  launchOptions: {
    slowMo: process.env.M703_LIVE || process.env.M704_LIVE ? 350 : 0,
  },
});

async function headers(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}
async function seed(page: Page) {
  const csrf = await headers(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const original = Buffer.from('Nội dung gốc — M7-03');
  async function upload(bytes: Buffer, target?: string) {
    const response = await page.request.post('/api/v1/uploads', {
      headers: csrf,
      data: {
        parent_id: me.root_folder_id,
        filename: 'Lịch sử.txt',
        size: bytes.length,
        mime_type: 'text/plain',
        fingerprint: crypto.randomUUID(),
        ...(target ? { target_node_id: target } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const session = (await response.json()) as { id: string };
    const signed = await page.request.post(
      `/api/v1/uploads/${session.id}/parts`,
      { headers: csrf, data: { part_numbers: [1] } },
    );
    const parts = (await signed.json()) as { parts: { url: string }[] };
    expect(
      (await page.request.put(parts.parts[0].url, { data: bytes })).ok(),
    ).toBe(true);
    const complete = await page.request.post(
      `/api/v1/uploads/${session.id}/complete`,
      { headers: csrf },
    );
    expect(complete.status()).toBe(200);
    return ((await complete.json()) as { id: string }).id;
  }
  const id = await upload(original);
  await upload(Buffer.from('Nội dung mới — M7-03'), id);
  return { id, original, csrf, root: me.root_folder_id };
}
async function openHistory(page: Page) {
  await page.getByRole('option', { name: 'Lịch sử.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await page.getByRole('tab', { name: 'Phiên bản' }).click();
  await expect(
    page.getByRole('listitem', { name: 'Phiên bản 2', exact: true }),
  ).toContainText('Hiện tại');
}

test('replacement upload refreshes the open history panel', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  await seed(page);
  await page.goto('/drive');
  await openHistory(page);
  await page.getByTestId('upload-input').setInputFiles({
    name: 'Lịch sử.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Replacement from the upload UI'),
  });
  await page.getByRole('button', { name: 'Thay thế', exact: true }).click();
  await expect(
    page.getByRole('listitem', { name: 'Phiên bản 3', exact: true }),
  ).toContainText('Hiện tại');
  await expect(
    page.getByRole('listitem', { name: 'Phiên bản 2', exact: true }),
  ).not.toContainText('Hiện tại');
});

test('owner downloads old bytes, restores a new version and deletes old history', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const { original } = await seed(page);
  await page.goto('/drive');
  await openHistory(page);
  if (process.env.M703_CAPTURE) {
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
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `../qloud_docs/assets/m7-03-versions-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Tải phiên bản 1', exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Lịch sử.txt');
  expect(await readFile(await download.path())).toEqual(original);
  await page
    .getByRole('button', { name: 'Khôi phục phiên bản 1', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Khôi phục phiên bản 1?',
  });
  await expect(confirmation).toContainText('dung lượng đã dùng không tăng');
  await confirmation
    .getByRole('button', { name: 'Khôi phục', exact: true })
    .click();
  await expect(
    page.getByRole('listitem', { name: 'Phiên bản 3', exact: true }),
  ).toContainText('Hiện tại');
  await expect(confirmation).not.toBeVisible();
  await page
    .getByRole('dialog', { name: 'Chi tiết', exact: true })
    .or(page.getByRole('complementary', { name: 'Chi tiết', exact: true }))
    .getByRole('button', { name: 'Đóng bảng chi tiết' })
    .click();
  await page.getByRole('option', { name: 'Lịch sử.txt', exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Lịch sử.txt', exact: true }),
  ).toContainText(original.toString());
  await page.getByRole('button', { name: 'Đóng trình xem' }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await page.getByRole('tab', { name: 'Phiên bản' }).click();
  for (const number of [1, 2]) {
    await page
      .getByRole('button', {
        name: `Xóa phiên bản ${String(number)}`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: `Xóa phiên bản ${String(number)}?`,
    });
    await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('listitem', {
        name: `Phiên bản ${String(number)}`,
        exact: true,
      }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole('listitem', { name: 'Phiên bản 3', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Xóa phiên bản 3' }),
  ).toHaveCount(0);
});

for (const role of ['viewer', 'editor'] as const) {
  test(`${role} sees only permitted history actions on a directly shared file`, async ({
    page,
    browser,
    isMobile,
  }) => {
    await signUpVerifiedViaApi(page);
    const { id, csrf } = await seed(page);
    const actor = await browser.newPage({
      viewport: page.viewportSize() ?? { width: 1280, height: 720 },
      isMobile,
      hasTouch: isMobile,
      locale: 'vi-VN',
    });
    try {
      const email = await signUpViaApi(actor);
      const grant = await page.request.post(`/api/v1/nodes/${id}/shares`, {
        headers: csrf,
        data: { email, role },
      });
      expect(grant.status()).toBe(201);
      await actor.goto('/shared');
      await openHistory(actor);
      await expect(
        actor.getByRole('button', { name: 'Tải phiên bản 1' }),
      ).toBeVisible();
      await expect(
        actor.getByRole('button', { name: 'Xóa phiên bản 1' }),
      ).toHaveCount(0);
      await expect(
        actor.getByRole('button', { name: 'Khóa phiên bản 1' }),
      ).toHaveCount(0);
      if (role === 'viewer') {
        await expect(
          actor.getByRole('button', { name: 'Khôi phục phiên bản 1' }),
        ).toHaveCount(0);
      } else {
        await actor
          .getByRole('button', { name: 'Khôi phục phiên bản 1', exact: true })
          .click();
        await actor
          .getByRole('dialog', { name: 'Khôi phục phiên bản 1?' })
          .getByRole('button', { name: 'Khôi phục', exact: true })
          .click();
        await expect(
          actor.getByRole('listitem', { name: 'Phiên bản 3', exact: true }),
        ).toContainText('Hiện tại');
      }
    } finally {
      await actor.close();
    }
  });
}

test('folder and trash details never read version history', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  const { id, csrf, root } = await seed(page);
  const folder = await page.request.post('/api/v1/folders', {
    headers: csrf,
    data: { parent_id: root, name: 'Thư mục kiểm tra' },
  });
  expect(folder.status()).toBe(201);
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/versions')) calls.push(request.url());
  });
  await page.goto('/drive');
  await page
    .getByRole('option', { name: 'Thư mục kiểm tra', exact: true })
    .click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await expect(page.getByRole('tab', { name: 'Phiên bản' })).toBeDisabled();
  await page
    .getByRole('dialog', { name: 'Chi tiết', exact: true })
    .or(page.getByRole('complementary', { name: 'Chi tiết', exact: true }))
    .getByRole('button', { name: 'Đóng bảng chi tiết' })
    .click();
  expect(
    (
      await page.request.post('/api/v1/nodes/trash', {
        headers: csrf,
        data: { node_ids: [id] },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/trash');
  await page.getByRole('option', { name: 'Lịch sử.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await expect(page.getByRole('tab', { name: 'Phiên bản' })).toBeDisabled();
  expect(calls).toEqual([]);
});

test('owner toggles keep forever on old and current versions', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const { id } = await seed(page);
  await page.goto('/drive');
  await openHistory(page);
  const old = page.getByRole('button', {
    name: 'Khóa phiên bản 1',
    exact: true,
  });
  await expect(old).toHaveAttribute('aria-pressed', 'false');
  await old.click();
  await expect(old).toHaveAttribute('aria-pressed', 'true');
  const current = page.getByRole('button', {
    name: 'Khóa phiên bản 2',
    exact: true,
  });
  await current.click();
  await expect(current).toHaveAttribute('aria-pressed', 'true');
  if (process.env.M704_CAPTURE) {
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
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `../qloud_docs/assets/m7-04-retention-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.reload();
  await openHistory(page);
  await expect(old).toHaveAttribute('aria-pressed', 'true');
  await old.click();
  await expect(old).toHaveAttribute('aria-pressed', 'false');
  const response = await page.request.get(`/api/v1/nodes/${id}/versions`);
  const history = (await response.json()) as {
    results: { version_number: number; keep_forever: boolean }[];
  };
  expect(
    history.results.find((version) => version.version_number === 1)
      ?.keep_forever,
  ).toBe(false);
  expect(
    history.results.find((version) => version.version_number === 2)
      ?.keep_forever,
  ).toBe(true);
});
