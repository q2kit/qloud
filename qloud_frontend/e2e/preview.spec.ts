import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.PREVIEW_LIVE ? 150 : 0 } });
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
const item = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });
async function open(page: Page, name: string) {
  await item(page, name).click();
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
}
async function captures(page: Page, kind: string, mobile: boolean) {
  if (!process.env.PREVIEW_CAPTURE) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /dark/ : /^$/,
    );
    await page.screenshot({
      path: `../qloud_docs/assets/m3-03-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      fullPage: true,
    });
  }
}

test('thumbnails in grid and list, image/PDF viewer, navigation and download', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  const image = await upload(
    page,
    parent,
    'a-ảnh.png',
    'image/png',
    await readFile('e2e/fixtures/preview.png'),
  );
  await upload(
    page,
    parent,
    'b-tài-liệu.pdf',
    'application/pdf',
    await readFile('e2e/fixtures/preview.pdf'),
  );
  await upload(
    page,
    parent,
    'c-text.txt',
    'text/plain',
    Buffer.from('<script>window.PWNED=true</script>'),
  );
  await page.goto('/drive');
  await expect(item(page, 'a-ảnh.png').locator('img')).toBeVisible();
  await expect(item(page, 'b-tài-liệu.pdf').locator('img')).toBeVisible();
  await captures(page, 'grid', isMobile);
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await expect(item(page, 'a-ảnh.png').locator('img')).toBeVisible();
  await expect(item(page, 'b-tài-liệu.pdf').locator('img')).toBeVisible();
  await captures(page, 'list', isMobile);
  await open(page, 'a-ảnh.png');
  await expect(page.getByRole('img', { name: 'a-ảnh.png' })).toBeVisible();
  await captures(page, 'image', isMobile);
  await page.getByRole('button', { name: 'Tệp sau' }).click();
  await expect(
    page.getByRole('dialog', { name: 'b-tài-liệu.pdf' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'Trang PDF 1' })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('canvas')
        .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Trang', exact: true }),
  ).toHaveValue('2');
  await captures(page, 'pdf', isMobile);
  await page.getByRole('button', { name: 'Tệp sau' }).click();
  await expect(page.locator('pre')).toHaveText(
    '<script>window.PWNED=true</script>',
  );
  expect(await page.evaluate(() => Object.hasOwn(window, 'PWNED'))).toBe(false);
  await page.getByRole('button', { name: 'Tệp trước' }).click();
  await expect(
    page.getByRole('dialog', { name: 'b-tài-liệu.pdf' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đóng trình xem' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'a-ảnh.png' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Tải xuống', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('a-ảnh.png');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/drive/files/${compact(image.id)}`);
  await expect(page.getByRole('dialog', { name: 'a-ảnh.png' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'a-ảnh.png' })).toBeVisible();
});

test('canonical link follows a moved file; unsafe MIME never renders', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  const file = await upload(
    page,
    parent,
    'page.html',
    'text/html',
    Buffer.from('<script>window.PWNED=true</script>'),
  );
  const folder = await page.request.post('/api/v1/folders', {
    headers: await csrf(page),
    data: { parent_id: parent, name: 'Moved' },
  });
  const destination = (await folder.json()) as { id: string };
  expect(
    (
      await page.request.post('/api/v1/nodes/move', {
        headers: await csrf(page),
        data: { node_ids: [file.id], target_parent_id: destination.id },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/drive/files/${compact(file.id)}`);
  await expect(page.getByRole('dialog', { name: 'page.html' })).toBeVisible();
  await expect(
    page.getByText('Loại tệp này chưa hỗ trợ xem trước. Bạn có thể tải về.'),
  ).toBeVisible();
  await expect(page.locator('iframe, embed, object')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, 'PWNED'))).toBe(false);
  expect(new URL(page.url()).pathname).toBe(
    `/drive/folders/${compact(destination.id)}`,
  );
});

test('video streams metadata and seeks using S3 Range', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  const video = await upload(
    page,
    parent,
    'video.mp4',
    'video/mp4',
    await readFile('e2e/fixtures/preview.mp4'),
  );
  const ranges: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(':4566') && request.headers().range)
      ranges.push(request.headers().range);
  });
  await page.goto(`/drive/files/${compact(video.id)}`);
  const player = page.locator('video');
  await expect(player).toHaveAttribute('src', /^https?:\/\//);
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).duration),
    )
    .toBeGreaterThan(19);
  await player.evaluate((element) => {
    (element as HTMLVideoElement).currentTime = 15;
  });
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).seeking),
    )
    .toBe(false);
  expect(
    await player.evaluate(
      (element) => (element as HTMLVideoElement).currentTime,
    ),
  ).toBeGreaterThan(14);
  expect(ranges.length).toBeGreaterThan(0);
  await player.evaluate((element) => (element as HTMLVideoElement).play());
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(15.1);
  await player.evaluate((element) => {
    (element as HTMLVideoElement).pause();
  });
  await captures(page, 'video', isMobile);
});

test('audio uses native playback controls', async ({ page, isMobile }) => {
  await signUpVerifiedViaApi(page);
  const audio = await upload(
    page,
    await root(page),
    'audio.wav',
    'audio/wav',
    await readFile('e2e/fixtures/preview.wav'),
  );
  await page.goto(`/drive/files/${compact(audio.id)}`);
  const player = page.locator('audio');
  await expect(player).toHaveAttribute('src', /^https?:\/\//);
  await expect(player).toHaveAttribute('controls', '');
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLAudioElement).duration),
    )
    .toBeGreaterThan(0.9);
  await player.evaluate((element) => (element as HTMLAudioElement).play());
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLAudioElement).currentTime),
    )
    .toBeGreaterThan(0);
  await captures(page, 'audio', isMobile);
});

test('MP4 thumbnails in grid and list with corrupt fallback and playable source', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const parent = await root(page);
  await upload(
    page,
    parent,
    'clip.mp4',
    'video/mp4',
    await readFile('e2e/fixtures/preview.mp4'),
  );
  await upload(
    page,
    parent,
    'broken.mp4',
    'video/mp4',
    Buffer.from('corrupt MP4'),
  );
  await page.goto('/drive');
  const thumbnail = item(page, 'clip.mp4').locator('img');
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() =>
      thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(item(page, 'broken.mp4').locator('img')).toHaveCount(0);
  for (const layout of ['grid', 'list']) {
    if (layout === 'list')
      await page.getByRole('button', { name: 'Dạng danh sách' }).click();
    await expect(item(page, 'clip.mp4').locator('img')).toBeVisible();
    if (process.env.PREVIEW_CAPTURE) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          localStorage.setItem('qloud-theme', value);
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'qloud-theme' }),
          );
        }, theme);
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^$/,
        );
        await page.screenshot({
          path: `../qloud_docs/assets/m3-04-${layout}-${theme}-${isMobile ? '360' : 'desktop'}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  }
  await expect(item(page, 'broken.mp4').locator('img')).toHaveCount(0);
  await open(page, 'clip.mp4');
  await expect(page.locator('video')).toHaveAttribute('src', /^https?:\/\//);
  await page
    .locator('video')
    .evaluate((element) => (element as HTMLVideoElement).play());
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
});
