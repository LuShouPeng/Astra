import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLaunchConfig, AgentStreamEvent } from '../../../core/contracts/agents';
import type { Project } from '../../../core/contracts/projects';
import type { AgentSession, SessionId } from '../../../core/contracts/sessions';
import type { StreamListener } from '../../agents';
import type { SessionPersistence } from '../adapters/sessionPersistenceAdapter';
import {
  createLiveSessionService,
  LiveSessionError,
  type LiveSessionSink,
  type LiveSessionUpdate,
  STDOUT_BUFFER_CAP_BYTES,
} from './liveSessionService';

function localProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Demo',
    rootPath: '/repo/demo',
    normalizedPath: '/repo/demo',
    source: 'local',
    status: 'available',
    gitRepository: true,
    gitStatus: 'clean',
    createdAt: '2026-07-25T00:00:00.000Z',
    lastActivityAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

interface Harness {
  service: ReturnType<typeof createLiveSessionService>;
  updates: Array<{ update: LiveSessionUpdate; persist: boolean }>;
  emit: (sessionId: SessionId, event: AgentStreamEvent) => void;
  logAppend: ReturnType<typeof vi.fn>;
  logRead: ReturnType<typeof vi.fn>;
  runtime: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendInput: ReturnType<typeof vi.fn>;
    listRunning: ReturnType<typeof vi.fn>;
    onStream: ReturnType<typeof vi.fn>;
  };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function makeHarness(options: { running?: SessionId[] } = {}): Harness {
  const updates: Harness['updates'] = [];
  const sink: LiveSessionSink = {
    apply(update, { persist }) {
      updates.push({ update, persist });
    },
  };
  const listeners = new Map<SessionId, StreamListener>();
  const unsubscribe = vi.fn();
  const logAppend = vi.fn().mockResolvedValue(undefined);
  const logRead = vi.fn().mockResolvedValue([]);

  const runtime = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(undefined),
    listRunning: vi.fn().mockResolvedValue(options.running ?? []),
    onStream: vi.fn(async (sessionId: SessionId, listener: StreamListener) => {
      listeners.set(sessionId, listener);
      return unsubscribe;
    }),
  };

  const persistence: SessionPersistence = {
    logAppend,
    logRead,
  };

  let counter = 0;
  const service = createLiveSessionService({
    agentRuntime: runtime,
    persistence,
    sink,
    generateId: () => `sess-${++counter}`,
    now: () => '2026-07-25T12:00:00.000Z',
    flushIntervalMs: 500,
  });

  return {
    service,
    updates,
    emit: (sessionId, event) => listeners.get(sessionId)?.(event),
    logAppend,
    logRead,
    runtime,
    unsubscribe,
  };
}

const startedConfigs = (runtimeStart: ReturnType<typeof vi.fn>): AgentLaunchConfig[] =>
  (runtimeStart.mock.calls as Array<[AgentLaunchConfig]>).map((call) => call[0]);

function resumableSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'sess-resume',
    projectId: 'project-1',
    provider: 'codex',
    title: 'Continue implementation',
    status: 'stopped',
    startedAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T11:00:00.000Z',
    completedAt: '2026-07-25T11:00:00.000Z',
    changedFilesCount: 0,
    testStatus: 'not_run',
    unread: false,
    origin: 'live',
    runtimeProcessId: 'sess-resume',
    workingDirectory: '/repo/demo',
    ...overrides,
  };
}

