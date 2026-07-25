import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useWorkbenchShortcuts } from './useWorkbenchShortcuts';

function Harness() {
  useWorkbenchShortcuts();
  const location = useLocation();
  return (
    <>
      <input aria-label="Message editor" />
      <output aria-label="Current route">{location.pathname}</output>
    </>
  );
}

describe('useWorkbenchShortcuts', () => {
  it('navigates with global shortcuts without intercepting text inputs', () => {
    render(
      <MemoryRouter initialEntries={['/command-center']}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { altKey: true, key: '3' });
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/attention');

    fireEvent.keyDown(screen.getByLabelText('Message editor'), { altKey: true, key: '2' });
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/attention');

    fireEvent.keyDown(window, { ctrlKey: true, key: ',' });
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('/settings');
  });
});
