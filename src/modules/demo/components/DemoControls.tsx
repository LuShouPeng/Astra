import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DemoSpeed } from '../../../core/contracts/demo';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import {
  advanceDemo,
  DEMO_RESET_TIMESTAMP,
  DEMO_STEP_COUNT,
  DEMO_STEP_INTERVAL_MS,
  setDemoPlayback,
  setDemoSpeed,
} from '../model/demoPlayback';

const speeds = [0.5, 1, 2] as const satisfies readonly DemoSpeed[];

function emitTransition(previous: WorkbenchSnapshot, next: WorkbenchSnapshot): void {
  const previousNotificationIds = new Set(previous.notifications.map((item) => item.id));
  next.notifications
    .filter((item) => !previousNotificationIds.has(item.id))
    .forEach((notification) => appEventBus.emit('notification:created', notification));

  const previousAttentionIds = new Set(previous.attentionItems.map((item) => item.id));
  next.attentionItems
    .filter((item) => !previousAttentionIds.has(item.id))
    .forEach((attention) => appEventBus.emit('attention:created', attention));

  next.sessions.forEach((session) => {
    const previousSession = previous.sessions.find((candidate) => candidate.id === session.id);
    if (previousSession && previousSession.status !== session.status) {
      appEventBus.emit('session:status-changed', {
        session,
        previousStatus: previousSession.status,
      });
    }
  });
}

export function DemoControls() {
  const { snapshot, saveSnapshot, resetSnapshot, saving } = useWorkbench();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(next: WorkbenchSnapshot, message?: string) {
    if (!snapshot) return;
    setPending(true);
    setError(null);
    try {
      await saveSnapshot(next);
      emitTransition(snapshot, next);
      setFeedback(message ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo state could not be saved.');
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!snapshot?.demo.isRunning || saving || pending) return;
    const timer = window.setTimeout(() => {
      void persist(advanceDemo(snapshot));
    }, DEMO_STEP_INTERVAL_MS / snapshot.demo.speed);
    return () => window.clearTimeout(timer);
  });

  if (!snapshot) return null;
  const controlsDisabled = saving || pending;
  const finished = snapshot.demo.currentStep >= DEMO_STEP_COUNT;

  async function reset() {
    setPending(true);
    setError(null);
    try {
      await resetSnapshot();
      appEventBus.emit('demo:reset', { timestamp: DEMO_RESET_TIMESTAMP });
      setFeedback('Demo data reset');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo data could not be reset.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="demo-controls">
      <div className="settings-row demo-controls__playback">
        <div>
          <strong>Simulation Timeline</strong>
          <small>
            Step {snapshot.demo.currentStep} of {DEMO_STEP_COUNT}
          </small>
        </div>
        <div className="demo-controls__commands">
          <button
            className="icon-button"
            aria-label={snapshot.demo.isRunning ? 'Pause demo' : 'Play demo'}
            title={snapshot.demo.isRunning ? 'Pause demo' : 'Play demo'}
            disabled={controlsDisabled || finished}
            onClick={() => void persist(setDemoPlayback(snapshot, !snapshot.demo.isRunning))}
          >
            {snapshot.demo.isRunning ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Next demo step"
            title="Next demo step"
            disabled={controlsDisabled || snapshot.demo.isRunning || finished}
            onClick={() => void persist(advanceDemo(snapshot), 'Demo advanced one step')}
          >
            <StepForward size={16} />
          </button>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <strong>Simulation Speed</strong>
          <small>Playback interval</small>
        </div>
        <div className="demo-speed" role="radiogroup" aria-label="Simulation speed">
          {speeds.map((speed) => (
            <button
              key={speed}
              role="radio"
              aria-checked={snapshot.demo.speed === speed}
              disabled={controlsDisabled}
              onClick={() => void persist(setDemoSpeed(snapshot, speed))}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <strong>Reset Demo Data</strong>
          <small>Restore frozen projects, Sessions, and activity</small>
        </div>
        <button
          className="button button--compact"
          aria-label="Reset Demo Data"
          disabled={controlsDisabled}
          onClick={() => void reset()}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
      </div>

      {(feedback || error) && (
        <p
          className={error ? 'demo-controls__feedback is-error' : 'demo-controls__feedback'}
          role={error ? 'alert' : 'status'}
        >
          {error ?? feedback}
        </p>
      )}
    </div>
  );
}
