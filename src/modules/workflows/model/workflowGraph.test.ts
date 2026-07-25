import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import { readyNodeIds, skippedNodeIds, validateWorkflow } from './workflowGraph';

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'workflow-1',
    name: 'Ship a verified change',
    version: 1,
    projectId: 'project-1',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    settings: { maxConcurrency: 2, defaultTimeoutSeconds: 1800, defaultRetries: 1 },
    nodes: [
      {
        id: 'plan',
        type: 'agent',
        name: 'Plan',
        position: { x: 40, y: 80 },
        provider: 'auto',
        prompt: 'Plan the change.',
        skillIds: [],
        mcpServerIds: [],
      },
      {
        id: 'approve',
        type: 'approval',
        name: 'Approve plan',
        position: { x: 320, y: 80 },
        risk: 'medium',
        instructions: 'Review the plan.',
      },
    ],
    edges: [{ id: 'plan-approve', source: 'plan', target: 'approve' }],
    ...overrides,
  };
}

describe('workflow graph', () => {
  it('accepts a connected DAG and returns its initial ready nodes', () => {
    const definition = workflow();

    expect(validateWorkflow(definition)).toEqual([]);
    expect(readyNodeIds(definition, {})).toEqual(['plan']);
    expect(readyNodeIds(definition, { plan: 'succeeded' })).toEqual(['approve']);
  });

  it('rejects cycles, dangling edges, duplicate ids, and values outside runtime limits', () => {
    const definition = workflow({
      settings: { maxConcurrency: 7, defaultTimeoutSeconds: 0, defaultRetries: 9 },
      nodes: [...workflow().nodes, { ...workflow().nodes[0], name: 'Duplicate' }],
      edges: [
        { id: 'a', source: 'plan', target: 'approve' },
        { id: 'b', source: 'approve', target: 'plan' },
        { id: 'c', source: 'missing', target: 'plan' },
      ],
    });

    expect(validateWorkflow(definition).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_NODE_ID',
        'DANGLING_EDGE',
        'CYCLE',
        'INVALID_CONCURRENCY',
        'INVALID_TIMEOUT',
        'INVALID_RETRIES',
      ]),
    );
  });

  it('does not release a dependent node after failed or skipped dependencies', () => {
    const definition = workflow();

    expect(readyNodeIds(definition, { plan: 'failed' })).toEqual([]);
    expect(readyNodeIds(definition, { plan: 'skipped' })).toEqual([]);
  });

  it('selects one condition branch and skips the other', () => {
    const definition = workflow({
      edges: [
        { id: 'yes', source: 'plan', target: 'approve', outcome: 'true' },
        { id: 'no', source: 'plan', target: 'other', outcome: 'false' },
      ],
      nodes: [
        ...workflow().nodes,
        {
          ...workflow().nodes[1],
          id: 'other',
          name: 'Other branch',
        },
      ],
    });
    const statuses = { plan: 'succeeded' as const };
    const outcomes = { plan: true };
    expect(readyNodeIds(definition, statuses, outcomes)).toEqual(['approve']);
    expect(skippedNodeIds(definition, statuses, outcomes)).toEqual(['other']);
  });
});
