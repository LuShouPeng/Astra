export type McpTransport = 'stdio' | 'streamable_http';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  secretRefs: Record<string, string>;
  enabled: boolean;
  source: 'catalog' | 'manual';
}

export interface SkillPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  source: 'catalog' | 'git' | 'local';
  sourceUrl?: string;
  sourceRevision?: string;
  contentHash: string;
  installPath: string;
  installedAt: string;
}
