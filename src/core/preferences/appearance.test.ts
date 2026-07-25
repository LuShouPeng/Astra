import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadThemePreference, saveThemePreference, startThemePreference } from './appearance';

describe('appearance preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => vi.restoreAllMocks());

  it('persists and applies an explicit theme', () => {
    saveThemePreference('light');

    expect(loadThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('tracks system theme changes and releases its listener', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => {
      listener = next;
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener,
        removeEventListener,
      })),
    );
    localStorage.setItem('astra-nexus.theme', 'system');

    const stop = startThemePreference();
    expect(document.documentElement.dataset.theme).toBe('dark');
    listener?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
});
