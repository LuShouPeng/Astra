import type { DemoSpeed } from '../../../core/contracts/demo';
import type { AppNotification } from '../../../core/contracts/notifications';
import type { AttentionItem } from '../../../core/contracts/attention';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export const DEMO_STEP_COUNT = 3;
export const DEMO_STEP_INTERVAL_MS = 2_400;
export const DEMO_RESET_TIMESTAMP = '2026-07-24T14:21:00.000Z';

const TARGET_SESSION_ID = 'session-backend-claude';
const TARGET_PROJECT_ID = 'project-backend-api';

function appendUnique<T extends { id: string }>(items: T[], item: T): void {
  if (!items.some((candidate) => candidate.id === item.id)) items.push(item);
}

function applyWaitingStep(next: WorkbenchSnapshot): void {
  const session = next.sessions.find((candidate) => candidate.id === TARGET_SESSION_ID);
  if (!session) return;
  session.status = 'waiting';
  session.currentAction = 'Waiting for test strategy approval';
  session.updatedAt = '2026-07-24T14:22:00.000Z';

  const event: TimelineEvent = {
    id: 'event-demo-test-approval',
    sessionId: TARGET_SESSION_ID,
    type: 'approval',
    timestamp: session.updatedAt,
    request: 'Approve the deterministic expanded timeout test matrix.',
    risk: 'low',
    decision: 'pending',
  };
  const attention: AttentionItem = {
    id: 'attention-demo-test-approval',
    sessionId: TARGET_SESSION_ID,
    projectId: TARGET_PROJECT_ID,
    type: 'approval',
    priority: 'medium',
    title: 'Test strategy approval required',
    description: 'Review the simulated timeout test matrix before playback continues.',
    createdAt: session.updatedAt,
    read: false,
    resolved: false,
  };
  const notification: AppNotification = {
    id: 'notification-demo-test-approval',
    sessionId: TARGET_SESSION_ID,
    projectId: TARGET_PROJECT_ID,
    event: 'waiting_approval',
    tone: 'warning',
    title: 'Claude needs approval',
    message: 'The deterministic demo is waiting for test strategy approval.',
    createdAt: session.updatedAt,
    read: false,
    target: { page: 'session', projectId: TARGET_PROJECT_ID, sessionId: TARGET_SESSION_ID },
  };
  appendUnique(next.timelineEvents, event);
  appendUnique(next.attentionItems, attention);
  appendUnique(next.notifications, notification);
}

function applyResumeStep(next: WorkbenchSnapshot): void {
  const session = next.sessions.find((candidate) => candidate.id === TARGET_SESSION_ID);
  if (!session) return;
  const previousStatus = session.status;
  session.status = 'running';
  session.currentAction = 'Running expanded timeout tests';
  session.updatedAt = '2026-07-24T14:23:00.000Z';
  const approval = next.timelineEvents.find(
    (event) => event.id === 'event-demo-test-approval' && event.type === 'approval',
  );
  if (approval?.type === 'approval') approval.decision = 'approved';
  const attention = next.attentionItems.find((item) => item.id === 'attention-demo-test-approval');
  if (attention) {
    attention.read = true;
    attention.resolved = true;
  }
  const notification = next.notifications.find(
    (item) => item.id === 'notification-demo-test-approval',
  );
  if (notification) notification.read = true;
  appendUnique(next.timelineEvents, {
    id: 'event-demo-resumed',
    sessionId: TARGET_SESSION_ID,
    type: 'status',
    timestamp: session.updatedAt,
    from: previousStatus,
    to: 'running',
    content: 'Approval recorded; deterministic test playback resumed.',
  });
}

function applyCompletedStep(next: WorkbenchSnapshot): void {
  const session = next.sessions.find((candidate) => candidate.id === TARGET_SESSION_ID);
  if (!session) return;
  const previousStatus = session.status;
  session.status = 'completed';
  session.currentAction = 'Ready for review';
  session.testStatus = 'passed';
  session.updatedAt = '2026-07-24T14:24:00.000Z';
  session.completedAt = session.updatedAt;
  appendUnique(next.timelineEvents, {
    id: 'event-demo-tests-completed',
    sessionId: TARGET_SESSION_ID,
    type: 'test',
    timestamp: session.updatedAt,
    command: 'npm test -- auth',
    status: 'passed',
    passed: 18,
    failed: 0,
    durationMs: 1842,
  });
  appendUnique(next.timelineEvents, {
    id: 'event-demo-completed',
    sessionId: TARGET_SESSION_ID,
    type: 'status',
    timestamp: session.updatedAt,
    from: previousStatus,
    to: 'completed',
    content: 'Claude completed the deterministic demo session.',
  });
  appendUnique(next.attentionItems, {
    id: 'attention-demo-review',
    sessionId: TARGET_SESSION_ID,
    projectId: TARGET_PROJECT_ID,
    type: 'review',
    priority: 'medium',
    title: 'Changes ready for review',
    description: 'The timeout changes and expanded tests are ready for local review.',
    createdAt: session.updatedAt,
    read: false,
    resolved: false,
  });
  appendUnique(next.notifications, {
    id: 'notification-demo-completed',
    sessionId: TARGET_SESSION_ID,
    projectId: TARGET_PROJECT_ID,
    event: 'completed',
    tone: 'success',
    title: 'Claude simulation completed',
    message: 'The timeout changes passed 18 deterministic tests.',
    createdAt: session.updatedAt,
    read: false,
    target: { page: 'session', projectId: TARGET_PROJECT_ID, sessionId: TARGET_SESSION_ID },
  });
}

const steps = [applyWaitingStep, applyResumeStep, applyCompletedStep] as const;

export function setDemoSpeed(snapshot: WorkbenchSnapshot, speed: DemoSpeed): WorkbenchSnapshot {
  return { ...snapshot, demo: { ...snapshot.demo, speed } };
}

export function setDemoPlayback(
  snapshot: WorkbenchSnapshot,
  isRunning: boolean,
): WorkbenchSnapshot {
  return {
    ...snapshot,
    demo: {
      ...snapshot.demo,
      isRunning: isRunning && snapshot.demo.currentStep < DEMO_STEP_COUNT,
    },
  };
}

export function advanceDemo(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  if (snapshot.demo.currentStep >= DEMO_STEP_COUNT) return structuredClone(snapshot);
  const next = structuredClone(snapshot);
  const nextStep = next.demo.currentStep + 1;
  steps[nextStep - 1](next);
  next.demo.currentStep = nextStep;
  next.demo.isRunning = nextStep < DEMO_STEP_COUNT && next.demo.isRunning;
  return next;
}
