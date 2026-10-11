import { execFileSync } from 'node:child_process';
import { expect, test, request, type Page } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({
  launchOptions: { slowMo: process.env.MODERATION_CAPTURE ? 250 : 0 },
});
async function csrf(page: Page) {
  return {
    'X-CSRFToken':
      (await page.context().cookies()).find(
        (cookie) => cookie.name === 'csrftoken',
      )?.value ?? '',
  };
}
async function folderLink(page: Page, name: string) {
  const root = (
    (await (await page.request.get('/api/v1/me')).json()) as {
      root_folder_id: string;
    }
  ).root_folder_id;
  const headers = await csrf(page);
  const response = await page.request.post('/api/v1/folders', {
    headers,
    data: { parent_id: root, name },
  });
  expect(response.status()).toBe(201);
  const node = (await response.json()) as { id: string };
  const created = await page.request.post(`/api/v1/nodes/${node.id}/links`, {
    headers,
    data: {},
  });
  expect(created.status()).toBe(201);
  return {
    node,
    link: (await created.json()) as { id: string; token: string },
  };
}
function promoteTestUser(email: string) {
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
      "import os; from django.conf import settings; from apps.accounts.models import User; assert settings.SETTINGS_MODULE == 'config.settings.e2e'; assert User.objects.filter(email=os.environ['QLOUD_E2E_MODERATOR']).update(is_superuser=True, is_staff=True) == 1",
    ],
    {
      cwd: '../qloud_backend',
      env: {
        ...process.env,
        DJANGO_SETTINGS_MODULE: 'config.settings.e2e',
        QLOUD_E2E_MODERATOR: email,
      },
      stdio: 'pipe',
    },
  );
}
async function capture(page: Page, kind: string, mobile: boolean) {
  if (!process.env.MODERATION_CAPTURE) return;
  if (process.env.MODERATION_CAPTURE === '404' && kind !== 'not-found') return;
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
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `../qloud_docs/assets/m5-07-${kind}-${theme}-${mobile ? '360' : 'desktop'}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
}
async function mailContaining(to: string, text: string) {
  const mail = await request.newContext({
    baseURL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
  });
  try {
    await expect
      .poll(async () => {
        const search = (await (
          await mail.get('/api/v1/search', { params: { query: `to:"${to}"` } })
        ).json()) as { messages: { ID: string }[] };
        for (const { ID } of search.messages) {
          const message = (await (
            await mail.get(`/api/v1/message/${ID}`)
          ).json()) as { Text: string };
          if (message.Text.includes(text)) return true;
        }
        return false;
      })
      .toBe(true);
  } finally {
    await mail.dispose();
  }
}
test('anonymous report reaches moderation, superuser removes link and owner receives email', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  const ownerEmail = await signUpVerifiedViaApi(page);
  const name = `Reported folder ${crypto.randomUUID()}`;
  const { node, link } = await folderLink(page, name);
  await page.goto('/moderation');
  await expect(
    page.getByRole('heading', { name: 'Không tìm thấy trang' }),
  ).toBeVisible();
  await capture(page, 'not-found', isMobile);
  await expect(page.getByText('Kiểm duyệt', { exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/v1/moderation/reports')).status()).toBe(
    403,
  );
  const context = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
    extraHTTPHeaders: {
      'X-Qloud-E2E-IP': `10.${crypto.getRandomValues(new Uint8Array(3)).join('.')}`,
    },
  });
  const adminContext = await browser.newContext({
    baseURL,
    locale: 'vi-VN',
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  try {
    const visitor = await context.newPage();
    await visitor.goto(`/s/${link.token}`);
    await visitor.getByRole('button', { name: 'Báo cáo vi phạm' }).click();
    const dialog = visitor.getByRole('dialog', { name: `Báo cáo: ${name}` });
    await dialog.getByLabel('Lý do').selectOption('malware');
    await dialog
      .getByLabel('Mô tả (không bắt buộc)')
      .fill('Nội dung độc hại cần kiểm duyệt.');
    await capture(visitor, 'report', isMobile);
    await dialog
      .getByRole('button', { name: 'Gửi báo cáo', exact: true })
      .click();
    await expect(
      dialog.getByText('Báo cáo đã được tiếp nhận. Cảm ơn bạn.'),
    ).toBeVisible();
    const moderator = await adminContext.newPage();
    const email = await signUpVerifiedViaApi(moderator);
    promoteTestUser(email);
    await moderator.goto('/moderation');
    expect(
      (
        (await (await moderator.request.get('/api/v1/me')).json()) as {
          is_superuser: boolean;
        }
      ).is_superuser,
    ).toBe(true);
    const list = (await (
      await moderator.request.get('/api/v1/moderation/reports')
    ).json()) as { results: { id: string; node_uuid: string }[] };
    const report = list.results.find((item) => item.node_uuid === node.id);
    expect(report).toBeDefined();
    await mailContaining(
      'moderation@qloud.test',
      `/moderation?report=${report?.id.replaceAll('-', '') ?? ''}`,
    );
    await moderator.goto(`/moderation?report=${report?.id ?? ''}`);
    await moderator
      .getByLabel('Ghi chú (bắt buộc)')
      .fill('Đã xác minh nội dung độc hại.');
    await moderator.getByRole('button', { name: 'Xem lại thao tác' }).click();
    await capture(moderator, 'moderation', isMobile);
    await moderator.getByRole('button', { name: 'Xác nhận xử lý' }).click();
    await expect(
      moderator.getByRole('region', { name: 'Lịch sử xử lý' }),
    ).toBeVisible();
    await mailContaining(ownerEmail, 'Đã xác minh nội dung độc hại.');
    await visitor.goto(`/s/${link.token}`);
    await expect(
      visitor.getByRole('heading', { name: 'Nội dung không còn khả dụng' }),
    ).toBeVisible();
    expect(
      (
        await visitor.request.get(`/api/v1/public/links/${link.token}`)
      ).status(),
    ).toBe(404);
    const headers = await csrf(page);
    expect(
      (
        await page.request.delete(`/api/v1/links/${link.id}`, { headers })
      ).status(),
    ).toBe(204);
    const links = (await (
      await page.request.get(`/api/v1/nodes/${node.id}/links`)
    ).json()) as { results: { id: string; revoke_reason: string }[] };
    expect(
      links.results.find((item) => item.id === link.id)?.revoke_reason,
    ).toBe('moderation');
  } finally {
    await context.close();
    await adminContext.close();
  }
});

test('moderator suspension invalidates owner sessions and all public links', async ({
  page,
  browser,
  baseURL,
}) => {
  const ownerEmail = await signUpVerifiedViaApi(page);
  const first = await folderLink(page, 'Suspension target');
  const second = await folderLink(page, 'Another public folder');
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      'X-Qloud-E2E-IP': `10.${crypto.getRandomValues(new Uint8Array(3)).join('.')}`,
    },
  });
  try {
    const moderator = await context.newPage();
    const email = await signUpVerifiedViaApi(moderator);
    promoteTestUser(email);
    const response = await moderator.request.post(
      `/api/v1/public/links/${first.link.token}/reports`,
      {
        headers: await csrf(moderator),
        data: { node_id: first.node.id, reason: 'abuse' },
      },
    );
    expect(response.status()).toBe(202);
    const reports = (await (
      await moderator.request.get('/api/v1/moderation/reports')
    ).json()) as { results: { id: string; node_uuid: string }[] };
    const report = reports.results.find(
      (item) => item.node_uuid === first.node.id,
    );
    expect(report).toBeDefined();
    await moderator.goto(`/moderation?report=${report?.id ?? ''}`);
    await moderator.getByLabel('Thao tác').selectOption('suspend_owner');
    await moderator
      .getByLabel('Ghi chú (bắt buộc)')
      .fill('Đã xác minh hành vi lạm dụng.');
    await moderator.getByRole('button', { name: 'Xem lại thao tác' }).click();
    await moderator.getByRole('button', { name: 'Xác nhận xử lý' }).click();
    await expect(
      moderator.getByRole('region', { name: 'Lịch sử xử lý' }),
    ).toBeVisible();
    expect((await page.request.get('/api/v1/me')).status()).toBe(403);
    for (const { link } of [first, second])
      expect(
        (
          await moderator.request.get(`/api/v1/public/links/${link.token}`)
        ).status(),
      ).toBe(404);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
    await page
      .getByLabel('Mật khẩu', { exact: true })
      .fill('qloud-e2e-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  } finally {
    await context.close();
  }
});
