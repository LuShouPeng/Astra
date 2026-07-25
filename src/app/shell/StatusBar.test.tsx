import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('exposes global save progress for asynchronous workbench actions', () => {
    const { rerender } = render(<StatusBar workspaceName="Astra Nexus" saving={false} />);

    expect(screen.getByRole('status', { name: 'Workbench status' })).toHaveTextContent('Ready');
    expect(screen.getByText('Local workspace')).toBeVisible();

    rerender(<StatusBar workspaceName="Astra Nexus" saving />);
    expect(screen.getByRole('status', { name: 'Workbench status' })).toHaveTextContent('Saving');
  });
});
