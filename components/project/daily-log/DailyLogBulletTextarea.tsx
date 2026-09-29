import React, { useLayoutEffect, useRef } from 'react';
import { BULLET, bulletLines, insertBulletBreak, normalizeBulletText } from '../../../lib/dailyLogItemNotes';

interface Props {
  label: string;
  value?: string | null;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  emptyText: string;
  tone?: 'default' | 'warning';
  onChange(value: string): void;
}

/** A textarea where every line is a dash bullet; Enter starts the next bullet. */
export const DailyLogBulletTextarea: React.FC<Props> = ({ label, value, placeholder, disabled, readOnly, emptyText, tone = 'default', onChange }) => {
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  // Place the caret in the same commit as the new bullet, before the next keystroke.
  useLayoutEffect(() => {
    if (caret.current == null || !box.current) return;
    box.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);
  if (readOnly) {
    const lines = bulletLines(value);
    return <div className={`dl-slip-bullets dl-slip-bullets-${tone}`}><span>{label}</span>
      {lines.length ? <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p>{emptyText}</p>}</div>;
  }
  return <label className={`dl-slip-bullets dl-slip-bullets-${tone}`}>{label}
    <textarea ref={box} value={value || ''} disabled={disabled} placeholder={placeholder} rows={3}
      onFocus={event => { if (!event.target.value) onChange(BULLET); }}
      onBlur={event => onChange(normalizeBulletText(event.target.value))}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        const target = event.currentTarget;
        event.preventDefault();
        const next = insertBulletBreak(target.value, target.selectionStart, target.selectionEnd);
        if (!next) return;
        caret.current = next.caret;
        onChange(next.value);
      }}
      onChange={event => {
        const next = event.target.value;
        // Typing into an empty box starts the first bullet even if focus never left it.
        onChange(!value && next && !/^\s*[-•*]/.test(next) ? `${BULLET}${next}` : next);
      }} />
  </label>;
};
