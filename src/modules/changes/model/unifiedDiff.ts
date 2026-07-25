export type DiffLineKind = 'hunk' | 'context' | 'addition' | 'deletion' | 'meta';

export interface ParsedDiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  return diff.split('\n').map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { kind: 'hunk', oldLine: null, newLine: null, text };
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      return { kind: 'addition', oldLine: null, newLine: newLine++, text };
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      return { kind: 'deletion', oldLine: oldLine++, newLine: null, text };
    }
    if (text.startsWith(' ')) {
      return { kind: 'context', oldLine: oldLine++, newLine: newLine++, text };
    }
    return { kind: 'meta', oldLine: null, newLine: null, text };
  });
}
