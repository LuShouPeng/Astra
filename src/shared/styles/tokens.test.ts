import { describe, expect, it } from 'vitest';
import shellStyles from '../../app/shell/shell.css?raw';
import workspaceStyles from '../../modules/workspace/workspace.css?raw';
import globalStyles from './global.css?raw';

const componentStyles = { globalStyles, workspaceStyles, shellStyles };

describe('design token contract', () => {
  it.each(Object.entries(componentStyles))('%s contains no raw color literals', (_, source) => {
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(source).not.toMatch(/\brgba?\s*\(/i);
  });
});
