import { expect, test, type Page } from '@playwright/test';

import { signUpVerifiedViaApi } from './auth';

test.use({
  launchOptions: { slowMo: process.env.M811_CAPTURE ? 250 : 0 },
});

/** M811_CAPTURE=1 saves light and dark screenshots for the PR. */
async function capture(page: Page, kind: string, mobile: boolean) {
  if (!process.env.M811_CAPTURE) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('qloud-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'qloud-theme' }));
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
      path: `../qloud_docs/assets/m8-11-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      animations: 'disabled',
    });
  }
}

async function headers(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}

async function openActivity(page: Page, name: string) {
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await page.getByRole('tab', { name: 'Hoạt động' }).click();
  return page
    .getByRole('dialog', { name: 'Chi tiết', exact: true })
    .or(page.getByRole('complementary', { name: 'Chi tiết', exact: true }));
}

test('the activity tab tells owners and recipients what happened', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  await signUpVerifiedViaApi(page);
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const created = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: me.root_folder_id, name: 'Drafts' },
  });
  expect(created.status()).toBe(201);
  const team = ((await created.json()) as { id: string }).id;
  const inside = await page.request.post('/api/v1/folders', {
    headers: await headers(page),
    data: { parent_id: team, name: 'Notes' },
  });
  expect(inside.status()).toBe(201);
  expect(
    (
      await page.request.patch(`/api/v1/nodes/${team}`, {
        headers: await headers(page),
        data: { name: 'Team' },
      })
    ).status(),
  ).toBe(200);

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
    expect(
      (
        await page.request.post(`/api/v1/nodes/${team}/shares`, {
          headers: await headers(page),
          data: { email, role: 'viewer' },
        })
      ).status(),
    ).toBe(201);

    await page.goto('/drive');
    let panel = await openActivity(page, 'Team');
    // Newest first; the folder includes what happened inside it.
    const rows = panel.getByRole('listitem');
    await expect(rows.nth(0)).toContainText(
      `Bạn đã chia sẻ “Team” với ${email} (người xem)`,
    );
    await expect(rows.nth(1)).toContainText(
      'Bạn đã đổi tên “Drafts” thành “Team”',
    );
    await expect(rows.nth(2)).toContainText('Bạn đã tạo thư mục “Notes”');
    await expect(rows.nth(3)).toContainText('Bạn đã tạo thư mục “Drafts”');
    await expect(rows.nth(0).locator('time')).toHaveText(/bây giờ|giây|phút/);
    await capture(page, 'activity', isMobile);

    // A viewer reads the same history, without the recipient's email.
    await recipient.goto('/shared');
    panel = await openActivity(recipient, 'Team');
    await expect(panel.getByRole('listitem').nth(1)).toContainText(
      'đã đổi tên “Drafts” thành “Team”',
    );
    await expect(panel.getByText(email)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
