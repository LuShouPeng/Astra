import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../../../core/contracts/agents';
import type { Project } from '../../../core/contracts/projects';
import type { SessionId } from '../../../core/contracts/sessions';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider, useWorkbench } from '../../../core/state/WorkbenchContext';
import type { AgentRuntimeService, StreamListener } from '../../agents';
import { createDemoSnapshot } from '../../demo';
import type { SessionPersistence } from '../adapters/sessionPersistenceAdapter';
import { LiveSessionProvider, useLiveSessions } from './LiveSessionContext';

function localProject(): Project {
  return {
    id: 'proj-live',
    name: 'Live Repo',
    rootPath: '/repo/live',
    normalizedPath: '/repo/live',
    source: 'local',
    status: 'available',
    gitRepository: true,
    gitStatus: 'clean',
    createdAt: '2026-07-25T00:00:00.000Z',
    lastActivityAt: '2026-07-25T00:00:00.000Z',
  };
}

function makeRuntime() {
  const listeners = new Map<SessionId, StreamListener>();
  const runtime: AgentRuntimeService = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(undefined),
    listRunning: vi.fn().mockResolvedValue([]),
    onStream: vi.fn(async (sessionId: SessionId, listener: StreamListener) => {
      listeners.set(sessionId, listener);
      return () => listeners.delete(sessionId);
    }),
  };
  const persistence: SessionPersistence = {
    logAppend: vi.fn().mockResolvedValue(undefined),
    logRead: vi.fn().mockResolvedValue([]),
  };
  const emit = (sessionId: SessionId, event: AgentStreamEvent) => listeners.get(sessionId)?.(event);
  return { runtime, persistence, emit };
}

describe('LiveSession integration (real WorkbenchProvider + sink)', () => {
  it('coalesces high-frequency stdout into snapshot summaries, not per-chunk events', async () => {
    const initial = createDemoSnapshot();
    const save = vi.fn(async () => undefined);
    const repository: PrototypeRepository = {
      load: vi.fn(async () => initial),
      save,
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const { runtime, persistence, emit } = makeRuntime();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkbenchProvider repository={repository}>
        <LiveSessionProvider agentRuntime={runtime} persistence={persistence}>
          {children}
        </LiveSessionProvider>
      </WorkbenchProvider>
    );
    const { result } = renderHook(
      () => ({ workbench: useWorkbench(), live: useLiveSessions() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.workbench.snapshot).not.toBeNull());
    const service = result.current.live!;
    expect(service).not.toBeNull();

    let sessionId = '';
    await act(async () => {
      sessionId = await service.createLiveSession(localProject(), 'claude', 'do the thing');
    });

    // 100 行 stdout —— 若逐块进快照会有 100 条 agent_message。
    await act(async () => {
      for (let i = 0; i < 100; i++) emit(sessionId, { kind: 'stdout', chunk: `line ${i}\n` });
      emit(sessionId, { kind: 'exit', code: 0 });
      await Promise.resolve();
    });

    await waitFor(() => {
      const events = result.current.workbench.snapshot!.timelineEvents.filter(
        (e) => e.sessionId === sessionId,
      );
      // 状态事件必须出现（exit → completed）。
      expect(events.some((e) => e.type === 'status')).toBe(true);
    });

    const events = result.current.workbench.snapshot!.timelineEvents.filter(
      (e) => e.sessionId === sessionId,
    );
    const agentMessages = events.filter((e) => e.type === 'agent_message');
    // 100 行合并成 1 条 agent_message（exit 前 flush），而非 100 条。
    expect(agentMessages).toHaveLength(1);
    expect((agentMessages[0] as { content: string }).content.split('\n').filter(Boolean)).toHaveLength(
      100,
    );

    // 会话作为 live 写入快照，状态收敛到 completed。
    const session = result.current.workbench.snapshot!.sessions.find((s) => s.id === sessionId);
    expect(session?.origin).toBe('live');
    expect(session?.status).toBe('completed');

    // 每条流事件都落了日志文件（持久化拆分：完整流进日志，摘要进快照）。
    expect(persistence.logAppend).toHaveBeenCalledTimes(101);

    // 落盘只发生在关键节点（created + user + exit status/session-status），
    // 不随 100 行 stdout 触发 —— 远小于流事件数。
    expect(save.mock.calls.length).toBeLessThan(10);
  });
});
