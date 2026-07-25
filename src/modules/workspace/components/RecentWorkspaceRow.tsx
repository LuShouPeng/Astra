import { FolderOpen, MoreHorizontal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceRecord } from '../../../core/contracts/workspace';
import { useI18n } from '../../../core/i18n/I18nContext';

interface RecentWorkspaceRowProps {
  workspace: WorkspaceRecord;
  selected: boolean;
  opening: boolean;
  disabled: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRemove: () => void;
}

function formatLastOpened(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function RecentWorkspaceRow({
  workspace,
  selected,
  opening,
  disabled,
  onSelect,
  onOpen,
  onRemove,
}: RecentWorkspaceRowProps) {
  const { language, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const missing = workspace.status === 'missing';

  return (
    <article
      className={`recent-row${selected ? ' recent-row--selected' : ''}${missing ? ' recent-row--missing' : ''}`}
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={() => !missing && !disabled && onOpen()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !missing && !disabled) onOpen();
      }}
    >
      <div className="recent-row__icon" aria-hidden="true">
        {missing ? <TriangleAlert size={18} /> : <FolderOpen size={18} />}
      </div>
      <div className="recent-row__content">
        <div className="recent-row__title-line">
          <h3>{workspace.name}</h3>
          <span className={`status-badge status-badge--${workspace.status}`}>
            {missing ? t('workspace.missing') : t('workspace.available')}
          </span>
        </div>
        <div className="recent-row__meta">
          <span className="recent-row__path" title={workspace.rootPath}>
            {workspace.rootPath}
          </span>
          <time dateTime={workspace.lastOpenedAt}>
            {formatLastOpened(workspace.lastOpenedAt, language)}
          </time>
        </div>
      </div>
      <div className="recent-row__actions">
        <button
          className="button button--compact"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          disabled={missing || disabled}
          aria-label={t('workspace.openNamed', { name: workspace.name })}
        >
          {opening ? t('workspace.opening') : t('workspace.open')}
        </button>
        <div className="menu-anchor">
          <button
            className="icon-button"
            aria-label={t('workspace.moreActions', { name: workspace.name })}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="row-menu" role="menu">
              <button
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  onRemove();
                }}
              >
                {t('workspace.removeRecent')}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
