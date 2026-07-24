import { CircleCheck } from 'lucide-react';

export function StatusBar({ workspaceName, saving }: { workspaceName: string; saving: boolean }) {
  return (
    <footer className="status-bar">
      <span role="status" aria-label="Workbench status" aria-live="polite">
        {saving ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <CircleCheck size={13} aria-hidden="true" />
        )}
        {saving ? 'Saving' : 'Ready'}
      </span>
      <span className="status-bar__workspace" title={workspaceName}>
        {workspaceName}
      </span>
      <span>Prototype</span>
    </footer>
  );
}
