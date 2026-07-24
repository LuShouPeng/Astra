import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createAcceptanceWorkspaceService } from './shared/test/acceptanceWorkspaceService';
import { createAcceptancePrototypeRepository } from './shared/test/acceptancePrototypeRepository';
import type { DesktopNotificationService } from './modules/notifications';
import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './modules/workspace/workspace.css';
import './modules/command-center/command-center.css';
import './modules/projects/projects.css';
import './modules/sessions/sessions.css';
import './modules/attention/attention.css';
import './modules/changes/changes.css';
import './modules/notifications/notifications.css';
import './modules/settings/settings.css';
import './app/shell/shell.css';

const acceptanceService =
  import.meta.env.MODE === 'acceptance'
    ? createAcceptanceWorkspaceService(window.location.search)
    : undefined;
const acceptanceRepository =
  import.meta.env.MODE === 'acceptance' ? createAcceptancePrototypeRepository() : undefined;
const acceptanceDesktopNotifications: DesktopNotificationService | undefined =
  import.meta.env.MODE === 'acceptance' ? { notify: () => Promise.resolve('sent') } : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      service={acceptanceService}
      repository={acceptanceRepository}
      desktopNotifications={acceptanceDesktopNotifications}
    />
  </StrictMode>,
);
