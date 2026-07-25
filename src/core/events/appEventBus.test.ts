import { describe, expect, it, vi } from 'vitest';
import { createAppEventBus } from './appEventBus';

describe('app event bus', () => {
  it('delivers typed workspace events until the subscriber unsubscribes', () => {
    const bus = createAppEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('workspace:opened', listener);
    const workspace = { id: 'one', name: 'One', rootPath: 'C:\\One' };

    bus.emit('workspace:opened', workspace);
    unsubscribe();
    bus.emit('workspace:opened', workspace);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(workspace);
  });
});
