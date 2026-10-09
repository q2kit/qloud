import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { readStorage, writeStorage } from '@/lib/storage';
import enCommon from '@/locales/en/common.json';
import viCommon from '@/locales/vi/common.json';

export const LANGUAGE_STORAGE_KEY = 'qloud-language';
export const supportedLanguages = ['vi', 'en'] as const;
export type Language = (typeof supportedLanguages)[number];

function normalizeLanguage(
  value: string | null | undefined,
): Language | undefined {
  const baseLanguage = value?.toLowerCase().split('-')[0];
  return supportedLanguages.find((language) => language === baseLanguage);
}

export function detectLanguage(): Language {
  return (
    normalizeLanguage(readStorage(LANGUAGE_STORAGE_KEY)) ??
    normalizeLanguage(navigator.language) ??
    'vi'
  );
}

void i18n.use(initReactI18next).init({
  resources: {
    vi: { common: viCommon },
    en: { common: enCommon },
  },
  lng: detectLanguage(),
  fallbackLng: 'vi',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.resolvedLanguage ?? 'vi';
i18n.on('languageChanged', (language) => {
  const normalizedLanguage = normalizeLanguage(language) ?? 'vi';
  writeStorage(LANGUAGE_STORAGE_KEY, normalizedLanguage);
  document.documentElement.lang = normalizedLanguage;
});

export { i18n };
