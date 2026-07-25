import type { WorkflowDefinition, WorkflowNode } from '../../../core/contracts/workflows';
import { validateWorkflow } from './workflowGraph';

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function baseNode(type: WorkflowNode['type'], name: string, x: number, y: number) {
  return { id: id(type), type, name, position: { x, y } };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function identifier(value: unknown): value is string {
  return boundedString(value, 128) && /^[A-Za-z0-9_.-]+$/.test(value);
}

function stringIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(identifier) &&
    new Set(value).size === value.length
  );
}

function validNode(value: unknown): value is WorkflowNode {
  if (!record(value) || !identifier(value.id) || !boundedString(value.name, 120)) return false;
  if (
    !record(value.position) ||
    typeof value.position.x !== 'number' ||
    !Number.isFinite(value.position.x) ||
    typeof value.position.y !== 'number' ||
    !Number.isFinite(value.position.y)
  ) {
    return false;
  }
  if (
    (value.timeoutSeconds !== undefined &&
      (typeof value.timeoutSeconds !== 'number' ||
        !Number.isInteger(value.timeoutSeconds) ||
        value.timeoutSeconds < 1)) ||
    (value.retries !== undefined &&
      (typeof value.retries !== 'number' ||
        !Number.isInteger(value.retries) ||
        value.retries < 0 ||
        value.retries > 3))
  ) {
    return false;
  }
  switch (value.type) {
    case 'agent':
      return (
        ['auto', 'claude', 'codex'].includes(String(value.provider)) &&
        boundedString(value.prompt, 32_768) &&
        stringIds(value.skillIds) &&
        stringIds(value.mcpServerIds)
      );
    case 'approval':
      return (
        ['low', 'medium', 'high'].includes(String(value.risk)) &&
        boundedString(value.instructions, 4096)
      );
    case 'condition':
      return boundedString(value.expression, 1024);
    case 'join':
      return value.strategy === 'all' || value.strategy === 'any';
    default:
      return false;
  }
}

function validEdge(value: unknown): boolean {
  return (
    record(value) &&
    identifier(value.id) &&
    identifier(value.source) &&
    identifier(value.target) &&
    (value.outcome === undefined ||
      value.outcome === 'true' ||
      value.outcome === 'false' ||
      value.outcome === 'success')
  );
}

export function createWorkflowDraft(
  projectId: string,
  name = 'Untitled workflow',
): WorkflowDefinition {
  const now = new Date().toISOString();
  const agent: WorkflowNode = {
    ...baseNode('agent', 'Implement', 80, 140),
    type: 'agent',
    provider: 'auto',
    prompt: 'Implement the requested change and verify it.',
    skillIds: [],
    mcpServerIds: [],
  };
  const approval: WorkflowNode = {
    ...baseNode('approval', 'Review changes', 390, 140),
    type: 'approval',
    risk: 'high',
    instructions: 'Review the diff, commits, and test results before integration.',
  };
  const join: WorkflowNode = {
    ...baseNode('join', 'Complete', 700, 140),
    type: 'join',
    strategy: 'all',
  };
  return {
    id: id('workflow'),
    name,
    version: 1,
    projectId,
    createdAt: now,
    updatedAt: now,
    settings: { maxConcurrency: 2, defaultTimeoutSeconds: 1800, defaultRetries: 1 },
    nodes: [agent, approval, join],
    edges: [
      { id: id('edge'), source: agent.id, target: approval.id },
      { id: id('edge'), source: approval.id, target: join.id },
    ],
  };
}

export function generateWorkflowDraft(projectId: string, goal: string): WorkflowDefinition {
  const draft = createWorkflowDraft(projectId, goal.trim().slice(0, 80) || 'Generated workflow');
  const implement = draft.nodes[0];
  if (implement.type === 'agent') implement.prompt = goal.trim();
  const condition: WorkflowNode = {
    ...baseNode('condition', 'Tests pass?', 390, 20),
    type: 'condition',
    expression: 'true',
  };
  const repair: WorkflowNode = {
    ...baseNode('agent', 'Diagnose failure', 390, 260),
    type: 'agent',
    provider: 'auto',
    prompt: `Diagnose test failures for this goal without hiding failures: ${goal.trim()}`,
    skillIds: [],
    mcpServerIds: [],
  };
  const approval = draft.nodes[1];
  const complete = draft.nodes[2];
  approval.position = { x: 700, y: 80 };
  complete.position = { x: 1000, y: 80 };
  draft.description = `Generated draft for: ${goal.trim()}`;
  draft.nodes = [implement, condition, repair, approval, complete];
  draft.edges = [
    { id: id('edge'), source: implement.id, target: condition.id },
    { id: id('edge'), source: condition.id, target: approval.id, outcome: 'true' },
    { id: id('edge'), source: condition.id, target: repair.id, outcome: 'false' },
    { id: id('edge'), source: repair.id, target: approval.id },
    { id: id('edge'), source: approval.id, target: complete.id },
  ];
  return draft;
}

export function finalizePlannedWorkflow(projectId: string, value: unknown): WorkflowDefinition {
  if (!value || typeof value !== 'object') throw new Error('Planning Provider output is invalid.');
  const planned = value as Partial<WorkflowDefinition>;
  if (
    typeof planned.name !== 'string' ||
    !planned.name.trim() ||
    !Array.isArray(planned.nodes) ||
    planned.nodes.length === 0 ||
    planned.nodes.length > 256 ||
    !planned.nodes.every(validNode) ||
    !Array.isArray(planned.edges) ||
    planned.edges.length > 1024 ||
    !planned.edges.every(validEdge)
  ) {
    throw new Error('Planning Provider output is invalid.');
  }
  const now = new Date().toISOString();
  const workflow: WorkflowDefinition = {
    ...planned,
    id: id('workflow'),
    name: planned.name.trim().slice(0, 120),
    version: 1,
    projectId,
    createdAt: now,
    updatedAt: now,
    settings: {
      maxConcurrency: Math.min(4, Math.max(1, planned.settings?.maxConcurrency ?? 2)),
      defaultTimeoutSeconds: Math.max(1, planned.settings?.defaultTimeoutSeconds ?? 1800),
      defaultRetries: Math.min(3, Math.max(0, planned.settings?.defaultRetries ?? 1)),
    },
    nodes: planned.nodes,
    edges: planned.edges,
  };
  if (validateWorkflow(workflow).length > 0) {
    throw new Error('Planning Provider returned an invalid DAG.');
  }
  return workflow;
}

export function instantiateWorkflowTemplate(
  template: WorkflowDefinition,
  projectId: string,
): WorkflowDefinition {
  const nodeIds = new Map(template.nodes.map((node) => [node.id, id(node.type)]));
  const now = new Date().toISOString();
  return {
    ...structuredClone(template),
    id: id('workflow'),
    projectId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: template.nodes.map((node) => ({ ...structuredClone(node), id: nodeIds.get(node.id)! })),
    edges: template.edges.map((edge) => ({
      ...edge,
      id: id('edge'),
      source: nodeIds.get(edge.source)!,
      target: nodeIds.get(edge.target)!,
    })),
  };
}
