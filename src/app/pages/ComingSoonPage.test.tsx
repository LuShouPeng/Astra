import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ComingSoonPage } from './ComingSoonPage';

describe('ComingSoonPage', () => {
  it.each([
    ['/projects', 'Projects'],
    ['/sessions/session-1', 'Session'],
    ['/attention', 'Needs Attention'],
    ['/changes', 'Changes'],
    ['/settings', 'Settings'],
    ['/unknown', 'Page'],
  ])('labels the %s route', (path, label) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<ComingSoonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: label })).toBeVisible();
  });
});
