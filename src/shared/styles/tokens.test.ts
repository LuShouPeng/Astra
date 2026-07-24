import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const tauriConfig = readWorkspaceFile('../../../src-tauri/tauri.conf.json');
const shellStyles = readWorkspaceFile('../../app/shell/shell.css');
const commandCenterStyles = readWorkspaceFile('../../modules/command-center/command-center.css');
const sessionStyles = readWorkspaceFile('../../modules/sessions/sessions.css');
const workspaceStyles = readWorkspaceFile('../../modules/workspace/workspace.css');
const globalStyles = readWorkspaceFile('./global.css');
const tokens = readWorkspaceFile('./tokens.css');

const componentStyles = { globalStyles, workspaceStyles, shellStyles };

describe('design token contract', () => {
  it.each(Object.entries(componentStyles))('%s contains no raw color literals', (_, source) => {
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(source).not.toMatch(/\brgba?\s*\(/i);
  });

  it('matches the frozen PRD desktop geometry', () => {
    const config = JSON.parse(tauriConfig) as {
      app: { windows: Array<{ minWidth: number }> };
    };

    expect(config.app.windows[0]?.minWidth).toBe(1200);
    expect(tokens).toContain('--titlebar-height: 48px');
    expect(tokens).toContain('--sidebar-width: 260px');
  });

  it('uses the PRD status colors consistently across the workbench', () => {
    expect(tokens).toContain('--color-status-running: var(--color-info)');
    expect(tokens).toContain('--color-status-completed: var(--color-accent)');
    expect(shellStyles).toMatch(/\.session-dot--running\s*{[^}]*--color-status-running/s);
    expect(shellStyles).toMatch(/\.session-dot--completed\s*{[^}]*--color-status-completed/s);
    expect(commandCenterStyles).toMatch(/\[data-status='running'\][^}]*--color-status-running/s);
    expect(commandCenterStyles).toMatch(
      /\[data-status='completed'\][^}]*--color-status-completed/s,
    );
    expect(sessionStyles).toMatch(/\.session-status--running\s*{[^}]*--color-status-running/s);
    expect(sessionStyles).toMatch(/\.session-status--completed\s*{[^}]*--color-status-completed/s);
  });
});
