// Gợi ý in mờ dùng chung (chủ SP 11/10/2026): chữ mờ chưa phải dữ liệu — Tab / Enter / bấm để dùng, Esc / Bỏ để ẩn.
import React from 'react';
import { History } from 'lucide-react';

/** Khối gợi ý cho một nhóm ô (nhiều dòng): cả khối là một nút. */
export const PrefillGhost: React.FC<{
  title: string;
  rows: string[];
  /** "nhật ký 11/10 của bạn", "đơn PO-621 (8/10)" */
  sourceLabel: string;
  /** Chữ đầu khối, mặc định "Như hôm qua". */
  heading?: string;
  onAccept: () => void;
  onDismiss: () => void;
}> = ({ title, rows, sourceLabel, heading = 'Như hôm qua', onAccept, onDismiss }) => (
  <div
    role="group"
    tabIndex={0}
    aria-label={`${heading}: ${title}`}
    data-testid="prefill-ghost"
    onClick={onAccept}
    onKeyDown={event => {
      if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'Enter') { event.preventDefault(); onAccept(); }
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
    }}
    className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2.5 cursor-pointer outline-none focus:ring-2 focus:ring-teal-400 hover:border-teal-400 transition-colors"
  >
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-600 dark:text-slate-300">
        <History size={12} className="text-teal-600" /> {heading}
        <span className="font-bold text-slate-400 dark:text-slate-500">· {sourceLabel}{rows.length > 1 ? ` · ${rows.length} dòng` : ''}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={event => { event.stopPropagation(); onAccept(); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-black">
          Dùng <kbd className="hidden sm:inline rounded bg-white/20 px-1 font-mono text-[9px] font-bold">Tab</kbd>
        </button>
        <button type="button" onClick={event => { event.stopPropagation(); onDismiss(); }}
          className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700">
          Bỏ
        </button>
      </div>
    </div>
    <ul className="mt-1.5 space-y-0.5 text-xs italic text-slate-400 dark:text-slate-500">
      {rows.map((row, index) => <li key={index} className="truncate">{row}</li>)}
    </ul>
  </div>
);

export interface InputGhost {
  /** Chữ mờ hiện trong ô (đã định dạng). */
  text: string;
  /** Giá trị điền vào ô khi dùng. */
  value: string;
  /** Nguồn, hiện khi rê chuột: "Theo PO-621 (8/10) · /kg". */
  title?: string;
}

export const GHOST_INPUT_CLASS = 'placeholder:italic placeholder:text-slate-400 dark:placeholder:text-slate-500';

/**
 * Chữ mờ trong một ô nhập: chỉ khi ô còn trống. Tab = dùng rồi sang ô kế (không chặn Tab); Enter = dùng.
 * Trả về props gắn vào <input> và lớp CSS cho chữ mờ; không có gợi ý thì trả về rỗng.
 */
export type GhostInputProps = Pick<React.InputHTMLAttributes<HTMLInputElement>, 'placeholder' | 'title' | 'onKeyDown'> & { 'data-ghost'?: string };

export const ghostInput = (ghost: InputGhost | null | undefined, value: string, accept: (value: string) => void) => {
  if (!ghost || value.trim() !== '') return { active: false, className: '', props: {} as GhostInputProps };
  const props: GhostInputProps = {
    placeholder: ghost.text,
    title: ghost.title,
    'data-ghost': ghost.value,
    onKeyDown: event => {
      if (event.key === 'Tab' && !event.shiftKey) accept(ghost.value);
      if (event.key === 'Enter') { event.preventDefault(); accept(ghost.value); }
    },
  };
  return { active: true, className: GHOST_INPUT_CLASS, props };
};
