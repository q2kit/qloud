import { expect, type Page } from '@playwright/test';

import { DESKTOP_INPUT_QUERY } from '../src/features/drive/desktop-input';

/** Desktop double click; touch devices select and use the existing Open action. */
export async function openDriveFolder(page: Page, name: string): Promise<void> {
  const desktop = await page.evaluate(
    (query) => window.matchMedia(query).matches,
    DESKTOP_INPUT_QUERY,
  );
  const item = page.getByRole('option', { name, exact: true });
  if (desktop) await item.dblclick();
  else {
    await item.click();
    await page.getByRole('button', { name: 'Mở', exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}
