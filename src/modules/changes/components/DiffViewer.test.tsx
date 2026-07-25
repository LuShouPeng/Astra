import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { parseUnifiedDiff } from '../model/unifiedDiff';
import { DiffViewer } from './DiffViewer';

describe('parseUnifiedDiff', () => {
  it('assigns old and new line numbers across a unified diff hunk', () => {
    expect(
      parseUnifiedDiff('@@ -12,2 +12,3 @@\n context\n-old line\n+new line\n+another line'),
    ).toEqual([
      { kind: 'hunk', oldLine: null, newLine: null, text: '@@ -12,2 +12,3 @@' },
      { kind: 'context', oldLine: 12, newLine: 12, text: ' context' },
      { kind: 'deletion', oldLine: 13, newLine: null, text: '-old line' },
      { kind: 'addition', oldLine: null, newLine: 13, text: '+new line' },
      { kind: 'addition', oldLine: null, newLine: 14, text: '+another line' },
    ]);
  });
});

describe('DiffViewer', () => {
  it('renders line numbers and a binary fallback', () => {
    const changes = createDemoSnapshot().fileChanges;
    const { rerender } = render(<DiffViewer change={changes[0]} />);

    expect(screen.getByText('-const timeout = 5000;')).toBeVisible();
    expect(screen.getByLabelText('Old line 12')).toBeVisible();
    expect(screen.getByLabelText('New line 12')).toBeVisible();

    rerender(<DiffViewer change={changes[3]} />);
    expect(screen.getByText('Binary preview unavailable')).toBeVisible();
    expect(screen.getByText('This file cannot be displayed as a text diff.')).toBeVisible();
  });

  it('renders an explicit empty state when no text diff exists', () => {
    const change = { ...createDemoSnapshot().fileChanges[0], diff: undefined };
    render(<DiffViewer change={change} />);

    expect(screen.getByText('No text diff is available for this file.')).toBeVisible();
  });
});
