import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { ChangesService } from '../services/changesService';
import { ChangesReview } from './ChangesReview';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('ChangesReview', () => {
  // 回归：live 会话初始零文件变更 + 传入 service + 本地可用项目时，
  // 旧代码在早返回前访问 selected.binary 抛 TypeError（真机 M5 验证发现）。
  it('renders empty state without crashing when a session has no changes and a service is provided', async () => {
    const snapshot = createDemoSnapshot();
    // 选一个本地可用项目，并把目标会话的文件变更清空。
    const project = snapshot.projects[0];
    project.source = 'local';
    project.status = 'available';
    const session = snapshot.sessions.find((s) => s.projectId === project.id)!;
    snapshot.fileChanges = snapshot.fileChanges.filter((c) => c.sessionId !== session.id);

    const service: ChangesService = {
      list: vi.fn(),
      diff: vi.fn(),
      openFile: vi.fn(),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesReview sessionId={session.id} service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('No changed files are available for review.'),
    ).toBeVisible();
  });
});
