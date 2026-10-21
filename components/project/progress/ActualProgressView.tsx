// Tiến độ thực tế (chủ SP duyệt mockup 15/10/2026): dự án dùng Nhật ký chính thức chỉ xem số từ nhật ký CHT đã duyệt.
// Dải 7 ngày là bộ lọc; bảng không có ô nhập; bấm việc xem từng ngày + Điều chỉnh ngoại lệ; "Xác nhận tuần" chỉ khóa số.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, CalendarCheck, CalendarDays, Camera, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ClipboardCheck,
  Clock3, History, Info, Loader2, Lock, LockOpen, NotebookPen, Pencil, RefreshCw, Search, TrendingUp, X,
} from 'lucide-react';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { ENT, Kpi, NUM } from '../../finance/financeUi';
import { AccordionToolbar, GroupHeader, fmt, parseQty, useGroupAccordion } from '../work-plan/workPlanUi';
import { useToast } from '../../../context/ToastContext';
import { useReasonConfirm } from '../../../context/ConfirmContext';
import { getProjectProgressMutationErrorMessage, projectWeeklyProgressService } from '../../../lib/projectWeeklyProgressService';
import {
  ACTUAL_DAY_LABEL, addDays, buildActualProgressRows, dayCounts, dayGain, getActualDayStatus, getAutoJumpWeek, getConfirmBlock, isoWeekNumber, mondayOf,
  pendingDayGain, summarizeActualProgress,
  type ActualDayStatus, type ActualProgressRow, type ActualProgressWeek,
} from '../../../lib/projectActualProgress';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const wd = (iso: string) => WD[new Date(`${iso}T00:00:00`).getDay()];
const dmt = (ts: string | null) => {
  if (!ts) return '';
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
};
const pct1 = (value: number | null | undefined) => value == null ? '—' : `${fmt(value, 1)}%`;
const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : '−'}${fmt(Math.abs(value), digits)}`;

const DAY_STYLE: Record<ActualDayStatus, { cls: string; icon: React.ElementType }> = {
  approved: { cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-200', icon: CheckCircle2 },
  before_cutover: { cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200', icon: CheckCircle2 },
  pending: { cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200', icon: Clock3 },
  not_sent: { cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200', icon: NotebookPen },
  missing: { cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200', icon: AlertTriangle },
  today: { cls: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200', icon: NotebookPen },
  future: { cls: 'border-border bg-card text-muted-foreground', icon: CircleDashed },
  off: { cls: 'border-border bg-muted text-muted-foreground', icon: CircleDashed },
};

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  onShowLegacy: () => void;
}

export default function ActualProgressView({ projectId, constructionSiteId, onShowLegacy }: Props) {
  const toast = useToast();
  const reasonConfirm = useReasonConfirm();
  const location = useLocation();
  const today = localToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [week, setWeek] = useState<ActualProgressWeek | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [day, setDay] = useState<string | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Lần mở đầu: tuần này chưa có nhật ký duyệt thì tự mở tuần có nhật ký duyệt gần nhất (giữ tuần gốc để quay về).
  const firstLoadRef = useRef(true);
  const [jumpedFrom, setJumpedFrom] = useState<string | null>(null);

  const load = useCallback(async (target: string) => {
    setLoadState('loading');
    try {
      const data = await projectWeeklyProgressService.getActualProgressWeek({ projectId, constructionSiteId, weekStart: target });
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        const jumpTo = getAutoJumpWeek(data);
        if (jumpTo) { setJumpedFrom(data.weekStart); setWeekStart(jumpTo); return; }
      }
      setWeek(data);
      setLoadState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '');
      setLoadState(message.includes('quyền Xem') ? 'denied' : 'error');
    }
  }, [constructionSiteId, projectId]);

  useEffect(() => { setDay(null); void load(weekStart); }, [load, weekStart]);

  const cutoverWeek = week?.cutoverDate ? mondayOf(week.cutoverDate) : null;
  const statuses = useMemo(() => new Map((week?.days || []).map(d => [d.date, getActualDayStatus(d, today, week?.cutoverDate || null)])), [today, week]);
  const counted = useMemo(() => new Set([...statuses].filter(([, s]) => dayCounts(s)).map(([d]) => d)), [statuses]);
  const weekRows = useMemo(() => week ? buildActualProgressRows(week, counted, null) : [], [counted, week]);
  const rows = useMemo(() => week && day ? buildActualProgressRows(week, counted, day) : weekRows, [counted, day, week, weekRows]);
  const summary = useMemo(() => summarizeActualProgress(weekRows), [weekRows]);

  const buildHref = useCallback((params: Record<string, string>) => {
    const query = new URLSearchParams(location.search);
    query.delete('dailyLogId'); query.delete('taskId');
    Object.entries(params).forEach(([k, v]) => query.set(k, v));
    query.set('projectId', projectId);
    if (constructionSiteId) query.set('siteId', constructionSiteId);
    return `/da?${query.toString()}`;
  }, [constructionSiteId, location.search, projectId]);

  if (loadState === 'denied') return <StateBox kind="denied" title="Bạn chưa có quyền xem tiến độ dự án này" />;
  if (loadState === 'error') return <StateBox kind="error" message="Không tải được tiến độ tuần này." onRetry={() => void load(weekStart)} />;
  if (!week) return <StateBox kind="loading" />;

  const weekEnd = addDays(week.weekStart, 6);
  const locked = !!week.state?.isLocked;
  const block = getConfirmBlock(week, today);
  const confirmTitle = block === 'not_ended' ? `Xác nhận được khi hết tuần (từ ${wd(addDays(weekEnd, 1))} ${dm(addDays(weekEnd, 1))})`
    : block === 'no_permission' ? 'Bạn chưa có quyền Xác nhận tuần' : undefined;
  const dayList = week.days.map(d => ({ ...d, status: statuses.get(d.date) as ActualDayStatus }));
  const workDays = dayList.filter(d => !['future', 'off', 'before_cutover'].includes(d.status) && !(week.cutoverDate && d.date < week.cutoverDate));
  const approvedDays = dayList.filter(d => d.status === 'approved').length;
  const pendingDays = dayList.filter(d => d.status === 'pending').length;
  const missingDays = dayList.filter(d => (d.status === 'missing' || d.status === 'not_sent') && !(week.cutoverDate && d.date < week.cutoverDate));
  const noData = week.source === 'daily_log' && counted.size === 0;
  const selectedDay = day ? dayList.find(d => d.date === day) || null : null;
  const drawerRow = drawerTaskId ? weekRows.find(r => r.task.id === drawerTaskId) || null : null;
  const gain = summary.beforePercent != null && summary.afterPercent != null ? summary.afterPercent - summary.beforePercent : null;
  const atCutoverWeek = !!cutoverWeek && week.weekStart <= cutoverWeek;

  const confirmWeek = async () => {
    setBusy(true);
    try {
      await projectWeeklyProgressService.closePeriod({ projectId, constructionSiteId, periodType: 'weekly', periodStart: week.weekStart, rows: null, snapshot: null });
      toast.success(`Đã xác nhận tuần ${isoWeekNumber(week.weekStart)}`, `Tiến độ thi công ${pct1(summary.afterPercent)} đã khóa.`);
      setConfirming(false);
      await load(week.weekStart);
    } catch (error) {
      toast.error('Chưa xác nhận được tuần', getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'));
    } finally { setBusy(false); }
  };

  const reopenWeek = async () => {
    const reason = await reasonConfirm({
      title: 'Mở lại tuần đã xác nhận?', targetName: `Tuần ${isoWeekNumber(week.weekStart)} · ${dm(week.weekStart)}–${dm(weekEnd)}`,
      reasonLabel: 'Lý do mở lại', actionLabel: 'Mở lại', intent: 'warning',
    });
    if (!reason) return;
    setBusy(true);
    try {
      await projectWeeklyProgressService.reopenPeriod({ projectId, constructionSiteId, periodType: 'weekly', periodStart: week.weekStart, reason });
      toast.success('Đã mở lại tuần', 'Nhật ký duyệt thêm sẽ được cộng vào tuần này.');
      await load(week.weekStart);
    } catch (error) {
      toast.error('Chưa mở lại được tuần', getProjectProgressMutationErrorMessage(error, 'Vui lòng thử lại.'));
    } finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><TrendingUp size={22} /></span>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold md:text-2xl">Tiến độ thực tế
            {locked ? <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800"><Lock size={12} />Đã xác nhận</Badge>
              : <Badge className="border-sky-200 bg-sky-50 text-sky-800">Đang ghi nhận</Badge>}</h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">Lấy từ Nhật ký đã duyệt
            <span title="Muốn sửa số: trả lại nhật ký ngày đó cho kỹ sư, hoặc dùng Điều chỉnh ngoại lệ (có lý do) trong chi tiết từng việc." className="inline-flex cursor-help"><Info size={14} /></span></p>
        </div>
      </div>
      <div className="flex w-full items-center gap-2 md:w-auto">
        <div className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-border bg-card md:flex-none">
          <button type="button" disabled={atCutoverWeek || loadState === 'loading'} onClick={() => { setJumpedFrom(null); setWeekStart(addDays(week.weekStart, -7)); }}
            title={atCutoverWeek ? 'Tuần trước mốc Nhật ký chính thức: xem ở Số liệu trước mốc' : 'Tuần trước'} aria-label="Tuần trước"
            className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="flex items-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold"><CalendarDays size={15} className="hidden text-mint-600 sm:block" />Tuần {isoWeekNumber(week.weekStart)} · {dm(week.weekStart)}–{dm(weekEnd)}</span>
          <button type="button" disabled={week.weekStart >= mondayOf(today) || loadState === 'loading'} onClick={() => { setJumpedFrom(null); setWeekStart(addDays(week.weekStart, 7)); }}
            aria-label="Tuần sau" className="px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
        <button type="button" onClick={() => void load(week.weekStart)} className={`${secondaryBtn} hidden px-2.5 md:inline-flex`} title="Làm mới" aria-label="Làm mới">
          {loadState === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}</button>
        {locked
          ? <button type="button" disabled={!week.canConfirm || busy} onClick={() => void reopenWeek()} title={week.canConfirm ? 'Mở lại cần lý do' : 'Bạn chưa có quyền Mở lại tuần'}
              className={`${secondaryBtn} shrink-0 whitespace-nowrap disabled:opacity-50`}><LockOpen size={15} />Mở lại</button>
          : <button type="button" disabled={!!block || busy} title={confirmTitle} onClick={() => setConfirming(true)}
              className={`${primaryBtn} shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}><CalendarCheck size={16} />Xác nhận tuần</button>}
      </div>
    </div>

    {jumpedFrom && jumpedFrom !== week.weekStart && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <Info size={15} className="shrink-0" />
      <span>Tuần {isoWeekNumber(jumpedFrom)} chưa có nhật ký được duyệt. Đang xem tuần {isoWeekNumber(week.weekStart)}{week.latestApprovedDate && <> — nhật ký duyệt gần nhất ngày {dm(week.latestApprovedDate)}</>}.</span>
      <button type="button" onClick={() => { const back = jumpedFrom; setJumpedFrom(null); setWeekStart(back); }}
        className="ml-auto font-semibold underline underline-offset-2">Về tuần này</button>
    </div>}

    {locked && week.state && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-leaf-200 bg-leaf-50 px-3 py-2 text-sm text-leaf-900 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-100">
      <Lock size={15} />Đã xác nhận{week.state.lockedByName && <> bởi <b className={ENT}>{week.state.lockedByName}</b></>}{week.state.lockedAt && <> lúc {dmt(week.state.lockedAt)}</>}. Nhật ký duyệt sau đó không cộng vào tuần này.
    </div>}

    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Kpi active={false} onClick={() => setDay(null)} icon={TrendingUp} tone="text-leaf-700 dark:text-leaf-300" label="Tiến độ thi công"
        value={noData ? '—' : pct1(summary.afterPercent)} hint={noData ? 'chưa có nhật ký duyệt' : gain != null ? `${signed(gain)} điểm trong tuần` : ''} />
      <Kpi active={false} onClick={() => setDay(null)} icon={ClipboardCheck} tone="text-sky-700 dark:text-sky-300" label="Việc có tiến triển"
        value={noData ? '—' : String(summary.movedCount)} hint={`trên ${week.tasks.length} việc`} />
      <Kpi active={false} onClick={() => setDay(null)} icon={CheckCircle2} tone="text-mint-600" label="Nhật ký đã duyệt"
        value={`${approvedDays}/${workDays.length}`} hint={pendingDays ? `${pendingDays} chờ CHT duyệt` : 'ngày làm việc'} />
      <Kpi active={false} onClick={() => setDay(missingDays[0]?.date || null)} icon={AlertTriangle}
        tone={missingDays.length ? 'text-rose-600' : 'text-muted-foreground'} label="Ngày thiếu nhật ký"
        value={String(missingDays.length)} hint={missingDays.length ? missingDays.map(d => `${wd(d.date)} ${dm(d.date)}`).join(', ') : 'đủ'} />
    </div>

    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <button type="button" onClick={() => setDay(null)} aria-pressed={day === null}
        className={`min-w-[92px] rounded-2xl border bg-card p-2.5 text-left shadow-sm ${day === null ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cả tuần</span>
        <span className="mt-1 block text-sm font-bold">{dm(week.weekStart)} – {dm(weekEnd)}</span>
      </button>
      {dayList.map(d => {
        const style = DAY_STYLE[d.status]; const Icon = style.icon; const clickable = d.status !== 'future';
        const g = dayCounts(d.status) ? dayGain(week, counted, d.date) : d.status === 'pending' ? pendingDayGain(week, counted, d.date) : null;
        return <button key={d.date} type="button" disabled={!clickable} onClick={() => setDay(d.date)} aria-pressed={day === d.date}
          className={`min-w-[112px] flex-1 rounded-2xl border p-2.5 text-left transition ${style.cls} ${day === d.date ? 'border-teal-500 ring-2 ring-teal-500/40' : ''} ${clickable ? 'hover:brightness-[0.98]' : 'cursor-default opacity-80'}`}>
          <span className="flex items-center justify-between text-xs font-bold">{wd(d.date)} {dm(d.date)}<Icon size={14} /></span>
          <span className="mt-1 block text-xs font-semibold">{ACTUAL_DAY_LABEL[d.status]}</span>
          <span className="block text-xs tabular-nums opacity-80">{g != null && Math.abs(g) > 0.0005 ? (d.status === 'pending' ? `(${signed(g)}%)` : `${signed(g)}%`) : ' '}</span>
        </button>;
      })}
    </div>

    {selectedDay && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
      <NotebookPen size={15} className="text-mint-600" />
      <span>Nhật ký <b>{wd(selectedDay.date)} {dm(selectedDay.date)}</b> · {ACTUAL_DAY_LABEL[selectedDay.status]}
        {selectedDay.authors && <> · ghi bởi <span className={ENT}>{selectedDay.authors}</span></>}
        {selectedDay.status === 'approved' && selectedDay.verifiedBy && <> · <span className={ENT}>{selectedDay.verifiedBy}</span> duyệt</>}
        {selectedDay.photos > 0 && <> · <Camera size={13} className="inline" /> {selectedDay.photos} ảnh</>}</span>
      <Link to={buildHref(selectedDay.summaryId ? { tab: 'dailylog', dailyLogId: selectedDay.summaryId } : { tab: 'dailylog' })}
        className="ml-auto inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline dark:text-teal-300">
        {selectedDay.status === 'pending' ? 'Mở để duyệt' : selectedDay.summaryId ? 'Mở nhật ký' : 'Mở Nhật ký để ghi'}<ArrowUpRight size={14} /></Link>
    </div>}

    {noData
      ? <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-6 py-10 text-center dark:border-amber-900 dark:bg-amber-950/20">
          <Clock3 size={26} className="mx-auto text-amber-600" />
          <p className="mt-3 font-semibold">Tuần này chưa có nhật ký nào được duyệt</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{pendingDays
            ? `${pendingDays} nhật ký đang chờ CHT duyệt. Duyệt xong, tiến độ tự cập nhật ở đây và trên Gantt.`
            : 'Kỹ sư ghi phiếu, người tổng hợp gửi CHT duyệt. Duyệt xong, tiến độ tự cập nhật ở đây và trên Gantt.'}</p>
          <Link to={buildHref({ tab: 'dailylog' })} className={`${primaryBtn} mt-4`}><NotebookPen size={15} />{pendingDays ? 'Mở Nhật ký để duyệt' : 'Mở Nhật ký'}</Link>
        </div>
      : <ProgressTable rows={rows} day={day} totalTasks={week.tasks.length} onOpen={row => setDrawerTaskId(row.task.id)} />}

    {atCutoverWeek && week.cutoverDate && <button type="button" onClick={onShowLegacy}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
      <History size={15} />Số liệu trước {dm(week.cutoverDate)} (nhập tay)</button>}

    {drawerRow && <TaskDrawer week={week} row={drawerRow} statuses={statuses} locked={locked}
      ganttHref={buildHref({ tab: 'gantt', taskId: drawerRow.task.id })}
      projectId={projectId} constructionSiteId={constructionSiteId}
      onClose={() => setDrawerTaskId(null)} onSaved={() => void load(week.weekStart)} />}
    {confirming && <ConfirmWeekDialog weekNo={isoWeekNumber(week.weekStart)} before={summary.beforePercent} after={summary.afterPercent}
      moved={summary.movedCount} approvedDays={approvedDays} missing={missingDays.map(d => `${wd(d.date)} ${dm(d.date)}`)}
      pendingDays={pendingDays} busy={busy} onCancel={() => setConfirming(false)} onOk={() => void confirmWeek()} />}
  </div>;
}

// ---------------------------------------------------------------------------- bảng
const Bar: React.FC<{ pct: number }> = ({ pct }) =>
  <span className="flex items-center gap-2">
    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-leaf-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
    <span className={`w-10 text-right text-xs ${NUM}`}>{fmt(pct, 0)}%</span>
  </span>;

const COLS = 'grid-cols-[64px_minmax(0,1fr)_52px_96px_104px_116px_104px_112px]';

const ProgressTable: React.FC<{ rows: ActualProgressRow[]; day: string | null; totalTasks: number; onOpen: (row: ActualProgressRow) => void }> = ({ rows, day, totalTasks, onOpen }) => {
  const [onlyMoved, setOnlyMoved] = useState(true);
  const [q, setQ] = useState('');
  const movedCount = rows.filter(r => r.moved || r.pendingQuantity > 0 || r.pendingPercent != null).length;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(r => (!onlyMoved || r.moved || r.pendingQuantity > 0 || r.pendingPercent != null)
    && (!needle || `${r.task.wbsCode || ''} ${r.task.name}`.toLowerCase().includes(needle)));
  const groupKey = (r: ActualProgressRow) => r.task.groupName || 'Chưa có hạng mục cha';
  const groups = useMemo(() => Array.from(new Set(shown.map(groupKey))), [shown]);
  const acc = useGroupAccordion(groups);
  const groupSig = groups.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { acc.expandAll(); }, [groupSig]);
  const incLabel = day ? `Ngày ${dm(day)}` : 'Trong tuần';
  const qty = (value: number | null, unit: string | null) => value == null ? '—' : `${fmt(value, 2)}${unit ? '' : ''}`;

  return <section className="rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <div className="flex rounded-xl border border-border bg-muted p-0.5">
        {[{ k: true, l: `Có tiến triển · ${movedCount}` }, { k: false, l: `Tất cả · ${totalTasks}` }].map(o =>
          <button key={String(o.k)} type="button" onClick={() => setOnlyMoved(o.k)} aria-pressed={onlyMoved === o.k}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${onlyMoved === o.k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{o.l}</button>)}
      </div>
      <label className="relative min-w-[200px] flex-1 md:max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã WBS hoặc tên việc" aria-label="Tìm việc" className={`${inputCls} w-full pl-8`} />
      </label>
      <div className="ml-auto hidden lg:block"><AccordionToolbar count={groups.length} allOpen={acc.allOpen} onExpand={acc.expandAll} onCollapse={acc.collapseAll} /></div>
    </div>
    <div className="hidden lg:block">
      <div className={`grid ${COLS} gap-2 bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <span>WBS</span><span>Công việc</span><span>ĐVT</span><span className="text-right">KL kế hoạch</span><span className="text-right">Đầu kỳ</span>
        <span className="text-right">{incLabel}</span><span className="text-right">Lũy kế</span><span>Hoàn thành</span>
      </div>
      {groups.map((g, gi) => {
        const list = shown.filter(r => groupKey(r) === g);
        return <div key={g}>
          <GroupHeader index={gi + 1} name={g} open={acc.isOpen(g)} onToggle={() => acc.toggle(g)} count={list.length}
            tone="bg-teal-50 border-l-teal-600 text-teal-950 dark:bg-teal-950/40 dark:border-l-teal-500 dark:text-teal-100" />
          {acc.isOpen(g) && list.map(r => {
            const hasQty = r.task.plannedQuantity != null;
            const deltaPct = r.afterPercent - r.beforePercent;
            return <button key={r.task.id} type="button" onClick={() => onOpen(r)}
              className={`grid w-full ${COLS} items-center gap-2 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted/50`}>
              <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-300">{r.task.wbsCode || '—'}</span>
              <span className="min-w-0"><span className="line-clamp-1 font-medium">{r.task.name}</span>
                {!day && r.recordedDates.length > 0 && <span className="block text-xs text-muted-foreground">Ghi ngày {r.recordedDates.map(dm).join(', ')}</span>}</span>
              <span className="text-xs text-muted-foreground">{r.task.unit || '—'}</span>
              <span className="text-right tabular-nums text-muted-foreground">{hasQty ? fmt(r.task.plannedQuantity, 2) : '—'}</span>
              <span className="text-right tabular-nums">{hasQty ? qty(r.beforeQuantity, r.task.unit) : pct1(r.beforePercent)}</span>
              <span className="text-right">
                {r.periodQuantity > 0 ? <span className={NUM}>+{fmt(r.periodQuantity, 2)}</span>
                  : deltaPct > 0.0005 ? <span className={NUM}>+{fmt(deltaPct, 1)}%</span> : <span className="text-muted-foreground">—</span>}
                {(r.pendingQuantity > 0 || r.pendingPercent != null) && <span className="block text-[11px] text-amber-700 dark:text-amber-300" title="Nhật ký chưa được CHT duyệt, chưa tính">
                  chờ duyệt {r.pendingQuantity > 0 ? `+${fmt(r.pendingQuantity, 2)}` : pct1(r.pendingPercent)}</span>}
              </span>
              <span className="text-right font-semibold tabular-nums">{hasQty ? qty(r.afterQuantity, r.task.unit) : pct1(r.afterPercent)}</span>
              <Bar pct={r.afterPercent} />
            </button>;
          })}
        </div>;
      })}
    </div>
    <div className="divide-y divide-border lg:hidden">
      {shown.map(r => {
        const deltaPct = r.afterPercent - r.beforePercent;
        return <button key={r.task.id} type="button" onClick={() => onOpen(r)} className="block w-full space-y-1.5 p-3 text-left">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0"><span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-300">{r.task.wbsCode}</span> <span className="text-sm font-medium">{r.task.name}</span></span>
            <Bar pct={r.afterPercent} />
          </span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{incLabel}: {r.periodQuantity > 0 ? <b className={NUM}>+{fmt(r.periodQuantity, 2)} {r.task.unit || ''}</b>
              : deltaPct > 0.0005 ? <b className={NUM}>+{fmt(deltaPct, 1)}%</b> : '—'}</span>
            {r.task.plannedQuantity != null && <span>Lũy kế <b className="tabular-nums text-foreground">{fmt(r.afterQuantity ?? 0, 2)}</b>/{fmt(r.task.plannedQuantity, 2)}</span>}
            {(r.pendingQuantity > 0 || r.pendingPercent != null) && <span className="text-amber-700 dark:text-amber-300">chờ duyệt {r.pendingQuantity > 0 ? `+${fmt(r.pendingQuantity, 2)}` : pct1(r.pendingPercent)}</span>}
          </span>
        </button>;
      })}
    </div>
    {shown.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">
      {onlyMoved && !needle ? <>{day ? 'Ngày này' : 'Tuần này'} chưa có việc nào có tiến triển. <button type="button" onClick={() => setOnlyMoved(false)} className="font-semibold text-teal-700 underline">Xem tất cả việc</button></>
        : 'Không có việc khớp bộ lọc'}</div>}
  </section>;
};

