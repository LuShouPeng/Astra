import type { AgentProvider, AgentStreamEvent } from '../../../core/contracts/agents';
import type { Project } from '../../../core/contracts/projects';
import type {
  AgentSession,
  SessionId,
  SessionStatus,
  TimelineEvent,
} from '../../../core/contracts/sessions';
import type { AgentRuntimeService, StreamUnsubscribe } from '../../agents';
import { buildLaunchConfig } from '../../agents';
import type { SessionPersistence } from '../adapters/sessionPersistenceAdapter';

/** stdout 合并 buffer 的上限，超过即强制 flush，避免超长无换行输出撑爆内存 [C1]。 */
export const STDOUT_BUFFER_CAP_BYTES = 64 * 1024;
/** stdout 静默多久后把累积的行合并成一条 agent_message 事件 [500ms 决策]。 */
export const STDOUT_FLUSH_INTERVAL_MS = 500;
/** exit 失败时，从环形缓冲取末尾多少行 stderr 拼入 StatusEvent [C4]。 */
export const STDERR_TAIL_LINES = 10;

export class LiveSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSessionError';
  }
}

/**
 * 单条会话更新。React 层据此更新快照；`persist` 由 service 决定：
 * 关键节点（创建 / 状态变更 / 用户消息）落盘，高频 stdout 合并事件仅更新内存。
 */
export type LiveSessionUpdate =
  | { kind: 'session-created'; session: AgentSession }
  | { kind: 'timeline-event'; event: TimelineEvent }
  | {
      kind: 'session-status';
      sessionId: SessionId;
      status: SessionStatus;
      currentAction?: string;
      completedAt?: string;
    };

/** 快照写入抽象：`persist=true` 立即落盘（关键节点），否则仅更新内存。 */
export interface LiveSessionSink {
  apply(update: LiveSessionUpdate, options: { persist: boolean }): void;
}

export interface LiveSessionDeps {
  agentRuntime: AgentRuntimeService;
  persistence: SessionPersistence;
  sink: LiveSessionSink;
  /** 生成唯一 sessionId，默认 crypto.randomUUID。 */
  generateId?: () => SessionId;
  /** 当前 ISO 时间，默认 new Date().toISOString()。测试可注入固定值。 */
  now?: () => string;
  /** 合并静默间隔，默认 500ms。 */
  flushIntervalMs?: number;
}

interface StreamState {
  unsubscribe: StreamUnsubscribe;
  /** 待合并的 stdout 行（尚未 flush 成 agent_message）。 */
  buffer: string[];
  bufferBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** 末尾 stderr 环形缓冲，供 exit 失败时诊断 [C4]。 */
  stderrTail: string[];
  /** 已产出的 agent_message 序号，用于生成事件 id。 */
  messageSeq: number;
  /** 用户后续消息序号，用于生成事件 id（初始提示为 1，后续从 2 起）。 */
  followUpSeq: number;
  provider: AgentProvider;
  /** 绑定的工作目录，用于冲突检测 [C3]。 */
  workingDirectory: string;
}

export interface LiveSessionService {
  createLiveSession(project: Project, provider: AgentProvider, prompt: string): Promise<SessionId>;
  /** 向运行中的 live 会话进程发送后续输入，并把用户消息追加到 Timeline。 */
  sendFollowUp(sessionId: SessionId, text: string): Promise<void>;
  stopLiveSession(sessionId: SessionId): Promise<void>;
  resumeLiveSession(sessionId: SessionId): Promise<never>;
  /** 释放所有订阅与计时器（组件卸载时调用）。 */
  dispose(): void;
}

function byteLength(text: string): number {
  // 近似 UTF-8 字节数；TextEncoder 在测试与浏览器均可用。
  return new TextEncoder().encode(text).length;
}

