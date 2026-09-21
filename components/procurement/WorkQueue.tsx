import React from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, MapPin, UserRound } from 'lucide-react';
import { formatProcurementQuantity } from '../../lib/procurement/presentation';
import type { ProcurementWorkbenchRow } from '../../types/procurementWorkbench';

const toneClass = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200',
  danger: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200',
};

const quantity = (value: string | null, unit: string | null) => value == null
  ? 'Chưa xác định'
  : `${formatProcurementQuantity(value)}${unit ? ` ${unit}` : ''}`;

export const WorkQueue: React.FC<{
  rows: ProcurementWorkbenchRow[];
  selectedId?: string;
  onSelect: (row: ProcurementWorkbenchRow) => void;
}> = ({ rows, selectedId, onSelect }) => (
  <section aria-label="Danh sách công việc" className="min-w-0 w-full divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
    {rows.map(row => {
      const selected = row.id === selectedId;
      return (
        <button
          key={row.id}
          type="button"
          onClick={() => onSelect(row)}
          className={`group grid min-h-[108px] min-w-0 w-full grid-cols-[minmax(0,1fr)] gap-3 px-4 py-4 text-left transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 sm:grid-cols-[minmax(0,1fr)_180px_36px] sm:items-center ${selected
            ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-black text-slate-900 dark:text-white">{row.title}</span>
              {row.tags.map(tag => <span key={`${row.id}-${tag.label}`} className={`rounded-full px-2 py-1 text-[11px] font-black ${toneClass[tag.tone]}`}>{tag.label}</span>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              <span className="font-mono text-emerald-700 dark:text-emerald-300">{row.sourceCode}</span>
              <span className="inline-flex items-center gap-1"><MapPin size={13} />{row.destinationLabel || 'Chưa có điểm nhận'}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{row.neededDate || 'Chưa có ngày cần'}</span>
              <span className="inline-flex items-center gap-1"><UserRound size={13} />{row.assigneeUserId ? 'Đã phân công' : 'Chưa phân công'}</span>
            </div>
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-slate-700 dark:text-slate-200">
              {row.actionKind === 'reconcile' && <AlertTriangle size={15} className="text-amber-600" />}
              {row.nextActionLabel}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-right dark:bg-slate-950/70">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">Còn bố trí</div>
            <div className={`mt-1 text-lg font-black ${row.balance.availableToPlan == null ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>
              {quantity(row.balance.availableToPlan, row.unit)}
            </div>
          </div>
          <ArrowRight className="hidden text-slate-300 transition group-hover:translate-x-1 group-hover:text-emerald-600 sm:block" size={20} />
        </button>
      );
    })}
  </section>
);
