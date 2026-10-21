import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { vnToday } from '../../lib/businessDate';
import { KIND_TEXT, type EmploymentDateKind, type WorkStatusInput } from '../../lib/hrmWorkStatus';

interface Props {
  kind: EmploymentDateKind;
  value: WorkStatusInput;
  onChange: (value: WorkStatusInput) => void;
  error?: string | null;
  inputClassName: string;
  /** Bound the date picker (today / ngày vào làm). Only in forms with noValidate, so our message shows instead of the browser's. */
  bounded?: boolean;
  minDate?: string | null;
  autoFocus?: boolean;
}

const labelCls = 'text-xs font-bold text-slate-500 uppercase tracking-wider';

/** Ngày + lý do (gợi ý bấm là điền) + số quyết định. Used inside the profile form and the small dialogs. */
const EmploymentDateFields: React.FC<Props> = ({ kind, value, onChange, error, inputClassName, bounded, minDate, autoFocus }) => {
  const text = KIND_TEXT[kind];
  const set = (patch: Partial<WorkStatusInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className={labelCls}>{text.dateLabel} *</span>
        <input type="date" value={value.date} max={bounded ? vnToday() : undefined} min={bounded && minDate ? minDate : undefined} autoFocus={autoFocus}
          onChange={event => set({ date: event.target.value })} className={inputClassName} aria-label={text.dateLabel} />
      </label>
      {kind !== 'start' && (
        <>
          <div className="space-y-1.5">
            <span className={labelCls}>Lý do *</span>
            <div className="flex flex-wrap gap-1.5">
              {text.notes.map(note => (
                <button key={note} type="button" onClick={() => set({ note })} aria-pressed={value.note === note}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${value.note === note
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {note}
                </button>
              ))}
            </div>
            <input type="text" value={value.note} maxLength={200} onChange={event => set({ note: event.target.value })}
              placeholder="Hoặc ghi lý do khác" className={inputClassName} aria-label="Lý do" />
          </div>
          <label className="block space-y-1.5">
            <span className={labelCls}>Số quyết định (nếu có)</span>
            <input type="text" value={value.reference} maxLength={80} onChange={event => set({ reference: event.target.value })}
              placeholder="Ví dụ: QĐ 12/2026/QĐ-TT" className={inputClassName} aria-label="Số quyết định" />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-rose-600 dark:text-rose-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}
        </p>
      )}
    </div>
  );
};

export default EmploymentDateFields;
