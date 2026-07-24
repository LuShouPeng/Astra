export type ThemePreference = 'dark' | 'light' | 'system';

const THEME_STORAGE_KEY = 'astra-nexus.theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function loadThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemUsesDarkTheme(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function applyThemePreference(preference: ThemePreference): void {
  const theme = preference === 'system' ? (systemUsesDarkTheme() ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The in-memory application theme still works when browser storage is unavailable.
  }
  applyThemePreference(preference);
}

export function startThemePreference(): () => void {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  applyThemePreference(loadThemePreference());
  if (!media) return () => undefined;

  const update = (event: MediaQueryListEvent) => {
    if (loadThemePreference() === 'system') {
      document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
    }
  };
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
