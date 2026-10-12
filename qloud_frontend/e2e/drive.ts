import { expect, type Locator, type Page } from '@playwright/test';

import { DESKTOP_INPUT_QUERY } from '../src/features/drive/desktop-input';

/** Desktop double click; touch devices use the item menu's Open action. */
export async function openDriveFolder(page: Page, name: string): Promise<void> {
  const desktop = await page.evaluate(
    (query) => window.matchMedia(query).matches,
    DESKTOP_INPUT_QUERY,
  );
  const item = page.getByRole('option', { name, exact: true });
  if (desktop) await item.dblclick();
  else {
    await chooseItemAction(page, item, 'Mở');
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** The item's ⋯ menu (mouse and touch): it keeps a selection that includes the item. */
export async function openItemMenu(
  page: Page,
  target: string | Locator,
): Promise<Locator> {
  const item =
    typeof target === 'string'
      ? page.getByRole('option', { name: target, exact: true })
      : target;
  await item.getByRole('button', { name: /^Thao tác với / }).click();
  return page.getByRole('menu');
}

/** Run an item action by its label (the menu item's name also holds its shortcut). */
export async function chooseItemAction(
  page: Page,
  target: string | Locator,
  label: string,
): Promise<void> {
  const menu = await openItemMenu(page, target);
  await menu.getByText(label, { exact: true }).click();
}
