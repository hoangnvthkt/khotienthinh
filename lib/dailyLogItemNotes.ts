// Per-item work notes on the engineer slip (owner request 29/09/2026): each WBS
// item carries its own "công tác thực hiện" and "sự cố" as dash-bullet lines.
// The slip-level content/issues are derived from them so the summary prefill
// and older readers keep working.

export const BULLET = '- ';

const stripBullet = (line: string) => line.replace(/^\s*[-•*]\s*/, '').trim();

/** Every non-empty line becomes "- text"; empty bullets are dropped. */
export const normalizeBulletText = (text?: string | null) => (text || '')
  .split('\n').map(stripBullet).filter(Boolean).map(line => `${BULLET}${line}`).join('\n');

export const bulletLines = (text?: string | null) => (text || '').split('\n').map(stripBullet).filter(Boolean);

/** Enter inside a bullet list: start a new bullet, unless the current bullet is still empty. */
export const insertBulletBreak = (value: string, start: number, end: number) => {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  if (!stripBullet(value.slice(lineStart, start)) && start === end) return null;
  const next = `${value.slice(0, start)}\n${BULLET}${value.slice(end)}`;
  return { value: next, caret: start + 1 + BULLET.length };
};

interface NoteRow { wbsCode?: string | null; taskName?: string | null; note?: string | null; issues?: string | null }

const compose = (rows: ReadonlyArray<NoteRow>, pick: (row: NoteRow) => string | null | undefined) => rows
  .map(row => ({ title: [row.wbsCode, row.taskName].filter(Boolean).join(' ').trim(), lines: bulletLines(pick(row)) }))
  .filter(entry => entry.lines.length)
  .map(entry => `${entry.title || 'Hạng mục'}:\n${entry.lines.map(line => `  ${BULLET}${line}`).join('\n')}`)
  .join('\n');

export const composeSlipNotes = (rows: ReadonlyArray<NoteRow>) => ({
  content: compose(rows, row => row.note),
  issues: compose(rows, row => row.issues),
});
