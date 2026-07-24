import { FileWarning } from 'lucide-react';
import type { FileChange } from '../../../core/contracts/changes';
import { parseUnifiedDiff } from '../model/unifiedDiff';

export function DiffViewer({ change }: { change: FileChange }) {
  if (change.binary) {
    return (
      <div className="diff-binary">
        <FileWarning size={28} aria-hidden="true" />
        <strong>Binary preview unavailable</strong>
        <p>This file cannot be displayed as a text diff.</p>
      </div>
    );
  }
  const lines = parseUnifiedDiff(change.diff ?? '');
  if (lines.length === 0 || (lines.length === 1 && lines[0].text === '')) {
    return <div className="diff-empty">No text diff is available for this file.</div>;
  }
  return (
    <div
      className="diff-viewer"
      role="table"
      aria-label={`Unified diff for ${change.relativePath}`}
    >
      {lines.map((line, index) => (
        <div
          className={`diff-line diff-line--${line.kind}`}
          role="row"
          key={`${index}-${line.text}`}
        >
          <span aria-label={line.oldLine === null ? undefined : `Old line ${line.oldLine}`}>
            {line.oldLine ?? ''}
          </span>
          <span aria-label={line.newLine === null ? undefined : `New line ${line.newLine}`}>
            {line.newLine ?? ''}
          </span>
          <code>{line.text || ' '}</code>
        </div>
      ))}
    </div>
  );
}