// ---------------------------------------------------------------------------- chi tiết một việc
const TaskDrawer: React.FC<{
  week: ActualProgressWeek; row: ActualProgressRow; statuses: Map<string, ActualDayStatus>; locked: boolean; ganttHref: string;
  projectId: string; constructionSiteId?: string | null; onClose: () => void; onSaved: () => void;
}> = ({ week, row, statuses, locked, ganttHref, onClose, onSaved }) => {
  const toast = useToast();
  const t = row.task;
  const entries = week.entries.filter(e => e.taskId === t.id).sort((a, b) => a.date.localeCompare(b.date));
  const pending = week.pending.filter(p => p.taskId === t.id);
  const adjustable = entries.filter(e => statuses.get(e.date) === 'approved' && e.sourceDailyLogId);
  const [adjusting, setAdjusting] = useState(false);
  const [target, setTarget] = useState(adjustable[adjustable.length - 1]?.id || '');
  const entry = adjustable.find(e => e.id === target) || null;
  const [pctText, setPctText] = useState(''); const [qtyText, setQtyText] = useState(''); const [dayQtyText, setDayQtyText] = useState('');
  const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!entry) return;
    setPctText(fmt(entry.percent, 2)); setQtyText(entry.quantity == null ? '' : fmt(entry.quantity, 3)); setDayQtyText(entry.dailyQuantity == null ? '' : fmt(entry.dailyQuantity, 3));
  }, [entry]);
  const canAdjust = week.canEditException && !locked && adjustable.length > 0;
  const adjustTitle = locked ? 'Tuần đã xác nhận — mở lại tuần trước khi điều chỉnh'
    : !week.canEditException ? 'Cần quyền Sửa tiến độ và Công bố nhật ký'
      : adjustable.length === 0 ? 'Tuần này chưa có số từ nhật ký đã duyệt cho việc này' : undefined;

  const save = async () => {
    if (!entry) return;
    const percent = parseQty(pctText);
    if (percent == null || percent < 0) { toast.warning('Kiểm tra % lũy kế', 'Nhập số không âm.'); return; }
    if (!reason.trim()) { toast.warning('Cần lý do điều chỉnh'); return; }
    setSaving(true);
    try {
      await projectWeeklyProgressService.saveDailyProgressException({
        progressRowId: entry.id, expectedUpdatedAt: entry.updatedAt, progressPercent: percent,
        quantityDone: qtyText.trim() ? parseQty(qtyText) : null, dailyQuantityDone: dayQtyText.trim() ? parseQty(dayQtyText) : null, reason,
      });
      toast.success('Đã lưu điều chỉnh ngoại lệ', 'Lý do và số trước/sau đã ghi vào lịch sử.');
      setAdjusting(false); onSaved();
    } catch (error) {
      toast.error('Chưa lưu được điều chỉnh', getProjectProgressMutationErrorMessage(error, error instanceof Error ? error.message : 'Vui lòng thử lại.'));
    } finally { setSaving(false); }
  };

  let lastPct = row.task.beforePercent ?? null;
  return <Drawer label={`Chi tiết ${t.wbsCode || t.name}`} onClose={onClose}
    header={<div className="min-w-0"><p className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-300">WBS {t.wbsCode || '—'}</p>
      <h2 className="text-lg font-bold">{t.name}</h2>{t.groupName && <p className="text-xs text-muted-foreground">{t.groupName}</p>}</div>}
    footer={<div className="flex w-full flex-wrap gap-2 md:justify-end">
      <Link to={ganttHref} className={`${secondaryBtn} flex-1 md:flex-none`}><ArrowUpRight size={15} />Xem trên Gantt</Link>
      {!adjusting && <button type="button" disabled={!canAdjust} title={adjustTitle} onClick={() => setAdjusting(true)}
        className={`${secondaryBtn} flex-1 border-amber-300 text-amber-800 disabled:opacity-50 md:flex-none dark:text-amber-200`}><Pencil size={15} />Điều chỉnh ngoại lệ</button>}
    </div>}>
    <div className="grid grid-cols-3 gap-2">
      {[{ l: 'Kế hoạch', v: t.plannedQuantity != null ? `${fmt(t.plannedQuantity, 2)} ${t.unit || ''}` : '—' },
        { l: 'Lũy kế', v: t.plannedQuantity != null ? `${fmt(row.afterQuantity ?? 0, 2)} ${t.unit || ''}` : pct1(row.afterPercent) },
        { l: 'Hoàn thành', v: `${fmt(row.afterPercent, 1)}%` }].map(k =>
        <div key={k.l} className="rounded-xl border border-border p-2.5"><p className="text-[11px] font-semibold uppercase text-muted-foreground">{k.l}</p><p className={`mt-1 ${NUM}`}>{k.v}</p></div>)}
    </div>
    <div>
      <p className="mb-2 text-sm font-semibold">Ghi nhận tuần {isoWeekNumber(week.weekStart)}</p>
      <ol className="space-y-2">
        <li className="flex justify-between rounded-lg bg-muted px-3 py-2 text-sm"><span>Đầu tuần</span><b className="tabular-nums">{pct1(row.task.beforePercent ?? row.beforePercent)}</b></li>
        {entries.map(e => {
          const status = statuses.get(e.date);
          const day = week.days.find(d => d.date === e.date);
          const changed = Number(e.dailyQuantity || 0) > 0 || lastPct == null || Number(e.percent) !== lastPct;
          lastPct = Number(e.percent);
          if (!changed) return null;
          return <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="w-16 font-semibold">{wd(e.date)} {dm(e.date)}</span>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">{status === 'before_cutover' ? 'Chốt tay trước mốc'
              : <>{day?.authors && <><span className={ENT}>{day.authors}</span> ghi · </>}{day?.verifiedBy ? <><span className={ENT}>{day.verifiedBy}</span> duyệt</> : 'đã duyệt'}</>}</span>
            {Number(e.dailyQuantity || 0) > 0 && <span className={NUM}>+{fmt(e.dailyQuantity, 2)} {t.unit || ''}</span>}
            <span className="w-14 text-right tabular-nums">{fmt(e.percent, 1)}%</span>
          </li>;
        })}
        {pending.map(p => <li key={`p-${p.date}`} className="flex flex-wrap items-center gap-x-3 rounded-lg border border-dashed border-amber-300 px-3 py-2 text-sm">
          <span className="w-16 font-semibold">{wd(p.date)} {dm(p.date)}</span>
          <span className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-200">Chờ CHT duyệt, chưa tính</span>
          {Number(p.dailyQuantity || 0) > 0 && <span className="text-amber-700">+{fmt(p.dailyQuantity, 2)}</span>}
          <span className="w-14 text-right tabular-nums text-amber-700">{fmt(p.percent, 1)}%</span>
        </li>)}
        {entries.length === 0 && pending.length === 0 && <li className="text-sm text-muted-foreground">Tuần này chưa ghi</li>}
      </ol>
    </div>
    {adjusting && entry && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Điều chỉnh ngoại lệ</p>
        <button type="button" onClick={() => setAdjusting(false)} aria-label="Đóng điều chỉnh" className="text-muted-foreground"><X size={16} /></button></div>
      <label className="block text-xs font-semibold text-muted-foreground">Ngày
        <select value={target} onChange={e => setTarget(e.target.value)} className={`${inputCls} mt-1 w-full`}>
          {adjustable.map(e => <option key={e.id} value={e.id}>{wd(e.date)} {dm(e.date)}</option>)}
        </select></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs font-semibold text-muted-foreground">% lũy kế<input value={pctText} onChange={e => setPctText(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1 w-full text-right`} /></label>
        <label className="text-xs font-semibold text-muted-foreground">KL lũy kế<input value={qtyText} onChange={e => setQtyText(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1 w-full text-right`} /></label>
        <label className="text-xs font-semibold text-muted-foreground">KL trong ngày<input value={dayQtyText} onChange={e => setDayQtyText(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1 w-full text-right`} /></label>
      </div>
      <label className="block text-xs font-semibold text-muted-foreground">Lý do (bắt buộc)
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={`${inputCls} mt-1 w-full`} placeholder="Vì sao không trả lại nhật ký được" /></label>
      <button type="button" disabled={saving || !reason.trim()} onClick={() => void save()}
        title={reason.trim() ? undefined : 'Nhập lý do trước'} className={`${primaryBtn} w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50`}>
        {saving && <Loader2 size={15} className="animate-spin" />}Lưu điều chỉnh</button>
    </section>}
    <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-100"><Info size={14} className="mt-0.5 shrink-0" />Ghi sai thì trả lại nhật ký ngày đó cho kỹ sư sửa. Điều chỉnh ngoại lệ chỉ dùng khi không trả lại được.</p>
  </Drawer>;
};

