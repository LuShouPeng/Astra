import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { searchSessionLibrary, setSessionArchived } from './sessionLibrary';

describe('sessionLibrary', () => {
  it('searches titles, summaries, projects, and timeline content across sessions', () => {
    const snapshot = createDemoSnapshot();
    expect(searchSessionLibrary(snapshot, 'timeout').map((result) => result.session.id)).toContain(
      'session-backend-claude',
    );
    expect(
      searchSessionLibrary(snapshot, 'authentication').map((result) => result.session.id),
    ).toContain('session-backend-codex');
    expect(
      searchSessionLibrary(snapshot, 'mobile navigation').map((result) => result.session.id),
    ).toContain('session-frontend-codex');
  });

  it('filters archived sessions and updates archive state without mutating the snapshot', () => {
    const snapshot = createDemoSnapshot();
    const next = setSessionArchived(snapshot, 'session-backend-codex', true);
    expect(
      snapshot.sessions.find((session) => session.id === 'session-backend-codex')?.archived,
    ).toBeUndefined();
    expect(searchSessionLibrary(next, '', 'archived')).toHaveLength(1);
    expect(
      searchSessionLibrary(next, '', 'active').some(
        (result) => result.session.id === 'session-backend-codex',
      ),
    ).toBe(false);
  });
});
