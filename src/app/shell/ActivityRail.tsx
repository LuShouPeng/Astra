import {
  Bell,
  CircleAlert,
  FolderKanban,
  GitCompare,
  LayoutDashboard,
  Settings,
  Workflow,
  Blocks,
  Library,
  MoreHorizontal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useI18n } from '../../core/i18n/I18nContext';
import { useWorkbench } from '../../core/state/WorkbenchContext';

const activities = [
  { labelKey: 'nav.commandCenter', icon: LayoutDashboard, to: '/command-center' },
  { labelKey: 'nav.projects', icon: FolderKanban, to: '/projects' },
  { labelKey: 'nav.sessionLibrary', icon: Library, to: '/sessions' },
  { labelKey: 'nav.workflows', icon: Workflow, to: '/workflows' },
  { labelKey: 'nav.extensions', icon: Blocks, to: '/extensions' },
  { labelKey: 'nav.attention', icon: CircleAlert, to: '/attention' },
  { labelKey: 'nav.notifications', icon: Bell, to: '/notifications' },
  { labelKey: 'nav.changes', icon: GitCompare, to: '/changes' },
  { labelKey: 'nav.settings', icon: Settings, to: '/settings' },
] as const;

const compactActivityKeys = new Set([
  'nav.commandCenter',
  'nav.projects',
  'nav.sessionLibrary',
  'nav.workflows',
  'nav.attention',
]);

export function ActivityRail() {
  const { t } = useI18n();
  const { snapshot } = useWorkbench();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const unreadNotifications =
    snapshot?.notifications.filter((notification) => !notification.read).length ?? 0;

  const compactActivities = activities.filter(({ labelKey }) => compactActivityKeys.has(labelKey));
  const moreActivities = activities.filter(({ labelKey }) => !compactActivityKeys.has(labelKey));
  const moreLabel = t('nav.more');

  useEffect(() => {
    if (!moreOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  function renderActivity(
    { labelKey, icon: Icon, to }: (typeof activities)[number],
    compact = false,
    menuItem = false,
  ) {
    const label = t(labelKey);
    return (
      <NavLink
        key={`${compact ? 'compact' : 'rail'}-${labelKey}`}
        className={({ isActive }) =>
          `activity-button${compact ? ' activity-button--compact' : ''}${
            isActive ? ' activity-button--active' : ''
          }`
        }
        aria-label={label}
        role={menuItem ? 'menuitem' : undefined}
        data-tooltip={compact ? undefined : label}
        to={to}
        onClick={compact ? () => setMoreOpen(false) : undefined}
      >
        <Icon size={20} aria-hidden="true" />
        <span className="activity-button__label">{label}</span>
        {labelKey === 'nav.notifications' && unreadNotifications > 0 && (
          <span className="activity-badge" aria-hidden="true">
            {unreadNotifications > 9 ? '9+' : unreadNotifications}
          </span>
        )}
      </NavLink>
    );
  }

  return (
    <nav className="activity-rail" aria-label={t('nav.activities')}>
      <div className="activity-rail__desktop">{activities.map((activity) => renderActivity(activity))}</div>
      <div className="activity-rail__compact">
        {compactActivities.map((activity) => renderActivity(activity, true))}
        <div className="activity-rail__more" ref={moreMenuRef}>
          <button
            className="activity-button activity-button--compact activity-button--more"
            type="button"
            aria-label={moreLabel}
            aria-controls="activity-more-menu"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
            <span className="activity-button__label">{moreLabel}</span>
          </button>
          {moreOpen && (
            <div className="activity-rail__more-menu" id="activity-more-menu" role="menu" aria-label={moreLabel}>
              {moreActivities.map((activity) => renderActivity(activity, true, true))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
