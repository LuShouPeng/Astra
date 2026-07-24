import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../data/demoFixtures';
import { DEMO_STEP_INTERVAL_MS } from '../model/demoPlayback';
import { DemoControls } from './DemoControls';

afterEach(() => vi.useRealTimers());

describe('DemoControls', () => {
  it('automatically advances playback using the frozen interval', async () => {
    vi.useFakeTimers();
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    render(
      <WorkbenchProvider repository={repository}>
        <DemoControls />
      </WorkbenchProvider>,
    );
    await act(async () => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play demo' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Pause demo' })).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(DEMO_STEP_INTERVAL_MS));
    expect(screen.getByText('Step 1 of 3')).toBeVisible();
    expect(repository.save).toHaveBeenCalledTimes(2);
  });
});
