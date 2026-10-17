import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({
  launchOptions: { slowMo: process.env.STORAGE_LIVE ? 300 : 0 },
});

async function headers(page: Page) {
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
  size: number,
): Promise<string> {
  const csrf = await headers(page);
  const created = await page.request.post('/api/v1/uploads', {
    headers: csrf,
    data: {
      parent_id: parent,
      filename: name,
      size,
      mime_type: mime,
      fingerprint: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const session = ((await created.json()) as { id: string }).id;
  const urls = await page.request.post(`/api/v1/uploads/${session}/parts`, {
    headers: csrf,
    data: { part_numbers: [1] },
  });
  const url = ((await urls.json()) as { parts: { url: string }[] }).parts[0]
    .url;
  expect(
    (await page.request.put(url, { data: Buffer.alloc(size, 97) })).ok(),
  ).toBe(true);
  const complete = await page.request.post(
    `/api/v1/uploads/${session}/complete`,
    { headers: csrf },
  );
  expect(complete.status()).toBe(200);
  return ((await complete.json()) as { id: string }).id;
}

function setQuota(email: string, bytes: number) {
  // Only the isolated E2E settings/database may be used by this fixture.
  execFileSync(
    'uv',
    [
      'run',
      '--frozen',
      'python',
      'manage.py',
      'shell',
      '-c',
      "import os; from django.conf import settings; from apps.accounts.models import User; assert settings.SETTINGS_MODULE == 'config.settings.e2e'; assert User.objects.filter(email=os.environ['QLOUD_E2E_EMAIL']).update(quota_override_bytes=int(os.environ['QLOUD_E2E_QUOTA'])) == 1",
    ],
    {
      cwd: '../qloud_backend',
      env: {
        ...process.env,
        DJANGO_SETTINGS_MODULE: 'config.settings.e2e',
        QLOUD_E2E_EMAIL: email,
        QLOUD_E2E_QUOTA: String(bytes),
      },
      stdio: 'pipe',
    },
  );
}

/** Screenshots for the PR, only when STORAGE_CAPTURE is set. */
async function capture(page: Page, kind: string) {
  if (!process.env.STORAGE_CAPTURE) return;
  for (const [width, size] of [
    [1280, 'desktop'],
    [360, '360'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
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
        path: `../qloud_docs/assets/m8-01-${kind}-${theme}-${size}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('storage page shows usage and the largest files; a full quota blocks uploads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const email = await signUpVerifiedViaApi(page);
  const root = (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
  const folder = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: root, name: 'Media' },
  });
  const media = ((await folder.json()) as { id: string }).id;
  await upload(page, media, 'Phim.mp4', 'video/mp4', 4000);
  await upload(page, root, 'Ghi chú.txt', 'text/plain', 1500);
  const old = await upload(page, root, 'Cũ.zip', 'application/zip', 500);
  const trash = await page.request.post('/api/v1/nodes/trash', {
    headers: await headers(page),
    data: { node_ids: [old] },
  });
  expect(trash.status()).toBe(200);

  await page.goto('/drive');
  const meter = page.getByRole('progressbar', { name: 'Dung lượng đã dùng' });
  await expect(meter).toHaveAttribute('aria-valuetext', /^Đã dùng 6 KB \/ /);
  await page.getByRole('link', { name: /^Dung lượng/ }).click();
  await expect(page).toHaveURL(/\/settings\/storage$/);

  const breakdown = page.getByRole('region', { name: 'Theo loại file' });
  for (const [group, size] of [
    ['Video', '4 KB'],
    ['Tài liệu', '1,5 KB'],
    ['Thùng rác', '500 B'],
  ])
    await expect(
      breakdown.getByRole('listitem').filter({ hasText: group }),
    ).toContainText(size);
  const largest = page.getByRole('region', { name: 'File lớn nhất' });
  await expect(largest.getByRole('listitem')).toHaveCount(2);
  await expect(largest.getByRole('listitem').first()).toContainText('Phim.mp4');
  // The capture shows the hover state of the breakdown.
  await breakdown.getByRole('listitem').filter({ hasText: 'Video' }).hover();
  await expect(breakdown.getByText('4 KB · 66,7%')).toBeVisible();
  await capture(page, 'storage');

  await largest
    .getByRole('button', { name: 'Đưa Phim.mp4 vào thùng rác' })
    .click();
  await expect(largest.getByText('Phim.mp4')).toBeHidden();
  await expect(
    breakdown.getByRole('listitem').filter({ hasText: 'Thùng rác' }),
  ).toContainText('4,5 KB');

  await largest
    .getByRole('button', { name: 'Mở thư mục chứa Ghi chú.txt' })
    .click();
  await expect(
    page.getByRole('option', { name: 'Ghi chú.txt', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  // Lowered below what is stored: nothing is deleted, only uploads stop.
  setQuota(email, 5000);
  await page.goto('/drive');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Đã hết dung lượng.' }),
  ).toBeVisible();
  await expect(meter).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: 'Tạo mới' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Tải tệp lên' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('menuitem', { name: 'Thư mục mới' }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('option', { name: 'Ghi chú.txt', exact: true }),
  ).toBeVisible();
  await capture(page, 'full');
});
