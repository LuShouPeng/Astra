import { invoke } from '@tauri-apps/api/core';
import type { AgentStreamEvent } from '../../../core/contracts/agents';
import type { SessionId } from '../../../core/contracts/sessions';

/** 一条持久化的会话日志记录（后端 `session_log_read` 返回结构）。 */
export interface SessionLogEntry {
  /** 毫秒时间戳，后端以字符串序列化（避免 u128 精度丢失）。 */
  timestampMs: string;
  event: AgentStreamEvent;
}

/**
 * 会话日志持久化抽象：封装后端 `session_log_*` 命令。测试注入 fake 实现，
 * 无需真实 IPC。高频 stdout 落此日志，不进 workbench 快照（持久化拆分）。
 */
export interface SessionPersistence {
  /** 追加一条流事件到 `~/.astra/sessions/{id}.log`。 */
  logAppend(sessionId: SessionId, event: AgentStreamEvent): Promise<void>;
  /** 读取会话日志（分页，oldest first），用于 resume / 诊断。 */
  logRead(sessionId: SessionId, offset?: number, limit?: number): Promise<SessionLogEntry[]>;
}

/** 生产实现：invoke 后端命令。 */
export class TauriSessionPersistence implements SessionPersistence {
  logAppend(sessionId: SessionId, event: AgentStreamEvent): Promise<void> {
    return invoke<void>('session_log_append', { sessionId, event });
  }

  logRead(sessionId: SessionId, offset?: number, limit?: number): Promise<SessionLogEntry[]> {
    return invoke<SessionLogEntry[]>('session_log_read', { sessionId, offset, limit });
  }
}
