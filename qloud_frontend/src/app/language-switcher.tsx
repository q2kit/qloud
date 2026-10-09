import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supportedLanguages } from '@/lib/i18n';

export function LanguageSwitcher(): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage?.split('-')[0] ?? 'vi';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language.label')}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={(value) => {
            void i18n.changeLanguage(value);
          }}
        >
          {supportedLanguages.map((language) => (
            <DropdownMenuRadioItem key={language} value={language}>
              {t(`language.${language}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
