import { Bot, Files, GitCompare, MessageSquare, TerminalSquare } from 'lucide-react';

const futureActivities = [
  { label: 'Agents', icon: Bot },
  { label: 'Chat', icon: MessageSquare },
  { label: 'Terminal', icon: TerminalSquare },
  { label: 'Source Control and Diff', icon: GitCompare },
];

export function ActivityRail() {
  return (
    <nav className="activity-rail" aria-label="Workbench activities">
      <button
        className="activity-button activity-button--active"
        aria-label="Explorer"
        aria-current="page"
      >
        <Files size={21} />
      </button>
      {futureActivities.map(({ label, icon: Icon }) => (
        <button
          key={label}
          className="activity-button activity-button--disabled"
          aria-label={`${label} (Coming soon)`}
          data-tooltip={`${label} · Coming soon`}
          disabled
        >
          <Icon size={20} />
        </button>
      ))}
    </nav>
  );
}
