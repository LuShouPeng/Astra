import {
  Bell,
  CircleAlert,
  FolderKanban,
  GitCompare,
  LayoutDashboard,
  Settings,
  Workflow,
  Blocks,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../core/i18n/I18nContext';
import { useWorkbench } from '../../core/state/WorkbenchContext';

const activities = [
  { labelKey: 'nav.commandCenter', icon: LayoutDashboard, to: '/command-center' },
  { labelKey: 'nav.projects', icon: FolderKanban, to: '/projects' },
  { labelKey: 'nav.workflows', icon: Workflow, to: '/workflows' },
  { labelKey: 'nav.extensions', icon: Blocks, to: '/extensions' },
  { labelKey: 'nav.attention', icon: CircleAlert, to: '/attention' },
  { labelKey: 'nav.notifications', icon: Bell, to: '/notifications' },
  { labelKey: 'nav.changes', icon: GitCompare, to: '/changes' },
  { labelKey: 'nav.settings', icon: Settings, to: '/settings' },
] as const;

export function ActivityRail() {
  const { t } = useI18n();
  const { snapshot } = useWorkbench();
  const unreadNotifications =
    snapshot?.notifications.filter((notification) => !notification.read).length ?? 0;
  return (
    <nav className="activity-rail" aria-label={t('nav.activities')}>
      {activities.map(({ labelKey, icon: Icon, to }) => {
        const label = t(labelKey);
        return (
          <NavLink
            key={labelKey}
            className={({ isActive }) =>
              `activity-button${isActive ? ' activity-button--active' : ''}`
            }
            aria-label={label}
            data-tooltip={label}
            to={to}
          >
            <Icon size={20} aria-hidden="true" />
            {labelKey === 'nav.notifications' && unreadNotifications > 0 && (
              <span className="activity-badge" aria-hidden="true">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
