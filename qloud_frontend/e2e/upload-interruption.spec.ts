import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { chooseItemAction, openDriveFolder } from './drive';

test.use({ launchOptions: { slowMo: process.env.M210_LIVE ? 250 : 0 } });

for (const interruption of ['offline', 'reload'] as const) {
  test(`UI upload survives ${interruption}, keeps completed parts and downloads intact`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const temp = await mkdtemp(join(tmpdir(), 'qloud-interruption-'));
    const filename = 'large.bin';
    const path = join(temp, filename);
    // Distinct part contents catch incorrect ordering as well as missing bytes.
    const bytes = Buffer.alloc(100 * 1024 * 1024);
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024)
      bytes.fill((offset / (1024 * 1024)) % 251, offset, offset + 1024 * 1024);
    await writeFile(path, bytes);

    let allowRemaining = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentParts: number[] = [];
    const sessions: string[] = [];
    const completed: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'PUT' && url.searchParams.has('partNumber'))
        sentParts.push(Number(url.searchParams.get('partNumber')));
      if (request.method() === 'POST' && url.pathname === '/api/v1/uploads')
        sessions.push(url.pathname);
      if (request.method() === 'POST' && url.pathname.endsWith('/complete'))
        completed.push(url.pathname);
    });

    // Hold later PUTs so the interruption always happens after exactly one
    // real S3 part. Django and S3 responses are never mocked.
    await page.route(/:\d+\/.*[?&]partNumber=/, async (route) => {
      const number = Number(
        new URL(route.request().url()).searchParams.get('partNumber'),
      );
      if (number > 1 && !allowRemaining) {
        await gate;
        await route.abort('internetdisconnected');
      } else {
        await route.continue();
      }
    });

    try {
      await signUpVerifiedViaApi(page);
      await page.goto('/drive');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Drive của tôi',
      );
      await page.getByRole('button', { name: 'Tạo mới' }).click();
      await page.getByRole('menuitem', { name: 'Thư mục mới' }).click();
      const dialog = page.getByRole('dialog', { name: 'Thư mục mới' });
      await dialog.getByLabel('Tên').fill('Kiểm tra phục hồi');
      await dialog.getByRole('button', { name: 'Tạo', exact: true }).click();
      await expect(dialog).toBeHidden();
      await openDriveFolder(page, 'Kiểm tra phục hồi');
      const folderUrl = page.url();
      const folderId = new URL(folderUrl).pathname.split('/').at(-1);

      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/v1/uploads',
      );
      const firstPart = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).searchParams.get('partNumber') === '1',
      );
      await page.getByTestId('upload-input').setInputFiles(path);
      const createResponse = await created;
      expect(createResponse.status()).toBe(201);
      const session = (await createResponse.json()) as {
        id: string;
        parent_id: string;
        part_size: number;
        part_count: number;
      };
      expect(session.parent_id.replaceAll('-', '')).toBe(folderId);
      expect((await firstPart).ok()).toBe(true);
      const tray = page.getByRole('region', { name: 'Tải lên', exact: true });
      // Wait for XHR's load handler too, before interrupting the browser.
      await expect(
        tray.getByRole('progressbar', { name: filename }),
      ).toHaveAttribute(
        'aria-valuenow',
        String(Math.round((session.part_size / bytes.length) * 100)),
      );
      const detail = await page.request.get(`/api/v1/uploads/${session.id}`);
      expect(detail.ok()).toBe(true);
      expect(((await detail.json()) as { parts: unknown[] }).parts).toEqual([
        expect.objectContaining({ part_number: 1, size: session.part_size }),
      ]);
      expect(completed).toHaveLength(0);
      await expect(
        page.getByRole('option', { name: filename, exact: true }),
      ).toBeHidden();

      await context.setOffline(true);
      await expect(
        tray.getByText('Mất kết nối — sẽ tự tiếp tục khi có mạng'),
      ).toBeVisible();
      release();
      if (interruption === 'reload') {
        // Keep later PUTs blocked until reload discards the old engine.
        await context.setOffline(false);
        await page.reload();
        allowRemaining = true;
        await expect(page).toHaveURL(folderUrl);
        const unfinished = page.getByRole('region', {
          name: 'Tệp tải lên dở dang',
        });
        await expect(unfinished.getByText(filename)).toBeVisible();
        if (process.env.M210_CAPTURE) {
          const width = page.viewportSize()?.width === 360 ? '360' : 'desktop';
          for (const theme of ['light', 'dark'] as const) {
            await page.evaluate((mode) => {
              document.documentElement.classList.toggle(
                'dark',
                mode === 'dark',
              );
              document.documentElement.style.colorScheme = mode;
            }, theme);
            await page.screenshot({
              path: `../qloud_docs/assets/m2-10-resume-${theme}-${width}.png`,
              fullPage: true,
              animations: 'disabled',
            });
          }
        }
        await unfinished.getByLabel(`Chọn lại ${filename}`).setInputFiles(path);
      } else {
        allowRemaining = true;
        await context.setOffline(false);
        // No Resume/Retry click: the online event must restart the queue.
      }

      await expect(tray.getByText('Đã tải lên 1 tệp')).toBeVisible({
        timeout: 60_000,
      });
      const item = page.getByRole('option', { name: filename, exact: true });
      await expect(item).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(1);
      expect(sessions).toHaveLength(1);
      expect(completed).toEqual([`/api/v1/uploads/${session.id}/complete`]);
      expect(sentParts.filter((number) => number === 1)).toHaveLength(1);
      expect([...new Set(sentParts)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: session.part_count }, (_, index) => index + 1),
      );
      const finished = await page.request.get(`/api/v1/uploads/${session.id}`);
      expect(finished.ok()).toBe(true);
      expect(((await finished.json()) as { status: string }).status).toBe(
        'completed',
      );

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        chooseItemAction(page, item, 'Tải xuống'),
      ]);
      expect(download.suggestedFilename()).toBe(filename);
      expect((await readFile(await download.path())).equals(bytes)).toBe(true);
      await page.goto('/drive');
      await expect(
        page.getByRole('option', { name: filename, exact: true }),
      ).toBeHidden();
      await openDriveFolder(page, 'Kiểm tra phục hồi');
      await expect(item).toBeVisible();
    } finally {
      release();
      await context.setOffline(false);
      await page.unrouteAll({ behavior: 'wait' });
      await rm(temp, { recursive: true, force: true });
    }
  });
}
