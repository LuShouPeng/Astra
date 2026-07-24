import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkspaceService } from '../../core/contracts/workspace';
import WorkspaceExplorerSidebar from '../../modules/workspace/components/WorkspaceExplorerSidebar';
import WorkspaceReadyMain from '../../modules/workspace/components/WorkspaceReadyMain';
import { WorkspaceProvider } from '../../modules/workspace/state/WorkspaceContext';
import { WorkbenchShell } from './WorkbenchShell';

const emptyService: WorkspaceService = {
  list: () => Promise.resolve([]),
  chooseAndAdd: () => Promise.resolve(null),
  open: () => Promise.reject(new Error('No workspace')),
  removeRecent: () => Promise.resolve(),
  refreshAvailability: () => Promise.resolve(),
};

describe('workbench defensive rendering', () => {
  it('does not render shell slots without an active workspace', async () => {
    render(
      <WorkspaceProvider service={emptyService}>
        <WorkbenchShell />
        <WorkspaceExplorerSidebar />
        <WorkspaceReadyMain />
        <span>provider mounted</span>
      </WorkspaceProvider>,
    );

    expect(await screen.findByText('provider mounted')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Workspace explorer' })).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
  });
});
