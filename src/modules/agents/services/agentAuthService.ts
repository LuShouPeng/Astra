import { invoke } from '@tauri-apps/api/core';
import type { AgentProvider } from '../../../core/contracts/agents';

export interface AgentAuthService {
  openLogin(provider: AgentProvider): Promise<void>;
}

export class TauriAgentAuthService implements AgentAuthService {
  openLogin(provider: AgentProvider): Promise<void> {
    return invoke<void>('agent_open_login', { provider });
  }
}

export const defaultAgentAuthService: AgentAuthService = new TauriAgentAuthService();
