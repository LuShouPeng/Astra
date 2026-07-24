import { CircleCheck } from 'lucide-react';

export function StatusBar({ workspaceName }: { workspaceName: string }) {
  return (
    <footer className="status-bar">
      <span>
        <CircleCheck size={13} aria-hidden="true" />
        Ready
      </span>
      <span className="status-bar__workspace" title={workspaceName}>
        {workspaceName}
      </span>
      <span>Prototype</span>
    </footer>
  );
}
