import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { appEventBus } from '../../../core/events/appEventBus';
import { WorkbenchProvider, useWorkbench } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { DesktopNotificationService } from '../services/desktopNotificationService';
import { DesktopNotificationBridge } from './DesktopNotificationBridge';

function repository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

function BridgeProbe() {
  const { snapshot } = useWorkbench();
  return <span>{snapshot ? 'Bridge ready' : 'Loading bridge'}</span>;
}

describe('DesktopNotificationBridge', () => {
  it('forwards typed notification events using current persisted settings', async () => {
    const service: DesktopNotificationService = {
      notify: vi.fn(async () => 'sent' as const),
    };
    const subscribe = vi.spyOn(appEventBus, 'subscribe');
    render(
      <WorkbenchProvider repository={repository()}>
        <DesktopNotificationBridge service={service} />
        <BridgeProbe />
      </WorkbenchProvider>,
    );

    expect(await screen.findByText('Bridge ready')).toBeVisible();
    await waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith('notification:created', expect.any(Function)),
    );
    const snapshot = createDemoSnapshot();
    act(() => appEventBus.emit('notification:created', snapshot.notifications[0]));

    await waitFor(() =>
      expect(service.notify).toHaveBeenCalledWith(
        snapshot.notifications[0],
        snapshot.notificationSettings,
      ),
    );
  });
});
