import { describe, expect, it } from 'vitest';
import {
  createWorkflowDraft,
  instantiateWorkflowTemplate,
  finalizePlannedWorkflow,
  generateWorkflowDraft,
} from './workflowPlanner';

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

describe('planning Provider output', () => {
  it('adds trusted project metadata and accepts a valid editable DAG', () => {
    const workflow = finalizePlannedWorkflow('project-1', {
      name: 'Planned',
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          name: 'Implement',
          position: { x: 80, y: 120 },
          provider: 'auto',
          prompt: 'Implement it',
          skillIds: [],
          mcpServerIds: [],
        },
      ],
      edges: [],
    });
    expect(workflow.projectId).toBe('project-1');
    expect(workflow.id).toMatch(/^workflow-/);
  });

  it('rejects malformed Provider output', () => {
    expect(() => finalizePlannedWorkflow('project-1', { nodes: [], edges: [] })).toThrow();
    expect(() =>
      finalizePlannedWorkflow('project-1', { name: 'Null node', nodes: [null], edges: [] }),
    ).toThrow(/invalid/i);
    expect(() =>
      finalizePlannedWorkflow('project-1', {
        name: 'Incomplete agent',
        nodes: [
          {
            id: 'agent-1',
            type: 'agent',
            name: 'Implement',
            position: { x: 0, y: 0 },
            provider: 'auto',
            prompt: 'Implement it',
            skillIds: 'not-an-array',
            mcpServerIds: [],
          },
        ],
        edges: [],
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      finalizePlannedWorkflow('project-1', {
        name: 'Malformed edge',
        nodes: [
          {
            id: 'agent-1',
            type: 'agent',
            name: 'Implement',
            position: { x: 0, y: 0 },
            provider: 'auto',
            prompt: 'Implement it',
            skillIds: [],
            mcpServerIds: [],
          },
        ],
        edges: [{ id: 'edge-1', source: 'agent-1', target: 42 }],
      }),
    ).toThrow(/invalid/i);
  });

  it('rejects unsupported standalone capability nodes', () => {
    expect(() =>
      finalizePlannedWorkflow('project-1', {
        name: 'Legacy MCP plan',
        nodes: [
          {
            id: 'mcp-1',
            type: 'tool',
            name: 'Search',
            position: { x: 0, y: 0 },
            serverId: 'exa',
            toolName: 'search',
            arguments: {},
          },
        ],
        edges: [],
      }),
    ).toThrow(/invalid/i);
  });

  it('instantiates templates with fresh graph identifiers', () => {
    const template = createWorkflowDraft('template-project', 'Template');
    const instance = instantiateWorkflowTemplate(template, 'project-2');
    expect(instance.projectId).toBe('project-2');
    expect(instance.id).not.toBe(template.id);
    expect(instance.nodes[0]?.id).not.toBe(template.nodes[0]?.id);
    expect(instance.edges[0]?.source).toBe(instance.nodes[0]?.id);
  });
});
