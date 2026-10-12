import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarOff, ChevronLeft, ChevronRight, Clock, MapPin, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { leaveService, type LeaveRequestRow } from '../../lib/leaveService';
import { buildMyCalendar, dateKey, leavePartLabel, type MyCalendarCell } from '../../lib/myAttendanceCalendar';
import { formatMinutes, timesheetService, type TimesheetDay, type TimesheetTotals } from '../../lib/timesheetService';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

// Nhãn + màu theo trạng thái ngày công (cùng bảng màu Tổng hợp công).
const STATUS: Record<string, { label: string; cell: string; bar: string; chip: string }> = {
  present: { label: 'Đi làm', cell: 'bg-leaf-50/60 dark:bg-leaf-950/20', bar: 'bg-leaf-500', chip: 'bg-leaf-100 text-leaf-800 dark:bg-leaf-900/40 dark:text-leaf-200' },
  off_day_work: { label: 'Làm ngày nghỉ', cell: 'bg-sky-50/60 dark:bg-sky-950/20', bar: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  business_trip: { label: 'Công tác', cell: 'bg-sky-50/60 dark:bg-sky-950/20', bar: 'bg-sky-500', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
  missing_punch: { label: 'Thiếu lượt chấm', cell: 'bg-amber-50/70 dark:bg-amber-950/20', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  absent: { label: 'Vắng', cell: 'bg-rose-50/70 dark:bg-rose-950/20', bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200' },
  leave: { label: 'Nghỉ phép', cell: 'bg-mint-50/70 dark:bg-mint-950/20', bar: 'bg-mint-500', chip: 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200' },
  holiday: { label: 'Lễ / Tết', cell: 'bg-violet-50/60 dark:bg-violet-950/20', bar: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' },
  off: { label: 'Nghỉ tuần', cell: 'bg-slate-50 dark:bg-slate-900/60', bar: '', chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};
const LEGEND = ['present', 'leave', 'missing_punch', 'absent', 'holiday'] as const;

const LEAVE_STATUS: Record<string, { label: string; chip: string }> = {
  pending: { label: 'Chờ duyệt', chip: 'border border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' },
  approved: { label: 'Đã duyệt', chip: 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200' },
  rejected: { label: 'Bị từ chối', chip: 'bg-rose-50 text-rose-700 line-through dark:bg-rose-950/30 dark:text-rose-300' },
};

const lateOf = (d: TimesheetDay) => d.lateBlock + d.earlyBlock;
const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Lịch chấm công + nghỉ phép của chính người dùng theo tháng. */
const MyAttendanceCalendar: React.FC<{ employeeId: string; onRequestMakeup?: (date: string) => void }> = ({ employeeId, onRequestMakeup }) => {
  const now = new Date();
  const today = dateKey(now);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [days, setDays] = useState<TimesheetDay[] | null>(null);
  const [totals, setTotals] = useState<TimesheetTotals | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequestRow[]>([]);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    setDays(null);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = dateKey(new Date(year, month, 0));
    try {
      const [rows, requests] = await Promise.all([
        timesheetService.month(year, month, employeeId),
        leaveService.listForEmployee(employeeId, from, to).catch(() => [] as LeaveRequestRow[]),
      ]);
      const mine = rows.find(r => r.employeeId === employeeId);
      setDays(mine?.timesheet.days || []);
      setTotals(mine?.timesheet.totals || null);
      setLeaves(requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được bảng công.');
    }
  }, [employeeId, year, month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    leaveService.listTypes().then(types => setTypeNames(Object.fromEntries(types.map(t => [t.code, t.name])))).catch(() => undefined);
  }, []);

  const cells = useMemo(() => days ? buildMyCalendar(year, month, days, leaves) : [], [days, leaves, year, month]);
  const selectedCell = cells.find(c => c.date === selected) || null;
  const lateDays = days ? days.filter(d => lateOf(d) > 0).length : 0;

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setSelected(null);
  };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setSelected(today); };

  const leaveName = (l: LeaveRequestRow) => typeNames[l.type] || l.type;
  // Đơn đã duyệt đã có trong bảng công (leaveName) — chỉ hiện thêm khi bảng công chưa thể hiện (ngày tương lai).
  const extraLeaves = (c: MyCalendarCell) => c.leaves.filter(l => l.status !== 'approved' || !c.timesheet?.leaveName);

  const kpis: Array<{ label: string; value: string; tone: string }> = totals ? [
    { label: 'Công', value: String(totals.workDays), tone: 'text-leaf-700 dark:text-leaf-300' },
    { label: 'Nghỉ phép', value: String(totals.paidLeaveDays + totals.unpaidLeaveDays + (totals.insuranceLeaveDays || 0)), tone: 'text-mint-700 dark:text-mint-300' },
    { label: 'Muộn / sớm', value: lateDays ? `${lateDays} ngày · ${formatMinutes(totals.lateBlockMinutes + totals.earlyBlockMinutes)}` : '0', tone: lateDays ? 'text-amber-700 dark:text-amber-300' : 'text-foreground' },
    { label: 'Thiếu lượt chấm', value: String(totals.missingPunchDays), tone: totals.missingPunchDays ? 'text-amber-700 dark:text-amber-300' : 'text-foreground' },
    { label: 'Vắng', value: String(totals.absentDays), tone: totals.absentDays ? 'text-rose-700 dark:text-rose-300' : 'text-foreground' },
  ] : [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Tháng trước" className="rounded-xl p-2 hover:bg-muted"><ChevronLeft size={18} /></button>
          <h2 className="min-w-[9.5rem] text-center text-lg font-black text-foreground">Tháng {String(month).padStart(2, '0')}/{year}</h2>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Tháng sau" className="rounded-xl p-2 hover:bg-muted"><ChevronRight size={18} /></button>
          <button type="button" onClick={goToday} className="ml-1 rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted">Hôm nay</button>
        </div>
        <Link to="/hrm/leave" className="inline-flex items-center gap-1.5 rounded-xl border border-mint-300 px-3 py-1.5 text-xs font-bold text-mint-800 hover:bg-mint-50 dark:border-mint-800 dark:text-mint-200 dark:hover:bg-mint-950/30">
          <CalendarOff size={14} />Xin nghỉ
        </Link>
      </div>

      {kpis.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {kpis.map(k => (
            <div key={k.label} className="rounded-xl border border-border bg-card px-3 py-2">
              <dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{k.label}</dt>
              <dd className={`text-lg font-black tabular-nums ${k.tone}`}>{k.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle size={16} />{error}
          <button type="button" onClick={() => void load()} className="ml-auto rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold">Thử lại</button>
        </div>
      ) : !days ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">Đang tải lịch công…</div>
      ) : (
        <div className="grid grid-cols-7 overflow-hidden rounded-2xl border-l border-t border-border bg-card shadow-sm">
          {WEEKDAYS.map(w => (
            <div key={w} className={`border-b border-r border-border bg-muted/60 py-2 text-center text-[10px] font-bold uppercase ${w === 'CN' ? 'text-rose-500' : 'text-muted-foreground'}`}>{w}</div>
          ))}
          {cells.map(c => {
            const t = c.timesheet;
            const st = t && t.status !== 'future' ? STATUS[t.status] : undefined;
            const isToday = c.date === today;
            const others = extraLeaves(c);
            const late = t ? lateOf(t) : 0;
            return (
              <button
                key={c.date}
                type="button"
                disabled={!c.inMonth}
                onClick={() => setSelected(c.date === selected ? null : c.date)}
                aria-pressed={selected === c.date}
                className={`relative flex min-h-[68px] flex-col items-stretch gap-0.5 border-b border-r border-border p-1.5 text-left transition sm:min-h-[96px] sm:p-2 ${!c.inMonth ? 'bg-muted/20' : st ? st.cell : 'bg-card'} ${c.inMonth ? 'hover:z-10 hover:shadow-md' : ''} ${selected === c.date ? 'ring-2 ring-inset ring-teal-600' : isToday ? 'ring-2 ring-inset ring-teal-400' : ''}`}
              >
                {c.inMonth && st?.bar && <span className={`absolute inset-x-0 top-0 h-1 ${st.bar}`} aria-hidden />}
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${isToday ? 'bg-teal-600 text-white' : c.inMonth ? 'text-foreground' : 'text-muted-foreground/40'}`}>{c.day}</span>
                {c.inMonth && t && (t.checkIn || t.checkOut) && (
                  <span className="text-[10px] font-semibold tabular-nums text-foreground sm:text-[11px]">
                    {t.checkIn || '--:--'}<span className="hidden sm:inline"> – {t.checkOut || '--:--'}</span>
                  </span>
                )}
                {c.inMonth && st && t && (
                  <span className={`hidden w-fit max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold sm:inline-block ${st.chip}`}>
                    {t.leaveName ? `${t.leaveName}${t.leavePart && t.leavePart !== 'full' ? (t.leavePart === 'morning' ? ' (sáng)' : ' (chiều)') : ''}` : st.label}
                  </span>
                )}
                {c.inMonth && late > 0 && <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">{t!.lateBlock > 0 ? `Muộn ${formatMinutes(t!.lateBlock)}` : `Sớm ${formatMinutes(t!.earlyBlock)}`}</span>}
                {c.inMonth && others.map(l => (
                  <span key={l.id} title={`${leaveName(l)} · ${LEAVE_STATUS[l.status]?.label || l.status}`}
                    className={`w-fit max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold ${LEAVE_STATUS[l.status]?.chip || ''}`}>
                    <span className="sm:hidden">{l.status === 'pending' ? '⏳' : 'P'}</span>
                    <span className="hidden sm:inline">{leaveName(l)}{leavePartLabel(l, c.date)}</span>
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      )}

      {days && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {LEGEND.map(k => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${STATUS[k].bar}`} />{STATUS[k].label}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500" />Đơn chờ duyệt</span>
        </div>
      )}

      {selectedCell && (
        <DayDetail cell={selectedCell} leaveName={leaveName} today={today} onClose={() => setSelected(null)} onRequestMakeup={onRequestMakeup} />
      )}
    </section>
  );
};

const DayDetail: React.FC<{
  cell: MyCalendarCell; leaveName: (l: LeaveRequestRow) => string; today: string; onClose: () => void; onRequestMakeup?: (date: string) => void;
}> = ({ cell, leaveName, today, onClose, onRequestMakeup }) => {
  const t = cell.timesheet;
  const st = t && t.status !== 'future' ? STATUS[t.status] : undefined;
  const canMakeup = Boolean(onRequestMakeup && t && cell.date <= today && (t.status === 'missing_punch' || t.status === 'absent'));
  const ref = useRef<HTMLDivElement>(null);
  // Điện thoại: chi tiết nằm dưới lưới — cuộn tới khi chọn ngày.
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [cell.date]);
  return (
    <div ref={ref} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black capitalize text-foreground">{dayLabel(cell.date)}</p>
          {t && <p className="text-xs text-muted-foreground">{t.shiftName || 'Ca'} · {t.shiftStart}–{t.shiftEnd}{t.notRequired ? ' · không bắt buộc chấm' : ''}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1 text-muted-foreground hover:bg-muted"><X size={16} /></button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Trạng thái</dt>
          <dd>{st && t ? <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${st.chip}`}>{t.leaveName || st.label}</span> : <span className="text-muted-foreground">Chưa tới</span>}</dd></div>
        <div><dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Vào – Ra</dt>
          <dd className="font-bold tabular-nums text-foreground"><Clock size={12} className="mr-1 inline text-muted-foreground" />{t?.checkIn || '--:--'} – {t?.checkOut || '--:--'}</dd></div>
        <div><dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Muộn / sớm</dt>
          <dd className={`font-bold tabular-nums ${t && lateOf(t) ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
            {t ? `${formatMinutes(t.lateBlock)} / ${formatMinutes(t.earlyBlock)}` : '—'}{t && t.excusedLate + t.excusedEarly > 0 ? <span className="ml-1 text-xs font-semibold text-leaf-700">miễn {t.excusedLate + t.excusedEarly}p</span> : null}</dd></div>
        <div><dt className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Công</dt>
          <dd className="font-bold tabular-nums text-foreground">{t ? t.workCredit : '—'}</dd></div>
      </dl>
      {t?.locationName && <p className="mt-2 text-xs text-muted-foreground"><MapPin size={12} className="mr-1 inline" />{t.locationName}</p>}
      {t?.adjusted && <p className="mt-1 text-xs text-muted-foreground">Nhân sự đã điều chỉnh khi chốt công.</p>}
      {cell.leaves.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {cell.leaves.map(l => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${LEAVE_STATUS[l.status]?.chip || ''}`}>{LEAVE_STATUS[l.status]?.label || l.status}</span>
              <span className="font-semibold text-foreground">{leaveName(l)}{leavePartLabel(l, cell.date)}</span>
              <span className="text-xs text-muted-foreground">{l.code} · {l.totalDays} ngày{l.rejectionReason ? ` · ${l.rejectionReason}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {canMakeup && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => onRequestMakeup!(cell.date)} className="rounded-xl bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800">Đề xuất bù công</button>
        </div>
      )}
    </div>
  );
};

export default MyAttendanceCalendar;
