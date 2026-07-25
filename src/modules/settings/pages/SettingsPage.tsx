import { BellRing, Bot, ExternalLink, Info, MonitorCog, Play } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppNotification, NotificationSettings } from '../../../core/contracts/notifications';
import type { AgentProvider } from '../../../core/contracts/agents';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../../../core/preferences/appearance';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { defaultAgentAuthService, type AgentAuthService } from '../../agents';
import { DemoControls } from '../../demo';
import type { DesktopNotificationService } from '../../notifications';

type SettingsTab = 'general' | 'agents' | 'notifications' | 'demo' | 'about';

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'demo', label: 'Demo' },
  { id: 'about', label: 'About' },
];

function settingsTab(value: string | null): SettingsTab {
  return value === 'agents' || value === 'notifications' || value === 'demo' || value === 'about'
    ? value
    : 'general';
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
  agentAuth = defaultAgentAuthService,
}: {
  desktopNotifications?: DesktopNotificationService;
  agentAuth?: AgentAuthService;
}) {
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = settingsTab(searchParams.get('tab'));
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [openingLogin, setOpeningLogin] = useState<AgentProvider | null>(null);

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

  async function openAgentLogin(provider: AgentProvider) {
    if (openingLogin) return;
    setOpeningLogin(provider);
    setError(null);
    setNotice(null);
    try {
      await agentAuth.openLogin(provider);
      const label = provider === 'claude' ? 'Claude' : 'Codex';
      setNotice(
        `${label} login terminal opened. Complete authentication there, then return to Astra.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Agent login terminal could not open.');
    } finally {
      setOpeningLogin(null);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <p className="eyebrow">Workbench preferences</p>
        <h1>Settings</h1>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
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
                <h2 id="general-settings-title">General</h2>
                <p>Local application defaults</p>
              </div>
            </header>
            <div className="settings-row">
              <div>
                <strong>Theme</strong>
                <small>Application appearance</small>
              </div>
              <select
                aria-label="Theme"
                value={theme}
                onChange={(event) => {
                  const preference = event.target.value as ThemePreference;
                  setTheme(preference);
                  saveThemePreference(preference);
                }}
              >
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div className="settings-row">
              <div>
                <strong>Language</strong>
                <small>Interface language</small>
              </div>
              <span className="settings-value">English only</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>Start on System Startup</strong>
                <small>Launch Astra Nexus after signing in</small>
              </div>
              <span className="coming-soon-badge">Coming soon</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>Default Project Directory</strong>
                <small>Selected independently when adding each project</small>
              </div>
              <span className="settings-value">Per-project folder picker</span>
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

        {tab === 'agents' && (
          <section className="settings-section" aria-labelledby="agent-settings-title">
            <header>
              <Bot size={20} aria-hidden="true" />
              <div>
                <h2 id="agent-settings-title">Agents</h2>
                <p>Installed command-line providers</p>
              </div>
            </header>
            {Object.values(snapshot.providerCapabilities).map((capability) => (
              <div className="settings-row" key={capability.provider}>
                <div>
                  <strong>{capability.label}</strong>
                  <small>
                    {capability.runtimeAvailable
                      ? (capability.version ?? 'CLI detected')
                      : 'CLI not detected'}
                  </small>
                </div>
                {capability.provider === 'claude' || capability.provider === 'codex' ? (
                  <button
                    className="button button--secondary"
                    aria-label={`Log in to ${capability.label}`}
                    disabled={!capability.runtimeAvailable || openingLogin !== null}
                    onClick={() => void openAgentLogin(capability.provider)}
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                    {openingLogin === capability.provider ? 'Opening terminal' : 'Log in'}
                  </button>
                ) : (
                  <span className="settings-value">
                    {capability.runtimeAvailable ? 'Available' : 'Unavailable'}
                  </span>
                )}
              </div>
            ))}
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
