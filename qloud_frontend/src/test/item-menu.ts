import { fireEvent, screen, within } from '@testing-library/react';
import type { userEvent } from '@testing-library/user-event';

/** Run an item action from the context menu of the current selection. */
export async function chooseSelectionAction(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> {
  const [item] = screen.getAllByRole('option', { selected: true });
  if (!item) throw new Error('Nothing is selected');
  // user-event does not synthesize contextmenu.
  fireEvent.contextMenu(item);
  // Match the label alone: the item's name also includes its shortcut.
  const menu = await screen.findByRole('menu');
  await user.click(within(menu).getByText(label, { exact: true }));
}
