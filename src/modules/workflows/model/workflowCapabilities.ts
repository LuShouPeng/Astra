import type { WorkflowNode } from '../../../core/contracts/workflows';

export interface WorkflowCapability {
  kind: 'mcp' | 'skill';
  id: string;
  name: string;
}

function validField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

export function parseCapabilityPayload(value: string): WorkflowCapability | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WorkflowCapability>;
    if (
      (parsed.kind !== 'mcp' && parsed.kind !== 'skill') ||
      !validId(parsed.id) ||
      !validField(parsed.name)
    )
      return null;
    return { kind: parsed.kind, id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

export function attachCapability(node: WorkflowNode, capability: WorkflowCapability): WorkflowNode {
  if (node.type !== 'agent') return node;
  if (capability.kind === 'skill') {
    return node.skillIds.includes(capability.id)
      ? node
      : { ...node, skillIds: [...node.skillIds, capability.id] };
  }
  return node.mcpServerIds.includes(capability.id)
    ? node
    : { ...node, mcpServerIds: [...node.mcpServerIds, capability.id] };
}
