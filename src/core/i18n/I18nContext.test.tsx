import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './I18nContext';

function LanguageProbe() {
  const { language, setLanguage, t } = useI18n();
  return (
    <>
      <span>{t('settings.title')}</span>
      <button onClick={() => setLanguage(language === 'en' ? 'zh-CN' : 'en')}>
        Switch language
      </button>
    </>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => localStorage.clear());

  it('switches translations immediately and persists the selection', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );

    expect(screen.getByText('Settings')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getByText('设置')).toBeVisible();
    expect(localStorage.getItem('astra-nexus.language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
