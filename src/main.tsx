import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createAcceptanceWorkspaceService } from './shared/test/acceptanceWorkspaceService';
import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './modules/workspace/workspace.css';
import './app/shell/shell.css';

const acceptanceService =
  import.meta.env.MODE === 'acceptance'
    ? createAcceptanceWorkspaceService(window.location.search)
    : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App service={acceptanceService} />
  </StrictMode>,
);
