import { BellRing, Info, MonitorCog, Play } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppNotification, NotificationSettings } from '../../../core/contracts/notifications';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { AppLanguage } from '../../../core/i18n/language';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../../../core/preferences/appearance';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { DemoControls } from '../../demo';
import type { DesktopNotificationService } from '../../notifications';

type SettingsTab = 'general' | 'notifications' | 'demo' | 'about';

function settingsTab(value: string | null): SettingsTab {
  return value === 'notifications' || value === 'demo' || value === 'about' ? value : 'general';
}

export function SettingsPage({
  desktopNotifications,
}: {
  desktopNotifications?: DesktopNotificationService;
}) {
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const { language, setLanguage, t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = settingsTab(searchParams.get('tab'));
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const tabs = [
    { id: 'general' as const, label: t('settings.tabs.general') },
    { id: 'notifications' as const, label: t('settings.tabs.notifications') },
    { id: 'demo' as const, label: t('settings.tabs.demo') },
    { id: 'about' as const, label: t('settings.tabs.about') },
  ];

  if (!snapshot) return <div className="settings-state">{t('settings.loading')}</div>;

  async function updateNotifications(patch: Partial<NotificationSettings>) {
    try {
      setError(null);
      setNotice(null);
      await saveSnapshot({
        ...snapshot!,
        notificationSettings: { ...snapshot!.notificationSettings, ...patch },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.saveError'));
    }
  }

  async function sendTestNotification() {
    if (!desktopNotifications || sendingTest) return;
    setSendingTest(true);
    try {
      setError(null);
      const testNotification: AppNotification = {
        id: 'notification-settings-test',
        event: 'waiting_input',
        tone: 'info',
        title: t('settings.testTitle'),
        message: t('settings.testMessage'),
        createdAt: '2026-07-24T14:21:00.000Z',
        read: true,
      };
      const result = await desktopNotifications.notify(
        testNotification,
        snapshot!.notificationSettings,
      );
      setNotice(
        result === 'sent'
          ? t('settings.notificationSent')
          : result === 'denied'
            ? t('settings.notificationDenied')
            : t('settings.notificationDisabled'),
      );
    } catch {
      setError(t('settings.notificationError'));
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <p className="eyebrow">{t('settings.eyebrow')}</p>
        <h1>{t('settings.title')}</h1>
      </header>
      <div className="settings-tabs" role="tablist" aria-label={t('settings.sections')}>
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => {
              setSearchParams(item.id === 'general' ? {} : { tab: item.id }, { replace: true });
              setNotice(null);
              setError(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {tab === 'general' && (
          <section className="settings-section" aria-labelledby="general-settings-title">
            <header>
              <MonitorCog size={20} aria-hidden="true" />
              <div>
                <h2 id="general-settings-title">{t('settings.tabs.general')}</h2>
                <p>{t('settings.general.description')}</p>
              </div>
            </header>
            <div className="settings-row">
              <div>
                <strong>{t('settings.theme.label')}</strong>
                <small>{t('settings.theme.description')}</small>
              </div>
              <select
                aria-label={t('settings.theme.label')}
                value={theme}
                onChange={(event) => {
                  const preference = event.target.value as ThemePreference;
                  setTheme(preference);
                  saveThemePreference(preference);
                }}
              >
                <option value="system">{t('settings.theme.system')}</option>
                <option value="dark">{t('settings.theme.dark')}</option>
                <option value="light">{t('settings.theme.light')}</option>
              </select>
            </div>
            <div className="settings-row">
              <div>
                <strong>{t('settings.language.label')}</strong>
                <small>{t('settings.language.description')}</small>
              </div>
              <select
                aria-label={t('settings.language.label')}
                value={language}
                onChange={(event) => setLanguage(event.target.value as AppLanguage)}
              >
                <option value="en">{t('settings.language.english')}</option>
                <option value="zh-CN">{t('settings.language.chinese')}</option>
              </select>
            </div>
            <div className="settings-row">
              <div>
                <strong>{t('settings.startup.label')}</strong>
                <small>{t('settings.startup.description')}</small>
              </div>
              <span className="coming-soon-badge">{t('settings.comingSoon')}</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>{t('settings.directory.label')}</strong>
                <small>{t('settings.directory.description')}</small>
              </div>
              <span className="settings-value">{t('settings.directory.value')}</span>
            </div>
          </section>
        )}

        {tab === 'notifications' && (
          <section className="settings-section" aria-labelledby="notification-settings-title">
            <header>
              <BellRing size={20} aria-hidden="true" />
              <div>
                <h2 id="notification-settings-title">{t('settings.tabs.notifications')}</h2>
                <p>{t('settings.notifications.description')}</p>
              </div>
            </header>
            <label className="settings-row settings-toggle">
              <span>
                <strong>{t('settings.notifications.enable')}</strong>
                <small>{t('settings.notifications.enableDescription')}</small>
              </span>
              <input
                type="checkbox"
                aria-label={t('settings.notifications.enable')}
                checked={snapshot.notificationSettings.desktopEnabled}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ desktopEnabled: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>{t('settings.notifications.waiting')}</strong>
                <small>{t('settings.notifications.waitingDescription')}</small>
              </span>
              <input
                type="checkbox"
                aria-label={t('settings.notifications.waiting')}
                checked={snapshot.notificationSettings.notifyOnWaiting}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ notifyOnWaiting: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>{t('settings.notifications.completed')}</strong>
                <small>{t('settings.notifications.completedDescription')}</small>
              </span>
              <input
                type="checkbox"
                aria-label={t('settings.notifications.completed')}
                checked={snapshot.notificationSettings.notifyOnCompleted}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ notifyOnCompleted: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>{t('settings.notifications.failed')}</strong>
                <small>{t('settings.notifications.failedDescription')}</small>
              </span>
              <input
                type="checkbox"
                aria-label={t('settings.notifications.failed')}
                checked={snapshot.notificationSettings.notifyOnFailed}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ notifyOnFailed: event.target.checked })
                }
              />
            </label>
            <div className="settings-test-row">
              <button
                className="button button--secondary"
                disabled={
                  saving ||
                  sendingTest ||
                  !desktopNotifications ||
                  !snapshot.notificationSettings.desktopEnabled
                }
                onClick={() => void sendTestNotification()}
              >
                {sendingTest ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <BellRing size={16} aria-hidden="true" />
                )}
                {sendingTest
                  ? t('settings.notifications.sending')
                  : t('settings.notifications.sendTest')}
              </button>
            </div>
          </section>
        )}

        {tab === 'demo' && (
          <section className="settings-section" aria-labelledby="demo-settings-title">
            <header>
              <Play size={20} aria-hidden="true" />
              <div>
                <h2 id="demo-settings-title">{t('settings.tabs.demo')}</h2>
                <p>{t('settings.demo.description')}</p>
              </div>
            </header>
            <DemoControls />
          </section>
        )}

        {tab === 'about' && (
          <section className="settings-section settings-about" aria-labelledby="about-title">
            <header>
              <Info size={20} aria-hidden="true" />
              <div>
                <h2 id="about-title">{t('settings.about.title')}</h2>
                <p>{t('settings.about.description')}</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>{t('settings.about.version')}</dt>
                <dd>0.1.0</dd>
              </div>
              <div>
                <dt>{t('settings.about.product')}</dt>
                <dd>{t('settings.about.productDescription')}</dd>
              </div>
              <div>
                <dt>{t('settings.about.stack')}</dt>
                <dd>Tauri 2, Rust, React 19, TypeScript, Vite, and git2</dd>
              </div>
              <div>
                <dt>{t('settings.about.runtime')}</dt>
                <dd>{t('settings.about.runtimeDescription')}</dd>
              </div>
            </dl>
          </section>
        )}

        {(notice || error) && (
          <div
            className={error ? 'settings-feedback settings-feedback--error' : 'settings-feedback'}
            role={error ? 'alert' : 'status'}
          >
            {error ?? notice}
          </div>
        )}
      </div>
    </div>
  );
}
