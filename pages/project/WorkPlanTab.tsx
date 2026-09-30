import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, History, Loader2, Plus,
  RotateCcw, Save, Search, Send, Trash2, Undo2, X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import {
  formatWorkPlanPeriod, normalizeWorkPlanPeriodStart, projectWorkPlanService, shiftWorkPlanPeriod, toIsoDate,
  WORK_PLAN_STATUS_LABELS, workPlanLineAchievement,
  type WorkPlan, type WorkPlanAction, type WorkPlanBoard, type WorkPlanCandidate, type WorkPlanLine,
  type WorkPlanPeriodType, type WorkPlanStatus,
} from '../../lib/projectWorkPlanService';

interface WorkPlanTabProps {
  projectId: string;
  constructionSiteId?: string;
}

type DraftLine = Pick<WorkPlanLine, 'taskId' | 'wbsCode' | 'taskName' | 'groupName' | 'unit' | 'totalQty' | 'doneBeforeQty' | 'crewLabel' | 'note'> & {
  plannedQty: string;
  overdue?: boolean;
  monthPlanQty?: number | null;
};

const fmt = (value: number | null | undefined, digits = 2) => value == null || Number.isNaN(value)
  ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value);
const parseQty = (value: string): number | null => {
  const text = value.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
};
const qtyInput = (value: number | null | undefined) => value == null ? '' : String(Math.round(value * 1000) / 1000).replace('.', ',');
const remainingOf = (line: Pick<DraftLine, 'totalQty' | 'doneBeforeQty'>) =>
  line.totalQty == null ? null : Math.max(line.totalQty - (line.doneBeforeQty ?? 0), 0);
const dateVi = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('vi-VN') : '';

const STATUS_STYLE: Record<WorkPlanStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  submitted: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  returned: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  superseded: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
};

const StatusChip: React.FC<{ status: WorkPlanStatus }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
    {WORK_PLAN_STATUS_LABELS[status]}
  </span>
);

const toDraftLine = (line: WorkPlanLine | WorkPlanCandidate, plannedQty: number | null): DraftLine => ({
  taskId: line.taskId, wbsCode: line.wbsCode, taskName: line.taskName, groupName: line.groupName, unit: line.unit,
  totalQty: line.totalQty, doneBeforeQty: line.doneBeforeQty,
  crewLabel: 'crewLabel' in line ? line.crewLabel : null, note: 'note' in line ? line.note : null,
  plannedQty: qtyInput(plannedQty),
  overdue: 'overdue' in line ? line.overdue : undefined,
  monthPlanQty: 'monthPlanQty' in line ? line.monthPlanQty : undefined,
});

const groupBy = <T extends { groupName: string | null }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  rows.forEach(row => { const key = row.groupName || 'Công việc khác'; map.set(key, [...(map.get(key) || []), row]); });
  return Array.from(map.entries());
};

