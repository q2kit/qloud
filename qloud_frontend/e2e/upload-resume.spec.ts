import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction } from './drive';

test.use({ launchOptions: { slowMo: process.env.M208B_LIVE ? 250 : 0 } });

const MiB = 1024 * 1024;
const item = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });

async function openFolder(page: Page, name: string) {
  await chooseItemAction(page, name, 'Mở');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function drive(page: Page) {
  await signUpVerifiedViaApi(page);
  await page.goto('/drive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Drive của tôi',
  );
}

async function csrf(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}

test('folder upload preserves nested files, then merges or keeps both on conflict', async ({
  page,
}) => {
  const temp = await mkdtemp(join(tmpdir(), 'qloud-folder-'));
  const folder = join(temp, 'Album');
  await mkdir(join(folder, 'Day1'), { recursive: true });
  await writeFile(join(folder, 'cover.txt'), 'cover');
  await writeFile(join(folder, 'Day1', 'photo.txt'), 'photo');
  try {
    await drive(page);
    await page.getByTestId('upload-folder-input').setInputFiles(folder);
    await expect(
      page
        .getByRole('region', { name: 'Tải lên' })
        .getByText('Đã tải lên 2 tệp'),
    ).toBeVisible();
    await openFolder(page, 'Album');
    await expect(item(page, 'cover.txt')).toBeVisible();
    await openFolder(page, 'Day1');
    await expect(item(page, 'photo.txt')).toBeVisible();

    await page.goto('/drive');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Drive của tôi',
    );
    await writeFile(join(folder, 'new.txt'), 'new');
    await page.getByTestId('upload-folder-input').setInputFiles(folder);
    const folderDialog = page.getByRole('dialog', {
      name: 'Tên thư mục đã được dùng',
    });
    await folderDialog
      .getByRole('button', { name: 'Gộp', exact: true })
      .click();
    await folderDialog
      .getByRole('button', { name: 'Gộp', exact: true })
      .click(); // Day1
    const fileDialog = page.getByRole('dialog', {
      name: 'Tên đã được dùng',
      exact: true,
    });
    await fileDialog.getByRole('button', { name: 'Bỏ qua' }).click();
    await fileDialog.getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Tải lên' })
        .getByText('Đã tải lên 1 tệp'),
    ).toBeVisible();
    await openFolder(page, 'Album');
    await expect(item(page, 'new.txt')).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(3);

    await page.goto('/drive');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Drive của tôi',
    );
    await page.getByTestId('upload-folder-input').setInputFiles(folder);
    await folderDialog.getByRole('button', { name: 'Giữ cả hai' }).click();
    await expect(item(page, 'Album (1)')).toBeVisible();
    await openFolder(page, 'Album (1)');
    await expect(item(page, 'cover.txt')).toBeVisible();
    await expect(item(page, 'new.txt')).toBeVisible();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('reload resumes an API-created partial upload, rejects a changed file and sends only missing parts', async ({
  page,
}) => {
  const temp = await mkdtemp(join(tmpdir(), 'qloud-resume-'));
  const path = join(temp, 'resume.bin');
  const bytes = Buffer.alloc(9 * MiB, 37);
  await writeFile(path, bytes);
  try {
    await drive(page);
    const me = (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    };
    const modified = Math.trunc((await stat(path)).mtimeMs);
    const hash = await page.evaluate(
      async ({ name, size, modified }) => {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new Uint8Array(1024 * 1024).fill(37),
        );
        const hex = (buffer: ArrayBuffer) =>
          [...new Uint8Array(buffer)]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        return hex(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(
              JSON.stringify([name, size, modified, hex(digest)]),
            ),
          ),
        );
      },
      { name: 'resume.bin', size: bytes.length, modified },
    );
    const headers = await csrf(page);
    const created = await page.request.post('/api/v1/uploads', {
      headers,
      data: {
        parent_id: me.root_folder_id,
        filename: 'resume.bin',
        size: bytes.length,
        mime_type: 'application/octet-stream',
        fingerprint: hash,
      },
    });
    expect(created.status()).toBe(201);
    const session = (await created.json()) as { id: string; part_size: number };
    const urls = (await (
      await page.request.post(`/api/v1/uploads/${session.id}/parts`, {
        headers,
        data: { part_numbers: [1] },
      })
    ).json()) as { parts: { url: string }[] };
    const put = await page.request.put(urls.parts[0]?.url ?? '', {
      data: bytes.subarray(0, session.part_size),
    });
    expect(put.ok()).toBe(true);
    await page.reload();
    const unfinished = page.getByRole('region', {
      name: 'Tệp tải lên dở dang',
    });
    await expect(unfinished.getByText('resume.bin')).toBeVisible();
    const picker = unfinished.getByLabel('Chọn lại resume.bin');
    await picker.setInputFiles({
      name: 'resume.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('wrong'),
    });
    await expect(unfinished.getByRole('alert')).toContainText('không khớp');
    const parts: string[] = [];
    const creates: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('4566'))
        parts.push(request.url());
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/uploads'
      )
        creates.push(request.url());
    });
    if (process.env.M208B_CAPTURE) {
      const mobile = page.viewportSize()?.width === 360;
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((mode) => {
          document.documentElement.classList.toggle('dark', mode === 'dark');
          document.documentElement.style.colorScheme = mode;
        }, theme);
        await page.screenshot({
          path: `../qloud_docs/assets/m2-08b-resume-${theme}-${mobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await picker.setInputFiles(path);
    await expect(item(page, 'resume.bin')).toBeVisible({ timeout: 30_000 });
    expect(creates).toHaveLength(0);
    expect(parts).toHaveLength(1);
    expect(new URL(parts[0] ?? '').searchParams.get('partNumber')).toBe('2');
    await item(page, 'resume.bin').click();
    await page.keyboard.press('Enter');
    const viewer = page.getByRole('dialog', { name: 'resume.bin' });
    await expect(viewer).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      viewer.getByRole('button', { name: 'Tải xuống', exact: true }).click(),
    ]);
    expect((await readFile(await download.path())).equals(bytes)).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
