import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../data/prototypeRepository';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import { createDemoSnapshot } from '../../modules/demo';
import { WorkbenchProvider, useWorkbench } from './WorkbenchContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe() {
  const { loadState, snapshot, warning, saveSnapshot, resetSnapshot } = useWorkbench();
  return (
    <div>
      <span>{loadState}</span>
      <span>{snapshot?.projects.length ?? 0} projects</span>
      {warning && <span>{warning}</span>}
      <button
        onClick={() => {
          if (snapshot) void saveSnapshot({ ...snapshot, projects: snapshot.projects.slice(1) });
        }}
      >
        Remove first
      </button>
      <button onClick={() => void resetSnapshot()}>Reset snapshot</button>
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

  it('persists and publishes an updated snapshot', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    render(
      <WorkbenchProvider repository={repository}>
        <Probe />
      </WorkbenchProvider>,
    );

    expect(await screen.findByText('3 projects')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove first' }));
    expect(await screen.findByText('2 projects')).toBeVisible();
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('merges discovered capabilities over demo defaults after load', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const discoverCapabilities = vi.fn(async () => ({
      claude: {
        provider: 'claude' as const,
        label: 'Claude',
        runtimeAvailable: true,
        displayOnly: false,
        version: '1.9.0',
      },
    }));

    function CapabilityProbe() {
      const { snapshot } = useWorkbench();
      const claude = snapshot?.providerCapabilities.claude;
      return <span>claude:{claude ? String(claude.runtimeAvailable) : 'none'}</span>;
    }

    render(
      <WorkbenchProvider repository={repository} discoverCapabilities={discoverCapabilities}>
        <CapabilityProbe />
      </WorkbenchProvider>,
    );

    // demo 默认 claude.runtimeAvailable=false；探测覆盖为 true。
    expect(await screen.findByText('claude:true')).toBeVisible();
    expect(discoverCapabilities).toHaveBeenCalledOnce();
  });

  it('keeps demo capabilities when discovery rejects', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const discoverCapabilities = vi.fn(async () => Promise.reject(new Error('no tauri')));

    function CapabilityProbe() {
      const { loadState, snapshot } = useWorkbench();
      const gemini = snapshot?.providerCapabilities.gemini;
      return (
        <span>
          {loadState}:{gemini ? String(gemini.displayOnly) : 'none'}
        </span>
      );
    }

    render(
      <WorkbenchProvider repository={repository} discoverCapabilities={discoverCapabilities}>
        <CapabilityProbe />
      </WorkbenchProvider>,
    );

    expect(await screen.findByText('ready:true')).toBeVisible();
  });

  it('resets and publishes the frozen repository snapshot', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const reset = createDemoSnapshot();
    reset.projects = reset.projects.slice(0, 1);
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => reset),
      consumeWarning: vi.fn(() => null),
    };
    render(
      <WorkbenchProvider repository={repository}>
        <Probe />
      </WorkbenchProvider>,
    );

    expect(await screen.findByText('3 projects')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset snapshot' }));
    expect(await screen.findByText('1 projects')).toBeVisible();
    expect(repository.reset).toHaveBeenCalledOnce();
  });

  function renderHookWithProvider(repository: PrototypeRepository) {
    return renderHook(() => useWorkbench(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WorkbenchProvider repository={repository}>{children}</WorkbenchProvider>
      ),
    });
  }

  it('serializes concurrent saves so later writes never race ahead of earlier ones', async () => {
    const gates = [deferred<void>(), deferred<void>()];
    const order: string[] = [];
    let call = 0;
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async (snapshot: WorkbenchSnapshot) => {
        const index = call++;
        order.push(`start:${snapshot.projects.length}`);
        await gates[index].promise;
        order.push(`end:${snapshot.projects.length}`);
      }),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    const { result } = renderHookWithProvider(repository);
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    const base = result.current.snapshot as WorkbenchSnapshot;

    // 连续两次 saveSnapshot，第一次尚未完成即发起第二次。
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.saveSnapshot({ ...base, projects: base.projects.slice(1) });
      second = result.current.saveSnapshot({ ...base, projects: base.projects.slice(2) });
      // 放行微任务，让队首落盘推进到 gate 处（await gates[0]）。
      await Promise.resolve();
    });

    // 第二次不得在第一次落盘完成前开始。
    expect(order).toEqual(['start:2']);
    gates[0].resolve();
    await act(async () => {
      await first;
    });
    expect(order).toEqual(['start:2', 'end:2', 'start:1']);
    gates[1].resolve();
    await act(async () => {
      await second;
    });
    expect(order).toEqual(['start:2', 'end:2', 'start:1', 'end:1']);
  });

  it('updateSnapshot with persist:false updates memory without saving', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const { result } = renderHookWithProvider(repository);
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    const before = (result.current.snapshot as WorkbenchSnapshot).projects.length;

    act(() => {
      result.current.updateSnapshot((s) => ({ ...s, projects: s.projects.slice(1) }));
    });

    expect(result.current.snapshot?.projects.length).toBe(before - 1);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('flushPending persists pending memory-only updates exactly once', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const { result } = renderHookWithProvider(repository);
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    act(() => {
      result.current.updateSnapshot((s) => ({ ...s, projects: s.projects.slice(1) }));
    });
    await act(async () => {
      await result.current.flushPending();
    });
    expect(repository.save).toHaveBeenCalledOnce();

    // 已落盘后无脏数据，再次 flush 不重复写。
    await act(async () => {
      await result.current.flushPending();
    });
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('keeps ready state when a background save fails, surfacing the error only', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => Promise.reject(new Error('disk full'))),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const { result } = renderHookWithProvider(repository);
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    const base = result.current.snapshot as WorkbenchSnapshot;

    await act(async () => {
      await result.current.saveSnapshot({ ...base, projects: base.projects.slice(1) }).catch(
        () => undefined,
      );
    });

    expect(result.current.loadState).toBe('ready');
    expect(result.current.error).toBe('disk full');
    // 内存快照仍推进到用户期望的新值。
    expect(result.current.snapshot?.projects.length).toBe(base.projects.length - 1);
  });
});