// ---------------------------------------------------------------------------
// Task picker: adds work from the schedule to the plan being written.
// ---------------------------------------------------------------------------
type PickerFilter = 'period' | 'overdue' | 'open';
const TaskPicker: React.FC<{
  candidates: WorkPlanCandidate[]; selected: Set<string>; periodType: WorkPlanPeriodType; initialFilter: PickerFilter;
  onClose: () => void; onAdd: (rows: WorkPlanCandidate[]) => void;
}> = ({ candidates, selected, periodType, initialFilter, onClose, onAdd }) => {
  const [filter, setFilter] = useState<PickerFilter>(initialFilter);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('vi');
    return candidates.filter(c => !selected.has(c.taskId) && !c.finished)
      .filter(c => filter === 'open' || (filter === 'overdue' ? c.overdue : c.inPeriod && !c.overdue))
      .filter(c => !q || `${c.wbsCode || ''} ${c.taskName} ${c.groupName || ''}`.toLocaleLowerCase('vi').includes(q));
  }, [candidates, filter, query, selected]);
  const counts = useMemo(() => {
    const open = candidates.filter(c => !selected.has(c.taskId) && !c.finished);
    return { period: open.filter(c => c.inPeriod && !c.overdue).length, overdue: open.filter(c => c.overdue).length, open: open.length };
  }, [candidates, selected]);
  const toggle = (id: string) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Thêm công việc vào kế hoạch"
    onClick={event => event.target === event.currentTarget && onClose()}>
    <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div><h3 className="text-base font-bold text-foreground">Thêm công việc từ bảng tiến độ</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Khối lượng gợi ý = phần còn lại chia theo số ngày của công việc nằm trong kỳ; việc trễ hạn gợi ý toàn bộ phần còn lại.</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
      </div>
      <div className="space-y-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {([['period', periodType === 'month' ? 'Có lịch trong tháng' : 'Có lịch trong tuần', counts.period], ['overdue', 'Trễ hạn chưa xong', counts.overdue], ['open', 'Tất cả chưa xong', counts.open]] as const).map(([key, label, count]) =>
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${filter === key ? 'border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
              {label} <span className="ml-1 opacity-70">{count}</span></button>)}
        </div>
        <label className="relative block"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã WBS, tên công việc, hạng mục" aria-label="Tìm công việc"
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-600" /></label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? <p className="px-3 py-10 text-center text-sm text-muted-foreground">Không còn công việc phù hợp bộ lọc này.</p>
          : groupBy(rows).map(([group, items]) => <div key={group} className="mb-2">
            <div className="sticky top-0 z-10 bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{group}</div>
            {items.map(c => <label key={c.taskId} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60 ${picked.has(c.taskId) ? 'bg-teal-50/70 dark:bg-teal-950/30' : ''}`}>
              <input type="checkbox" checked={picked.has(c.taskId)} onChange={() => toggle(c.taskId)} className="mt-1 h-4 w-4 accent-teal-700" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{c.wbsCode && <span className="mr-1.5 text-muted-foreground">{c.wbsCode}</span>}{c.taskName}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{dateVi(c.startDate)} – {dateVi(c.endDate)}</span>
                  {c.overdue && <span className="font-semibold text-rose-600 dark:text-rose-400">Trễ hạn</span>}
                  <span>{c.totalQty == null ? 'Chưa có khối lượng' : `Còn ${fmt(c.remainingQty)} / ${fmt(c.totalQty)} ${c.unit || ''}`}</span>
                  {c.suggestedQty != null && <span className="text-teal-700 dark:text-teal-300">Gợi ý {fmt(c.suggestedQty)} {c.unit || ''}</span>}
                  {c.monthPlanQty != null && <span>KH tháng {fmt(c.monthPlanQty)}</span>}
                </span>
              </span>
            </label>)}
          </div>)}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <button type="button" className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300" onClick={() => setPicked(new Set(rows.map(r => r.taskId)))}>Chọn tất cả {rows.length} việc đang lọc</button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Hủy</button>
          <button type="button" disabled={!picked.size} onClick={() => onAdd(candidates.filter(c => picked.has(c.taskId)))}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            <Plus size={15} />Thêm {picked.size || ''} việc</button>
        </div>
      </div>
    </div>
  </div>;
};

// ---------------------------------------------------------------------------
// Read view: plan vs actual.
// ---------------------------------------------------------------------------
const AchievementBar: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return <span className="text-xs text-muted-foreground">Chưa có số liệu</span>;
  const tone = value >= 100 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return <span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} /></span>
    <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(value, 0)}%</span></span>;
};

const PlanSummary: React.FC<{ plan: WorkPlan; periodStarted: boolean }> = ({ plan, periodStarted }) => {
  const stats = useMemo(() => {
    let done = 0; let partial = 0; let none = 0; let unknown = 0;
    plan.lines.forEach(line => {
      const a = workPlanLineAchievement(line);
      if (a == null) unknown += 1; else if (a >= 100) done += 1; else if (a > 0) partial += 1; else none += 1;
    });
    return { done, partial, none, unknown };
  }, [plan.lines]);
  const tiles = [
    ['Công việc trong kế hoạch', plan.lines.length, 'text-foreground'],
    ['Đạt kế hoạch', periodStarted ? stats.done : '—', 'text-emerald-700 dark:text-emerald-300'],
    ['Đang làm, chưa đạt', periodStarted ? stats.partial : '—', 'text-amber-700 dark:text-amber-300'],
    ['Chưa làm', periodStarted ? stats.none : '—', 'text-rose-700 dark:text-rose-300'],
  ] as const;
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
    {tiles.map(([label, value, tone]) => <div key={label} className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>)}
    {periodStarted && stats.unknown > 0 && <p className="col-span-2 text-xs text-muted-foreground md:col-span-4">{stats.unknown} công việc chưa có số liệu thực hiện (chưa ghi nhật ký/chốt tiến độ hoặc chưa có khối lượng).</p>}
    {!periodStarted && <p className="col-span-2 text-xs text-muted-foreground md:col-span-4">Kỳ chưa bắt đầu — số thực hiện sẽ tự lấy từ Nhật ký và Chốt tiến độ.</p>}
  </div>;
};

const PlanReadTable: React.FC<{ plan: WorkPlan; periodStarted: boolean }> = ({ plan, periodStarted }) =>
  <div className="overflow-hidden rounded-xl border border-border">
    <div className="hidden grid-cols-[minmax(0,2.6fr)_64px_120px_120px_130px_minmax(0,1fr)] gap-3 bg-muted/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:grid">
      <span>Công việc</span><span>ĐVT</span><span className="text-right">Kế hoạch</span><span className="text-right">Thực hiện</span><span>% đạt</span><span>Tổ đội / nhà thầu</span>
    </div>
    {groupBy(plan.lines).map(([group, lines]) => <div key={group}>
      <div className="border-t border-border bg-muted/30 px-4 py-1.5 text-xs font-bold text-foreground">{group} <span className="font-normal text-muted-foreground">· {lines.length} việc</span></div>
      {lines.map(line => <div key={line.taskId} className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-sm md:grid-cols-[minmax(0,2.6fr)_64px_120px_120px_130px_minmax(0,1fr)] md:items-center">
        <span className="col-span-2 min-w-0 md:col-span-1"><span className="mr-1.5 text-muted-foreground">{line.wbsCode}</span>{line.taskName}
          {line.note && <span className="block text-xs text-muted-foreground">{line.note}</span>}</span>
        <span className="text-muted-foreground"><span className="md:hidden">ĐVT: </span>{line.unit || '—'}</span>
        <span className="text-right tabular-nums"><span className="float-left text-xs text-muted-foreground md:hidden">Kế hoạch</span>{line.plannedQty == null ? <span className="text-muted-foreground">Chưa có KL</span> : fmt(line.plannedQty)}</span>
        <span className="text-right tabular-nums"><span className="float-left text-xs text-muted-foreground md:hidden">Thực hiện</span>{!periodStarted ? '—' : line.actualQty == null ? <span className="text-xs text-muted-foreground">Chưa có số liệu</span> : fmt(line.actualQty)}</span>
        <span>{periodStarted ? <AchievementBar value={workPlanLineAchievement(line)} /> : <span className="text-xs text-muted-foreground">Chưa đến kỳ</span>}</span>
        <span className="truncate text-muted-foreground">{line.crewLabel || '—'}</span>
      </div>)}
    </div>)}
  </div>;

// ---------------------------------------------------------------------------
// Editor for a draft / returned plan.
// ---------------------------------------------------------------------------
const PlanEditor: React.FC<{
  lines: DraftLine[]; periodType: WorkPlanPeriodType; disabled: boolean;
  onChange: (taskId: string, patch: Partial<DraftLine>) => void; onRemove: (taskId: string) => void;
}> = ({ lines, periodType, disabled, onChange, onRemove }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const showMonth = periodType === 'week' && lines.some(l => l.monthPlanQty != null);
  const cols = showMonth ? 'md:grid-cols-[minmax(0,2.4fr)_60px_110px_100px_130px_minmax(0,1fr)_36px]' : 'md:grid-cols-[minmax(0,2.4fr)_60px_110px_130px_minmax(0,1fr)_36px]';
  return <div className="overflow-hidden rounded-xl border border-border">
    <div className={`hidden gap-3 bg-muted/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:grid ${cols}`}>
      <span>Công việc</span><span>ĐVT</span><span className="text-right">Còn lại đầu kỳ</span>{showMonth && <span className="text-right">KH tháng</span>}
      <span className="text-right">KL kế hoạch</span><span>Tổ đội / nhà thầu</span><span />
    </div>
    {groupBy(lines).map(([group, rows]) => {
      const isCollapsed = collapsed.has(group);
      return <div key={group}>
        <button type="button" aria-expanded={!isCollapsed} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}
          className="flex w-full items-center gap-2 border-t border-border bg-muted/30 px-4 py-1.5 text-left text-xs font-bold text-foreground hover:bg-muted/60">
          <ChevronDown size={14} className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />{group}<span className="font-normal text-muted-foreground">· {rows.length} việc</span>
        </button>
        {!isCollapsed && rows.map(line => {
          const qty = parseQty(line.plannedQty);
          const remaining = remainingOf(line);
          const invalid = Number.isNaN(qty) || (qty != null && qty < 0);
          const over = qty != null && !Number.isNaN(qty) && remaining != null && qty > remaining;
          return <div key={line.taskId} className={`grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-4 py-2.5 text-sm md:items-center ${cols}`}>
            <span className="col-span-2 min-w-0 md:col-span-1"><span className="mr-1.5 text-muted-foreground">{line.wbsCode}</span>{line.taskName}
              {line.overdue && <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Trễ hạn</span>}</span>
            <span className="text-muted-foreground"><span className="md:hidden">ĐVT: </span>{line.unit || '—'}</span>
            <span className="text-right tabular-nums text-muted-foreground"><span className="float-left text-xs md:hidden">Còn lại</span>{remaining == null ? 'Chưa có KL' : fmt(remaining)}</span>
            {showMonth && <span className="text-right tabular-nums text-muted-foreground"><span className="float-left text-xs md:hidden">KH tháng</span>{line.monthPlanQty == null ? '—' : fmt(line.monthPlanQty)}</span>}
            <label className="col-span-2 block md:col-span-1"><span className="sr-only">Khối lượng kế hoạch {line.taskName}</span>
              <span className="mb-1 block text-xs text-muted-foreground md:hidden">KL kế hoạch</span>
              <input inputMode="decimal" value={line.plannedQty} disabled={disabled} aria-invalid={invalid}
                placeholder={line.totalQty == null ? 'Không bắt buộc' : 'Nhập KL'}
                onChange={event => onChange(line.taskId, { plannedQty: event.target.value })}
                className={`w-full rounded-lg border bg-background px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:border-teal-600 ${invalid ? 'border-rose-500' : 'border-border'}`} />
              {invalid && <span className="mt-1 block text-xs text-rose-600">Nhập số ≥ 0</span>}
              {over && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Vượt phần còn lại</span>}
            </label>
            <label className="col-span-2 block md:col-span-1"><span className="sr-only">Tổ đội hoặc nhà thầu</span>
              <input value={line.crewLabel || ''} disabled={disabled} placeholder="Tổ đội / nhà thầu"
                onChange={event => onChange(line.taskId, { crewLabel: event.target.value })}
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-teal-600" /></label>
            <button type="button" disabled={disabled} onClick={() => onRemove(line.taskId)} aria-label={`Bỏ ${line.taskName} khỏi kế hoạch`}
              className="col-span-2 justify-self-end rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 md:col-span-1"><Trash2 size={15} /></button>
          </div>;
        })}
      </div>;
    })}
  </div>;
};

// ---------------------------------------------------------------------------
// Tab.
// ---------------------------------------------------------------------------
const WorkPlanTab: React.FC<WorkPlanTabProps> = ({ projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const siteId = constructionSiteId || null;
  const initial = (() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const type = params.get('period') === 'week' ? 'week' : 'month';
    return { type: type as WorkPlanPeriodType, start: normalizeWorkPlanPeriodStart(type, params.get('start') || toIsoDate(new Date())) };
  })();
  const [periodType, setPeriodType] = useState<WorkPlanPeriodType>(initial.type);
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [board, setBoard] = useState<WorkPlanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WorkPlanCandidate[] | null>(null);
  const [draft, setDraft] = useState<{ planId?: string; rowVersion?: number; note: string; lines: DraftLine[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<PickerFilter | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approverId, setApproverId] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const request = useRef(0);

  const today = toIsoDate(new Date());
  const periodLabel = formatWorkPlanPeriod(periodType, periodStart);
  const kindLabel = periodType === 'month' ? 'kế hoạch tháng' : 'kế hoạch tuần';

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError(null);
    try {
      const next = await projectWorkPlanService.getBoard({ projectId, constructionSiteId: siteId, periodType, periodStart });
      if (id !== request.current) return;
      setBoard(next);
      const open = next.open;
      setDraft(open && ['draft', 'returned'].includes(open.status)
        ? { planId: open.id, rowVersion: open.rowVersion, note: open.note || '', lines: open.lines.map(l => toDraftLine(l, l.plannedQty)) }
        : null);
      setDirty(false);
    } catch (caught) {
      if (id === request.current) setError(caught instanceof Error ? caught.message : 'Không tải được kế hoạch.');
    } finally { if (id === request.current) setLoading(false); }
  }, [periodStart, periodType, projectId, siteId]);

  useEffect(() => { void load(); setCandidates(null); }, [load]);

  const ensureCandidates = useCallback(async () => {
    if (candidates) return candidates;
    const rows = await projectWorkPlanService.listCandidates({ projectId, constructionSiteId: siteId, periodType, periodStart });
    setCandidates(rows); return rows;
  }, [candidates, periodStart, periodType, projectId, siteId]);

  // A draft is always compared with the schedule (overdue work, suggestions).
  useEffect(() => {
    if (draft && !candidates) ensureCandidates().catch(() => undefined);
  }, [candidates, draft, ensureCandidates]);

  const leaveDraft = async () => !dirty || confirm({ title: 'Bỏ thay đổi chưa lưu?', targetName: periodLabel,
    warningText: 'Các thay đổi trên kế hoạch chưa được lưu sẽ mất.', actionLabel: 'Bỏ thay đổi', cancelLabel: 'Ở lại', intent: 'warning' });

  const changePeriod = async (type: WorkPlanPeriodType, start: string) => {
    if (!(await leaveDraft())) return;
    setPeriodType(type); setPeriodStart(normalizeWorkPlanPeriodStart(type, start));
  };

  const startNewPlan = async () => {
    setBusy('new');
    try {
      const rows = await ensureCandidates();
      const suggested = rows.filter(c => c.inPeriod && !c.finished && c.suggestedQty != null && c.suggestedQty > 0 && !c.overdue);
      setDraft({ note: '', lines: suggested.map(c => toDraftLine(c, c.suggestedQty)) });
      setDirty(true);
      toast.info(`Đã gợi ý ${suggested.length} công việc có lịch trong kỳ`, 'Chỉnh khối lượng, thêm việc nếu cần rồi lưu nháp.');
    } catch (caught) { toast.error('Không lấy được công việc từ bảng tiến độ', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const openPicker = async (filter: PickerFilter = 'period') => {
    setBusy('picker');
    try { await ensureCandidates(); setPicker(filter); }
    catch (caught) { toast.error('Không tải được danh sách công việc', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const overdueMissing = useMemo(() => {
    if (!draft || !candidates) return 0;
    const inPlan = new Set(draft.lines.map(l => l.taskId));
    return candidates.filter(c => c.overdue && !inPlan.has(c.taskId)).length;
  }, [candidates, draft]);
  const draftErrors = useMemo(() => draft ? draft.lines.filter(l => { const q = parseQty(l.plannedQty); return Number.isNaN(q) || (q != null && q < 0); }).length : 0, [draft]);

  const saveDraft = async (): Promise<{ planId: string; rowVersion: number } | null> => {
    if (!draft) return null;
    if (draftErrors) { toast.error('Còn khối lượng chưa hợp lệ', 'Sửa các ô được tô đỏ rồi lưu lại.'); return null; }
    const result = await projectWorkPlanService.save({
      planId: draft.planId, expectedRowVersion: draft.rowVersion, projectId, constructionSiteId: siteId, periodType, periodStart,
      note: draft.note, lines: draft.lines.map(l => ({ taskId: l.taskId, plannedQty: parseQty(l.plannedQty), plannedStart: null, plannedEnd: null, crewLabel: l.crewLabel, note: l.note })),
    });
    setDraft(current => current ? { ...current, planId: result.planId, rowVersion: result.rowVersion } : current);
    setDirty(false);
    return result;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (caught) { toast.error('Chưa thực hiện được', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const onSave = () => run('save', async () => { if (await saveDraft()) { toast.success('Đã lưu nháp', periodLabel); await load(); } });
  const onSubmit = () => run('submit', async () => {
    if (!draft?.lines.length) { toast.error('Kế hoạch chưa có công việc', 'Thêm ít nhất một công việc rồi gửi duyệt.'); return; }
    const saved = await saveDraft(); if (!saved) return;
    await projectWorkPlanService.transition({ planId: saved.planId, expectedRowVersion: saved.rowVersion, action: 'submit', recipientUserId: approverId || null });
    toast.success('Đã gửi duyệt', `${periodLabel} đang chờ ${periodType === 'month' ? 'GĐ dự án' : 'CHT'} duyệt.`);
    await load();
  });
  const onTransition = (plan: WorkPlan, action: WorkPlanAction) => run(action, async () => {
    let reason: string | undefined;
    if (action === 'return') {
      const value = await reasonConfirm({ title: `Trả lại ${kindLabel}`, targetName: periodLabel, reasonLabel: 'Lý do trả lại',
        reasonPlaceholder: 'Ví dụ: KL đổ bê tông móng M3 chưa khớp tiến độ, thiếu tổ nề…', actionLabel: 'Trả lại', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 });
      if (!value) return; reason = value;
    }
    if (action === 'delete' && !(await confirm({ title: 'Xóa bản nháp?', targetName: periodLabel, warningText: 'Bản nháp chưa từng gửi duyệt sẽ bị xóa hẳn.', actionLabel: 'Xóa nháp', intent: 'danger' }))) return;
    if (action === 'approve' && !(await confirm({ title: `Duyệt ${kindLabel}?`, targetName: periodLabel, warningText: `${plan.lines.length} công việc sẽ thành kế hoạch chính thức của kỳ.`, actionLabel: 'Duyệt', intent: 'success' }))) return;
    await projectWorkPlanService.transition({ planId: plan.id, expectedRowVersion: plan.rowVersion, action, reason });
    toast.success({ approve: 'Đã duyệt kế hoạch', return: 'Đã trả lại người lập', withdraw: 'Đã rút về để sửa', delete: 'Đã xóa bản nháp', submit: 'Đã gửi duyệt' }[action], periodLabel);
    await load();
  });
  const onRevise = (plan: WorkPlan) => run('revise', async () => {
    const reason = await reasonConfirm({ title: 'Tạo bản điều chỉnh', targetName: periodLabel, reasonLabel: 'Lý do điều chỉnh',
      warningText: 'Bản đã duyệt vẫn giữ hiệu lực cho tới khi bản điều chỉnh được duyệt.', reasonPlaceholder: 'Ví dụ: thêm tổ đội, tăng KL xây tường…', actionLabel: 'Tạo bản điều chỉnh', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 });
    if (!reason) return;
    await projectWorkPlanService.revise({ planId: plan.id, reason });
    toast.success('Đã tạo bản điều chỉnh', 'Sửa rồi gửi duyệt lại.');
    await load();
  });

  const patchLine = (taskId: string, patch: Partial<DraftLine>) => {
    setDraft(current => current ? { ...current, lines: current.lines.map(l => l.taskId === taskId ? { ...l, ...patch } : l) } : current);
    setDirty(true);
  };
  const removeLine = (taskId: string) => { setDraft(current => current ? { ...current, lines: current.lines.filter(l => l.taskId !== taskId) } : current); setDirty(true); };
  const addLines = (rows: WorkPlanCandidate[]) => {
    setDraft(current => current ? { ...current, lines: [...current.lines, ...rows.map(c => toDraftLine(c, c.suggestedQty))] } : current);
    setDirty(true); setPicker(null);
  };

  const permissions = board?.permissions;
  const open = board?.open || null;
  const approved = board?.approved || null;
  const periodStarted = periodStart <= today;
  const periodEnd = board?.periodEnd || '';
  const isCurrent = periodStart <= today && today <= (periodEnd || periodStart);

  const header = <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><CalendarRange size={20} className="text-teal-600" />Kế hoạch thi công</h2>
      <p className="text-xs text-muted-foreground">Lập kế hoạch tháng, tuần từ bảng tiến độ. Số thực hiện lấy tự động từ Nhật ký và Chốt tiến độ.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-border bg-muted/60 p-1" role="tablist" aria-label="Loại kế hoạch">
        {(['month', 'week'] as const).map(type => <button key={type} type="button" role="tab" aria-selected={periodType === type}
          onClick={() => void changePeriod(type, periodType === type ? periodStart : today)}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${periodType === type ? 'bg-card text-teal-700 shadow-sm dark:text-teal-300' : 'text-muted-foreground hover:text-foreground'}`}>
          {type === 'month' ? 'Tháng' : 'Tuần'}</button>)}
      </div>
      <div className="inline-flex items-center rounded-xl border border-border bg-card">
        <button type="button" aria-label="Kỳ trước" onClick={() => void changePeriod(periodType, shiftWorkPlanPeriod(periodType, periodStart, -1))} className="rounded-l-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft size={16} /></button>
        <span className="min-w-[150px] px-2 text-center text-sm font-semibold text-foreground">{periodLabel}</span>
        <button type="button" aria-label="Kỳ sau" onClick={() => void changePeriod(periodType, shiftWorkPlanPeriod(periodType, periodStart, 1))} className="rounded-r-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight size={16} /></button>
      </div>
      {!isCurrent && <button type="button" onClick={() => void changePeriod(periodType, today)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">{periodType === 'month' ? 'Tháng này' : 'Tuần này'}</button>}
    </div>
  </div>;

  if (loading && !board) return <div className="space-y-4">{header}<div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang tải kế hoạch…</div></div>;
  if (error && !board) return <div className="space-y-4">{header}<div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
    <p className="font-semibold">{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold"><RotateCcw size={13} />Thử lại</button></div></div>;

  const editing = Boolean(draft);
  const busyIcon = (key: string) => busy === key ? <Loader2 size={15} className="animate-spin" /> : null;

  return <div className="space-y-4">
    {header}
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

    {/* Open plan: being written, returned, or waiting for approval. */}
    {editing && draft && <section className="space-y-3 rounded-2xl border border-teal-200 bg-card p-4 shadow-sm dark:border-teal-900 md:p-5" aria-label={`Soạn ${kindLabel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-foreground">{draft.planId ? `Soạn ${kindLabel}` : `Lập ${kindLabel}`} · {periodLabel}</h3>
          {open ? <StatusChip status={open.status} /> : <span className="text-xs font-semibold text-amber-700">Chưa lưu</span>}
          {open && open.revisionNo > 1 && <span className="text-xs text-muted-foreground">Bản điều chỉnh lần {open.revisionNo - 1}</span>}
        </div>
        <button type="button" onClick={() => void openPicker('period')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40">
          {busyIcon('picker') || <Plus size={15} />}Thêm công việc</button>
      </div>
      {open?.status === 'returned' && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <strong>Bị trả lại</strong>{open.returnedByName ? ` bởi ${open.returnedByName}` : ''}{open.returnedAt ? ` lúc ${new Date(open.returnedAt).toLocaleString('vi-VN')}` : ''}: {open.returnReason}</div>}
      {overdueMissing > 0 && <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
        <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><strong>{overdueMissing} việc trễ hạn chưa xong</strong> theo bảng tiến độ chưa có trong kế hoạch. Việc nào thực tế đã xong thì nên cập nhật tiến độ; việc còn làm thì thêm vào kỳ này.</span></span>
        <button type="button" onClick={() => void openPicker('overdue')} disabled={Boolean(busy)} className="shrink-0 rounded-lg border border-amber-400 bg-white/70 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:bg-transparent">Xem và thêm</button>
      </div>}
      {draft.lines.length === 0
        ? <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Chưa có công việc nào. Bấm <strong>Thêm công việc</strong> để chọn từ bảng tiến độ.</div>
        : <PlanEditor lines={draft.lines} periodType={periodType} disabled={Boolean(busy)} onChange={patchLine} onRemove={removeLine} />}
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Ghi chú kế hoạch</span>
        <textarea value={draft.note} rows={2} disabled={Boolean(busy)} onChange={event => { setDraft(current => current ? { ...current, note: event.target.value } : current); setDirty(true); }}
          placeholder="Mục tiêu chính của kỳ, điều kiện cần (vật tư, nhân lực, máy)…" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-teal-600" /></label>
      <div className="flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{draft.lines.length} công việc{dirty ? ' · có thay đổi chưa lưu' : ''}</span>
          {draftErrors > 0 && <span className="font-semibold text-rose-600">{draftErrors} ô khối lượng chưa hợp lệ</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open?.status === 'draft' && !open.submittedAt && <button type="button" onClick={() => onTransition(open, 'delete')} disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40">{busyIcon('delete') || <Trash2 size={15} />}Xóa nháp</button>}
          {!open && <button type="button" onClick={() => { setDraft(null); setDirty(false); }} disabled={Boolean(busy)} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">Hủy</button>}
          {permissions?.canSubmit && (board?.approvers.length || 0) > 0 && <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Người duyệt
            <select value={approverId} onChange={event => setApproverId(event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">Tất cả người có quyền duyệt</option>
              {board!.approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>}
          <button type="button" onClick={onSave} disabled={Boolean(busy) || !permissions?.canEdit} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50">
            {busyIcon('save') || <Save size={15} />}Lưu nháp</button>
          {permissions?.canSubmit && <button type="button" onClick={onSubmit} disabled={Boolean(busy) || !draft.lines.length || draftErrors > 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            {busyIcon('submit') || <Send size={15} />}Gửi duyệt</button>}
        </div>
      </div>
    </section>}

    {!editing && open?.status === 'submitted' && <section className="space-y-3 rounded-2xl border border-amber-200 bg-card p-4 shadow-sm dark:border-amber-900 md:p-5" aria-label="Kế hoạch chờ duyệt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-foreground">{open.revisionNo > 1 ? 'Bản điều chỉnh' : 'Kế hoạch'} chờ duyệt · {periodLabel}</h3><StatusChip status="submitted" /></div>
        <span className="text-xs text-muted-foreground">{open.submittedByName} gửi lúc {open.submittedAt ? new Date(open.submittedAt).toLocaleString('vi-VN') : ''}</span>
      </div>
      <PlanReadTable plan={open} periodStarted={false} />
      {open.note && <p className="text-sm text-muted-foreground"><strong className="text-foreground">Ghi chú:</strong> {open.note}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        {!permissions?.canApprove && <span className="mr-auto self-center text-xs text-muted-foreground">Đang chờ {periodType === 'month' ? 'GĐ dự án' : 'CHT'} duyệt.</span>}
        {permissions?.canSubmit && <button type="button" onClick={() => onTransition(open, 'withdraw')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{busyIcon('withdraw') || <Undo2 size={15} />}Rút về sửa</button>}
        {permissions?.canApprove && <>
          <button type="button" onClick={() => onTransition(open, 'return')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950/40">{busyIcon('return') || <Undo2 size={15} />}Trả lại</button>
          <button type="button" onClick={() => onTransition(open, 'approve')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busyIcon('approve') || <CheckCircle2 size={15} />}Duyệt</button>
        </>}
      </div>
    </section>}

    {/* Approved plan of the period with actual progress. */}
    {approved && <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5" aria-label="Kế hoạch đã duyệt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-foreground">Kế hoạch đã duyệt · {periodLabel}</h3><StatusChip status="approved" />
          {approved.revisionNo > 1 && <span className="text-xs text-muted-foreground">Bản điều chỉnh lần {approved.revisionNo - 1}</span>}</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{approved.approvedByName} duyệt {approved.approvedAt ? new Date(approved.approvedAt).toLocaleDateString('vi-VN') : ''}</span>
          {permissions?.canEdit && !open && <button type="button" onClick={() => onRevise(approved)} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">{busyIcon('revise') || <RotateCcw size={13} />}Tạo bản điều chỉnh</button>}
        </div>
      </div>
      <PlanSummary plan={approved} periodStarted={periodStarted} />
      <PlanReadTable plan={approved} periodStarted={periodStarted} />
      {approved.note && <p className="text-sm text-muted-foreground"><strong className="text-foreground">Ghi chú:</strong> {approved.note}</p>}
    </section>}

    {/* Nothing yet for this period. */}
    {!editing && !open && !approved && <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <CalendarRange size={32} className="mx-auto text-slate-300" />
      <h3 className="mt-3 text-base font-bold text-foreground">Chưa có kế hoạch cho {periodLabel.charAt(0).toLowerCase() + periodLabel.slice(1)}</h3>
      {permissions?.canEdit ? <>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Hệ thống gợi ý sẵn các công việc có lịch trong kỳ theo bảng tiến độ{periodType === 'week' ? ', kèm khối lượng kế hoạch tháng để đối chiếu' : ''}. Bạn chỉ cần chỉnh khối lượng rồi gửi duyệt.</p>
        <button type="button" onClick={() => void startNewPlan()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {busyIcon('new') || <Plus size={16} />}Lập {kindLabel}</button>
      </> : <p className="mt-1 text-sm text-muted-foreground">Người có quyền "Lập/sửa kế hoạch" sẽ lập kế hoạch cho kỳ này.</p>}
    </section>}

    {/* Earlier plans of the same kind. */}
    {(board?.history.length || 0) > 0 && <section className="rounded-2xl border border-border bg-card">
      <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><History size={15} className="text-muted-foreground" />Các {kindLabel} đã lập <span className="font-normal text-muted-foreground">({board!.history.length})</span></span>
        <ChevronDown size={16} className={`text-muted-foreground transition-transform ${showHistory ? 'rotate-180' : ''}`} />
      </button>
      {showHistory && <div className="divide-y divide-border border-t border-border">
        {board!.history.map(item => <button key={item.id} type="button" onClick={() => void changePeriod(periodType, item.periodStart)}
          className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted/50">
          <span className="font-medium text-foreground">{formatWorkPlanPeriod(periodType, item.periodStart)}{item.revisionNo > 1 ? ` · điều chỉnh ${item.revisionNo - 1}` : ''}</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">{item.lineCount} việc<StatusChip status={item.status} /></span>
        </button>)}
      </div>}
    </section>}

    {!permissions?.canEdit && !permissions?.canApprove && board && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={13} />Bạn đang xem ở chế độ chỉ đọc.</p>}

    {picker && candidates && draft && <TaskPicker candidates={candidates} periodType={periodType} initialFilter={picker} selected={new Set(draft.lines.map(l => l.taskId))} onClose={() => setPicker(null)} onAdd={addLines} />}
  </div>;
};

export default WorkPlanTab;
