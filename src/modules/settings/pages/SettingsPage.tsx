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

const testNotification: AppNotification = {
  id: 'notification-settings-test',
  event: 'waiting_input',
  tone: 'info',
  title: 'Astra Nexus notification test',
  message: 'Desktop notifications are configured for this workbench.',
  createdAt: '2026-07-24T14:21:00.000Z',
  read: true,
};

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

  if (!snapshot) return <div className="settings-state">Loading settings...</div>;

  async function updateNotifications(patch: Partial<NotificationSettings>) {
    try {
      setError(null);
      setNotice(null);
      await saveSnapshot({
        ...snapshot!,
        notificationSettings: { ...snapshot!.notificationSettings, ...patch },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Settings could not be saved.');
    }
  }

  async function sendTestNotification() {
    if (!desktopNotifications || sendingTest) return;
    setSendingTest(true);
    try {
      setError(null);
      const result = await desktopNotifications.notify(
        testNotification,
        snapshot!.notificationSettings,
      );
      setNotice(
        result === 'sent'
          ? 'Desktop notification sent'
          : result === 'denied'
            ? 'Desktop notification permission denied'
            : 'Desktop notifications are disabled',
      );
    } catch {
      setError('The desktop notification could not be sent.');
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
                <h2 id="notification-settings-title">Notifications</h2>
                <p>Desktop delivery rules</p>
              </div>
            </header>
            <label className="settings-row settings-toggle">
              <span>
                <strong>Enable Desktop Notifications</strong>
                <small>Allow configured events to use operating system notifications</small>
              </span>
              <input
                type="checkbox"
                aria-label="Enable Desktop Notifications"
                checked={snapshot.notificationSettings.desktopEnabled}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ desktopEnabled: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>Notify on Waiting</strong>
                <small>Input and approval requests</small>
              </span>
              <input
                type="checkbox"
                aria-label="Notify on Waiting"
                checked={snapshot.notificationSettings.notifyOnWaiting}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ notifyOnWaiting: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>Notify on Completed</strong>
                <small>Completed Agent simulations</small>
              </span>
              <input
                type="checkbox"
                aria-label="Notify on Completed"
                checked={snapshot.notificationSettings.notifyOnCompleted}
                disabled={saving}
                onChange={(event) =>
                  void updateNotifications({ notifyOnCompleted: event.target.checked })
                }
              />
            </label>
            <label className="settings-row settings-toggle">
              <span>
                <strong>Notify on Failed</strong>
                <small>Agent and test failures</small>
              </span>
              <input
                type="checkbox"
                aria-label="Notify on Failed"
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
                {sendingTest ? 'Sending notification' : 'Send test notification'}
              </button>
            </div>
          </section>
        )}

        {tab === 'demo' && (
          <section className="settings-section" aria-labelledby="demo-settings-title">
            <header>
              <Play size={20} aria-hidden="true" />
              <div>
                <h2 id="demo-settings-title">Demo</h2>
                <p>Deterministic presentation controls</p>
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
                <h2 id="about-title">About Astra Nexus</h2>
                <p>AI Coding Workbench prototype</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>Version</dt>
                <dd>0.1.0</dd>
              </div>
              <div>
                <dt>Product</dt>
                <dd>
                  Local control plane for projects, mock Agent Sessions, Git changes, and review.
                </dd>
              </div>
              <div>
                <dt>Technology Stack</dt>
                <dd>Tauri 2, Rust, React 19, TypeScript, Vite, and git2</dd>
              </div>
              <div>
                <dt>Provider Runtime</dt>
                <dd>Claude and Codex deterministic mocks; Gemini display only</dd>
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
