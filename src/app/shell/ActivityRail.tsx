import {
  Bell,
  CircleAlert,
  FolderKanban,
  GitCompare,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useWorkbench } from '../../core/state/WorkbenchContext';

const activities = [
  { label: 'Command Center', icon: LayoutDashboard, to: '/command-center' },
  { label: 'Projects', icon: FolderKanban, to: '/projects' },
  { label: 'Needs Attention', icon: CircleAlert, to: '/attention' },
  { label: 'Notifications', icon: Bell, to: '/notifications' },
  { label: 'Changes', icon: GitCompare, to: '/changes' },
  { label: 'Settings', icon: Settings, to: '/settings' },
] as const;

export function ActivityRail() {
  const { snapshot } = useWorkbench();
  const unreadNotifications =
    snapshot?.notifications.filter((notification) => !notification.read).length ?? 0;
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
          {label === 'Notifications' && unreadNotifications > 0 && (
            <span className="activity-badge" aria-hidden="true">
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
