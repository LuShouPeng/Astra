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
  | 'INVALID_EDGE_OUTCOME'
  | 'CYCLE'
  | 'INVALID_CONCURRENCY'
  | 'INVALID_TIMEOUT'
  | 'INVALID_RETRIES';

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  nodeId?: WorkflowNodeId;
  edgeId?: string;
}

export function layoutWorkflow(
  definition: WorkflowDefinition,
): ReadonlyMap<WorkflowNodeId, { x: number; y: number }> {
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
  const depth = new Map(definition.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<WorkflowNodeId, WorkflowNodeId[]>();
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const queue = definition.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const visited = new Set<WorkflowNodeId>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    visited.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(nodeId) ?? 0) + 1));
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  // Invalid cyclic remnants remain visible in a final column so layout never loses a node.
  const finalDepth = Math.max(0, ...depth.values()) + 1;
  for (const node of definition.nodes) {
    if (!visited.has(node.id)) depth.set(node.id, finalDepth);
  }
  const layerRows = new Map<number, number>();
  return new Map(
    definition.nodes.map((node) => {
      const column = depth.get(node.id) ?? 0;
      const row = layerRows.get(column) ?? 0;
      layerRows.set(column, row + 1);
      return [node.id, { x: 80 + column * 300, y: 70 + row * 150 }];
    }),
  );
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
  const nodeTypes = new Map(definition.nodes.map((node) => [node.id, node.type]));
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ code: 'DANGLING_EDGE', edgeId: edge.id });
    }
    if (
      (edge.outcome === 'true' || edge.outcome === 'false') &&
      nodeTypes.get(edge.source) !== 'condition'
    ) {
      issues.push({ code: 'INVALID_EDGE_OUTCOME', edgeId: edge.id });
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
  conditionOutcomes: Readonly<Record<WorkflowNodeId, boolean>> = {},
): WorkflowNodeId[] {
  return definition.nodes
    .filter((node) => statuses[node.id] === undefined || statuses[node.id] === 'pending')
    .filter((node) => {
      const incoming = definition.edges.filter((edge) => edge.target === node.id);
      return incoming.every((edge) => {
        if (edge.outcome === 'true' || edge.outcome === 'false') {
          const outcome = conditionOutcomes[edge.source];
          if (outcome === undefined || outcome !== (edge.outcome === 'true')) return false;
        }
        return statuses[edge.source] === 'succeeded';
      });
    })
    .map((node) => node.id);
}

export function skippedNodeIds(
  definition: WorkflowDefinition,
  statuses: Readonly<Record<WorkflowNodeId, NodeRunStatus>>,
  conditionOutcomes: Readonly<Record<WorkflowNodeId, boolean>>,
): WorkflowNodeId[] {
  return definition.nodes
    .filter((node) => statuses[node.id] === undefined || statuses[node.id] === 'pending')
    .filter((node) => {
      const incoming = definition.edges.filter((edge) => edge.target === node.id);
      return (
        incoming.length > 0 &&
        incoming.every((edge) => {
          if (edge.outcome !== 'true' && edge.outcome !== 'false') return false;
          const outcome = conditionOutcomes[edge.source];
          return outcome !== undefined && outcome !== (edge.outcome === 'true');
        })
      );
    })
    .map((node) => node.id);
}