export function createLiveSessionService(deps: LiveSessionDeps): LiveSessionService {
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const flushIntervalMs = deps.flushIntervalMs ?? STDOUT_FLUSH_INTERVAL_MS;
  const streams = new Map<SessionId, StreamState>();

  /** 把缓冲的 stdout 行合并成一条 agent_message 更新（仅内存，不落盘）。 */
  function flushBuffer(sessionId: SessionId): void {
    const state = streams.get(sessionId);
    if (!state) return;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (state.buffer.length === 0) return;
    const content = state.buffer.join('');
    state.buffer = [];
    state.bufferBytes = 0;
    state.messageSeq += 1;
    const event: TimelineEvent = {
      id: `event-${sessionId}-agent-${state.messageSeq}`,
      sessionId,
      type: 'agent_message',
      timestamp: now(),
      content,
    };
    // 高频输出：仅更新内存，不触发 saveSnapshot（关键节点才落盘）。
    deps.sink.apply({ kind: 'timeline-event', event }, { persist: false });
  }

  function handleStreamEvent(sessionId: SessionId, event: AgentStreamEvent): void {
    const state = streams.get(sessionId);
    if (!state) return;

    // 所有事件都落日志（持久化拆分：完整流进日志文件，不进快照）。
    void deps.persistence.logAppend(sessionId, event).catch(() => {
      /* 落盘失败不阻断 UI；残留局限见 M5-known-limitations 8.1 */
    });

    switch (event.kind) {
      case 'stdout': {
        state.buffer.push(event.chunk);
        state.bufferBytes += byteLength(event.chunk);
        if (state.bufferBytes >= STDOUT_BUFFER_CAP_BYTES) {
          flushBuffer(sessionId); // [C1] 超上限强制 flush，防 OOM
          return;
        }
        if (!state.flushTimer) {
          state.flushTimer = setTimeout(() => flushBuffer(sessionId), flushIntervalMs);
        }
        return;
      }
      case 'stderr': {
        // 只落日志、不进 Timeline；保留末尾若干行供 exit 失败时诊断 [C4]。
        state.stderrTail.push(event.chunk);
        if (state.stderrTail.length > STDERR_TAIL_LINES) state.stderrTail.shift();
        return;
      }
      case 'exit': {
        flushBuffer(sessionId); // 退出前把残留 stdout 合并出来
        const failed = event.code !== 0 && event.code !== null;
        const target: SessionStatus = failed ? 'failed' : 'completed';
        const timestamp = now();
        let content = failed
          ? `进程异常退出 (code ${event.code})。`
          : '进程已正常结束。';
        if (failed && state.stderrTail.length > 0) {
          content += `\n${state.stderrTail.join('')}`;
        }
        const statusEvent: TimelineEvent = {
          id: `event-${sessionId}-exit-${state.messageSeq + 1}`,
          sessionId,
          type: 'status',
          timestamp,
          from: 'running',
          to: target,
          content,
        };
        // exit 是关键节点：状态 + 事件都落盘。
        deps.sink.apply({ kind: 'timeline-event', event: statusEvent }, { persist: true });
        deps.sink.apply(
          { kind: 'session-status', sessionId, status: target, completedAt: timestamp },
          { persist: true },
        );
        teardownStream(sessionId);
        return;
      }
    }
  }

  function teardownStream(sessionId: SessionId): void {
    const state = streams.get(sessionId);
    if (!state) return;
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.unsubscribe();
    streams.delete(sessionId);
  }

  return {
    async createLiveSession(project, provider, prompt) {
      if (project.source !== 'local') {
        throw new LiveSessionError('只能在本地项目上启动真实会话。');
      }
      if (project.status !== 'available') {
        throw new LiveSessionError('该项目目录不可用。');
      }
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new LiveSessionError('请输入启动 Agent 的提示词。');
      }
      // [C3] 工作目录冲突检测：同目录已有运行中的 live 会话则拒绝，避免两个
      // Agent 并发改同一目录造成脏数据。以后端 registry 的 running 列表为准
      // （跨刷新可靠），再匹配本地追踪的 workingDirectory。
      const running = new Set(await deps.agentRuntime.listRunning());
      const conflict = [...streams.entries()].some(
        ([id, state]) => running.has(id) && state.workingDirectory === project.rootPath,
      );
      if (conflict) {
        throw new LiveSessionError('该项目已有运行中的会话，请先停止后再启动。');
      }

      const sessionId = generateId();
      const timestamp = now();
      const session: AgentSession = {
        id: sessionId,
        projectId: project.id,
        provider,
        title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed,
        status: 'running',
        currentAction: '启动 Agent 进程',
        startedAt: timestamp,
        updatedAt: timestamp,
        changedFilesCount: 0,
        testStatus: 'not_run',
        unread: false,
        origin: 'live',
        runtimeProcessId: sessionId,
        workingDirectory: project.rootPath,
      };
      // 创建是关键节点：立即落盘。
      deps.sink.apply({ kind: 'session-created', session }, { persist: true });
      // 记录初始用户提示到 Timeline（关键节点）。
      deps.sink.apply(
        {
          kind: 'timeline-event',
          event: {
            id: `event-${sessionId}-user-1`,
            sessionId,
            type: 'user_message',
            timestamp,
            content: trimmed,
          },
        },
        { persist: true },
      );

      const unsubscribe = await deps.agentRuntime.onStream(sessionId, (event) =>
        handleStreamEvent(sessionId, event),
      );
      streams.set(sessionId, {
        unsubscribe,
        buffer: [],
        bufferBytes: 0,
        flushTimer: null,
        stderrTail: [],
        messageSeq: 0,
        followUpSeq: 1,
        provider,
        workingDirectory: project.rootPath,
      });

      const config = buildLaunchConfig(provider, {
        workingDirectory: project.rootPath,
        prompt: trimmed,
        sessionId,
      });
      try {
        await deps.agentRuntime.start(config);
      } catch (error) {
        teardownStream(sessionId);
        deps.sink.apply(
          { kind: 'session-status', sessionId, status: 'failed', completedAt: now() },
          { persist: true },
        );
        throw new LiveSessionError(
          error instanceof Error ? error.message : '启动 Agent 进程失败。',
        );
      }
      return sessionId;
    },

    async sendFollowUp(sessionId, text) {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new LiveSessionError('请输入要发送的消息。');
      }
      const state = streams.get(sessionId);
      if (!state) {
        throw new LiveSessionError('会话进程已结束，无法发送消息。');
      }
      try {
        await deps.agentRuntime.sendInput(sessionId, trimmed);
      } catch (error) {
        throw new LiveSessionError(
          error instanceof Error ? error.message : '发送消息到 Agent 进程失败。',
        );
      }
      state.followUpSeq += 1;
      // 用户后续消息是关键节点：落盘。
      deps.sink.apply(
        {
          kind: 'timeline-event',
          event: {
            id: `event-${sessionId}-user-${state.followUpSeq}`,
            sessionId,
            type: 'user_message',
            timestamp: now(),
            content: trimmed,
          },
        },
        { persist: true },
      );
    },

    async stopLiveSession(sessionId) {
      try {
        await deps.agentRuntime.stop(sessionId);
      } catch (error) {
        throw new LiveSessionError(
          error instanceof Error ? error.message : '停止 Agent 进程失败。',
        );
      } finally {
        flushBuffer(sessionId);
        teardownStream(sessionId);
      }
      const timestamp = now();
      deps.sink.apply(
        { kind: 'session-status', sessionId, status: 'stopped', completedAt: timestamp },
        { persist: true },
      );
    },

    resumeLiveSession() {
      // M5 暂不支持真实 resume（见 M5-known-limitations 2.x），M7 补齐。
      return Promise.reject(
        new LiveSessionError('恢复执行功能开发中（计划于 M7 支持），可查看历史日志。'),
      );
    },

    dispose() {
      for (const sessionId of [...streams.keys()]) {
        teardownStream(sessionId);
      }
    },
  };
}
