/**
 * Terminal PTY contracts for interactive command execution
 */

/**
 * Terminal session configuration
 */
export interface TerminalConfig {
  workingDir: string;
  cols: number;
  rows: number;
  shell?: string;
  env?: Record<string, string>;
}

/**
 * Command execution policy
 */
export enum ExecutionPolicy {
  /** Always allow without confirmation */
  Allow = 'Allow',
  /** Require user confirmation */
  Confirm = 'Confirm',
  /** Block execution */
  Deny = 'Deny',
}

/**
 * Command permission rule
 */
export interface CommandRule {
  pattern: string;
  policy: ExecutionPolicy;
  description: string;
}

/**
 * Terminal session information
 */
export interface TerminalSessionInfo {
  id: string;
  workingDir: string;
  cols: number;
  rows: number;
  isAlive: boolean;
}

/**
 * Terminal command confirmation event payload
 */
export interface TerminalCommandConfirmation {
  sessionId: string;
  command: string;
}

/**
 * Terminal output event payload
 */
export interface TerminalOutput {
  sessionId: string;
  data: string;
}

/**
 * Terminal error
 */
export interface TerminalError {
  type: 'PtyError' | 'SessionNotFound' | 'CommandNotPermitted' |
        'WorkingDirectoryError' | 'IoError' | 'PermissionDenied';
  message: string;
}

/**
 * Terminal service interface
 */
export interface ITerminalService {
  /**
   * Create a new terminal session
   */
  createSession(config: TerminalConfig): Promise<string>;

  /**
   * Write input to terminal
   */
  writeInput(sessionId: string, data: string): Promise<void>;

  /**
   * Read output from terminal
   */
  readOutput(sessionId: string): Promise<string>;

  /**
   * Execute a command with policy check
   * Returns the execution policy applied
   */
  executeCommand(sessionId: string, command: string): Promise<ExecutionPolicy>;

  /**
   * Confirm and execute a pending command
   */
  confirmCommand(sessionId: string, command: string): Promise<void>;

  /**
   * Cancel current command execution (sends Ctrl+C)
   */
  cancelCommand(sessionId: string): Promise<void>;

  /**
   * Resize terminal
   */
  resize(sessionId: string, cols: number, rows: number): Promise<void>;

  /**
   * Get session information
   */
  getSessionInfo(sessionId: string): Promise<TerminalSessionInfo>;

  /**
   * Close terminal session
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * List all active sessions
   */
  listSessions(): Promise<string[]>;

  /**
   * Add or update command rule
   */
  addCommandRule(rule: CommandRule): Promise<void>;

  /**
   * Get all command rules
   */
  getCommandRules(): Promise<CommandRule[]>;

  /**
   * Change working directory for session
   */
  changeDirectory(sessionId: string, path: string): Promise<void>;
}
