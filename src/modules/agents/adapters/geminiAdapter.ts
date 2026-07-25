import type { AgentLaunchConfig } from '../../../core/contracts/agents';
import type { AdapterInput } from './claudeAdapter';

/**
 * Gemini 适配器：组装启动参数（后端 `gemini --prompt <prompt>`）。
 */
export function buildGeminiLaunchConfig(input: AdapterInput): AgentLaunchConfig {
  return {
    provider: 'gemini',
    workingDirectory: input.workingDirectory,
    prompt: input.prompt,
    sessionId: input.sessionId,
    ...(input.mode ? { mode: input.mode } : {}),
  };
}
