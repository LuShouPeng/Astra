import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../core/data/prototypeRepository';
import { I18nProvider } from '../../core/i18n/I18nContext';
import { WorkbenchProvider } from '../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../modules/demo';
import { ActivityRail } from './ActivityRail';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => snapshot),
    consumeWarning: vi.fn(() => null),
  };
}

function renderRail(snapshot = createDemoSnapshot()) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ActivityRail />
        </WorkbenchProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('ActivityRail', () => {
  it('keeps compact navigation discoverable through an accessible more menu', async () => {
    const user = userEvent.setup();
    renderRail();

    expect(await screen.findAllByRole('link', { name: 'Command Center' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Needs Attention' })).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'More navigation' }));
    expect(screen.getByRole('menu', { name: 'More navigation' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Extensions' })).toBeVisible();
  });

  it('hides the notification badge when every notification is read', async () => {
    const snapshot = createDemoSnapshot();
    renderRail({
      ...snapshot,
      notifications: snapshot.notifications.map((notification) => ({ ...notification, read: true })),
    });

    await screen.findAllByRole('link', { name: 'Command Center' });
    expect(document.querySelector('.activity-badge')).not.toBeInTheDocument();
  });

  it('caps unread notification counts at 9+', async () => {
    const snapshot = createDemoSnapshot();
    const template = snapshot.notifications[0];
    if (!template) throw new Error('Demo snapshot must include a notification template');
    const notifications = Array.from({ length: 10 }, (_, index) => ({
      ...template,
      id: `unread-notification-${index}`,
      read: false,
    }));

    renderRail({ ...snapshot, notifications });

    await screen.findAllByRole('link', { name: 'Command Center' });
    const badges = document.querySelectorAll('.activity-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('9+');
  });

  it('closes the more menu on Escape and outside press', async () => {
    const user = userEvent.setup();
    renderRail();

    await screen.findAllByRole('link', { name: 'Command Center' });
    const moreButton = screen.getByRole('button', { name: 'More navigation' });
    await user.click(moreButton);
    expect(screen.getByRole('menu', { name: 'More navigation' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'More navigation' })).not.toBeInTheDocument();

    await user.click(moreButton);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'More navigation' })).not.toBeInTheDocument();
  });

  it('closes the more menu after selecting a compact navigation item', async () => {
    const user = userEvent.setup();
    renderRail();

    await screen.findAllByRole('link', { name: 'Command Center' });
    await user.click(screen.getByRole('button', { name: 'More navigation' }));
    await user.click(screen.getByRole('menuitem', { name: 'Extensions' }));

    expect(screen.queryByRole('menu', { name: 'More navigation' })).not.toBeInTheDocument();
  });
});
