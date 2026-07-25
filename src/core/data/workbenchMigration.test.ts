import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../modules/demo';
import { migrateWorkbenchSnapshot } from './workbenchMigration';

describe('workbench snapshot migration', () => {
  it('upgrades schema v1 sessions to runtime-aware schema v2', () => {
    const legacy = { ...createDemoSnapshot(), schemaVersion: 1 as const };

    const migrated = migrateWorkbenchSnapshot(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.sessions.every((session) => session.source === 'demo')).toBe(true);
  });

  it('preserves schema v2 runtime projection fields', () => {
    const current = createDemoSnapshot();
    current.sessions[0] = {
      ...current.sessions[0],
      source: 'runtime',
      workflowRunId: 'run-1',
      workflowNodeId: 'node-1',
      externalSessionId: 'provider-session-1',
    };

    expect(migrateWorkbenchSnapshot(current)).toEqual(current);
  });

  it('rejects unsupported data instead of guessing a migration', () => {
    expect(() => migrateWorkbenchSnapshot({ schemaVersion: 99 })).toThrow(
      'Unsupported workbench schema.',
    );
  });
});
