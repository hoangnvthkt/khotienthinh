import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, HardHat, History, Loader2, Lock, Paperclip, Plus,
  RotateCcw, Save, Search, Send, ShieldCheck, Trash2, Undo2, X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import MaterialPlanPanel from '../../components/project/work-plan/MaterialPlanPanel';
import {
  AccordionToolbar, CrewPill, crewColor, dateVi, fmt, GroupHeader, groupBy, parseQty, qtyInput, StatusChip, uniqueCrews, useGroupAccordion,
} from '../../components/project/work-plan/workPlanUi';
import {
  AttachmentList, CompareControl, CompareSummary, DiffTable, ImpactBlock, PARTY_TONE, PerfRow, ReasonChip, TONE, VersionHistory, VersionStrip, WRAP,
  type CompareMode,
} from '../../components/project/work-plan/planVersionUi';
import { Badge } from '../../components/procurement/hub/hubUi';
import {
  formatWorkPlanPeriod, normalizeWorkPlanPeriodStart, projectWorkPlanService, RESPONSIBLE_PARTY_LABELS, shiftWorkPlanPeriod, toIsoDate,
  workPlanLineAchievement,
  type ResponsibleParty, type WorkPlan, type WorkPlanAction, type WorkPlanAttachment, type WorkPlanBoard, type WorkPlanCandidate,
  type WorkPlanImpact, type WorkPlanLine, type WorkPlanPeriodType,
} from '../../lib/projectWorkPlanService';
import {
  changeRefs, diffPlans, originalVersion, reasonNeedsDocument, revisionLineIssues, type RevisionIssue,
} from '../../lib/workPlanVersions';

interface WorkPlanTabProps {
  projectId: string;
  constructionSiteId?: string;
}

type DraftLine = Pick<WorkPlanLine, 'taskId' | 'wbsCode' | 'taskName' | 'groupName' | 'unit' | 'totalQty' | 'doneBeforeQty' | 'crewLabel' | 'note'> & {
  plannedQty: string;
  /** '' = theo kỳ (ngày đầu / cuối kỳ). */
  plannedStart: string;
  plannedEnd: string;
  changeReasonCode: string;
  changeNote: string;
  /** Đã làm trong kỳ (Nhật ký / Chốt tiến độ); null = chưa rõ. */
  actualQty: number | null;
  overdue?: boolean;
  monthPlanQty?: number | null;
};
type RevisionDraft = {
  basePlan: WorkPlan;
  changeReasonCode: string;
  responsibleParty: ResponsibleParty | '';
  changeSummary: string;
  attachments: WorkPlanAttachment[];
  removed: Record<string, { changeReasonCode: string; changeNote: string }>;
};
type Draft = { planId?: string; rowVersion?: number; note: string; lines: DraftLine[]; revision: RevisionDraft | null };

const remainingOf = (line: Pick<DraftLine, 'totalQty' | 'doneBeforeQty'>) =>
  line.totalQty == null ? null : Math.max(line.totalQty - (line.doneBeforeQty ?? 0), 0);
const lineToDraft = (line: WorkPlanLine): DraftLine => ({
  taskId: line.taskId, wbsCode: line.wbsCode, taskName: line.taskName, groupName: line.groupName, unit: line.unit,
  totalQty: line.totalQty, doneBeforeQty: line.doneBeforeQty, crewLabel: line.crewLabel, note: line.note,
  plannedQty: qtyInput(line.plannedQty), plannedStart: line.plannedStart?.slice(0, 10) || '', plannedEnd: line.plannedEnd?.slice(0, 10) || '',
  changeReasonCode: line.changeReasonCode || '', changeNote: line.changeNote || '', actualQty: line.actualQty ?? null,
});
/** Ngày gợi ý trong kỳ theo lịch của công việc; bản điều chỉnh không gợi ý ngày đã qua. */
const suggestDates = (c: WorkPlanCandidate, start: string, end: string, earliest: string): [string, string] => {
  const from = earliest > start ? (earliest < end ? earliest : end) : start;
  if (!c.startDate || !c.endDate || c.overdue || c.endDate < from) return [from, end];
  const s = c.startDate > from ? (c.startDate < end ? c.startDate : end) : from;
  const e = c.endDate < end ? (c.endDate < s ? s : c.endDate) : end;
  return [s, e];
};
const candidateToDraft = (c: WorkPlanCandidate, start: string, end: string, earliest: string): DraftLine => {
  const [s, e] = suggestDates(c, start, end, earliest);
  return {
    taskId: c.taskId, wbsCode: c.wbsCode, taskName: c.taskName, groupName: c.groupName, unit: c.unit,
    totalQty: c.totalQty, doneBeforeQty: c.doneBeforeQty, crewLabel: null, note: null,
    plannedQty: qtyInput(c.suggestedQty), plannedStart: s, plannedEnd: e, changeReasonCode: '', changeNote: '', actualQty: null,
    overdue: c.overdue, monthPlanQty: c.monthPlanQty,
  };
};
const asLine = (l: DraftLine) => ({ plannedQty: (() => { const q = parseQty(l.plannedQty); return q == null || Number.isNaN(q) ? null : q; })(), plannedStart: l.plannedStart || null, plannedEnd: l.plannedEnd || null });
const lineChanged = (l: DraftLine, base: WorkPlanLine | undefined, period: { periodStart: string; periodEnd: string }) => {
  if (!base) return true;
  const q = asLine(l).plannedQty;
  if ((q == null) !== (base.plannedQty == null) || (q != null && base.plannedQty != null && Math.abs(q - base.plannedQty) > 0.0005)) return true;
  return (l.plannedStart || period.periodStart) !== (base.plannedStart?.slice(0, 10) || period.periodStart)
    || (l.plannedEnd || period.periodEnd) !== (base.plannedEnd?.slice(0, 10) || period.periodEnd);
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
// Read view of a first plan waiting for approval: plan vs actual.
// ---------------------------------------------------------------------------
const AchievementBar: React.FC<{ value: number | null }> = ({ value }) => {
  if (value == null) return <span className="text-xs text-muted-foreground">Chưa có số liệu</span>;
  const tone = value >= 100 ? 'bg-emerald-500' : value > 0 ? 'bg-amber-500' : 'bg-rose-500';
  return <span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} /></span>
    <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(value, 0)}%</span></span>;
};

