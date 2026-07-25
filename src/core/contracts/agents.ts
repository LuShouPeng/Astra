import type { SessionId } from './sessions';

export type AgentProvider = 'claude' | 'codex' | 'gemini';

export interface ProviderCapability {
  provider: AgentProvider;
  label: string;
  runtimeAvailable: boolean;
  displayOnly: boolean;
  /** 探测到的 CLI 版本（能力发现填充，M2）。 */
  version?: string;
  /** 解析到的可执行文件绝对路径（能力发现填充，M2）。 */
  executablePath?: string;
  /** 最近一次能力探测的 ISO 时间戳。 */
  discoveredAt?: string;
}

/** 启动一次真实 Agent 运行所需的参数（前端 → 后端 IPC）。 */
export interface AgentLaunchConfig {
  provider: AgentProvider;
  /** 必须是已注册的本地项目根，后端经 safe_directory 校验。 */
  workingDirectory: string;
  prompt: string;
  sessionId: SessionId;
  /** Provider-native continuation of the most recent session in this working directory. */
  mode?: 'new' | 'resume';
}

/** 后端子进程流式事件（经 `agent://stream/{sessionId}` 推送）。 */
export type AgentStreamEvent =
  | { kind: 'stdout'; chunk: string }
  | { kind: 'stderr'; chunk: string }
  | { kind: 'exit'; code: number | null };
