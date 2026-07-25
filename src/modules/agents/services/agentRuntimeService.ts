import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentLaunchConfig, AgentStreamEvent } from '../../../core/contracts/agents';
import type { SessionId } from '../../../core/contracts/sessions';
import type { AppEventBus } from '../../../core/events/appEventBus';

/** 取消一个流订阅。 */
export type StreamUnsubscribe = () => void;

/** 流事件回调。 */
export type StreamListener = (event: AgentStreamEvent) => void;

/**
 * Native 层抽象：封装 Tauri 的 invoke / listen。测试注入 fake 实现，避免
 * 依赖真实 IPC。
 */
export interface AgentRuntimeNativeAdapter {
  start(config: AgentLaunchConfig): Promise<void>;
  sendInput(sessionId: SessionId, text: string): Promise<void>;
  stop(sessionId: SessionId): Promise<void>;
  listRunning(): Promise<SessionId[]>;
  /** 订阅某个 session 的流通道，返回取消函数。 */
  onStream(sessionId: SessionId, listener: StreamListener): Promise<StreamUnsubscribe>;
}

export interface AgentRuntimeService {
  start(config: AgentLaunchConfig): Promise<void>;
  sendInput(sessionId: SessionId, text: string): Promise<void>;
  stop(sessionId: SessionId): Promise<void>;
  listRunning(): Promise<SessionId[]>;
  onStream(sessionId: SessionId, listener: StreamListener): Promise<StreamUnsubscribe>;
}

export class AgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

/**
 * 生产实现：invoke 四个后端命令；onStream 用 `listen()` 订阅
 * `agent://stream/{sessionId}`。这是 dev doc 标记的头号 🔴 风险点——后端
 * `app.emit` 走 `@tauri-apps/api/event`，必须在此桥接，否则前端收不到真实输出。
 */
export class TauriAgentRuntimeAdapter implements AgentRuntimeNativeAdapter {
  start(config: AgentLaunchConfig): Promise<void> {
    return invoke<void>('agent_start', { config });
  }

  sendInput(sessionId: SessionId, text: string): Promise<void> {
    return invoke<void>('agent_send_input', { sessionId, text });
  }

  stop(sessionId: SessionId): Promise<void> {
    return invoke<void>('agent_stop', { sessionId });
  }

  listRunning(): Promise<SessionId[]> {
    return invoke<SessionId[]>('agent_list_running');
  }

  async onStream(sessionId: SessionId, listener: StreamListener): Promise<StreamUnsubscribe> {
    const channel = `agent://stream/${sessionId}`;
    const unlisten = await listen<AgentStreamEvent>(channel, (payload) => {
      listener(payload.payload);
    });
    return unlisten;
  }
}

/**
 * 创建运行时服务。若传入 `eventBus`，每个 `onStream` 订阅会同时把事件桥接到
 * `appEventBus` 的 `agent:stream`，供 Timeline 等既有内存总线的消费方接收
 * （M5 会在此基础上追加 TimelineEvent）。
 */
export function createAgentRuntimeService(
  adapter: AgentRuntimeNativeAdapter,
  eventBus?: AppEventBus,
): AgentRuntimeService {
  return {
    start(config) {
      return adapter.start(config);
    },
    sendInput(sessionId, text) {
      return adapter.sendInput(sessionId, text);
    },
    stop(sessionId) {
      return adapter.stop(sessionId);
    },
    listRunning() {
      return adapter.listRunning();
    },
    onStream(sessionId, listener) {
      return adapter.onStream(sessionId, (event) => {
        listener(event);
        eventBus?.emit('agent:stream', { sessionId, event });
      });
    },
  };
}

/** 默认单例：生产环境用真实 Tauri adapter，桥接到全局 appEventBus。 */
export function createDefaultAgentRuntimeService(eventBus?: AppEventBus): AgentRuntimeService {
  return createAgentRuntimeService(new TauriAgentRuntimeAdapter(), eventBus);
}