const READ_COLS = 'md:grid-cols-[56px_minmax(0,2.4fr)_60px_110px_130px_110px_120px_minmax(0,1.2fr)]';
const PlanReadTable: React.FC<{ plan: WorkPlan; periodStarted: boolean }> = ({ plan, periodStarted }) => {
  const groups = useMemo(() => groupBy(plan.lines), [plan.lines]);
  const accordion = useGroupAccordion(groups.map(([g]) => g));
  return <div className="space-y-2">
    <AccordionToolbar count={groups.length} allOpen={accordion.allOpen} onExpand={accordion.expandAll} onCollapse={accordion.collapseAll} />
    <div className="overflow-hidden rounded-xl border border-border">
      <div className={`hidden gap-3 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 md:grid ${READ_COLS}`}>
        <span>Chỉ mục</span><span>Công việc</span><span>ĐVT</span><span className="text-right">Kế hoạch</span><span>Thời gian</span><span className="text-right">Thực hiện</span><span>% đạt</span><span>Tổ đội / nhà thầu</span>
      </div>
      {groups.map(([group, lines], gi) => {
        const open = accordion.isOpen(group);
        return <div key={group}>
          <GroupHeader index={gi + 1} name={group} open={open} onToggle={() => accordion.toggle(group)} count={lines.length}
            tone="bg-teal-50 border-l-teal-600 text-teal-950 dark:bg-teal-950/40 dark:border-l-teal-500 dark:text-teal-100">
            {uniqueCrews(lines).slice(0, 3).map(c => <CrewPill key={c} name={c} />)}
          </GroupHeader>
          {open && lines.map((line, li) => <div key={line.taskId} className={`grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border px-3 py-2.5 text-sm md:items-center ${READ_COLS}`}>
            <span className="hidden text-xs tabular-nums text-muted-foreground md:block">{gi + 1}.{li + 1}</span>
            <span className="col-span-2 min-w-0 md:col-span-1"><span className="mr-1.5 text-muted-foreground">{line.wbsCode}</span>{line.taskName}
              {line.note && <span className="block text-xs text-muted-foreground">{line.note}</span>}</span>
            <span className="text-muted-foreground"><span className="md:hidden">ĐVT: </span>{line.unit || '—'}</span>
            <span className="text-right tabular-nums"><span className="float-left text-xs text-muted-foreground md:hidden">Kế hoạch</span>{line.plannedQty == null ? <span className="text-muted-foreground">Chưa có KL</span> : fmt(line.plannedQty)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{line.plannedStart || line.plannedEnd ? `${dateVi(line.plannedStart || plan.periodStart)} – ${dateVi(line.plannedEnd || plan.periodEnd)}` : 'Theo kỳ'}</span>
            <span className="text-right tabular-nums font-semibold"><span className="float-left text-xs font-normal text-muted-foreground md:hidden">Thực hiện</span>{!periodStarted ? '—' : line.actualQty == null ? <span className="text-xs font-normal text-muted-foreground">Chưa có số liệu</span> : fmt(line.actualQty)}</span>
            <span>{periodStarted ? <AchievementBar value={workPlanLineAchievement(line)} /> : <span className="text-xs text-muted-foreground">Chưa đến kỳ</span>}</span>
            <span className="min-w-0"><CrewPill name={line.crewLabel} /></span>
          </div>)}
        </div>;
      })}
    </div>
  </div>;
};

// ---------------------------------------------------------------------------
// Editor for a draft / returned plan (bản đầu kỳ hoặc bản điều chỉnh).
// ---------------------------------------------------------------------------
type RevisionCtx = { base: Map<string, WorkPlanLine>; baseNo: number; today: string; reasons: WorkPlanBoard['reasons'] };
const PlanEditor: React.FC<{
  lines: DraftLine[]; periodType: WorkPlanPeriodType; period: { periodStart: string; periodEnd: string }; disabled: boolean; revision: RevisionCtx | null;
  issuesOf: (line: DraftLine) => RevisionIssue[];
  onChange: (taskId: string, patch: Partial<DraftLine>) => void; onRemove: (taskId: string) => void;
}> = ({ lines, periodType, period, disabled, revision, issuesOf, onChange, onRemove }) => {
  const groups = useMemo(() => groupBy(lines), [lines]);
  const accordion = useGroupAccordion(groups.map(([g]) => g));
  useEffect(() => { if (revision) accordion.expandAll(); }, [revision ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = revision
    ? 'lg:grid-cols-[48px_minmax(0,2.3fr)_104px_112px_140px_minmax(0,1.1fr)_64px]'
    : 'lg:grid-cols-[48px_minmax(0,2.3fr)_104px_112px_140px_minmax(0,1.1fr)_36px]';
  return <div className="space-y-2">
    <AccordionToolbar count={groups.length} allOpen={accordion.allOpen} onExpand={accordion.expandAll} onCollapse={accordion.collapseAll} />
    <div className="overflow-hidden rounded-xl border border-border">
      <div className={`hidden gap-3 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 lg:grid ${cols}`}>
        <span>Chỉ mục</span><span>Công việc</span><span className="text-right">{revision ? `Bản ${revision.baseNo}` : 'Còn lại đầu kỳ'}</span>
        <span className="text-right">KL kế hoạch</span><span>Thời gian</span><span>Tổ đội / nhà thầu</span><span />
      </div>
      {groups.map(([group, rows], gi) => {
        const open = accordion.isOpen(group);
        const overdue = rows.filter(r => r.overdue).length;
        const missing = rows.filter(r => r.totalQty != null && parseQty(r.plannedQty) == null).length;
        const errors = rows.filter(r => issuesOf(r).length).length;
        const changed = revision ? rows.filter(r => lineChanged(r, revision.base.get(r.taskId), period)).length : 0;
        return <div key={group}>
          <GroupHeader index={gi + 1} name={group} open={open} onToggle={() => accordion.toggle(group)} count={rows.length}
            tone="bg-teal-50 border-l-teal-600 text-teal-950 dark:bg-teal-950/40 dark:border-l-teal-500 dark:text-teal-100">
            {errors > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">{errors} lỗi</span>}
            {changed > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{changed} thay đổi</span>}
            {overdue > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">{overdue} trễ hạn</span>}
            {missing > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{missing} chưa nhập KL</span>}
            {uniqueCrews(rows).slice(0, 3).map(c => <CrewPill key={c} name={c} />)}
          </GroupHeader>
          {open && rows.map((line, li) => {
            const qty = parseQty(line.plannedQty);
            const remaining = remainingOf(line);
            const invalid = Number.isNaN(qty) || (qty != null && qty < 0);
            const over = qty != null && !Number.isNaN(qty) && remaining != null && qty > remaining + 0.001;
            const base = revision?.base.get(line.taskId);
            const changed = revision ? lineChanged(line, base, period) : false;
            const issues = issuesOf(line);
            const startLocked = !!revision && !!base && (base.plannedStart?.slice(0, 10) || period.periodStart) < revision.today;
            const doneBlocks = !!revision && !!base && (base.actualQty ?? 0) > 0.0005;
            return <div key={line.taskId} className={`relative grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border px-3 py-2.5 text-sm lg:items-start ${cols} ${issues.length ? 'bg-rose-50/60 dark:bg-rose-950/20' : changed ? 'bg-amber-50/50 dark:bg-amber-950/20' : line.overdue ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''}`}>
              <span className="hidden pt-1.5 text-xs tabular-nums text-muted-foreground lg:block">{gi + 1}.{li + 1}</span>
              <div className="col-span-2 min-w-0 pr-10 lg:col-span-1 lg:pr-0">
                <p><span className="mr-1.5 text-muted-foreground">{line.wbsCode}</span>{line.taskName}
                  {line.overdue && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">Trễ hạn</span>}
                  {revision && !base && <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-200">Thêm mới</span>}</p>
                {line.actualQty != null && line.actualQty > 0 && <p className={`mt-0.5 text-xs text-muted-foreground ${WRAP}`}>Đã làm trong kỳ <b className="text-foreground">{fmt(line.actualQty)}</b> {line.unit || ''}</p>}
                {issues.map(issue => <p key={issue.code} className={`mt-1 text-xs font-semibold text-rose-700 dark:text-rose-300 ${WRAP}`}><AlertTriangle size={12} className="mr-1 inline -translate-y-px" />{issue.message}{' '}
                  {(issue.code === 'START_LOCKED' || issue.code === 'START_IN_PAST') && base && <button type="button" onClick={() => onChange(line.taskId, { plannedStart: base.plannedStart?.slice(0, 10) || '' })}
                    className="rounded-md border border-rose-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:bg-transparent">Giữ ngày bắt đầu {dateVi(base.plannedStart || period.periodStart)}</button>}
                  {issue.code === 'END_IN_PAST' && base && <button type="button" onClick={() => onChange(line.taskId, { plannedEnd: base.plannedEnd?.slice(0, 10) || '' })}
                    className="rounded-md border border-rose-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:bg-transparent">Giữ ngày kết thúc {dateVi(base.plannedEnd || period.periodEnd)}</button>}</p>)}
              </div>
              <span className="text-right text-xs tabular-nums text-muted-foreground"><span className="float-left lg:hidden">{revision ? `Bản ${revision.baseNo}` : 'Còn lại'}</span>
                {revision ? (base ? `${base.plannedQty == null ? 'Chưa có KL' : fmt(base.plannedQty)} ${line.unit || ''}` : '—') : remaining == null ? 'Chưa có KL' : `${fmt(remaining)} ${line.unit || ''}`}
                {periodType === 'week' && line.monthPlanQty != null && <span className="block">KH tháng {fmt(line.monthPlanQty)}</span>}</span>
              <label className="col-span-2 block lg:col-span-1"><span className="sr-only">Khối lượng kế hoạch {line.taskName}</span>
                <span className="mb-1 block text-xs text-muted-foreground lg:hidden">KL kế hoạch ({line.unit || '—'})</span>
                <input inputMode="decimal" value={line.plannedQty} disabled={disabled} aria-invalid={invalid}
                  placeholder={line.totalQty == null ? 'Không bắt buộc' : 'Nhập KL'}
                  onChange={event => onChange(line.taskId, { plannedQty: event.target.value })}
                  className={`w-full rounded-lg border bg-background px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums outline-none focus:border-teal-600 ${invalid ? 'border-rose-500' : 'border-border'}`} />
                {invalid && <span className="mt-1 block text-xs text-rose-600">Nhập số ≥ 0</span>}
                {over && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Vượt phần còn lại</span>}
              </label>
              <div className="col-span-2 grid grid-cols-2 gap-2 lg:col-span-1 lg:grid-cols-1 lg:gap-1">
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground lg:sr-only">Bắt đầu</span>
                  <input type="date" value={line.plannedStart} min={period.periodStart} max={period.periodEnd} disabled={disabled || startLocked}
                    onChange={event => onChange(line.taskId, { plannedStart: event.target.value })} aria-label={`Ngày bắt đầu ${line.taskName}`}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-teal-600 disabled:opacity-70" />
                  {!line.plannedStart && <span className="mt-0.5 block text-[11px] text-muted-foreground">Bắt đầu theo kỳ</span>}
                  {startLocked && <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Lock size={10} />đã bắt đầu</span>}</label>
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground lg:sr-only">Kết thúc</span>
                  <input type="date" value={line.plannedEnd} min={revision ? (revision.today > period.periodStart ? revision.today : period.periodStart) : period.periodStart} max={period.periodEnd} disabled={disabled}
                    onChange={event => onChange(line.taskId, { plannedEnd: event.target.value })} aria-label={`Ngày kết thúc ${line.taskName}`}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-teal-600" />
                  {!line.plannedEnd && <span className="mt-0.5 block text-[11px] text-muted-foreground">Kết thúc theo kỳ</span>}</label>
              </div>
              <label className="col-span-2 block lg:col-span-1"><span className="sr-only">Tổ đội hoặc nhà thầu</span>
                <span className="relative block">
                  <HardHat size={13} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${line.crewLabel?.trim() ? 'text-teal-700 dark:text-teal-300' : 'text-muted-foreground'}`} />
                  <input value={line.crewLabel || ''} disabled={disabled} placeholder="Tổ đội / nhà thầu"
                    onChange={event => onChange(line.taskId, { crewLabel: event.target.value })}
                    className={`w-full rounded-lg border py-1.5 pl-7 pr-2.5 text-sm outline-none focus:border-teal-600 ${line.crewLabel?.trim() ? `font-semibold ${crewColor(line.crewLabel)}` : 'border-border bg-background'}`} />
                </span></label>
              <div className="absolute right-2 top-2 flex gap-0.5 lg:static lg:justify-self-end">
                {revision && base && changed && <button type="button" disabled={disabled} title={`Hoàn tác về Bản ${revision.baseNo}`} aria-label={`Hoàn tác ${line.taskName}`}
                  onClick={() => onChange(line.taskId, { ...lineToDraft(base), changeReasonCode: '', changeNote: '' })} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"><Undo2 size={15} /></button>}
                <button type="button" disabled={disabled || doneBlocks} onClick={() => onRemove(line.taskId)}
                  title={doneBlocks ? 'Đã làm trong kỳ — giảm khối lượng về phần đã làm thay vì bỏ' : `Bỏ ${line.taskName} khỏi kế hoạch`} aria-label={`Bỏ ${line.taskName} khỏi kế hoạch`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><Trash2 size={15} /></button>
              </div>
              {revision && changed && <div className="col-span-2 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-white/70 px-2.5 py-2 dark:border-amber-900 dark:bg-transparent lg:col-span-full lg:ml-[60px] lg:flex-row lg:items-center">
                <span className="shrink-0 text-xs font-semibold text-amber-800 dark:text-amber-200">Lý do thay đổi</span>
                <select value={line.changeReasonCode} disabled={disabled} onChange={event => onChange(line.taskId, { changeReasonCode: event.target.value })} aria-label={`Lý do thay đổi ${line.taskName}`}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-teal-600 lg:w-72">
                  <option value="">Theo lý do chính của bản</option>
                  {revision.reasons.map(r => <option key={r.code} value={r.code}>{r.label} · {RESPONSIBLE_PARTY_LABELS[r.defaultParty]}</option>)}
                </select>
                <input value={line.changeNote} disabled={disabled} onChange={event => onChange(line.taskId, { changeNote: event.target.value })} placeholder="Ghi chú thêm (không bắt buộc)" aria-label={`Ghi chú thay đổi ${line.taskName}`}
                  className="w-full min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus:border-teal-600 lg:flex-1" />
              </div>}
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
};

const RemovedLinesPanel: React.FC<{
  basePlan: WorkPlan; lines: DraftLine[]; removed: RevisionDraft['removed']; reasons: WorkPlanBoard['reasons']; disabled: boolean;
  onReason: (taskId: string, patch: Partial<{ changeReasonCode: string; changeNote: string }>) => void; onRestore: (line: WorkPlanLine) => void;
}> = ({ basePlan, lines, removed, reasons, disabled, onReason, onRestore }) => {
  const inDraft = new Set(lines.map(l => l.taskId));
  const gone = basePlan.lines.filter(l => !inDraft.has(l.taskId));
  if (!gone.length) return null;
  return <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900 dark:bg-rose-950/20">
    <p className="text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">Việc bỏ khỏi kỳ · {gone.length}</p>
    {gone.map(l => <div key={l.taskId} className="grid gap-2 rounded-lg border border-border bg-card px-3 py-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto] md:items-center">
      <div className="min-w-0 text-sm"><p className="text-muted-foreground line-through">{l.wbsCode && <span className="mr-1.5">{l.wbsCode}</span>}{l.taskName}</p>
        <p className="text-xs text-muted-foreground">Bản {basePlan.revisionNo}: {l.plannedQty == null ? 'Chưa có KL' : `${fmt(l.plannedQty)} ${l.unit || ''}`} — sang kỳ sau</p></div>
      <div className="flex flex-col gap-1">
        <select value={removed[l.taskId]?.changeReasonCode || ''} disabled={disabled} onChange={e => onReason(l.taskId, { changeReasonCode: e.target.value })} aria-label={`Lý do bỏ ${l.taskName}`}
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">Theo lý do chính của bản</option>
          {reasons.map(r => <option key={r.code} value={r.code}>{r.label} · {RESPONSIBLE_PARTY_LABELS[r.defaultParty]}</option>)}
        </select>
        <input value={removed[l.taskId]?.changeNote || ''} disabled={disabled} onChange={e => onReason(l.taskId, { changeNote: e.target.value })} placeholder="Ghi chú (không bắt buộc)"
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs" />
      </div>
      <button type="button" disabled={disabled} onClick={() => onRestore(l)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"><Undo2 size={13} />Giữ lại</button>
    </div>)}
  </div>;
};

// ---------------------------------------------------------------------------
// Gửi duyệt bản điều chỉnh: lý do chính, bên chịu trách nhiệm, mô tả, văn bản, tác động.
// ---------------------------------------------------------------------------
const SubmitRevisionDialog: React.FC<{
  board: WorkPlanBoard; draft: Draft; rows: ReturnType<typeof diffPlans>; projectId: string; siteId: string | null; periodLabel: string; busy: boolean;
  onClose: () => void; onSend: (fields: { changeReasonCode: string; responsibleParty: ResponsibleParty; changeSummary: string; attachments: WorkPlanAttachment[] }, approverId: string) => void;
}> = ({ board, draft, rows, projectId, siteId, periodLabel, busy, onClose, onSend }) => {
  const toast = useToast();
  const rev = draft.revision!;
  const lineReasons = draft.lines.map(l => l.changeReasonCode).filter(Boolean);
  const firstCode = rev.changeReasonCode || lineReasons[0] || '';
  const [reason, setReason] = useState(firstCode);
  const [party, setParty] = useState<ResponsibleParty | ''>(rev.responsibleParty || board.reasons.find(r => r.code === firstCode)?.defaultParty || '');
  const [summary, setSummary] = useState(rev.changeSummary);
  const [files, setFiles] = useState<WorkPlanAttachment[]>(rev.attachments);
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const [impact, setImpact] = useState<WorkPlanImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);
  const approvers = board.approvers.filter(a => a.id !== board.currentUserId);
  const [approverId, setApproverId] = useState('');
  useEffect(() => {
    let alive = true;
    if (!draft.planId) { setImpactLoading(false); return; }
    projectWorkPlanService.previewImpact(draft.planId).then(x => { if (alive) setImpact(x); }).catch(() => undefined).finally(() => { if (alive) setImpactLoading(false); });
    return () => { alive = false; };
  }, [draft.planId]);
  const codes = [reason, ...lineReasons, ...Object.values(rev.removed).map(r => r.changeReasonCode)];
  const docMissing = reasonNeedsDocument(board.reasons, codes) && files.length === 0;
  const errors = { reason: !reason, party: !party, summary: summary.trim().length < 10, doc: docMissing };
  const send = () => { setTried(true); if (Object.values(errors).some(Boolean)) return; onSend({ changeReasonCode: reason, responsibleParty: party as ResponsibleParty, changeSummary: summary.trim(), attachments: files }, approverId); };
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try { const added = await projectWorkPlanService.uploadAttachments({ projectId, constructionSiteId: siteId, files: Array.from(list) }); setFiles(f => [...f, ...added]); }
    catch (caught) { toast.error('Chưa tải được tệp', caught instanceof Error ? caught.message : ''); }
    finally { setUploading(false); }
  };
  return <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Gửi duyệt bản điều chỉnh"
    onClick={e => e.target === e.currentTarget && !busy && onClose()}>
    <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div><h3 className="text-base font-bold text-foreground">Gửi duyệt bản điều chỉnh · {periodLabel}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Bản {rev.basePlan.revisionNo} vẫn là bản hiện hành cho tới khi bản này được duyệt.</p></div>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div><p className="mb-1.5 text-xs font-semibold text-foreground">Lý do chính <span className="text-rose-600">*</span></p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Lý do chính">{board.reasons.map(r => <button key={r.code} type="button" role="radio" aria-checked={reason === r.code}
            onClick={() => { setReason(r.code); setParty(r.defaultParty); }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${reason === r.code ? 'border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border text-muted-foreground hover:text-foreground'}`}>{r.label}</button>)}</div>
          {tried && errors.reason && <span className="mt-1 block text-xs text-rose-600">Chọn lý do chính.</span>}
          <p className="mt-1 text-xs text-muted-foreground">Dòng nào chưa chọn lý do riêng sẽ lấy lý do chính.</p></div>
        <div><p className="mb-1.5 text-xs font-semibold text-foreground">Bên chịu trách nhiệm <span className="text-rose-600">*</span></p>
          <div className="flex flex-wrap gap-1.5">{(Object.keys(RESPONSIBLE_PARTY_LABELS) as ResponsibleParty[]).map(p => <button key={p} type="button" onClick={() => setParty(p)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${party === p ? PARTY_TONE[p] : 'border-border text-muted-foreground'}`}>{RESPONSIBLE_PARTY_LABELS[p]}</button>)}</div>
          {party === 'owner' && <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">Thay đổi do Chủ đầu tư được gom vào danh sách làm hồ sơ gia hạn / phát sinh — nên đính kèm văn bản.</p>}</div>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-foreground">Mô tả ngắn <span className="text-rose-600">*</span></span>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} placeholder="Điều gì thay đổi và vì sao. Ví dụ: Mưa 17–19/10, tường ngoài chưa khô — dời sơn ngoài sang tháng 11."
            className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-teal-600 ${tried && errors.summary ? 'border-rose-500' : 'border-border'}`} />
          {tried && errors.summary && <span className="mt-1 block text-xs text-rose-600">Ghi ít nhất 10 ký tự.</span>}</label>
        <div><p className="mb-1.5 text-xs font-semibold text-foreground">Văn bản, ảnh đính kèm{reasonNeedsDocument(board.reasons, codes) && <span className="text-rose-600"> *</span>}</p>
          <AttachmentList files={files} onRemove={path => setFiles(f => f.filter(x => x.path !== path))} />
          <label className={`mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-teal-500 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:text-teal-300 ${uploading ? 'opacity-60' : ''}`}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}{uploading ? 'Đang tải…' : 'Thêm tệp (PDF, ảnh, Word, Excel ≤ 25 MB)'}
            <input type="file" multiple className="sr-only" disabled={uploading} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={e => { void upload(e.target.files); e.target.value = ''; }} /></label>
          {tried && errors.doc && <span className="mt-1 block text-xs text-rose-600">Lý do này cần văn bản (công văn, biên bản) để làm hồ sơ với Chủ đầu tư.</span>}</div>
        <ImpactBlock rows={rows} impact={impact} loading={impactLoading} />
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Người duyệt
          <select value={approverId} onChange={e => setApproverId(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground">
            <option value="">Tất cả người có quyền duyệt</option>{approvers.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <span className="flex items-center gap-1"><ShieldCheck size={13} className="text-teal-600" />Người lập không tự duyệt bản của mình.</span></label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">Hủy</button>
        <button type="button" onClick={send} disabled={busy || uploading} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Gửi duyệt</button>
      </div>
    </div>
  </div>;
};

// ---------------------------------------------------------------------------
// Các phiên bản của kỳ: dải phiên bản, so sánh với gốc / bản trước, thực hiện, lịch sử.
// ---------------------------------------------------------------------------
const VersionsBoard: React.FC<{ board: WorkPlanBoard; initialId: string; actions?: React.ReactNode; periodStarted: boolean; kindLabel: string }> = ({ board, initialId, actions, periodStarted, kindLabel }) => {
  const versions = board.versions;
  const original = originalVersion(versions);
  const [viewId, setViewId] = useState(initialId);
  const viewed = versions.find(v => v.id === viewId) || versions[versions.length - 1];
  const isFirst = !viewed.supersedesPlanId || viewed.id === original?.id;
  const [cmp, setCmp] = useState<CompareMode>(isFirst ? 'none' : 'goc');
  const [onlyChanged, setOnlyChanged] = useState(true);
  useEffect(() => { setViewId(initialId); }, [initialId]);
  const mode: CompareMode = isFirst ? 'none' : cmp;
  const base = mode === 'goc' ? original : mode === 'prev' ? versions.find(v => v.id === viewed.supersedesPlanId) || null : null;
  const rows = useMemo(() => diffPlans(base, viewed), [base, viewed]);
  const actual = useMemo(() => { const m = new Map<string, number | null>(); versions.forEach(v => v.lines.forEach(l => { if (!m.has(l.taskId) || m.get(l.taskId) == null) m.set(l.taskId, l.actualQty ?? null); })); return m; }, [versions]);
  const [tag, tone] = (() => { const t = versions.length && original?.id === viewed.id ? ['Gốc', TONE.teal] : viewed.status === 'approved' ? ['Hiện hành', TONE.leaf] : viewed.status === 'submitted' ? ['Chờ duyệt', TONE.amber] : viewed.status === 'superseded' ? ['Bản cũ', TONE.slate] : ['Nháp', TONE.slate]; return t; })();
  return <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5" aria-label="Các phiên bản của kỳ">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-foreground">{kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)} · Bản {viewed.revisionNo}</h3><Badge className={tone}>{tag}</Badge></div>
      {actions}
    </div>
    {versions.length > 1 && <VersionStrip versions={versions} reasons={board.reasons} selected={viewed.id} onSelect={id => { setViewId(id); const v = versions.find(x => x.id === id); if (v && (!v.supersedesPlanId || v.id === original?.id)) setCmp('none'); else if (cmp === 'none') setCmp('goc'); }} />}
    {versions.length > 1 && <CompareControl value={mode} onChange={setCmp} isFirst={isFirst} onlyChanged={onlyChanged} onOnlyChanged={setOnlyChanged} />}
    {base && <CompareSummary rows={rows} versions={versions} baseNo={base.revisionNo} curNo={viewed.revisionNo}
      label={`Bản ${viewed.revisionNo} so với ${mode === 'goc' ? 'bản gốc' : `Bản ${base.revisionNo}`}`} />}
    {viewed.changeSummary && viewed.supersedesPlanId && <p className={`text-sm text-muted-foreground ${WRAP}`}><b className="text-foreground">Vì sao điều chỉnh:</b> {viewed.changeSummary}
      {viewed.changeReasonCode && <span className="ml-2 inline-flex"><ReasonChip reasons={board.reasons} code={viewed.changeReasonCode} party={viewed.responsibleParty} /></span>}</p>}
    {viewed.attachments.length > 0 && <AttachmentList files={viewed.attachments} />}
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thực hiện đến {dateVi(board.today)} — chấm theo bản gốc{viewed.id !== original?.id ? ', xem thêm theo bản đang xem' : ''}</p>
      {!periodStarted ? <p className="text-xs text-muted-foreground">Kỳ chưa bắt đầu — số thực hiện sẽ tự lấy từ Nhật ký và Chốt tiến độ.</p> : <>
        {original && <PerfRow label={`Theo bản gốc (Bản ${original.revisionNo})`} hint="Dùng để đánh giá kỳ" plan={original} today={board.today} actualOf={id => actual.get(id)} strong />}
        {viewed.id !== original?.id && <PerfRow label={`Theo Bản ${viewed.revisionNo}`} hint={viewed.status === 'approved' ? 'Bản đang điều hành' : 'Bản đang xem'} plan={viewed} today={board.today} actualOf={id => actual.get(id)} />}
      </>}
    </div>
    <DiffTable rows={rows} compare={mode !== 'none'} onlyChanged={onlyChanged} today={board.today} reasons={board.reasons}
      basePlan={base} curPlan={viewed} original={original} curLabel={`Bản ${viewed.revisionNo}`}
      refsOf={r => base ? changeRefs(versions, r.taskId, base.revisionNo, viewed.revisionNo) : []} />
    {versions.length > 1 && <VersionHistory versions={versions} reasons={board.reasons} onView={(id, m) => { setViewId(id); setCmp(m); }} />}
  </section>;
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
    return { type: type as WorkPlanPeriodType, start: normalizeWorkPlanPeriodStart(type, params.get('start') || toIsoDate(new Date())),
      view: (params.get('view') === 'material' ? 'material' : 'work') as 'work' | 'material' };
  })();
  const [periodType, setPeriodType] = useState<WorkPlanPeriodType>(initial.type);
  const [view, setView] = useState<'work' | 'material'>(initial.view);
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [board, setBoard] = useState<WorkPlanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WorkPlanCandidate[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<PickerFilter | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approverId, setApproverId] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [submitDialog, setSubmitDialog] = useState(false);
  const [reviewImpact, setReviewImpact] = useState<WorkPlanImpact | null>(null);
  const [reviewCmp, setReviewCmp] = useState<CompareMode>('prev');
  const request = useRef(0);

  const today = board?.today || toIsoDate(new Date());
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
      if (open && ['draft', 'returned'].includes(open.status)) {
        const basePlan = open.supersedesPlanId ? next.versions.find(v => v.id === open.supersedesPlanId) || null : null;
        setDraft({
          planId: open.id, rowVersion: open.rowVersion, note: open.note || '', lines: open.lines.map(lineToDraft),
          revision: basePlan ? {
            basePlan, changeReasonCode: open.changeReasonCode || '', responsibleParty: open.responsibleParty || '', changeSummary: open.changeSummary || '',
            attachments: open.attachments || [],
            removed: Object.fromEntries((open.removedLines || []).map(r => [r.taskId, { changeReasonCode: r.changeReasonCode || '', changeNote: r.changeNote || '' }])),
          } : null,
        });
      } else setDraft(null);
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

  // Bản điều chỉnh đang chờ duyệt: tính sẵn tác động cho người duyệt.
  const open = board?.open || null;
  useEffect(() => {
    setReviewImpact(null); setReviewCmp('prev');
    if (open?.status === 'submitted' && open.supersedesPlanId) projectWorkPlanService.previewImpact(open.id).then(setReviewImpact).catch(() => undefined);
  }, [open?.id, open?.status, open?.supersedesPlanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveDraft = async () => !dirty || confirm({ title: 'Bỏ thay đổi chưa lưu?', targetName: periodLabel,
    warningText: 'Các thay đổi trên kế hoạch chưa được lưu sẽ mất.', actionLabel: 'Bỏ thay đổi', cancelLabel: 'Ở lại', intent: 'warning' });

  const changePeriod = async (type: WorkPlanPeriodType, start: string) => {
    if (!(await leaveDraft())) return;
    setPeriodType(type); setPeriodStart(normalizeWorkPlanPeriodStart(type, start));
  };

  const periodEnd = board?.periodEnd || '';
  const earliestNew = draft?.revision ? today : periodStart;
  const startNewPlan = async () => {
    setBusy('new');
    try {
      const rows = await ensureCandidates();
      const suggested = rows.filter(c => c.inPeriod && !c.finished && c.suggestedQty != null && c.suggestedQty > 0 && !c.overdue);
      setDraft({ note: '', revision: null, lines: suggested.map(c => candidateToDraft(c, periodStart, periodEnd, periodStart)) });
      setDirty(true);
      toast.info(`Đã gợi ý ${suggested.length} công việc có lịch trong kỳ`, 'Chỉnh khối lượng, ngày, thêm việc nếu cần rồi lưu nháp.');
    } catch (caught) { toast.error('Không lấy được công việc từ bảng tiến độ', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const openPicker = async (filter: PickerFilter = 'period') => {
    setBusy('picker');
    try { await ensureCandidates(); setPicker(filter); }
    catch (caught) { toast.error('Không tải được danh sách công việc', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const revisionCtx: RevisionCtx | null = useMemo(() => draft?.revision ? {
    base: new Map(draft.revision.basePlan.lines.map(l => [l.taskId, l])), baseNo: draft.revision.basePlan.revisionNo, today, reasons: board?.reasons || [],
  } : null, [board?.reasons, draft?.revision, today]);
  const period = useMemo(() => ({ periodStart, periodEnd: periodEnd || periodStart }), [periodEnd, periodStart]);
  const issuesOf = useCallback((line: DraftLine): RevisionIssue[] => {
    if (!revisionCtx) return [];
    return revisionLineIssues({ line: asLine(line), base: revisionCtx.base.get(line.taskId) || null, period, today, done: line.actualQty });
  }, [period, revisionCtx, today]);

  const overdueMissing = useMemo(() => {
    if (!draft || !candidates) return 0;
    const inPlan = new Set(draft.lines.map(l => l.taskId));
    return candidates.filter(c => c.overdue && !inPlan.has(c.taskId)).length;
  }, [candidates, draft]);
  const draftErrors = useMemo(() => draft ? draft.lines.filter(l => { const q = parseQty(l.plannedQty); return Number.isNaN(q) || (q != null && q < 0); }).length : 0, [draft]);
  const ruleErrors = useMemo(() => draft?.revision ? draft.lines.filter(l => issuesOf(l).length).length : 0, [draft, issuesOf]);
  const draftAsPlan = useMemo(() => draft ? {
    periodStart, periodEnd: periodEnd || periodStart,
    lines: draft.lines.map(l => ({ taskId: l.taskId, workBoqItemId: null, wbsCode: l.wbsCode, taskName: l.taskName, groupName: l.groupName, unit: l.unit,
      totalQty: l.totalQty, doneBeforeQty: l.doneBeforeQty, crewLabel: l.crewLabel, note: l.note, ...asLine(l), actualQty: l.actualQty })) as WorkPlanLine[],
  } : null, [draft, periodEnd, periodStart]);
  const draftRows = useMemo(() => draft?.revision && draftAsPlan ? diffPlans(draft.revision.basePlan, draftAsPlan) : [], [draft?.revision, draftAsPlan]);
  const changedCount = draftRows.filter(r => r.kind !== 'same').length;

  const saveDraft = async (extra?: { changeReasonCode: string; responsibleParty: ResponsibleParty; changeSummary: string; attachments: WorkPlanAttachment[] }): Promise<{ planId: string; rowVersion: number } | null> => {
    if (!draft) return null;
    if (draftErrors) { toast.error('Còn khối lượng chưa hợp lệ', 'Sửa các ô được tô đỏ rồi lưu lại.'); return null; }
    if (ruleErrors) { toast.error('Còn dòng vi phạm luật không sửa lùi', 'Sửa các dòng tô đỏ (dùng nút gợi ý ở từng dòng) rồi lưu lại.'); return null; }
    const rev = draft.revision;
    const result = await projectWorkPlanService.save({
      planId: draft.planId, expectedRowVersion: draft.rowVersion, projectId, constructionSiteId: siteId, periodType, periodStart,
      note: draft.note,
      lines: draft.lines.map(l => ({ taskId: l.taskId, ...asLine(l), crewLabel: l.crewLabel, note: l.note,
        changeReasonCode: rev && l.changeReasonCode ? l.changeReasonCode : null, responsibleParty: null, changeNote: rev && l.changeNote.trim() ? l.changeNote.trim() : null })),
      ...(rev ? {
        changeReasonCode: extra?.changeReasonCode ?? (rev.changeReasonCode || null),
        responsibleParty: extra?.responsibleParty ?? (rev.responsibleParty || null),
        changeSummary: extra?.changeSummary ?? (rev.changeSummary || null),
        attachments: extra?.attachments ?? rev.attachments,
        removedLines: Object.entries(rev.removed).map(([taskId, r]) => ({ taskId, changeReasonCode: r.changeReasonCode || null, changeNote: r.changeNote.trim() || null })),
      } : {}),
    });
    setDraft(current => current ? { ...current, planId: result.planId, rowVersion: result.rowVersion,
      revision: current.revision && extra ? { ...current.revision, ...extra } : current.revision } : current);
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
    if (draft.revision) {
      if (!changedCount) { toast.error('Bản điều chỉnh chưa thay đổi gì', `Sửa khối lượng, ngày hoặc thêm / bỏ việc so với Bản ${draft.revision.basePlan.revisionNo}.`); return; }
      if (await saveDraft()) setSubmitDialog(true);
      return;
    }
    const saved = await saveDraft(); if (!saved) return;
    await projectWorkPlanService.transition({ planId: saved.planId, expectedRowVersion: saved.rowVersion, action: 'submit', recipientUserId: approverId || null });
    toast.success('Đã gửi duyệt', `${periodLabel} đang chờ ${periodType === 'month' ? 'GĐ dự án' : 'CHT'} duyệt.`);
    await load();
  });
  const onSendRevision = (fields: { changeReasonCode: string; responsibleParty: ResponsibleParty; changeSummary: string; attachments: WorkPlanAttachment[] }, recipient: string) => run('send', async () => {
    const saved = await saveDraft(fields); if (!saved) return;
    await projectWorkPlanService.transition({ planId: saved.planId, expectedRowVersion: saved.rowVersion, action: 'submit', recipientUserId: recipient || null });
    setSubmitDialog(false);
    toast.success('Đã gửi duyệt bản điều chỉnh', `Bản hiện hành vẫn có hiệu lực tới khi bản này được duyệt.`);
    await load();
  });
  const onTransition = (plan: WorkPlan, action: WorkPlanAction) => run(action, async () => {
    let reason: string | undefined;
    if (action === 'return') {
      const value = await reasonConfirm({ title: `Trả lại ${kindLabel}`, targetName: periodLabel, reasonLabel: 'Lý do trả lại',
        reasonPlaceholder: 'Ví dụ: KL đổ bê tông móng M3 chưa khớp tiến độ, thiếu tổ nề…', actionLabel: 'Trả lại', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 });
      if (!value) return; reason = value;
    }
    if (action === 'keep') {
      const value = await reasonConfirm({ title: 'Giữ nguyên kế hoạch', targetName: periodLabel, reasonLabel: 'Lý do giữ nguyên',
        warningText: plan.needsReviewReason || 'Kế hoạch cấp trên đã đổi.', reasonPlaceholder: 'Ví dụ: tuần này vẫn làm đúng như cũ, thay đổi chỉ ảnh hưởng tuần sau',
        actionLabel: 'Giữ nguyên', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0, minLength: 5 });
      if (!value) return; reason = value;
    }
    if (action === 'delete' && !(await confirm({ title: 'Xóa bản nháp?', targetName: periodLabel, warningText: 'Bản nháp chưa từng gửi duyệt sẽ bị xóa hẳn.', actionLabel: 'Xóa nháp', intent: 'danger' }))) return;
    if (action === 'approve' && !(await confirm({ title: `Duyệt ${kindLabel}?`, targetName: periodLabel,
      warningText: plan.supersedesPlanId
        ? `Bản ${plan.revisionNo} thay bản hiện hành. Thành tích kỳ vẫn chấm theo bản gốc. Kế hoạch tuần và kế hoạch vật tư liên quan sẽ được đánh dấu cần xem lại.`
        : `${plan.lines.length} công việc sẽ thành kế hoạch chính thức (bản gốc) của kỳ.`,
      actionLabel: 'Duyệt', intent: 'success', countdownSeconds: 0 }))) return;
    await projectWorkPlanService.transition({ planId: plan.id, expectedRowVersion: plan.rowVersion, action, reason });
    toast.success({ approve: 'Đã duyệt kế hoạch', return: 'Đã trả lại người lập', withdraw: 'Đã rút về để sửa', delete: 'Đã xóa bản nháp', submit: 'Đã gửi duyệt', keep: 'Đã giữ nguyên kế hoạch' }[action], periodLabel);
    await load();
  });
  const onRevise = (plan: WorkPlan) => run('revise', async () => {
    if (!(await confirm({ title: 'Tạo bản điều chỉnh?', targetName: `${periodLabel} · từ Bản ${plan.revisionNo}`,
      warningText: `Bản ${plan.revisionNo} vẫn có hiệu lực tới khi bản điều chỉnh được duyệt. Chỉ sửa phần việc từ hôm nay trở đi; ngày đã qua và phần đã làm giữ nguyên.`,
      actionLabel: 'Tạo bản điều chỉnh', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 }))) return;
    await projectWorkPlanService.revise({ planId: plan.id, reason: plan.needsReviewReason || undefined });
    toast.success('Đã tạo bản điều chỉnh', 'Sửa các dòng cần đổi, chọn lý do rồi gửi duyệt.');
    await load();
  });

  const patchLine = (taskId: string, patch: Partial<DraftLine>) => {
    setDraft(current => current ? { ...current, lines: current.lines.map(l => l.taskId === taskId ? { ...l, ...patch } : l) } : current);
    setDirty(true);
  };
  const removeLine = (taskId: string) => { setDraft(current => current ? { ...current, lines: current.lines.filter(l => l.taskId !== taskId) } : current); setDirty(true); };
  const addLines = (rows: WorkPlanCandidate[]) => {
    setDraft(current => current ? { ...current, lines: [...current.lines, ...rows.map(c => candidateToDraft(c, periodStart, periodEnd || periodStart, earliestNew))] } : current);
    setDirty(true); setPicker(null);
  };
  const patchRevision = (patch: Partial<RevisionDraft>) => { setDraft(current => current?.revision ? { ...current, revision: { ...current.revision, ...patch } } : current); setDirty(true); };

  const permissions = board?.permissions;
  const approved = board?.approved || null;
  const periodStarted = periodStart <= today;
  const periodEnded = Boolean(board?.periodEnded);
  const isCurrent = periodStart <= today && today <= (periodEnd || periodStart);
  const me = board?.currentUserId || null;

  const header = <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><CalendarRange size={20} className="text-teal-600" />{view === 'work' ? 'Kế hoạch thi công' : 'Kế hoạch vật tư'}</h2>
      <p className="text-xs text-muted-foreground">{view === 'work' ? 'Mỗi kỳ có bản gốc và các bản điều chỉnh. Số thực hiện lấy tự động từ Nhật ký và Chốt tiến độ.'
        : 'Tính nhu cầu vật tư từ kế hoạch thi công đã duyệt, đối chiếu tồn kho và BOQ. Tuần: đề nghị mua gửi CHT duyệt rồi sang Mua hàng. Tháng: dự báo.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-teal-200 bg-teal-50 p-1 dark:border-teal-900 dark:bg-teal-950/40" role="tablist" aria-label="Loại kế hoạch">
        {([['work', 'Thi công'], ['material', 'Vật tư']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key}
          onClick={async () => { if (view !== key && (key === 'work' || await leaveDraft())) setView(key); }}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${view === key ? 'bg-teal-700 text-white shadow-sm' : 'text-teal-800 hover:bg-teal-100 dark:text-teal-200 dark:hover:bg-teal-900/40'}`}>{label}</button>)}
      </div>
      <div className="inline-flex rounded-xl border border-border bg-muted/60 p-1" role="tablist" aria-label="Kỳ kế hoạch">
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

  if (view === 'material') return <div className="space-y-4">{header}
    <MaterialPlanPanel projectId={projectId} constructionSiteId={siteId} periodType={periodType} periodStart={periodStart} onOpenWorkPlan={() => setView('work')} />
  </div>;

  if (loading && !board) return <div className="space-y-4">{header}<div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang tải kế hoạch…</div></div>;
  if (error && !board) return <div className="space-y-4">{header}<div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
    <p className="font-semibold">{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold"><RotateCcw size={13} />Thử lại</button></div></div>;

  const editing = Boolean(draft);
  const busyIcon = (key: string) => busy === key ? <Loader2 size={15} className="animate-spin" /> : null;
  const editDisabled = Boolean(busy) || periodEnded;
  const reviewBase = open?.supersedesPlanId ? (reviewCmp === 'goc' ? originalVersion(board?.versions || []) : board?.versions.find(v => v.id === open.supersedesPlanId) || null) : null;
  const reviewRows = open && reviewBase ? diffPlans(reviewBase, open) : [];
  const isSelf = (plan: WorkPlan) => Boolean(me && (plan.createdBy === me || plan.submittedBy === me));

  return <div className="space-y-4">
    {header}
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}

    {periodEnded && <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <Lock size={16} className="mt-0.5 shrink-0" /><span><strong>{periodLabel} đã kết thúc ngày {dateVi(periodEnd)}.</strong> Kỳ đã qua chỉ để xem — không lập và không điều chỉnh kế hoạch. Thành tích kỳ chấm theo bản gốc; việc chưa xong đưa vào kỳ sau.</span></div>}

    {approved?.needsReviewAt && !periodEnded && <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
      <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><strong>Cần xem lại {kindLabel}.</strong> {approved.needsReviewReason}</span></span>
      {permissions?.canEdit && !open && <span className="flex shrink-0 flex-wrap gap-2">
        <button type="button" onClick={() => onRevise(approved)} disabled={Boolean(busy)} className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Tạo bản điều chỉnh</button>
        <button type="button" onClick={() => onTransition(approved, 'keep')} disabled={Boolean(busy)} className="rounded-lg border border-amber-400 bg-white/80 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:bg-transparent">Giữ nguyên — ghi lý do</button>
      </span>}
    </div>}

    {/* Open plan: being written or returned. */}
    {editing && draft && <section className="space-y-3 rounded-2xl border border-teal-200 bg-card p-4 shadow-sm dark:border-teal-900 md:p-5" aria-label={`Soạn ${kindLabel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-foreground">{draft.revision ? 'Soạn bản điều chỉnh' : draft.planId ? `Soạn ${kindLabel}` : `Lập ${kindLabel}`} · {periodLabel}</h3>
          {open ? <StatusChip status={open.status} /> : <span className="text-xs font-semibold text-amber-700">Chưa lưu</span>}
          {open && open.revisionNo > 1 && <span className="text-xs text-muted-foreground">Bản {open.revisionNo} · từ Bản {draft.revision?.basePlan.revisionNo}</span>}
        </div>
        <button type="button" onClick={() => void openPicker('period')} disabled={editDisabled} className="inline-flex items-center gap-1.5 rounded-xl border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40">
          {busyIcon('picker') || <Plus size={15} />}Thêm công việc</button>
      </div>
      {draft.revision && <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Bản {draft.revision.basePlan.revisionNo} vẫn là bản hiện hành cho tới khi bản này được duyệt. Chỉ sửa phần việc từ hôm nay ({dateVi(today)}) trở đi: việc đã bắt đầu giữ ngày bắt đầu, khối lượng không dưới phần đã làm. Dòng nào thay đổi cần có lý do.</span></div>}
      {open?.status === 'returned' && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <strong>Bị trả lại</strong>{open.returnedByName ? ` bởi ${open.returnedByName}` : ''}{open.returnedAt ? ` lúc ${new Date(open.returnedAt).toLocaleString('vi-VN')}` : ''}: {open.returnReason}</div>}
      {overdueMissing > 0 && !draft.revision && <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
        <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><strong>{overdueMissing} việc trễ hạn chưa xong</strong> theo bảng tiến độ chưa có trong kế hoạch. Việc nào thực tế đã xong thì nên cập nhật tiến độ; việc còn làm thì thêm vào kỳ này.</span></span>
        <button type="button" onClick={() => void openPicker('overdue')} disabled={editDisabled} className="shrink-0 rounded-lg border border-amber-400 bg-white/70 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:bg-transparent">Xem và thêm</button>
      </div>}
      {draft.lines.length === 0
        ? <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Chưa có công việc nào. Bấm <strong>Thêm công việc</strong> để chọn từ bảng tiến độ.</div>
        : <PlanEditor lines={draft.lines} periodType={periodType} period={period} disabled={editDisabled} revision={revisionCtx} issuesOf={issuesOf} onChange={patchLine} onRemove={removeLine} />}
      {draft.revision && <RemovedLinesPanel basePlan={draft.revision.basePlan} lines={draft.lines} removed={draft.revision.removed} reasons={board?.reasons || []} disabled={editDisabled}
        onReason={(taskId, patch) => patchRevision({ removed: { ...draft.revision!.removed, [taskId]: { changeReasonCode: '', changeNote: '', ...draft.revision!.removed[taskId], ...patch } } })}
        onRestore={line => { setDraft(current => current ? { ...current, lines: [...current.lines, lineToDraft(line)] } : current); setDirty(true); }} />}
      <label className="block"><span className="mb-1 block text-xs font-semibold text-muted-foreground">Ghi chú kế hoạch</span>
        <textarea value={draft.note} rows={2} disabled={editDisabled} onChange={event => { setDraft(current => current ? { ...current, note: event.target.value } : current); setDirty(true); }}
          placeholder="Mục tiêu chính của kỳ, điều kiện cần (vật tư, nhân lực, máy)…" className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-teal-600" /></label>
      <div className="flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{draft.lines.length} công việc{draft.revision ? ` · ${changedCount} thay đổi so với Bản ${draft.revision.basePlan.revisionNo}` : ''}{dirty ? ' · có thay đổi chưa lưu' : ''}</span>
          {draftErrors > 0 && <span className="font-semibold text-rose-600">{draftErrors} ô khối lượng chưa hợp lệ</span>}
          {ruleErrors > 0 && <span className="font-semibold text-rose-600">{ruleErrors} dòng cần sửa trước khi lưu</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open?.status === 'draft' && !open.submittedAt && <button type="button" onClick={() => onTransition(open, 'delete')} disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40">{busyIcon('delete') || <Trash2 size={15} />}{draft.revision ? 'Bỏ bản điều chỉnh' : 'Xóa nháp'}</button>}
          {!open && <button type="button" onClick={() => { setDraft(null); setDirty(false); }} disabled={Boolean(busy)} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted">Hủy</button>}
          {!draft.revision && permissions?.canSubmit && (board?.approvers.length || 0) > 0 && <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Người duyệt
            <select value={approverId} onChange={event => setApproverId(event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">Tất cả người có quyền duyệt</option>
              {board!.approvers.filter(a => a.id !== me).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>}
          <button type="button" onClick={onSave} disabled={editDisabled || !permissions?.canEdit} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50">
            {busyIcon('save') || <Save size={15} />}Lưu nháp</button>
          {permissions?.canSubmit && <button type="button" onClick={onSubmit} disabled={editDisabled || !draft.lines.length || draftErrors > 0 || ruleErrors > 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            {busyIcon('submit') || <Send size={15} />}{draft.revision ? 'Gửi duyệt…' : 'Gửi duyệt'}</button>}
        </div>
      </div>
    </section>}

    {/* Plan waiting for approval. */}
    {!editing && open?.status === 'submitted' && <section className="space-y-3 rounded-2xl border border-amber-200 bg-card p-4 shadow-sm dark:border-amber-900 md:p-5" aria-label="Kế hoạch chờ duyệt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-foreground">{open.supersedesPlanId ? `Bản ${open.revisionNo} · điều chỉnh` : 'Kế hoạch'} chờ duyệt · {periodLabel}</h3><StatusChip status="submitted" /></div>
        <span className="text-xs text-muted-foreground">{open.submittedByName} gửi lúc {open.submittedAt ? new Date(open.submittedAt).toLocaleString('vi-VN') : ''}</span>
      </div>
      {open.supersedesPlanId ? <>
        <div className="space-y-2 rounded-xl border border-border bg-background p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vì sao điều chỉnh</p>
          {open.changeSummary && <p className={`text-sm text-foreground ${WRAP}`}>{open.changeSummary}</p>}
          {open.changeReasonCode && <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">Lý do chính: <ReasonChip reasons={board?.reasons || []} code={open.changeReasonCode} party={open.responsibleParty} /></div>}
          <AttachmentList files={open.attachments || []} />
        </div>
        <ImpactBlock rows={open.supersedesPlanId ? diffPlans(board?.versions.find(v => v.id === open.supersedesPlanId) || null, open) : []} impact={reviewImpact} loading={!reviewImpact} />
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-muted-foreground">So sánh với</span>
          {([['prev', 'Bản đang áp dụng'], ['goc', 'Bản gốc']] as const).map(([k, label]) => <button key={k} type="button" onClick={() => setReviewCmp(k)}
            className={`rounded-full border px-3 py-1 font-semibold ${reviewCmp === k ? 'border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200' : 'border-border text-muted-foreground'}`}>{label}</button>)}</div>
        <DiffTable rows={reviewRows} compare onlyChanged today={today} reasons={board?.reasons || []} basePlan={reviewBase} curPlan={open} original={originalVersion(board?.versions || [])}
          curLabel={`Bản ${open.revisionNo}`} refsOf={r => reviewBase ? changeRefs(board?.versions || [], r.taskId, reviewBase.revisionNo, open.revisionNo) : []} />
      </> : <PlanReadTable plan={open} periodStarted={false} />}
      {open.note && <p className="text-sm text-muted-foreground"><strong className="text-foreground">Ghi chú:</strong> {open.note}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {isSelf(open) ? <span className="mr-auto flex items-center gap-1.5 self-center text-xs text-muted-foreground"><ShieldCheck size={14} className="text-teal-600" />Bạn là người lập / gửi bản này — cần người khác duyệt.</span>
          : !permissions?.canApprove && <span className="mr-auto self-center text-xs text-muted-foreground">Đang chờ {periodType === 'month' ? 'GĐ dự án' : 'CHT'} duyệt.</span>}
        {open.submittedBy === me && <button type="button" onClick={() => onTransition(open, 'withdraw')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{busyIcon('withdraw') || <Undo2 size={15} />}Rút về sửa</button>}
        {permissions?.canApprove && !isSelf(open) && <>
          <button type="button" onClick={() => onTransition(open, 'return')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950/40">{busyIcon('return') || <Undo2 size={15} />}Trả lại</button>
          <button type="button" onClick={() => onTransition(open, 'approve')} disabled={Boolean(busy) || periodEnded} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busyIcon('approve') || <CheckCircle2 size={15} />}Duyệt</button>
        </>}
      </div>
    </section>}

    {/* Approved plan of the period and every version of it. */}
    {approved && board && <VersionsBoard board={board} initialId={approved.id} periodStarted={periodStarted} kindLabel={kindLabel}
      actions={<div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{approved.approvedByName} duyệt {approved.approvedAt ? new Date(approved.approvedAt).toLocaleDateString('vi-VN') : ''}</span>
        {permissions?.canEdit && !open && !periodEnded && !approved.needsReviewAt && <button type="button" onClick={() => onRevise(approved)} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">{busyIcon('revise') || <RotateCcw size={13} />}Tạo bản điều chỉnh</button>}
        {open && <Badge className={TONE.amber}>Đang có bản {open.status === 'submitted' ? 'chờ duyệt' : 'đang soạn'}</Badge>}
      </div>} />}

    {/* Nothing yet for this period. */}
    {!editing && !open && !approved && <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      {periodEnded ? <Lock size={32} className="mx-auto text-slate-300" /> : <CalendarRange size={32} className="mx-auto text-slate-300" />}
      <h3 className="mt-3 text-base font-bold text-foreground">Chưa có kế hoạch cho {periodLabel.charAt(0).toLowerCase() + periodLabel.slice(1)}</h3>
      {periodEnded ? <p className="mt-1 text-sm text-muted-foreground">Kỳ đã kết thúc nên không lập được nữa.</p>
        : permissions?.canEdit ? <>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Hệ thống gợi ý sẵn các công việc có lịch trong kỳ theo bảng tiến độ{periodType === 'week' ? ', kèm khối lượng kế hoạch tháng để đối chiếu' : ''}. Bạn chỉ cần chỉnh khối lượng, ngày rồi gửi duyệt. Bản được duyệt đầu tiên là bản gốc của kỳ.</p>
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
          <span className="font-medium text-foreground">{formatWorkPlanPeriod(periodType, item.periodStart)} · Bản {item.revisionNo}</span>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">{item.lineCount} việc<StatusChip status={item.status} /></span>
        </button>)}
      </div>}
    </section>}

    {!permissions?.canEdit && !permissions?.canApprove && board && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={13} />Bạn đang xem ở chế độ chỉ đọc.</p>}

    {picker && candidates && draft && <TaskPicker candidates={candidates} periodType={periodType} initialFilter={picker} selected={new Set(draft.lines.map(l => l.taskId))} onClose={() => setPicker(null)} onAdd={addLines} />}
    {submitDialog && draft?.revision && board && <SubmitRevisionDialog board={board} draft={draft} rows={draftRows} projectId={projectId} siteId={siteId} periodLabel={periodLabel}
      busy={busy === 'send'} onClose={() => setSubmitDialog(false)} onSend={onSendRevision} />}
  </div>;
};

export default WorkPlanTab;
