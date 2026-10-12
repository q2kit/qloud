import { expect, test } from '@playwright/test';
import { signUpVerifiedViaApi } from './auth';

test.use({ launchOptions: { slowMo: process.env.M702_LIVE ? 350 : 0 } });

test('restore file history, preview original bytes and delete references', async ({
  page,
}) => {
  await signUpVerifiedViaApi(page);
  const headers = {
    'X-CSRFToken':
      (await page.context().cookies()).find((c) => c.name === 'csrftoken')
        ?.value ?? '',
  };
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    root_folder_id: string;
  };
  const original = Buffer.from('Nội dung gốc M7-02');
  const replacement = Buffer.from('Nội dung thay thế M7-02');
  async function upload(bytes: Buffer, target?: string): Promise<string> {
    const created = await page.request.post('/api/v1/uploads', {
      headers,
      data: {
        parent_id: me.root_folder_id,
        filename: 'Lịch sử.txt',
        size: bytes.length,
        mime_type: 'text/plain',
        fingerprint: crypto.randomUUID(),
        ...(target ? { target_node_id: target } : {}),
      },
    });
    expect(created.status()).toBe(201);
    const session = (await created.json()) as { id: string };
    const signed = await page.request.post(
      `/api/v1/uploads/${session.id}/parts`,
      { headers, data: { part_numbers: [1] } },
    );
    const parts = (await signed.json()) as { parts: { url: string }[] };
    expect(
      (await page.request.put(parts.parts[0].url, { data: bytes })).ok(),
    ).toBe(true);
    const complete = await page.request.post(
      `/api/v1/uploads/${session.id}/complete`,
      { headers },
    );
    expect(complete.status()).toBe(200);
    return ((await complete.json()) as { id: string }).id;
  }
  const id = await upload(original);
  await upload(replacement, id);
  const base = `/api/v1/nodes/${id}/versions`;
  const history = (await (await page.request.get(base)).json()) as {
    results: { id: string; version_number: number; is_current: boolean }[];
  };
  expect(history.results.map((v) => v.version_number)).toEqual([2, 1]);
  const [second, first] = history.results;
  const download = (await (
    await page.request.get(`${base}/${first.id}/download`)
  ).json()) as { url: string };
  expect(await (await page.request.get(download.url)).body()).toEqual(original);
  expect(
    (
      await page.request.post(`${base}/${first.id}/restore`, { headers })
    ).status(),
  ).toBe(200);
  await page.goto('/drive');
  await page.getByRole('option', { name: 'Lịch sử.txt', exact: true }).click();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Lịch sử.txt', exact: true }),
  ).toContainText(original.toString());
  expect(
    (await page.request.delete(`${base}/${first.id}`, { headers })).status(),
  ).toBe(204);
  expect(
    (await page.request.delete(`${base}/${second.id}`, { headers })).status(),
  ).toBe(204);
  const final = (await (await page.request.get(base)).json()) as typeof history;
  expect(final.results).toHaveLength(1);
  expect(final.results[0]).toMatchObject({
    version_number: 3,
    is_current: true,
  });
  expect(
    (
      await page.request.delete(`${base}/${final.results[0].id}`, { headers })
    ).status(),
  ).toBe(409);
});
