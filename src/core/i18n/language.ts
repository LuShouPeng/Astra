export type AppLanguage = 'en' | 'zh-CN';

const LANGUAGE_STORAGE_KEY = 'astra-nexus.language';

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === 'en' || value === 'zh-CN';
}

export function loadLanguagePreference(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isAppLanguage(stored) ? stored : 'en';
  } catch {
    return 'en';
  }
}

export function applyLanguagePreference(language: AppLanguage): void {
  document.documentElement.lang = language;
}

export function saveLanguagePreference(language: AppLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The in-memory language still works when browser storage is unavailable.
  }
  applyLanguagePreference(language);
}

export function startLanguagePreference(): void {
  applyLanguagePreference(loadLanguagePreference());
}
