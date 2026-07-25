import type { WorkflowDefinition } from '../../../core/contracts/workflows';

export type RuntimeProvider = 'claude' | 'codex';
export type AgentRole = 'planning' | 'implementation' | 'testing' | 'review';

export interface ProviderAvailability {
  provider: RuntimeProvider;
  available: boolean;
}

export function routeProvider(
  role: AgentRole,
  providers: readonly ProviderAvailability[],
): RuntimeProvider | undefined {
  const preferred: RuntimeProvider = role === 'planning' || role === 'review' ? 'claude' : 'codex';
  const fallback: RuntimeProvider = preferred === 'claude' ? 'codex' : 'claude';
  if (providers.some((item) => item.provider === preferred && item.available)) return preferred;
  if (providers.some((item) => item.provider === fallback && item.available)) return fallback;
  return undefined;
}

function inferRole(name: string, prompt: string): AgentRole {
  const value = `${name} ${prompt}`.toLowerCase();
  if (/\b(plan|research|architect|design)\b/.test(value)) return 'planning';
  if (/\b(review|audit|inspect)\b/.test(value)) return 'review';
  if (/\b(test|verify|validation|qa)\b/.test(value)) return 'testing';
  return 'implementation';
}

export function routeWorkflowProviders(
  workflow: WorkflowDefinition,
  providers: readonly ProviderAvailability[],
): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.type !== 'agent' || node.provider !== 'auto') return node;
      const provider = routeProvider(inferRole(node.name, node.prompt), providers);
      return provider ? { ...node, provider } : node;
    }),
  };
}
