export type AgentProvider = 'claude' | 'codex' | 'gemini';

export interface ProviderCapability {
  provider: AgentProvider;
  label: string;
  runtimeAvailable: boolean;
  displayOnly: boolean;
}
