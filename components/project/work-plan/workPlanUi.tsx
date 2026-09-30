import React, { useState } from 'react';
import { ChevronRight, ChevronsUpDown, HardHat } from 'lucide-react';
import { WORK_PLAN_STATUS_LABELS, type WorkPlanStatus } from '../../../lib/projectWorkPlanService';

// Shared look of the planning screens (Kế hoạch thi công / Kế hoạch vật tư):
// numbered, collapsible groups, status chips and one stable colour per crew.
export const fmt = (value: number | null | undefined, digits = 2) => value == null || Number.isNaN(value)
  ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value);
export const parseQty = (value: string): number | null => {
  const text = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
};
export const qtyInput = (value: number | null | undefined) => value == null ? '' : String(Math.round(value * 1000) / 1000).replace('.', ',');
export const dateVi = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('vi-VN') : '';

export const STATUS_STYLE: Record<WorkPlanStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  submitted: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  returned: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  superseded: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
};

export const StatusChip: React.FC<{ status: WorkPlanStatus }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
    {WORK_PLAN_STATUS_LABELS[status]}
  </span>
);

export const groupBy = <T extends { groupName: string | null }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  rows.forEach(row => { const key = row.groupName || 'Công việc khác'; map.set(key, [...(map.get(key) || []), row]); });
  return Array.from(map.entries());
};

// ---------------------------------------------------------------------------
// Shared look: numbered, collapsible work groups (FastCons-style index 1 / 1.1)
// and one stable colour per crew so the same team reads the same everywhere.
// ---------------------------------------------------------------------------
const CREW_COLORS = [
  'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-800',
  'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-800',
  'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800',
  'bg-lime-50 text-lime-800 border-lime-200 dark:bg-lime-950/40 dark:text-lime-200 dark:border-lime-800',
  'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-200 dark:border-fuchsia-800',
  'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:border-cyan-800',
  'bg-yellow-50 text-yellow-900 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-100 dark:border-yellow-800',
  'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800',
];
export const crewColor = (name: string) => {
  let hash = 0;
  for (const ch of name.trim().toLocaleLowerCase('vi')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CREW_COLORS[hash % CREW_COLORS.length];
};
export const CrewPill: React.FC<{ name: string | null | undefined }> = ({ name }) => name?.trim()
  ? <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs font-semibold ${crewColor(name)}`}><HardHat size={11} className="shrink-0" />{name.trim()}</span>
  : <span className="text-xs text-muted-foreground">Chưa giao tổ đội</span>;

export const useGroupAccordion = (groups: string[]) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return {
    isOpen: (group: string) => open.has(group),
    toggle: (group: string) => setOpen(current => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; }),
    expandAll: () => setOpen(new Set(groups)),
    collapseAll: () => setOpen(new Set()),
    allOpen: groups.length > 0 && groups.every(g => open.has(g)),
  };
};

export const AccordionToolbar: React.FC<{ count: number; allOpen: boolean; onExpand: () => void; onCollapse: () => void }> = ({ count, allOpen, onExpand, onCollapse }) =>
  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
    <span>{count} hạng mục chính</span>
    <button type="button" onClick={allOpen ? onCollapse : onExpand} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-semibold text-foreground hover:bg-muted">
      <ChevronsUpDown size={13} />{allOpen ? 'Thu gọn hết' : 'Mở rộng hết'}</button>
  </div>;

export const GroupHeader: React.FC<{
  index: number; name: string; open: boolean; onToggle: () => void; count: number; tone: string; children?: React.ReactNode;
}> = ({ index, name, open, onToggle, count, tone, children }) =>
  <button type="button" aria-expanded={open} onClick={onToggle}
    className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-l-4 border-border px-3 py-2.5 text-left transition-colors hover:brightness-[0.98] md:flex-nowrap ${tone}`}>
    <ChevronRight size={16} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
    <span className="w-6 shrink-0 text-sm font-bold tabular-nums">{index}</span>
    <span className="min-w-0 flex-1 text-sm font-bold uppercase tracking-wide">{name}<span className="ml-2 text-xs font-medium normal-case tracking-normal opacity-70">{count} việc</span></span>
    {children && <span className="flex w-full flex-wrap items-center gap-1.5 pl-[3.25rem] md:w-auto md:justify-end md:pl-0">{children}</span>}
  </button>;

export const uniqueCrews = (lines: Array<{ crewLabel: string | null }>) =>
  Array.from(new Set(lines.map(l => l.crewLabel?.trim()).filter((c): c is string => Boolean(c))));

