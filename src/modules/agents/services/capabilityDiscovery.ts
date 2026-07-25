import { invoke } from '@tauri-apps/api/core';
import type { AgentProvider, ProviderCapability } from '../../../core/contracts/agents';

/** 探测结果：部分 provider 可能缺失，故用 Partial。 */
export type DiscoveredCapabilities = Partial<Record<AgentProvider, ProviderCapability>>;

/**
 * 调用后端探测本机 Agent CLI 能力。附加 `discoveredAt` 时间戳。
 * 后端失败时抛出，由调用方（WorkbenchContext）降级为保留现有值。
 */
export async function discoverCapabilities(): Promise<DiscoveredCapabilities> {
  const raw = await invoke<Record<string, ProviderCapability>>('discover_agent_capabilities');
  const discoveredAt = new Date().toISOString();
  const result: DiscoveredCapabilities = {};
  for (const [provider, capability] of Object.entries(raw)) {
    result[provider as AgentProvider] = { ...capability, discoveredAt };
  }
  return result;
}
