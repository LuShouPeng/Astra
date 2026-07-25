/**
 * Example React component demonstrating Terminal integration
 * This is a reference implementation showing how to use the terminal service
 */

import { useEffect, useRef, useState } from 'react';
import { terminalService, ExecutionPolicy } from '@/modules/terminal';

interface TerminalComponentProps {
  workingDir: string;
  onClose?: () => void;
}

export function TerminalComponent({ workingDir, onClose }: TerminalComponentProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Initialize terminal session
  useEffect(() => {
    let mounted = true;

    async function initTerminal() {
      try {
        setIsLoading(true);

        // Create session with streaming
        const { sessionId: newSessionId, cleanup } =
          await terminalService.createSessionWithStreaming(
            {
              workingDir,
              cols: 80,
              rows: 24,
            },
            (data: string) => {
              if (mounted) {
                setOutput((prev) => prev + data);
              }
            }
          );

        if (mounted) {
          setSessionId(newSessionId);
          cleanupRef.current = cleanup;
        }
      } catch (error) {
        console.error('Failed to create terminal session:', error);
        const message = error instanceof Error ? error.message : String(error);
        alert(`Terminal error: ${message}`);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void initTerminal();

    return () => {
      mounted = false;
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      if (sessionId) {
        void terminalService.closeSession(sessionId).catch(console.error);
      }
    };
  }, [workingDir, sessionId]);

  // Listen for command confirmation requests
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    async function setupListener() {
      unlisten = await terminalService.onCommandConfirmationRequired(
        (command: string) => {
          setPendingCommand(command);
        }
      );
    }

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleExecuteCommand = async () => {
    if (!sessionId || !input.trim()) return;

    try {
      setIsLoading(true);
      const policy = await terminalService.executeCommand(sessionId, input);

      if (policy === ExecutionPolicy.Allow) {
        // Command executed immediately
        setInput('');
      } else if (policy === ExecutionPolicy.Confirm) {
        // Wait for user confirmation
        setPendingCommand(input);
        setInput('');
      }
    } catch (error) {
      console.error('Command execution failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      setOutput((prev) => prev + `\nError: ${message}\n`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCommand = async () => {
    if (!sessionId || !pendingCommand) return;

    try {
      await terminalService.confirmCommand(sessionId, pendingCommand);
      setPendingCommand(null);
    } catch (error) {
      console.error('Command confirmation failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      setOutput((prev) => prev + `\nError: ${message}\n`);
    }
  };

  const handleCancelCommand = async () => {
    if (!sessionId) return;

    try {
      await terminalService.cancelCommand(sessionId);
      setOutput((prev) => prev + '\n^C\n');
    } catch (error) {
      console.error('Command cancellation failed:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleExecuteCommand();
    } else if (e.key === 'c' && e.ctrlKey) {
      void handleCancelCommand();
    }
  };

  if (isLoading && !sessionId) {
    return <div>Loading terminal...</div>;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: 'monospace',
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Terminal: {workingDir}</span>
        <button onClick={onClose}>Close</button>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        style={{
          flex: 1,
          padding: '8px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {output || 'Terminal ready. Type a command and press Enter.'}
      </div>

      {/* Confirmation dialog */}
      {pendingCommand && (
        <div style={{
          padding: '8px',
          backgroundColor: '#3c3c3c',
          borderTop: '1px solid #333',
        }}>
          <div>Command requires confirmation:</div>
          <div style={{ fontWeight: 'bold', margin: '4px 0' }}>
            {pendingCommand}
          </div>
          <div>
            <button
              onClick={() => void handleConfirmCommand()}
              style={{ marginRight: '8px' }}
            >
              Allow
            </button>
            <button onClick={() => setPendingCommand(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: '8px',
        borderTop: '1px solid #333',
        display: 'flex',
        gap: '8px',
      }}>
        <span>$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || !!pendingCommand}
          placeholder="Enter command..."
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            color: 'inherit',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void handleExecuteCommand()}
          disabled={isLoading || !input.trim() || !!pendingCommand}
        >
          Execute
        </button>
        <button
          onClick={() => void handleCancelCommand()}
          disabled={isLoading}
          title="Ctrl+C"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Example usage in a parent component
export function TerminalExample() {
  const [showTerminal, setShowTerminal] = useState(false);

  return (
    <div>
      <button onClick={() => setShowTerminal(true)}>
        Open Terminal
      </button>

      {showTerminal && (
        <div style={{
          position: 'fixed',
          top: '10%',
          left: '10%',
          right: '10%',
          bottom: '10%',
          zIndex: 1000,
        }}>
          <TerminalComponent
            workingDir={process.cwd()}
            onClose={() => setShowTerminal(false)}
          />
        </div>
      )}
    </div>
  );
}
