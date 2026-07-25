import type { AgentLaunchConfig, AgentProvider } from '../../../core/contracts/agents';
import { buildClaudeLaunchConfig, type AdapterInput } from './claudeAdapter';
import { buildCodexLaunchConfig } from './codexAdapter';
import { buildGeminiLaunchConfig } from './geminiAdapter';

export type { AdapterInput };

/**
 * 统一适配器入口：按 provider 分发到具体适配器，组装 `AgentLaunchConfig`。
 * 这是「适配器」在前端的落点——调用方只需给 provider + 输入，无需知道各
 * CLI 的参数差异。
 */
export function buildLaunchConfig(
  provider: AgentProvider,
  input: AdapterInput,
): AgentLaunchConfig {
  switch (provider) {
    case 'claude':
      return buildClaudeLaunchConfig(input);
    case 'codex':
      return buildCodexLaunchConfig(input);
    case 'gemini':
      return buildGeminiLaunchConfig(input);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported agent provider: ${String(exhaustive)}`);
    }
  }
}
