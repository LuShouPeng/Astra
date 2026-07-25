/**
 * Terminal module - Interactive PTY terminal with command execution controls
 */

export { TauriTerminalService, terminalService } from './services/terminalService';

export type {
  ITerminalService,
  TerminalConfig,
  TerminalSessionInfo,
  CommandRule,
  TerminalCommandConfirmation,
  TerminalOutput,
  TerminalError,
} from '../../core/contracts/terminal';

export { ExecutionPolicy } from '../../core/contracts/terminal';
