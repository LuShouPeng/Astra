import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowDraft } from '../model/workflowPlanner';
import { BrowserWorkflowAdapter, createWorkflowService } from './workflowService';

describe('workflow service browser fallback', () => {
  beforeEach(() => localStorage.clear());

  it('persists workflows and creates resumable run projections', async () => {
    const service = createWorkflowService(new BrowserWorkflowAdapter());
    const workflow = createWorkflowDraft('project-1', 'Build');
    await service.save(workflow);
    expect(await service.list()).toEqual([workflow]);

    const run = await service.createRun(workflow);
    expect(run.status).toBe('waiting');
    expect((await service.getRun(run.id))?.nodeRuns).toHaveLength(workflow.nodes.length);
    const approved = await service.decideRun(run.id, true);
    expect(approved.status).toBe('queued');
    expect(approved.nodeRuns[0]?.status).toBe('ready');
    const cancelled = await service.cancelRun(run.id);
    expect(cancelled.status).toBe('cancelled');
  });
});
