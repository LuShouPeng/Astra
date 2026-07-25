/**
 * Terminal service implementation using Tauri backend
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ITerminalService,
  TerminalConfig,
  TerminalSessionInfo,
  ExecutionPolicy,
  CommandRule,
} from '@/core/contracts/terminal';

export class TauriTerminalService implements ITerminalService {
  private listeners: Map<string, () => void> = new Map();

  async createSession(config: TerminalConfig): Promise<string> {
    return await invoke<string>('terminal_create_session', { config });
  }

  async writeInput(sessionId: string, data: string): Promise<void> {
    await invoke('terminal_write_input', { sessionId, data });
  }

  async readOutput(sessionId: string): Promise<string> {
    return await invoke<string>('terminal_read_output', { sessionId });
  }

  async executeCommand(
    sessionId: string,
    command: string,
  ): Promise<ExecutionPolicy> {
    return await invoke<ExecutionPolicy>('terminal_execute_command', {
      sessionId,
      command,
    });
  }

  async confirmCommand(sessionId: string, command: string): Promise<void> {
    await invoke('terminal_confirm_command', { sessionId, command });
  }

  async cancelCommand(sessionId: string): Promise<void> {
    await invoke('terminal_cancel_command', { sessionId });
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await invoke('terminal_resize', { sessionId, cols, rows });
  }

  async getSessionInfo(sessionId: string): Promise<TerminalSessionInfo> {
    return await invoke<TerminalSessionInfo>('terminal_get_session_info', {
      sessionId,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await invoke('terminal_close_session', { sessionId });

    // Clean up listener if exists
    const unlisten = this.listeners.get(sessionId);
    if (unlisten) {
      unlisten();
      this.listeners.delete(sessionId);
    }
  }

  async listSessions(): Promise<string[]> {
    return await invoke<string[]>('terminal_list_sessions');
  }

  async addCommandRule(rule: CommandRule): Promise<void> {
    await invoke('terminal_add_command_rule', { rule });
  }

  async getCommandRules(): Promise<CommandRule[]> {
    return await invoke<CommandRule[]>('terminal_get_command_rules');
  }

  async changeDirectory(sessionId: string, path: string): Promise<void> {
    await invoke('terminal_change_directory', { sessionId, path });
  }

  /**
   * Listen for command confirmation requests
   */
  async onCommandConfirmationRequired(
    callback: (command: string) => void,
  ): Promise<() => void> {
    const unlisten = await listen<string>(
      'terminal-command-confirmation-required',
      (event) => {
        callback(event.payload);
      },
    );

    return unlisten;
  }

  /**
   * Start polling for terminal output
   * Returns a cleanup function to stop polling
   */
  startOutputPolling(
    sessionId: string,
    onOutput: (data: string) => void,
    intervalMs: number = 100,
  ): () => void {
    const poll = async () => {
      try {
        const output = await this.readOutput(sessionId);
        if (output) {
          onOutput(output);
        }
      } catch (error) {
        // Session might be closed or errored
        console.error('Error reading terminal output:', error);
      }
    };

    const intervalId = setInterval(() => void poll(), intervalMs);

    const cleanup = () => {
      clearInterval(intervalId);
    };

    this.listeners.set(sessionId, cleanup);
    return cleanup;
  }

  /**
   * Create session with output streaming
   */
  async createSessionWithStreaming(
    config: TerminalConfig,
    onOutput: (data: string) => void,
  ): Promise<{ sessionId: string; cleanup: () => void }> {
    const sessionId = await this.createSession(config);
    const cleanup = this.startOutputPolling(sessionId, onOutput);

    return { sessionId, cleanup };
  }
}

/**
 * Singleton instance for use across the application
 */
export const terminalService = new TauriTerminalService();
