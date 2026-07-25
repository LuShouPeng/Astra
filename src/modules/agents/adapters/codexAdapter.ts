import type { AgentLaunchConfig } from '../../../core/contracts/agents';
import type { AdapterInput } from './claudeAdapter';

/**
 * Codex adapter. Resume maps to `codex exec resume --last <prompt>` in the backend.
 */
export function buildCodexLaunchConfig(input: AdapterInput): AgentLaunchConfig {
  return {
    provider: 'codex',
    workingDirectory: input.workingDirectory,
    prompt: input.prompt,
    sessionId: input.sessionId,
    ...(input.mode ? { mode: input.mode } : {}),
  };
}
