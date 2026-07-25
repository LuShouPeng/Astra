import type {
  NodeRunStatus,
  WorkflowDefinition,
  WorkflowNodeId,
} from '../../../core/contracts/workflows';

export type WorkflowIssueCode =
  | 'EMPTY_GRAPH'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'DANGLING_EDGE'
  | 'CYCLE'
  | 'INVALID_CONCURRENCY'
  | 'INVALID_TIMEOUT'
  | 'INVALID_RETRIES';

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  nodeId?: WorkflowNodeId;
  edgeId?: string;
}

function duplicates(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return duplicate;
}

function containsCycle(definition: WorkflowDefinition): boolean {
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const indegree = new Map([...nodeIds].map((id) => [id, 0]));
  const targets = new Map<string, string[]>();
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    targets.set(edge.source, [...(targets.get(edge.source) ?? []), edge.target]);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of targets.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  return visited !== nodeIds.size;
}

export function validateWorkflow(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (definition.nodes.length === 0) issues.push({ code: 'EMPTY_GRAPH' });
  for (const nodeId of duplicates(definition.nodes.map((node) => node.id))) {
    issues.push({ code: 'DUPLICATE_NODE_ID', nodeId });
  }
  for (const edgeId of duplicates(definition.edges.map((edge) => edge.id))) {
    issues.push({ code: 'DUPLICATE_EDGE_ID', edgeId });
  }
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ code: 'DANGLING_EDGE', edgeId: edge.id });
    }
  }
  if (containsCycle(definition)) issues.push({ code: 'CYCLE' });
  if (definition.settings.maxConcurrency < 1 || definition.settings.maxConcurrency > 4) {
    issues.push({ code: 'INVALID_CONCURRENCY' });
  }
  if (definition.settings.defaultTimeoutSeconds < 1) issues.push({ code: 'INVALID_TIMEOUT' });
  if (definition.settings.defaultRetries < 0 || definition.settings.defaultRetries > 3) {
    issues.push({ code: 'INVALID_RETRIES' });
  }
  return issues;
}

export function readyNodeIds(
  definition: WorkflowDefinition,
  statuses: Readonly<Record<WorkflowNodeId, NodeRunStatus>>,
): WorkflowNodeId[] {
  return definition.nodes
    .filter((node) => statuses[node.id] === undefined || statuses[node.id] === 'pending')
    .filter((node) => {
      const dependencies = definition.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => edge.source);
      return dependencies.every((dependency) => statuses[dependency] === 'succeeded');
    })
    .map((node) => node.id);
}
