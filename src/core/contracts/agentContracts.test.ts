import { describe, expect, it } from 'vitest';
import type { AgentLaunchConfig, AgentStreamEvent, ProviderCapability } from './agents';
import type { AgentSession } from './sessions';
import { createDemoSnapshot } from '../../modules/demo/data/demoFixtures';
import { isWorkbenchSnapshot } from '../data/prototypeRepository';

describe('M1 agent contract extensions', () => {
  it('marks every demo session with origin "demo"', () => {
    const snapshot = createDemoSnapshot();
    expect(snapshot.sessions).not.toHaveLength(0);
    expect(snapshot.sessions.every((session) => session.origin === 'demo')).toBe(true);
  });

  it('accepts a snapshot whose sessions omit origin (backward compatible)', () => {
    const snapshot = createDemoSnapshot();
    const legacy = {
      ...snapshot,
      sessions: snapshot.sessions.map(({ origin, ...rest }) => {
        void origin;
        return rest;
      }),
    };
    expect(isWorkbenchSnapshot(legacy)).toBe(true);
  });

  it('accepts a live session carrying runtime metadata', () => {
    const snapshot = createDemoSnapshot();
    const base = snapshot.sessions[0];
    const live: AgentSession = {
      ...base,
      id: 'session-live-1',
      origin: 'live',
      runtimeProcessId: 'session-live-1',
      workingDirectory: 'C:/Code/demo',
    };
    const next = { ...snapshot, sessions: [...snapshot.sessions, live] };
    expect(isWorkbenchSnapshot(next)).toBe(true);
    expect(live.origin).toBe('live');
  });

  it('supports discovery fields on ProviderCapability', () => {
    const capability: ProviderCapability = {
      provider: 'claude',
      label: 'Claude',
      runtimeAvailable: true,
      displayOnly: false,
      version: '1.2.3',
      executablePath: 'C:/bin/claude.cmd',
      discoveredAt: '2026-07-25T00:00:00.000Z',
    };
    expect(capability.runtimeAvailable).toBe(true);
  });

  it('models launch config and the stream event union', () => {
    const config: AgentLaunchConfig = {
      provider: 'codex',
      workingDirectory: 'C:/Code/demo',
      prompt: 'do the thing',
      sessionId: 'session-live-1',
    };
    const events: AgentStreamEvent[] = [
      { kind: 'stdout', chunk: 'hello' },
      { kind: 'stderr', chunk: 'warn' },
      { kind: 'exit', code: 0 },
    ];
    expect(config.provider).toBe('codex');
    expect(events.map((event) => event.kind)).toEqual(['stdout', 'stderr', 'exit']);
  });
});
