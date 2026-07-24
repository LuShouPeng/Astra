import { Bell, FolderKanban, GitCompare, LayoutDashboard, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const activities = [
  { label: 'Command Center', icon: LayoutDashboard, to: '/command-center' },
  { label: 'Projects', icon: FolderKanban, to: '/projects' },
  { label: 'Needs Attention', icon: Bell, to: '/attention' },
  { label: 'Changes', icon: GitCompare, to: '/changes' },
  { label: 'Settings', icon: Settings, to: '/settings' },
] as const;

export function ActivityRail() {
  return (
    <nav className="activity-rail" aria-label="Workbench activities">
      {activities.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={label}
          className={({ isActive }) =>
            `activity-button${isActive ? ' activity-button--active' : ''}`
          }
          aria-label={label}
          data-tooltip={label}
          to={to}
        >
          <Icon size={20} aria-hidden="true" />
        </NavLink>
      ))}
    </nav>
  );
}
