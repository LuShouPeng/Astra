import { describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig, AgentStreamEvent } from '../../../core/contracts/agents';
import { createAppEventBus } from '../../../core/events/appEventBus';
import { buildLaunchConfig } from '../adapters/agentAdapter';
import {
  createAgentRuntimeService,
  type AgentRuntimeNativeAdapter,
  type StreamListener,
} from './agentRuntimeService';

/** 可控 fake：记录调用并手动触发流事件。 */
function createFakeAdapter() {
  const calls = {
    start: [] as AgentLaunchConfig[],
    sendInput: [] as Array<{ sessionId: string; text: string }>,
    stop: [] as string[],
  };
  const listeners = new Map<string, StreamListener>();
  const unsubscribed = new Set<string>();

  const adapter: AgentRuntimeNativeAdapter = {
    async start(config) {
      calls.start.push(config);
    },
    async sendInput(sessionId, text) {
      calls.sendInput.push({ sessionId, text });
    },
    async stop(sessionId) {
      calls.stop.push(sessionId);
    },
    async listRunning() {
      return [...listeners.keys()];
    },
    async onStream(sessionId, listener) {
      listeners.set(sessionId, listener);
      return () => {
        unsubscribed.add(sessionId);
        listeners.delete(sessionId);
      };
    },
  };

  return { adapter, calls, listeners, unsubscribed };
}

describe('buildLaunchConfig', () => {
  const input = { workingDirectory: '/proj', prompt: 'hi', sessionId: 's1' };

  it('maps each provider to the right config', () => {
    expect(buildLaunchConfig('claude', input)).toEqual({
      provider: 'claude',
      workingDirectory: '/proj',
      prompt: 'hi',
      sessionId: 's1',
    });
    expect(buildLaunchConfig('codex', input).provider).toBe('codex');
    expect(buildLaunchConfig('gemini', input).provider).toBe('gemini');
    expect(buildLaunchConfig('codex', { ...input, mode: 'resume' })).toMatchObject({
      provider: 'codex',
      mode: 'resume',
    });
  });
});

describe('createAgentRuntimeService', () => {
  it('delegates start/sendInput/stop/listRunning to the adapter', async () => {
    const { adapter, calls } = createFakeAdapter();
    const service = createAgentRuntimeService(adapter);
    const config = buildLaunchConfig('claude', {
      workingDirectory: '/proj',
      prompt: 'go',
      sessionId: 's1',
    });

    await service.start(config);
    await service.sendInput('s1', 'more');
    await service.stop('s1');

    expect(calls.start).toEqual([config]);
    expect(calls.sendInput).toEqual([{ sessionId: 's1', text: 'more' }]);
    expect(calls.stop).toEqual(['s1']);
  });

  it('invokes the direct listener on stream events', async () => {
    const { adapter, listeners } = createFakeAdapter();
    const service = createAgentRuntimeService(adapter);
    const received: AgentStreamEvent[] = [];

    await service.onStream('s1', (event) => received.push(event));
    listeners.get('s1')?.({ kind: 'stdout', chunk: 'hello' });
    listeners.get('s1')?.({ kind: 'exit', code: 0 });

    expect(received).toEqual([
      { kind: 'stdout', chunk: 'hello' },
      { kind: 'exit', code: 0 },
    ]);
  });

  it('bridges stream events to appEventBus when a bus is provided', async () => {
    const { adapter, listeners } = createFakeAdapter();
    const bus = createAppEventBus();
    const service = createAgentRuntimeService(adapter, bus);
    const busEvents: Array<{ sessionId: string; event: AgentStreamEvent }> = [];
    bus.subscribe('agent:stream', (payload) => busEvents.push(payload));

    await service.onStream('s1', () => {});
    listeners.get('s1')?.({ kind: 'stdout', chunk: 'bridged' });

    expect(busEvents).toEqual([{ sessionId: 's1', event: { kind: 'stdout', chunk: 'bridged' } }]);
  });

  it('does not emit to the bus when none is provided', async () => {
    const { adapter, listeners } = createFakeAdapter();
    const service = createAgentRuntimeService(adapter);
    const directListener = vi.fn();

    await service.onStream('s1', directListener);
    listeners.get('s1')?.({ kind: 'stdout', chunk: 'x' });

    // No bus wired — only the direct listener fires, no throw.
    expect(directListener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cleanly', async () => {
    const { adapter, unsubscribed } = createFakeAdapter();
    const service = createAgentRuntimeService(adapter);

    const unsub = await service.onStream('s1', () => {});
    unsub();

    expect(unsubscribed.has('s1')).toBe(true);
  });
});
