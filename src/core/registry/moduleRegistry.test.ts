import { describe, expect, it } from 'vitest';
import { getEnabledModules, moduleRegistry } from './moduleRegistry';

describe('module registry', () => {
  it('registers only the workspace module for the P0 shell', () => {
    expect(moduleRegistry.map((module) => module.id)).toEqual(['workspace']);
  });

  it('enables the workspace module for an active workspace', () => {
    const enabled = getEnabledModules({
      workspace: { id: 'one', name: 'One', rootPath: 'C:\\One' },
    });
    expect(enabled.map((module) => module.id)).toEqual(['workspace']);
  });
});
