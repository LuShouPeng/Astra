import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import { layoutWorkflow, readyNodeIds, skippedNodeIds, validateWorkflow } from './workflowGraph';

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

  it('rejects true or false outcomes on non-condition edges', () => {
    const definition = workflow({
      edges: [{ id: 'invalid-branch', source: 'plan', target: 'approve', outcome: 'true' }],
    });

    expect(validateWorkflow(definition)).toContainEqual({
      code: 'INVALID_EDGE_OUTCOME',
      edgeId: 'invalid-branch',
    });
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

  it('lays out dependencies by topological depth and keeps parallel nodes in one column', () => {
    const definition = workflow({
      nodes: [
        workflow().nodes[0],
        { ...workflow().nodes[1], id: 'review', name: 'Review' },
        { ...workflow().nodes[1], id: 'test', name: 'Test' },
        workflow().nodes[1],
      ],
      edges: [
        { id: 'plan-review', source: 'plan', target: 'review' },
        { id: 'plan-test', source: 'plan', target: 'test' },
        { id: 'review-approve', source: 'review', target: 'approve' },
        { id: 'test-approve', source: 'test', target: 'approve' },
      ],
    });

    const positions = layoutWorkflow(definition);
    expect(positions.get('plan')?.x).toBeLessThan(positions.get('review')!.x);
    expect(positions.get('review')?.x).toBe(positions.get('test')?.x);
    expect(positions.get('review')?.y).not.toBe(positions.get('test')?.y);
    expect(positions.get('approve')?.x).toBeGreaterThan(positions.get('review')!.x);
  });

  it('keeps cyclic remnants visible in a fallback column', () => {
    const definition = workflow({
      edges: [
        { id: 'forward', source: 'plan', target: 'approve' },
        { id: 'back', source: 'approve', target: 'plan' },
      ],
    });

    const positions = layoutWorkflow(definition);
    expect([...positions.keys()]).toEqual(['plan', 'approve']);
    expect(positions.get('plan')?.x).toBe(positions.get('approve')?.x);
  });
});
