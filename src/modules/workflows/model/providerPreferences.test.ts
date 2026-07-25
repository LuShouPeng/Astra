import { beforeEach, describe, expect, it } from 'vitest';
import { loadProviderPreferences, saveProviderPreferences } from './providerPreferences';

describe('provider preferences', () => {
  beforeEach(() => localStorage.clear());

  it('persists trimmed executable paths without credentials', () => {
    saveProviderPreferences({ claudePath: ' C:\\bin\\claude.exe ', codexPath: '' });
    expect(loadProviderPreferences()).toEqual({
      claudePath: 'C:\\bin\\claude.exe',
      codexPath: undefined,
    });
  });

  it('recovers from malformed storage', () => {
    localStorage.setItem('astra.providers.v1', 'not-json');
    expect(loadProviderPreferences()).toEqual({});
  });
});
