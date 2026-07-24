import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../data/prototypeRepository';
import { createDemoSnapshot } from '../../modules/demo';
import { WorkbenchProvider, useWorkbench } from './WorkbenchContext';

function Probe() {
  const { loadState, snapshot, warning } = useWorkbench();
  return (
    <div>
      <span>{loadState}</span>
      <span>{snapshot?.projects.length ?? 0} projects</span>
      {warning && <span>{warning}</span>}
    </div>
  );
}

describe('WorkbenchProvider', () => {
  it('loads one snapshot from the repository and exposes recoverable warnings', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => new Error('Demo data was restored.') as never),
    };

    render(
      <WorkbenchProvider repository={repository}>
        <Probe />
      </WorkbenchProvider>,
    );

    expect(screen.getByText('loading')).toBeVisible();
    expect(await screen.findByText('3 projects')).toBeVisible();
    expect(screen.getByText('Demo data was restored.')).toBeVisible();
    expect(repository.load).toHaveBeenCalledOnce();
  });

  it('exposes a readable error when repository loading fails', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => Promise.reject(new Error('offline'))),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <WorkbenchProvider repository={repository}>
        <Probe />
      </WorkbenchProvider>,
    );

    expect(await screen.findByText('error')).toBeVisible();
    expect(screen.getByText('0 projects')).toBeVisible();
  });

  it('rejects consumers outside the provider boundary', () => {
    expect(() => renderHook(() => useWorkbench())).toThrow(
      'useWorkbench must be used within WorkbenchProvider.',
    );
  });
});
