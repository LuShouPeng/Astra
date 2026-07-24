import { FolderOpen, MoreHorizontal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceRecord } from '../../../core/contracts/workspace';

interface RecentWorkspaceRowProps {
  workspace: WorkspaceRecord;
  selected: boolean;
  opening: boolean;
  disabled: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRemove: () => void;
}

function formatLastOpened(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
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
            {missing ? 'Missing' : 'Available'}
          </span>
        </div>
        <div className="recent-row__meta">
          <span className="recent-row__path" title={workspace.rootPath}>
            {workspace.rootPath}
          </span>
          <time dateTime={workspace.lastOpenedAt}>{formatLastOpened(workspace.lastOpenedAt)}</time>
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
          aria-label={`Open ${workspace.name}`}
        >
          {opening ? 'Opening...' : 'Open'}
        </button>
        <div className="menu-anchor">
          <button
            className="icon-button"
            aria-label={`More actions for ${workspace.name}`}
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
                Remove from Recent
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
