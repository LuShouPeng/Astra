import type { AgentLaunchConfig } from '../../../core/contracts/agents';
import type { AdapterInput } from './claudeAdapter';

/**
 * Codex 适配器：组装启动参数（后端 `codex exec <prompt>`）。
 */
export function buildCodexLaunchConfig(input: AdapterInput): AgentLaunchConfig {
  return {
    provider: 'codex',
    workingDirectory: input.workingDirectory,
    prompt: input.prompt,
    sessionId: input.sessionId,
  };
}
