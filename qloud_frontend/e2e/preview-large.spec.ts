import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

// Opt-in live acceptance check: real 2 GB S3 upload, never a mocked Range response.
test('a real 2 GB fast-start video seeks without downloading the whole file', async ({
  page,
  isMobile,
}) => {
  test.skip(
    !process.env.PREVIEW_LARGE || isMobile,
    'Run explicitly on headed desktop; also checks 360px in that run.',
  );
  test.setTimeout(600_000);
  const size = 2_000_000_000;
  const directory = await mkdtemp(join(tmpdir(), 'qloud-preview-large-'));
  const file = await open(join(directory, 'video.mp4'), 'w+');
  try {
    const source = await readFile('e2e/fixtures/preview.mp4');
    await file.write(source, 0, source.length, 0);
    // A valid MP4 free box pads the file without moving its fast-start metadata.
    const header = Buffer.alloc(8);
    header.writeUInt32BE(size - source.length);
    header.write('free', 4);
    await file.write(header, 0, 8, source.length);
    await file.truncate(size);
    await signUpVerifiedViaApi(page);
    const headers = {
      'X-CSRFToken':
        (await page.context().cookies()).find(
          (cookie) => cookie.name === 'csrftoken',
        )?.value ?? '',
    };
    const me = (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    };
    const created = await page.request.post('/api/v1/uploads', {
      headers,
      data: {
        parent_id: me.root_folder_id,
        filename: 'video-2GB.mp4',
        mime_type: 'video/mp4',
        size,
        fingerprint: 'preview-real-2GB',
      },
    });
    expect(created.status()).toBe(201);
    const session = (await created.json()) as { id: string; part_size: number };
    const partNumbers = Array.from(
      { length: Math.ceil(size / session.part_size) },
      (_, index) => index + 1,
    );
    for (let offset = 0; offset < partNumbers.length; offset += 100) {
      const signed = await page.request.post(
        `/api/v1/uploads/${session.id}/parts`,
        {
          headers,
          data: { part_numbers: partNumbers.slice(offset, offset + 100) },
        },
      );
      expect(signed.status()).toBe(200);
      const parts = (await signed.json()) as {
        parts: { part_number: number; url: string }[];
      };
      for (const part of parts.parts) {
        const start = (part.part_number - 1) * session.part_size;
        const buffer = Buffer.alloc(Math.min(session.part_size, size - start));
        await file.read(buffer, 0, buffer.length, start);
        expect(
          (await page.request.put(part.url, { data: buffer })).status(),
        ).toBe(200);
      }
    }
    const complete = await page.request.post(
      `/api/v1/uploads/${session.id}/complete`,
      { headers },
    );
    expect(complete.status()).toBe(200);
    const node = (await complete.json()) as { id: string; size: number };
    expect(node.size).toBe(size);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const storageRequests = new Set<string>();
    let transferred = 0;
    let ranged = false;
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.request.url.includes(':4566'))
        storageRequests.add(event.requestId);
    });
    cdp.on('Network.dataReceived', (event) => {
      if (storageRequests.has(event.requestId)) transferred += event.dataLength;
    });
    cdp.on('Network.responseReceived', (event) => {
      if (storageRequests.has(event.requestId) && event.response.status === 206)
        ranged = true;
    });
    await page.goto(`/drive/files/${node.id.replaceAll('-', '')}`);
    const player = page.locator('video');
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
    await expect.poll(() => transferred).toBeGreaterThan(0);
    expect(transferred).toBeLessThan(32 * 1024 * 1024);
    expect(ranged).toBe(true);
    await page.setViewportSize({ width: 360, height: 740 });
    await player.evaluate((element) => {
      (element as HTMLVideoElement).currentTime = 5;
    });
    await expect
      .poll(() =>
        player.evaluate((element) => (element as HTMLVideoElement).seeking),
      )
      .toBe(false);
    expect(transferred).toBeLessThan(32 * 1024 * 1024);
    console.log(
      `2GB live: transferred ${String(transferred)} bytes, Range 206, seek 15s desktop / 5s 360px`,
    );
    await cdp.detach();
  } finally {
    await file.close();
    await rm(directory, { recursive: true, force: true });
  }
});
