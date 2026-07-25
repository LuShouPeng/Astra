import type { McpServerConfig } from '../../../core/contracts/extensions';

export interface RuntimeMcpConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable_http';
  command?: string;
  args: string[];
  url?: string;
  secretRef?: string;
  secretHeader?: string;
  enabled: boolean;
}

export function fromRuntimeMcp(item: RuntimeMcpConfig): McpServerConfig {
  return {
    id: item.id,
    name: item.name,
    transport: item.transport,
    command: item.command,
    args: item.args,
    url: item.url,
    secretRefs: item.secretRef ? { [item.secretHeader || 'authorization']: item.secretRef } : {},
    enabled: item.enabled,
    source: 'manual',
  };
}
