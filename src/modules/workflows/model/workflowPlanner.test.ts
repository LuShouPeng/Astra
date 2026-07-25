import { describe, expect, it } from 'vitest';
import { createWorkflowDraft, generateWorkflowDraft } from './workflowPlanner';

describe('workflow planner', () => {
  it('creates an editable valid default DAG', () => {
    const draft = createWorkflowDraft('project-1', 'Release check');
    expect(draft.nodes.map((node) => node.type)).toEqual(['agent', 'approval', 'join']);
    expect(draft.edges).toHaveLength(2);
  });

  it('generates a reviewable DAG from a natural-language goal', () => {
    const draft = generateWorkflowDraft('project-1', 'Implement authentication and run tests');
    expect(draft.description).toContain('Implement authentication');
    expect(draft.nodes.some((node) => node.type === 'condition')).toBe(true);
    expect(draft.nodes.every((node) => node.position.x >= 0)).toBe(true);
  });
});