// ---------------------------------------------------------------------------- xác nhận tuần
const ConfirmWeekDialog: React.FC<{
  weekNo: number; before: number | null; after: number | null; moved: number; approvedDays: number; missing: string[]; pendingDays: number;
  busy: boolean; onCancel: () => void; onOk: () => void;
}> = ({ weekNo, before, after, moved, approvedDays, missing, pendingDays, busy, onCancel, onOk }) =>
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-4" role="dialog" aria-modal="true" aria-label={`Xác nhận tuần ${weekNo}`}>
    <div className="w-full max-w-md rounded-t-2xl bg-card p-5 shadow-xl md:rounded-2xl">
      <div className="flex items-start justify-between"><h3 className="text-lg font-bold">Xác nhận tuần {weekNo}?</h3>
        <button type="button" onClick={onCancel} aria-label="Đóng" className="text-muted-foreground"><X size={18} /></button></div>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Tiến độ thi công</dt><dd className={NUM}>{pct1(before)} → {pct1(after)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Việc có tiến triển</dt><dd className="font-semibold">{moved}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Nhật ký đã duyệt</dt><dd className="font-semibold">{approvedDays} ngày</dd></div>
      </dl>
      {(missing.length > 0 || pendingDays > 0) && <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span>{missing.length > 0 && <>{missing.join(', ')} chưa có nhật ký duyệt. </>}{pendingDays > 0 && <>{pendingDays} nhật ký còn chờ CHT duyệt. </>}Số những ngày đó sẽ không được tính vào tuần này.</span></p>}
      <p className="mt-3 text-xs text-muted-foreground">Sau khi xác nhận, số tuần bị khóa. Mở lại cần lý do.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryBtn} flex-1`}>Để sau</button>
        <button type="button" disabled={busy} onClick={onOk} className={`${primaryBtn} flex-1 disabled:opacity-50`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CalendarCheck size={16} />}Xác nhận</button>
      </div>
    </div>
  </div>;
