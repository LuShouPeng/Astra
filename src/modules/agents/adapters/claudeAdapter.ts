import type { AgentLaunchConfig } from '../../../core/contracts/agents';
import type { SessionId } from '../../../core/contracts/sessions';

export interface AdapterInput {
  workingDirectory: string;
  prompt: string;
  sessionId: SessionId;
  mode?: 'new' | 'resume';
}

/**
 * Claude 适配器：组装启动参数。当前 provider 差异集中在后端 `provider_argv`
 * （`claude --print <prompt>`），前端适配器只负责声明 provider 与透传参数，
 * 为后续按 provider 加模型/flags 预留扩展点。
 */
export function buildClaudeLaunchConfig(input: AdapterInput): AgentLaunchConfig {
  return {
    provider: 'claude',
    workingDirectory: input.workingDirectory,
    prompt: input.prompt,
    sessionId: input.sessionId,
    ...(input.mode ? { mode: input.mode } : {}),
  };
}
