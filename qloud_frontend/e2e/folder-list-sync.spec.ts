import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';
import { openDriveFolder } from './drive';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test.use({ launchOptions: { slowMo: process.env.M509_LIVE ? 200 : 0 } });

async function seed(page: Page) {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const csrf =
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'csrftoken',
    )?.value ?? '';
  const create = async (name: string) => {
    const response = await page.request.post('/api/v1/folders', {
      headers: { 'X-CSRFToken': csrf },
      data: { parent_id: me.root_folder_id, name, on_conflict: 'fail' },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string };
  };
  const target = await create('Đích');
  await create('Nguồn');
  await page.goto('/drive');
  await expect(
    page.getByRole('option', { name: 'Đích', exact: true }),
  ).toBeVisible();
  return target.id;
}

for (const operation of ['upload', 'move'] as const) {
  test(`${operation} commits while the destination initial listing is in flight`, async ({
    page,
    isMobile,
  }) => {
    test.skip(
      operation === 'move' && isMobile,
      'Drag and drop requires a mouse',
    );
    const targetId = await seed(page);
    const writeStarted = gate();
    const allowWrite = gate();
    const staleCaptured = gate();
    const allowStale = gate();
    const refreshed = gate();
    const endpoint =
      operation === 'upload'
        ? '**/api/v1/uploads/*/complete'
        : '**/api/v1/nodes/move';
    await page.route(endpoint, async (route) => {
      writeStarted.release();
      await allowWrite.promise;
      await route.continue();
    });
    let reads = 0;
    await page.route(
      `**/api/v1/nodes/${targetId}/children?*`,
      async (route) => {
        reads += 1;
        if (reads > 1) {
          refreshed.release();
          await route.continue();
          return;
        }
        // Capture an actual backend response before the write commits, then delay delivery.
        const response = await route.fetch();
        expect(
          ((await response.json()) as { results: unknown[] }).results,
        ).toHaveLength(0);
        staleCaptured.release();
        await allowStale.promise;
        await route.fulfill({ response }).catch(() => {
          /* The cancelled browser request may already be gone. */
        });
      },
    );
    try {
      if (operation === 'upload') {
        const transfer = await page.evaluateHandle(() => {
          const data = new DataTransfer();
          data.items.add(
            new File(['new content'], 'new.txt', { type: 'text/plain' }),
          );
          return data;
        });
        await page
          .getByRole('option', { name: 'Đích', exact: true })
          .dispatchEvent('drop', { dataTransfer: transfer });
        await transfer.dispose();
      } else {
        await page
          .getByRole('option', { name: 'Nguồn', exact: true })
          .dragTo(page.getByRole('option', { name: 'Đích', exact: true }));
      }
      await writeStarted.promise;
      await openDriveFolder(page, 'Đích');
      await staleCaptured.promise;
      const committed = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response
            .url()
            .includes(operation === 'upload' ? '/complete' : '/nodes/move') &&
          response.status() === 200,
      );
      allowWrite.release();
      await committed;
      // A fresh read must start even though the initial read has not returned.
      await refreshed.promise;
      allowStale.release();
      await expect(
        page.getByRole('option', {
          name: operation === 'upload' ? 'new.txt' : 'Nguồn',
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(1);
      if (process.env.M509_CAPTURE && operation === 'upload') {
        for (const theme of ['light', 'dark'] as const) {
          await page.evaluate((mode) => {
            document.documentElement.classList.toggle('dark', mode === 'dark');
            document.documentElement.style.colorScheme = mode;
          }, theme);
          await page.screenshot({
            path: `../qloud_docs/assets/m5-09-${theme}-${isMobile ? '360' : 'desktop'}.png`,
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
    } finally {
      allowWrite.release();
      allowStale.release();
    }
  });
}
