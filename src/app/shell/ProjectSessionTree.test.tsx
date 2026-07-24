import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../modules/demo';
import { ProjectSessionTree } from './ProjectSessionTree';

function LocationProbe() {
  return <output>{useLocation().pathname}</output>;
}

describe('ProjectSessionTree', () => {
  it('groups sessions by project and creates stable deep links', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();

    render(
      <MemoryRouter>
        <ProjectSessionTree projects={snapshot.projects} sessions={snapshot.sessions} />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByRole('tree', { name: 'Projects and sessions' })).toBeVisible();
    expect(screen.getByText('backend-api')).toBeVisible();
    expect(screen.getByText('frontend')).toBeVisible();
    expect(screen.getByText('ai-service')).toBeVisible();

    await user.click(screen.getByRole('link', { name: /Fix intermittent login timeout/ }));
    expect(screen.getByText('/sessions/session-backend-claude')).toBeVisible();
  });

  it('collapses and expands a project session group', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();

    render(
      <MemoryRouter>
        <ProjectSessionTree projects={snapshot.projects} sessions={snapshot.sessions} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse backend-api' }));
    expect(screen.queryByText('Fix intermittent login timeout')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand backend-api' }));
    expect(screen.getByText('Fix intermittent login timeout')).toBeVisible();
  });
});
