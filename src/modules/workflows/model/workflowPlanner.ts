import type { WorkflowDefinition, WorkflowNode } from '../../../core/contracts/workflows';
import { validateWorkflow } from './workflowGraph';

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function baseNode(type: WorkflowNode['type'], name: string, x: number, y: number) {
  return { id: id(type), type, name, position: { x, y } };
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
    !Array.isArray(planned.edges)
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
