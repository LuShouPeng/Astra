import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadLanguagePreference,
  saveLanguagePreference,
  startLanguagePreference,
} from './language';

describe('language preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('defaults invalid or missing preferences to English', () => {
    expect(loadLanguagePreference()).toBe('en');
    localStorage.setItem('astra-nexus.language', 'unsupported');
    expect(loadLanguagePreference()).toBe('en');
  });

  it('persists Simplified Chinese and applies the document language', () => {
    saveLanguagePreference('zh-CN');

    expect(localStorage.getItem('astra-nexus.language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('applies a persisted preference during application startup', () => {
    localStorage.setItem('astra-nexus.language', 'zh-CN');

    startLanguagePreference();

    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
