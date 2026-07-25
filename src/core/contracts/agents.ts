export type AgentProvider = 'claude' | 'codex';

export interface ProviderCapability {
  provider: AgentProvider;
  label: string;
  runtimeAvailable: boolean;
  displayOnly: boolean;
}
