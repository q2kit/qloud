import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { signUpViaApi, signUpVerifiedViaApi } from './auth';

// M2-08a against the real stack: parts go from Chromium straight to LocalStack S3
// (bucket qloud-e2e, CORS for vite preview), sessions through Django.

const MiB = 1024 * 1024;

function payload(size: number, seed: number): Buffer {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 31 + seed) % 251;
  return buffer;
}

async function pick(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await page.getByTestId('upload-input').setInputFiles(files);
}

/** The Drive root, loaded: its id is known, so picked files have somewhere to go. */
async function openDrive(page: Page): Promise<void> {
  await page.goto('/drive');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Drive của tôi',
  );
}

function tray(page: Page) {
  return page.getByRole('region', { name: 'Tải lên' });
}

function item(page: Page, name: string) {
  return page.getByRole('option', { name, exact: true });
}

test('upload files, including one in several parts, then download it back', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  await openDrive(page);
  const big = payload(9 * MiB, 7); // two parts of at least 8 MiB
  await pick(page, [
    {
      name: 'video-demo.bin',
      mimeType: 'application/octet-stream',
      buffer: big,
    },
    {
      name: 'ghi-chú.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('xin chào'),
    },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ]);

  await expect(tray(page).getByText('Đã tải lên 3 tệp')).toBeVisible({
    timeout: 30_000,
  });
  // The folder listing refreshes on its own.
  await expect(item(page, 'video-demo.bin')).toBeVisible();
  await expect(item(page, 'ghi-chú.txt')).toBeVisible();
  await expect(item(page, 'empty.txt')).toBeVisible();

  await item(page, 'video-demo.bin').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  expect(download.suggestedFilename()).toBe('video-demo.bin');
  const path = await download.path();
  expect((await readFile(path)).equals(big)).toBe(true);

  await tray(page).getByRole('button', { name: 'Đóng khay tải lên' }).click();
  await expect(tray(page)).toBeHidden();
});

test('a taken name: keep both, or skip', async ({ page }) => {
  await signUpVerifiedViaApi(page);
  await openDrive(page);
  const note = {
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1'),
  };
  await pick(page, [note]);
  await expect(item(page, 'note.txt')).toBeVisible();

  await pick(page, [note]);
  const dialog = page.getByRole('dialog', { name: 'Tên đã được dùng' });
  await expect(dialog).toContainText(
    'Thư mục này đã có một mục tên "note.txt".',
  );
  await dialog.getByRole('button', { name: 'Giữ cả hai' }).click();
  await expect(item(page, 'note (1).txt')).toBeVisible();

  await pick(page, [note]);
  await dialog.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(tray(page).getByText('Đã bỏ qua')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(2);
});

test('files dropped from the computer onto a folder upload into it', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  await openDrive(page);
  await page.getByRole('button', { name: 'Tạo mới' }).click();
  await page.getByRole('menuitem', { name: 'Thư mục mới' }).click();
  await page
    .getByRole('dialog', { name: 'Thư mục mới' })
    .getByLabel('Tên')
    .fill('Ảnh');
  await page
    .getByRole('dialog', { name: 'Thư mục mới' })
    .getByRole('button', { name: 'Tạo' })
    .click();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['png'], 'logo.png', { type: 'image/png' }));
    return transfer;
  });
  const folder = item(page, 'Ảnh');
  await folder.dispatchEvent('dragenter', { dataTransfer });
  await folder.dispatchEvent('dragover', { dataTransfer });
  await expect(page.getByText('Thả để tải lên vào "Ảnh"')).toBeVisible();
  await folder.dispatchEvent('drop', { dataTransfer });

  await expect(tray(page).getByText('Đã tải lên 1 tệp')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1); // not in this folder
  await folder.dblclick();
  await expect(item(page, 'logo.png')).toBeVisible();
});

test('without a verified email the tray says so and can resend it', async ({
  page,
}) => {
  await signUpViaApi(page);
  await openDrive(page);
  await pick(page, [
    { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
  ]);
  await expect(
    tray(page).getByText('Hãy xác thực email trước khi tải tệp lên.'),
  ).toBeVisible();
  await tray(page)
    .getByRole('button', { name: 'Gửi lại email xác thực' })
    .click();
  await expect(tray(page).getByText(/^Đã gửi tới /)).toBeVisible();
});
