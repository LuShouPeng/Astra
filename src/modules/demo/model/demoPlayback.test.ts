import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../data/demoFixtures';
import { DEMO_STEP_COUNT, advanceDemo, setDemoPlayback, setDemoSpeed } from './demoPlayback';

describe('deterministic demo playback', () => {
  it('applies the frozen waiting, resumed, and completed transitions', () => {
    const initial = createDemoSnapshot();
    const waiting = advanceDemo(initial);
    expect(waiting.demo).toMatchObject({ currentStep: 1 });
    expect(
      waiting.sessions.find((session) => session.id === 'session-backend-claude'),
    ).toMatchObject({ status: 'waiting', currentAction: 'Waiting for test strategy approval' });
    expect(waiting.attentionItems).toContainEqual(
      expect.objectContaining({ id: 'attention-demo-test-approval', resolved: false }),
    );
    expect(waiting.notifications).toContainEqual(
      expect.objectContaining({ id: 'notification-demo-test-approval', read: false }),
    );

    const resumed = advanceDemo(waiting);
    expect(resumed.demo.currentStep).toBe(2);
    expect(
      resumed.sessions.find((session) => session.id === 'session-backend-claude')?.status,
    ).toBe('running');
    expect(
      resumed.attentionItems.find((item) => item.id === 'attention-demo-test-approval'),
    ).toMatchObject({ read: true, resolved: true });

    const completed = advanceDemo(resumed);
    expect(completed.demo).toEqual({ isRunning: false, speed: 1, currentStep: DEMO_STEP_COUNT });
    expect(
      completed.sessions.find((session) => session.id === 'session-backend-claude'),
    ).toMatchObject({
      status: 'completed',
      testStatus: 'passed',
      currentAction: 'Ready for review',
    });
    expect(completed.notifications).toContainEqual(
      expect.objectContaining({ id: 'notification-demo-completed', event: 'completed' }),
    );
    expect(completed.attentionItems).toContainEqual(
      expect.objectContaining({ id: 'attention-demo-review', type: 'review' }),
    );
  });

  it('is immutable, idempotent at the final step, and preserves the selected speed', () => {
    const initial = setDemoSpeed(createDemoSnapshot(), 2);
    const started = setDemoPlayback(initial, true);
    const completed = Array.from({ length: DEMO_STEP_COUNT }).reduce(advanceDemo, started);

    expect(initial.demo).toEqual({ isRunning: false, speed: 2, currentStep: 0 });
    expect(completed.demo.speed).toBe(2);
    expect(advanceDemo(completed)).toEqual(completed);
  });
});
