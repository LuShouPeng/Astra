export interface ProviderPreferences {
  claudePath?: string;
  codexPath?: string;
}

const KEY = 'astra.providers.v1';

export function loadProviderPreferences(): ProviderPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as ProviderPreferences;
    return {
      claudePath: value.claudePath?.trim() || undefined,
      codexPath: value.codexPath?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function saveProviderPreferences(value: ProviderPreferences) {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      claudePath: value.claudePath?.trim() || undefined,
      codexPath: value.codexPath?.trim() || undefined,
    }),
  );
}
