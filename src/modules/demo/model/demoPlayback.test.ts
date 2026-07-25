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

  it('advances safely when the recorded target session is no longer available', () => {
    const snapshot = createDemoSnapshot();
    snapshot.sessions = snapshot.sessions.filter(
      (session) => session.id !== 'session-backend-claude',
    );

    const completed = Array.from({ length: DEMO_STEP_COUNT }).reduce(advanceDemo, snapshot);

    expect(completed.demo).toEqual({ isRunning: false, speed: 1, currentStep: DEMO_STEP_COUNT });
    expect(completed.timelineEvents.some((event) => event.id.startsWith('event-demo-'))).toBe(
      false,
    );
    expect(completed.attentionItems.some((item) => item.id.startsWith('attention-demo-'))).toBe(
      false,
    );
    expect(completed.notifications.some((item) => item.id.startsWith('notification-demo-'))).toBe(
      false,
    );
  });

  it('does not restart a completed demo and returns independent snapshots at the advance boundary', () => {
    const completed = {
      ...createDemoSnapshot(),
      demo: { isRunning: false, speed: 1 as const, currentStep: DEMO_STEP_COUNT },
    };

    const playback = setDemoPlayback(completed, true);
    const oncePastTheBoundary = advanceDemo(playback);
    const twicePastTheBoundary = advanceDemo(oncePastTheBoundary);

    expect(playback.demo).toEqual({ isRunning: false, speed: 1, currentStep: DEMO_STEP_COUNT });
    expect(oncePastTheBoundary).toEqual(playback);
    expect(oncePastTheBoundary).not.toBe(playback);
    expect(twicePastTheBoundary).toEqual(playback);
    expect(twicePastTheBoundary).not.toBe(oncePastTheBoundary);
  });
});