describe('createLiveSession', () => {
  beforeEach(() => vi.useRealTimers());

  it('creates a live session, persists it, and starts the process', async () => {
    const h = makeHarness();
    const id = await h.service.createLiveSession(localProject(), 'claude', '  Build a feature  ');

    expect(id).toBe('sess-1');
    const created = h.updates.find((u) => u.update.kind === 'session-created');
    expect(created?.persist).toBe(true);
    expect(created?.update).toMatchObject({
      session: {
        id: 'sess-1',
        origin: 'live',
        status: 'running',
        provider: 'claude',
        runtimeProcessId: 'sess-1',
        workingDirectory: '/repo/demo',
      },
    });
    // 初始用户消息落盘
    const userMsg = h.updates.find(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'user_message',
    );
    expect(userMsg?.persist).toBe(true);
    expect(startedConfigs(h.runtime.start)[0]).toMatchObject({
      provider: 'claude',
      prompt: 'Build a feature',
      sessionId: 'sess-1',
    });
  });

  it('rejects non-local projects, missing dirs, and blank prompts', async () => {
    const h = makeHarness();
    await expect(
      h.service.createLiveSession(localProject({ source: 'demo' }), 'claude', 'x'),
    ).rejects.toThrow(LiveSessionError);
    await expect(
      h.service.createLiveSession(localProject({ status: 'missing' }), 'claude', 'x'),
    ).rejects.toThrow('不可用');
    await expect(h.service.createLiveSession(localProject(), 'claude', '   ')).rejects.toThrow(
      '提示词',
    );
    expect(h.runtime.start).not.toHaveBeenCalled();
  });

  it('[C3] rejects a second session on the same working directory while one runs', async () => {
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'first');
    // 后端汇报该 session 仍在运行
    h.runtime.listRunning.mockResolvedValue(['sess-1']);

    await expect(h.service.createLiveSession(localProject(), 'codex', 'second')).rejects.toThrow(
      '已有运行中的会话',
    );
    // 不同目录不冲突
    h.runtime.listRunning.mockResolvedValue(['sess-1']);
    await expect(
      h.service.createLiveSession(localProject({ rootPath: '/repo/other' }), 'codex', 'ok'),
    ).resolves.toBe('sess-2');
  });

  it('marks the session failed and tears down when start throws', async () => {
    const h = makeHarness();
    h.runtime.start.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(h.service.createLiveSession(localProject(), 'claude', 'x')).rejects.toThrow(
      'spawn failed',
    );
    const failed = h.updates.find(
      (u) => u.update.kind === 'session-status' && u.update.status === 'failed',
    );
    expect(failed?.persist).toBe(true);
    expect(h.unsubscribe).toHaveBeenCalled();
  });
});

