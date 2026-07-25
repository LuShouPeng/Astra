import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyLanguagePreference,
  loadLanguagePreference,
  saveLanguagePreference,
  type AppLanguage,
} from './language';
import { translate, type TranslationKey, type TranslationParams } from './translations';
import { localizeKnownText } from './knownText';

interface I18nValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  text: (value: string) => string;
}

const defaultValue: I18nValue = {
  language: 'en',
  setLanguage: () => undefined,
  t: (key, params) => translate('en', key, params),
  text: (value) => value,
};

const I18nContext = createContext<I18nValue>(defaultValue);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => loadLanguagePreference());

  useEffect(() => applyLanguagePreference(language), [language]);

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage(nextLanguage) {
        saveLanguagePreference(nextLanguage);
        setLanguageState(nextLanguage);
      },
      t: (key, params) => translate(language, key, params),
      text: (text) => localizeKnownText(language, text),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
