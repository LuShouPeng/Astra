import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createAcceptanceWorkspaceService } from './shared/test/acceptanceWorkspaceService';
import { createAcceptancePrototypeRepository } from './shared/test/acceptancePrototypeRepository';
import './shared/styles/tokens.css';
import './shared/styles/global.css';
import './modules/workspace/workspace.css';
import './modules/command-center/command-center.css';
import './app/shell/shell.css';

const acceptanceService =
  import.meta.env.MODE === 'acceptance'
    ? createAcceptanceWorkspaceService(window.location.search)
    : undefined;
const acceptanceRepository =
  import.meta.env.MODE === 'acceptance' ? createAcceptancePrototypeRepository() : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App service={acceptanceService} repository={acceptanceRepository} />
  </StrictMode>,
);
