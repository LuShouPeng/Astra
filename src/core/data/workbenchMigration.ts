import type { WorkbenchSnapshot } from '../contracts/workbenchData';

interface LegacySnapshot {
  schemaVersion: 1;
  sessions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function isLegacySnapshot(value: unknown): value is LegacySnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Array.isArray((value as { sessions?: unknown }).sessions)
  );
}

export function migrateWorkbenchSnapshot(value: unknown): WorkbenchSnapshot {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2
  ) {
    return structuredClone(value) as WorkbenchSnapshot;
  }
  if (!isLegacySnapshot(value)) throw new Error('Unsupported workbench schema.');
  return {
    ...structuredClone(value),
    schemaVersion: 2,
    sessions: value.sessions.map((session) => ({ ...session, source: 'demo' })),
  } as unknown as WorkbenchSnapshot;
}
