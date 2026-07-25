import { describe, expect, it } from 'vitest';
import { routeProvider, routeWorkflowProviders } from './providerRouting';
import { createWorkflowDraft } from './workflowPlanner';

describe('provider routing', () => {
  const available = [
    { provider: 'claude' as const, available: true },
    { provider: 'codex' as const, available: true },
  ];

  it('routes planning to Claude and implementation to Codex with fallback', () => {
    expect(routeProvider('planning', available)).toBe('claude');
    expect(routeProvider('implementation', available)).toBe('codex');
    expect(routeProvider('implementation', [{ provider: 'claude', available: true }])).toBe(
      'claude',
    );
  });

  it('preserves explicit overrides and resolves automatic workflow nodes', () => {
    const workflow = createWorkflowDraft('project-1');
    const agent = workflow.nodes.find((node) => node.type === 'agent')!;
    if (agent.type !== 'agent') throw new Error('agent fixture');
    agent.provider = 'claude';
    expect(
      routeWorkflowProviders(workflow, available).nodes.find((node) => node.id === agent.id),
    ).toMatchObject({ provider: 'claude' });
  });
});
