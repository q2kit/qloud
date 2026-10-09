import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n';

import { LanguageSwitcher } from './language-switcher';

afterEach(async () => {
  await i18n.changeLanguage('vi');
});

describe('LanguageSwitcher', () => {
  it('changes and persists the active language', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('vi');
    render(<LanguageSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Ngôn ngữ' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
    });
    expect(localStorage.getItem('qloud-language')).toBe('en');
    expect(
      screen.getByRole('button', { name: 'Language' }),
    ).toBeInTheDocument();
  });
});
