import { FileWarning } from 'lucide-react';
import type { FileChange } from '../../../core/contracts/changes';
import { useI18n } from '../../../core/i18n/I18nContext';
import { parseUnifiedDiff } from '../model/unifiedDiff';

export function DiffViewer({ change }: { change: FileChange }) {
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
        <div
          className={`diff-line diff-line--${line.kind}`}
          role="row"
          key={`${index}-${line.text}`}
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
        </div>
      ))}
    </div>
  );
}