describe('stream handling', () => {
  beforeEach(() => vi.useFakeTimers());

  it('coalesces stdout lines into one agent_message after the flush interval', async () => {
    vi.useRealTimers();
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');
    vi.useFakeTimers();

    h.emit('sess-1', { kind: 'stdout', chunk: 'line one\n' });
    h.emit('sess-1', { kind: 'stdout', chunk: 'line two\n' });
    // flush 前无 agent_message
    expect(
      h.updates.some(
        (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'agent_message',
      ),
    ).toBe(false);

    vi.advanceTimersByTime(500);
    const msg = h.updates.find(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'agent_message',
    );
    expect(msg?.persist).toBe(false); // 高频输出仅内存
    expect(msg?.update).toMatchObject({ event: { content: 'line one\nline two\n' } });
    // 每条流事件都落日志
    expect(h.logAppend).toHaveBeenCalledTimes(2);
  });

  it('[C1] force-flushes when the buffer exceeds the cap, without waiting', async () => {
    vi.useRealTimers();
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');

    const huge = 'x'.repeat(STDOUT_BUFFER_CAP_BYTES + 10);
    h.emit('sess-1', { kind: 'stdout', chunk: huge });
    // 未推进计时器就已 flush
    const msg = h.updates.find(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'agent_message',
    );
    expect(msg).toBeDefined();
    expect(msg?.persist).toBe(false);
  });

  it('emits a completed status on exit code 0 and persists it', async () => {
    vi.useRealTimers();
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');

    h.emit('sess-1', { kind: 'stdout', chunk: 'done\n' });
    h.emit('sess-1', { kind: 'exit', code: 0 });

    const status = h.updates.find(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'status',
    );
    expect(status?.persist).toBe(true);
    expect(status?.update).toMatchObject({ event: { to: 'completed' } });
    const sessionStatus = h.updates.find((u) => u.update.kind === 'session-status');
    expect(sessionStatus?.update).toMatchObject({ status: 'completed' });
    expect(h.unsubscribe).toHaveBeenCalled();
  });

  it('[C4] injects tail stderr into the status content on non-zero exit', async () => {
    vi.useRealTimers();
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');

    h.emit('sess-1', { kind: 'stderr', chunk: 'Error: file not found\n' });
    h.emit('sess-1', { kind: 'exit', code: 1 });

    const status = h.updates.find(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'status',
    );
    expect(status?.update).toMatchObject({ event: { to: 'failed' } });
    expect(
      status?.update.kind === 'timeline-event' &&
        status.update.event.type === 'status' &&
        status.update.event.content,
    ).toContain('file not found');
    // stderr 不产生独立 Timeline 事件
    const stderrEvents = h.updates.filter(
      (u) => u.update.kind === 'timeline-event' && u.update.event.type === 'agent_message',
    );
    expect(stderrEvents).toHaveLength(0);
  });
});

describe('stopLiveSession / resume / dispose', () => {
  it('stops the process and persists a stopped status', async () => {
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');
    await h.service.stopLiveSession('sess-1');

    expect(h.runtime.stop).toHaveBeenCalledWith('sess-1');
    const stopped = h.updates.find(
      (u) => u.update.kind === 'session-status' && u.update.status === 'stopped',
    );
    expect(stopped?.persist).toBe(true);
    expect(h.unsubscribe).toHaveBeenCalled();
  });

  it('sendFollowUp forwards input to the process and persists a user_message', async () => {
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');
    const before = h.updates.length;

    await h.service.sendFollowUp('sess-1', '  keep going  ');

    expect(h.runtime.sendInput).toHaveBeenCalledWith('sess-1', 'keep going');
    const followUp = h.updates
      .slice(before)
      .find((u) => u.update.kind === 'timeline-event' && u.update.event.type === 'user_message');
    expect(followUp?.persist).toBe(true);
    expect(followUp?.update).toMatchObject({
      event: { id: 'event-sess-1-user-2', content: 'keep going' },
    });
  });

  it('sendFollowUp rejects blank text and unknown sessions without calling the runtime', async () => {
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');

    await expect(h.service.sendFollowUp('sess-1', '   ')).rejects.toThrow('请输入');
    await expect(h.service.sendFollowUp('sess-unknown', 'hi')).rejects.toThrow('会话进程已结束');
    expect(h.runtime.sendInput).not.toHaveBeenCalled();
  });

  it('resumes Codex from durable history using provider-native resume mode', async () => {
    const h = makeHarness();
    h.logRead.mockResolvedValue([
      { timestampMs: '1', event: { kind: 'stdout', chunk: 'Last completed step' } },
    ]);

    await h.service.resumeLiveSession(resumableSession());

    expect(h.logRead).toHaveBeenCalledWith('sess-resume', undefined, 200);
    const config = startedConfigs(h.runtime.start)[0];
    expect(config).toMatchObject({
      provider: 'codex',
      workingDirectory: '/repo/demo',
      sessionId: 'sess-resume',
      mode: 'resume',
    });
    expect(config.prompt).toContain('Last completed step');
    const runningUpdate = h.updates.find(
      (item) => item.update.kind === 'session-status' && item.update.status === 'running',
    );
    expect(runningUpdate?.persist).toBe(true);
    expect(runningUpdate?.update).toMatchObject({
      kind: 'session-status',
      sessionId: 'sess-resume',
      clearCompletedAt: true,
    });
  });

  it('rejects resume for demo, active, and non-Codex sessions', async () => {
    const h = makeHarness();
    await expect(h.service.resumeLiveSession(resumableSession({ origin: 'demo' }))).rejects.toThrow(
      '真实会话',
    );
    await expect(
      h.service.resumeLiveSession(resumableSession({ provider: 'claude' })),
    ).rejects.toThrow('仅 Codex');
    await expect(
      h.service.resumeLiveSession(resumableSession({ status: 'running' })),
    ).rejects.toThrow('仍在运行');
    expect(h.runtime.start).not.toHaveBeenCalled();
  });

  it('marks a failed Codex resume and tears down its stream', async () => {
    const h = makeHarness();
    h.runtime.start.mockRejectedValueOnce(new Error('resume failed'));
    await expect(h.service.resumeLiveSession(resumableSession())).rejects.toThrow('resume failed');
    expect(h.unsubscribe).toHaveBeenCalled();
    expect(
      h.updates.some(
        (item) => item.update.kind === 'session-status' && item.update.status === 'failed',
      ),
    ).toBe(true);
  });

  it('dispose tears down all active streams', async () => {
    const h = makeHarness();
    await h.service.createLiveSession(localProject(), 'claude', 'go');
    h.service.dispose();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
