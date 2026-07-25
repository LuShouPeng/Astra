import { FileWarning } from 'lucide-react';
import type { FileChange } from '../../../core/contracts/changes';
import { useI18n } from '../../../core/i18n/I18nContext';
import { parseUnifiedDiff } from '../model/unifiedDiff';

export function DiffViewer({
  change,
  onSelectLine,
}: {
  change: FileChange;
  onSelectLine?: (line: number) => void;
}) {
  const { t } = useI18n();
  if (change.binary) {
    return (
      <div className="diff-binary">
        <FileWarning size={28} aria-hidden="true" />
        <strong>{t('diff.binaryUnavailable')}</strong>
        <p>{t('diff.binaryDescription')}</p>
      </div>
    );
  }
  const lines = parseUnifiedDiff(change.diff ?? '');
  if (lines.length === 0 || (lines.length === 1 && lines[0].text === '')) {
    return <div className="diff-empty">{t('diff.empty')}</div>;
  }
  return (
    <div
      className="diff-viewer"
      role="table"
      aria-label={t('diff.unifiedNamed', { name: change.relativePath })}
    >
      {lines.map((line, index) => (
        <button
          type="button"
          className={`diff-line diff-line--${line.kind}`}
          role="row"
          key={`${index}-${line.text}`}
          disabled={line.newLine === null || !onSelectLine}
          aria-label={
            line.newLine === null ? undefined : t('changes.commentLine', { line: line.newLine })
          }
          onClick={() => line.newLine !== null && onSelectLine?.(line.newLine)}
        >
          <span
            aria-label={
              line.oldLine === null ? undefined : t('diff.oldLine', { line: line.oldLine })
            }
          >
            {line.oldLine ?? ''}
          </span>
          <span
            aria-label={
              line.newLine === null ? undefined : t('diff.newLine', { line: line.newLine })
            }
          >
            {line.newLine ?? ''}
          </span>
          <code>{line.text || ' '}</code>
        </button>
      ))}
    </div>
  );
}
