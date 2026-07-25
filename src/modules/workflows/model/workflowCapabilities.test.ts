import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../../../core/contracts/workflows';
import { attachCapability, parseCapabilityPayload } from './workflowCapabilities';

const agent: WorkflowNode = {
  id: 'agent-1',
  type: 'agent',
  name: 'Implement',
  position: { x: 0, y: 0 },
  provider: 'auto',
  prompt: 'Implement it',
  skillIds: [],
  mcpServerIds: [],
};

describe('workflow Agent capabilities', () => {
  it('attaches MCP and Skill capabilities without duplicates', () => {
    const withMcp = attachCapability(agent, { kind: 'mcp', id: 'exa', name: 'Exa' });
    const withSkill = attachCapability(withMcp, {
      kind: 'skill',
      id: 'security-review',
      name: 'Security Review',
    });
    const duplicate = attachCapability(withSkill, { kind: 'mcp', id: 'exa', name: 'Exa' });

    expect(duplicate).toMatchObject({
      mcpServerIds: ['exa'],
      skillIds: ['security-review'],
    });
  });

  it('does not attach capabilities to control nodes', () => {
    const approval: WorkflowNode = {
      id: 'approval-1',
      type: 'approval',
      name: 'Review',
      position: { x: 0, y: 0 },
      risk: 'high',
      instructions: '',
    };
    expect(attachCapability(approval, { kind: 'mcp', id: 'exa', name: 'Exa' })).toBe(approval);
  });

  it('accepts only bounded capability drag payloads', () => {
    expect(
      parseCapabilityPayload(
        JSON.stringify({ kind: 'skill', id: 'security-review', name: 'Security Review' }),
      ),
    ).toEqual({ kind: 'skill', id: 'security-review', name: 'Security Review' });
    expect(parseCapabilityPayload('{"kind":"tool","id":"bad"}')).toBeNull();
    expect(
      parseCapabilityPayload(
        JSON.stringify({ kind: 'mcp', id: '../credential', name: 'Injected' }),
      ),
    ).toBeNull();
    expect(
      parseCapabilityPayload(
        JSON.stringify({ kind: 'skill', id: 'skill\nforged', name: 'Injected' }),
      ),
    ).toBeNull();
    expect(parseCapabilityPayload('x'.repeat(5000))).toBeNull();
  });
});
