import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

const live = Boolean(process.env.SELECTION_LIVE);
test.use({ launchOptions: { slowMo: live ? 180 : 0 } });

async function createFolders(page: Page, names: string[]): Promise<void> {
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const csrf =
    (await page.context().cookies()).find(
      (cookie) => cookie.name === 'csrftoken',
    )?.value ?? '';
  for (const name of names) {
    const response = await page.request.post('/api/v1/folders', {
      headers: { 'X-CSRFToken': csrf },
      data: { parent_id: me.root_folder_id, name },
    });
    expect(response.status()).toBe(201);
  }
}

async function screenshots(
  page: Page,
  name: string,
  isMobile: boolean,
): Promise<void> {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
    }, theme);
    if (live)
      await page.screenshot({
        path: `../qloud_docs/assets/drive-${name}-${theme}-${isMobile ? '360' : 'desktop'}.png`,
        animations: 'disabled',
      });
  }
  await page.evaluate(() => {
    localStorage.setItem('qloud-theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
  });
}

const option = (page: Page, name: string) =>
  page.getByRole('option', { name, exact: true });

test('arrow keys need no click; neighbouring list rows share one outline', async ({
  page,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  await createFolders(page, ['Alpha', 'Beta', 'Charlie', 'Delta']);
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Dạng danh sách' }).click();
  await expect(option(page, 'Alpha')).toBeVisible();
  // Nothing clicked in the list yet: the first arrow starts at the first item.
  await page.locator('body').focus();
  await page.keyboard.press('ArrowDown');
  await expect(option(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'Alpha')).toBeFocused();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await option(page, 'Delta').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(4);
  await option(page, 'Charlie').click({ modifiers: ['ControlOrMeta'] });
  await expect(option(page, 'Beta')).toHaveClass(/border-t-0/);
  await expect(option(page, 'Delta')).not.toHaveClass(/border-t-0/);
  await screenshots(page, 'list-selection', isMobile);
});

test('dragging several items shows a stack and fades the originals', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'touch moves items with the Move dialog');
  await signUpVerifiedViaApi(page);
  await createFolders(page, ['Đích', 'Một', 'Hai', 'Ba']);
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Dạng lưới' }).click();
  await option(page, 'Ba').click();
  await option(page, 'Hai').click({ modifiers: ['ControlOrMeta'] });
  await option(page, 'Một').click({ modifiers: ['ControlOrMeta'] });

  // The drag image is drawn by the browser outside the page: for the screenshot,
  // also show a copy of it at the pointer.
  if (live)
    await page.evaluate(() => {
      // Called back with the DataTransfer as `this` below.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const original = DataTransfer.prototype.setDragImage;
      DataTransfer.prototype.setDragImage = function (image, x, y) {
        const copy = image.cloneNode(true) as HTMLElement;
        copy.dataset.dragShot = '';
        const point = (window as unknown as { __point: [number, number] })
          .__point;
        Object.assign(copy.style, {
          top: `${String(point[1] - y + 24)}px`,
          left: `${String(point[0] - x + 24)}px`,
          opacity: '0.85',
          zIndex: '50',
        });
        document.body.append(copy);
        original.call(this, image, x, y);
      };
      window.addEventListener(
        'dragstart',
        (event) => {
          (window as unknown as { __point: [number, number] }).__point = [
            event.clientX,
            event.clientY,
          ];
        },
        true,
      );
    });

  const source = await option(page, 'Hai').boundingBox();
  const target = await option(page, 'Đích').boundingBox();
  if (!source || !target) throw new Error('items are not laid out');
  await page.mouse.move(source.x + source.width / 2, source.y + 30);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 40, source.y + 120, {
    steps: 8,
  });
  for (const name of ['Một', 'Hai', 'Ba'])
    await expect(option(page, name)).toHaveClass(/border-dashed/);
  await screenshots(page, 'drag-several', isMobile);
  await page.evaluate(() => {
    document.querySelector('[data-drag-shot]')?.remove();
  });
  await page.mouse.move(target.x + target.width / 2, target.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByText('Đã di chuyển 3 mục tới "Đích".')).toBeAttached();
});
