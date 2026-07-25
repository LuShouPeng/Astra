/**
 * Terminal service tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TauriTerminalService } from './terminalService';
import { ExecutionPolicy } from '../../../core/contracts/terminal';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('TauriTerminalService', () => {
  let service: TauriTerminalService;
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    mockInvoke = invoke as ReturnType<typeof vi.fn>;
    mockInvoke.mockClear();
    service = new TauriTerminalService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a terminal session', async () => {
      const mockSessionId = 'test-session-123';
      mockInvoke.mockResolvedValue(mockSessionId);

      const sessionId = await service.createSession({
        workingDir: '/test/path',
        cols: 80,
        rows: 24,
      });

      expect(sessionId).toBe(mockSessionId);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_create_session', {
        config: {
          workingDir: '/test/path',
          cols: 80,
          rows: 24,
        },
      });
    });

    it('should pass shell and environment variables', async () => {
      const mockSessionId = 'test-session-456';
      mockInvoke.mockResolvedValue(mockSessionId);

      await service.createSession({
        workingDir: '/home/user',
        cols: 120,
        rows: 30,
        shell: '/bin/zsh',
        env: {
          NODE_ENV: 'test',
          DEBUG: '1',
        },
      });

      expect(mockInvoke).toHaveBeenCalledWith('terminal_create_session', {
        config: {
          workingDir: '/home/user',
          cols: 120,
          rows: 30,
          shell: '/bin/zsh',
          env: {
            NODE_ENV: 'test',
            DEBUG: '1',
          },
        },
      });
    });
  });

  describe('executeCommand', () => {
    it('should execute allowed commands directly', async () => {
      mockInvoke.mockResolvedValue(ExecutionPolicy.Allow);

      const policy = await service.executeCommand('session-1', 'ls -la');

      expect(policy).toBe(ExecutionPolicy.Allow);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_execute_command', {
        sessionId: 'session-1',
        command: 'ls -la',
      });
    });

    it('should return Confirm for commands requiring confirmation', async () => {
      mockInvoke.mockResolvedValue(ExecutionPolicy.Confirm);

      const policy = await service.executeCommand('session-1', 'sudo apt-get install');

      expect(policy).toBe(ExecutionPolicy.Confirm);
    });

    it('should handle denied commands', async () => {
      mockInvoke.mockRejectedValue(new Error('Command not permitted'));

      await expect(
        service.executeCommand('session-1', 'rm -rf /')
      ).rejects.toThrow('Command not permitted');
    });
  });

  describe('writeInput', () => {
    it('should write input to terminal', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await service.writeInput('session-1', 'echo "hello"\n');

      expect(mockInvoke).toHaveBeenCalledWith('terminal_write_input', {
        sessionId: 'session-1',
        data: 'echo "hello"\n',
      });
    });
  });

  describe('readOutput', () => {
    it('should read output from terminal', async () => {
      const mockOutput = 'hello\nworld\n';
      mockInvoke.mockResolvedValue(mockOutput);

      const output = await service.readOutput('session-1');

      expect(output).toBe(mockOutput);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_read_output', {
        sessionId: 'session-1',
      });
    });
  });

  describe('cancelCommand', () => {
    it('should send interrupt signal', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await service.cancelCommand('session-1');

      expect(mockInvoke).toHaveBeenCalledWith('terminal_cancel_command', {
        sessionId: 'session-1',
      });
    });
  });

  describe('resize', () => {
    it('should resize terminal', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await service.resize('session-1', 120, 40);

      expect(mockInvoke).toHaveBeenCalledWith('terminal_resize', {
        sessionId: 'session-1',
        cols: 120,
        rows: 40,
      });
    });
  });

  describe('getSessionInfo', () => {
    it('should get session information', async () => {
      const mockInfo = {
        id: 'session-1',
        workingDir: '/home/user',
        cols: 80,
        rows: 24,
        isAlive: true,
      };
      mockInvoke.mockResolvedValue(mockInfo);

      const info = await service.getSessionInfo('session-1');

      expect(info).toEqual(mockInfo);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_get_session_info', {
        sessionId: 'session-1',
      });
    });
  });

  describe('closeSession', () => {
    it('should close terminal session', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await service.closeSession('session-1');

      expect(mockInvoke).toHaveBeenCalledWith('terminal_close_session', {
        sessionId: 'session-1',
      });
    });
  });

  describe('changeDirectory', () => {
    it('should change working directory', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await service.changeDirectory('session-1', '/tmp');

      expect(mockInvoke).toHaveBeenCalledWith('terminal_change_directory', {
        sessionId: 'session-1',
        path: '/tmp',
      });
    });
  });

  describe('command rules', () => {
    it('should add command rule', async () => {
      mockInvoke.mockResolvedValue(undefined);

      const rule = {
        pattern: '^git push.*--force',
        policy: ExecutionPolicy.Confirm,
        description: 'Force push requires confirmation',
      };

      await service.addCommandRule(rule);

      expect(mockInvoke).toHaveBeenCalledWith('terminal_add_command_rule', {
        rule,
      });
    });

    it('should get command rules', async () => {
      const mockRules = [
        {
          pattern: '^sudo',
          policy: ExecutionPolicy.Confirm,
          description: 'Sudo requires confirmation',
        },
      ];
      mockInvoke.mockResolvedValue(mockRules);

      const rules = await service.getCommandRules();

      expect(rules).toEqual(mockRules);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_get_command_rules');
    });
  });

  describe('listSessions', () => {
    it('should list all active sessions', async () => {
      const mockSessions = ['session-1', 'session-2', 'session-3'];
      mockInvoke.mockResolvedValue(mockSessions);

      const sessions = await service.listSessions();

      expect(sessions).toEqual(mockSessions);
      expect(mockInvoke).toHaveBeenCalledWith('terminal_list_sessions');
    });
  });

  describe('output polling', () => {
    it('should start and stop output polling', async () => {
      vi.useFakeTimers();
      mockInvoke.mockResolvedValue('output data');

      const outputs: string[] = [];
      const cleanup = service.startOutputPolling('session-1', (data) => {
        outputs.push(data);
      }, 100);

      // Wait for a few poll cycles
      await vi.advanceTimersByTimeAsync(250);

      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs[0]).toBe('output data');

      cleanup();
      vi.useRealTimers();
    });
  });
});
