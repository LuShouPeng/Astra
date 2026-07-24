import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { selectProjects } from './projectSelectors';

describe('selectProjects', () => {
  it('searches names, descriptions, and branches case-insensitively', () => {
    const projects = createDemoSnapshot().projects;

    expect(selectProjects(projects, 'CUSTOMER', 'recent').map((item) => item.id)).toEqual([
      'project-frontend',
    ]);
    expect(selectProjects(projects, 'feat/mobile', 'recent').map((item) => item.id)).toEqual([
      'project-frontend',
    ]);
  });

  it('sorts by recent activity or project name without mutating source order', () => {
    const projects = createDemoSnapshot().projects;

    expect(selectProjects(projects, '', 'name').map((item) => item.name)).toEqual([
      'ai-service',
      'backend-api',
      'frontend',
    ]);
    expect(selectProjects(projects, '', 'recent').map((item) => item.name)).toEqual([
      'backend-api',
      'frontend',
      'ai-service',
    ]);
    expect(projects[0].name).toBe('backend-api');
  });
});
