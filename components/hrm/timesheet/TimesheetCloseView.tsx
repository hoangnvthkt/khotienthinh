import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarCheck2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Download, Lock, MessageSquareText,
  RefreshCw, RotateCcw, Search, Send, ShieldCheck, Undo2, X,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { loadXlsx } from '../../../lib/loadXlsx';
import { leaveService, type LeaveSession, type LeaveTypeOption } from '../../../lib/leaveService';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';
import { formatMinutes, type EmployeeTimesheet, type TimesheetDay } from '../../../lib/timesheetService';
import {
  collectIssues, daySymbol, ISSUE_LABEL, payableDays, PERIOD_STEP,
  type IssueKind, type TimesheetAdjustment, type TimesheetCloseBoard, type TimesheetIssue, type TimesheetPeriodStatus,
} from '../../../lib/timesheetClose';
import { timesheetCloseService } from '../../../lib/timesheetCloseService';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import SearchableSelect from '../../common/SearchableSelect';

// Chốt công tháng (H4): HR reviews and fixes the month, HR Manage approves, the month locks.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const WEEKDAY = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const SYMBOL_TONE: Record<string, string> = {
  X: 'bg-leaf-100 text-leaf-800 dark:bg-leaf-900/50 dark:text-leaf-200',
  '½': 'bg-leaf-50 text-leaf-700 dark:bg-leaf-950/40 dark:text-leaf-300',
  P: 'bg-mint-100 text-mint-800 dark:bg-mint-900/50 dark:text-mint-200',
  R: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  KL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  BH: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  L: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  CT: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  V: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
  '!': 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
  '–': 'text-slate-400',
};
const toneOf = (symbol: string) => SYMBOL_TONE[symbol.replace('½', '') || '½'] || SYMBOL_TONE[symbol] || '';
const LEGEND: Array<[string, string]> = [['X', 'Đi làm'], ['½', 'Nửa công'], ['P', 'Phép năm'], ['R', 'Nghỉ có lương khác'], ['KL', 'Không lương'],
  ['BH', 'BHXH'], ['L', 'Lễ'], ['CT', 'Công tác'], ['V', 'Vắng'], ['!', 'Thiếu lượt chấm'], ['–', 'Chưa vào làm']];
const STATUS_TEXT: Record<string, string> = {
  present: 'Đi làm', missing_punch: 'Thiếu lượt chấm', absent: 'Vắng', leave: 'Nghỉ', holiday: 'Lễ', off: 'Nghỉ tuần',
  off_day_work: 'Làm ngày nghỉ', business_trip: 'Công tác', not_employed: 'Chưa vào làm', future: 'Chưa tới',
};
const STEPS: Array<{ status: TimesheetPeriodStatus; label: string; hint: string }> = [
  { status: 'open', label: 'Đang chạy', hint: 'cập nhật trực tiếp' },
  { status: 'reviewing', label: 'HR rà soát', hint: 'sửa công, ghi phép thay' },
  { status: 'submitted', label: 'HR Manage duyệt', hint: 'duyệt hoặc trả lại' },
  { status: 'closed', label: 'Đã chốt', hint: 'khóa tháng, dùng tính lương' },
];
const dateVi = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
const dayNum = (value: string) => Number(value.slice(8, 10));
const keyOf = (employeeId: string, date: string) => `${employeeId}|${date}`;
const days = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Day drawer: everything about one person's day, and HR's fixes.
// ---------------------------------------------------------------------------
const DayDrawer: React.FC<{
  board: TimesheetCloseBoard;
  row: EmployeeTimesheet;
  day: TimesheetDay;
  leaveTypes: LeaveTypeOption[];
  editable: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ board, row, day, leaveTypes, editable, onClose, onChanged }) => {
  const toast = useToast();
  const reasonConfirm = useReasonConfirm();
  const adjustments = board.adjustments.filter(item => item.employeeId === row.employeeId && item.date === day.date);
  const feedback = board.feedback.filter(item => item.employeeId === row.employeeId && item.date === day.date);
  const pending = board.pending.filter(item => item.employeeId === row.employeeId && day.date >= item.date && day.date <= (item.endDate || item.date));
  const [mode, setMode] = useState<'credit' | 'excuse' | 'leave' | null>(null);
  const [credit, setCredit] = useState<number>(day.workCredit);
  const [leaveType, setLeaveType] = useState(leaveTypes.find(type => type.code === 'annual')?.code || leaveTypes[0]?.code || '');
  const [session, setSession] = useState<LeaveSession>('full');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const blocks = day.lateBlock + day.earlyBlock;

  const run = async (action: () => Promise<unknown>, title: string, detail: string) => {
    setSaving(true);
    try {
      await action();
      toast.success(title, detail);
      setMode(null); setReason('');
      await onChanged();
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };
  const save = () => {
    const who = `${row.fullName} · ${dateVi(day.date)}`;
    if (mode === 'credit') return run(() => timesheetCloseService.adjust(row.employeeId, day.date, 'credit', credit, reason.trim()), 'Đã sửa công', `${who}: ${days(day.workCredit)} → ${days(credit)} công.`);
    if (mode === 'excuse') return run(() => timesheetCloseService.adjust(row.employeeId, day.date, 'excuse', blocks, reason.trim()), 'Đã miễn đi muộn / về sớm', `${who}: miễn ${blocks} phút.`);
    if (mode === 'leave') return run(() => timesheetCloseService.recordLeave({ employeeId: row.employeeId, type: leaveType, start: day.date, end: day.date, startSession: session, endSession: session, reason: reason.trim() }),
      'Đã ghi đơn nghỉ thay', `${who}: ${leaveTypes.find(type => type.code === leaveType)?.name}; số phép và sổ phép đã cập nhật.`);
    return undefined;
  };
  const undo = async (item: TimesheetAdjustment) => {
    const note = await reasonConfirm({ title: 'Bỏ điều chỉnh', targetName: `${row.fullName} · ${dateVi(day.date)}`, subtitle: 'Ngày này trở về số hệ thống tính.', reasonLabel: 'Lý do', actionLabel: 'Bỏ điều chỉnh', intent: 'warning', minLength: 5 });
    if (note === null) return;
    await run(() => timesheetCloseService.removeAdjustment(item.id, note), 'Đã bỏ điều chỉnh', `${row.fullName} · ${dateVi(day.date)} về số hệ thống.`);
  };

  const fact = (label: string, value: React.ReactNode) => <div className="flex justify-between gap-3 py-1 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right text-foreground">{value}</dd></div>;
  const symbol = daySymbol(day);

  return <Drawer label={`${row.fullName} ngày ${dateVi(day.date)}`} onClose={onClose}
    header={<div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{WEEKDAY[day.weekday]} · {dateVi(day.date)}</p>
      <h2 className={`text-lg ${ENT}`}>{row.fullName} <span className="text-sm font-normal text-muted-foreground">{row.employeeCode}</span></h2>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {symbol && <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-bold ${toneOf(symbol)}`}>{symbol}</span>}
        <span className="text-sm text-foreground">{STATUS_TEXT[day.status] || day.status}{day.leaveName ? ` · ${day.leaveName}` : ''}</span>
        {adjustments.length > 0 && <Badge className="border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">Đã điều chỉnh</Badge>}
      </div>
    </div>}
    footer={mode ? <>
      <button type="button" onClick={() => { setMode(null); setReason(''); }} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving || reason.trim().length < 5 || (mode === 'credit' && credit === day.workCredit)} onClick={() => void save()} className={primaryBtn}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
    </> : <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>}>
    {pending.map(item => <p key={`${item.kind}-${item.code || item.date}`} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span><b>{item.label}</b> đang chờ duyệt — duyệt hoặc từ chối trước khi gửi chốt công ({item.kind === 'leave' ? 'Nghỉ phép' : item.kind === 'makeup' ? 'Chấm công → Đề xuất CC' : 'Nghỉ phép → Chờ tôi duyệt'}).</span>
    </p>)}
    {feedback.map(item => <div key={item.id} className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm dark:border-teal-900 dark:bg-teal-950/40">
      <p className="flex items-center gap-1.5 font-semibold text-teal-900 dark:text-teal-100"><MessageSquareText size={14} />Nhân viên phản hồi</p>
      <p className="mt-0.5 text-foreground">{item.message}</p>
      {item.reply && <p className="mt-1 text-xs text-muted-foreground">HR trả lời: {item.reply}</p>}
    </div>)}

    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Hệ thống ghi nhận</h3>
      <dl className="mt-2 divide-y divide-border">
        {fact('Ca', `${day.shiftName} ${day.shiftStart}–${day.shiftEnd}`)}
        {day.notRequired && fact('Chấm công', 'Không phải chấm công — ngày làm việc tính đủ công')}
        {fact('Vào / ra', <span className="tabular-nums">{day.checkIn || '—'} → {day.checkOut || '—'}</span>)}
        {day.locationName && fact('Địa điểm', day.locationName)}
        {fact('Công', <span className={NUM}>{days(day.workCredit)}</span>)}
        {(day.lateMinutes > 0 || day.earlyMinutes > 0) && fact('Đi muộn / về sớm', `${day.lateMinutes}p / ${day.earlyMinutes}p → tính ${blocks} phút${day.excusedLate + day.excusedEarly ? `, đã miễn ${day.excusedLate + day.excusedEarly}p` : ''}`)}
        {day.extraMinutes > 0 && fact('Phút dư (chờ xác nhận làm thêm)', formatMinutes(day.extraMinutes))}
      </dl>
    </section>

    {adjustments.length > 0 && <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Điều chỉnh của HR</h3>
      <ul className="mt-2 space-y-2">{adjustments.map(item => <li key={item.id} className="flex items-start gap-2 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-foreground">{item.kind === 'credit' ? `Công ${days(Number(item.before ?? 0))} → ${days(Number(item.value))}` : item.kind === 'excuse' ? `Miễn ${item.value} phút muộn / sớm` : `Ghi đơn nghỉ thay${item.leaveCode ? ` ${item.leaveCode}` : ''}`}</span>
          <span className="block text-xs text-muted-foreground">{item.reason} · {item.byName} · {new Date(item.at).toLocaleString('vi-VN')}</span>
        </span>
        {editable && item.kind !== 'leave' && <button type="button" onClick={() => void undo(item)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Bỏ điều chỉnh"><Undo2 size={15} /></button>}
      </li>)}</ul>
    </section>}

    {editable && day.status !== 'future' && day.status !== 'not_employed' && <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Sửa ngày này</h3>
      {!mode && <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode('credit')} className={secondaryBtn}>Sửa công</button>
        {blocks > 0 && <button type="button" onClick={() => setMode('excuse')} className={secondaryBtn}>Miễn đi muộn / về sớm</button>}
        {day.status !== 'leave' && <button type="button" onClick={() => setMode('leave')} className={secondaryBtn}>Ghi đơn nghỉ thay</button>}
      </div>}
      {mode === 'credit' && <div className="mt-2 space-y-2">
        <div className="flex gap-2" role="radiogroup" aria-label="Công ngày">{[0, 0.5, 1].map(value =>
          <button key={value} type="button" role="radio" aria-checked={credit === value} onClick={() => setCredit(value)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold tabular-nums ${credit === value ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:bg-muted'}`}>{value === 0.5 ? '½' : value} công</button>)}
        </div>
        <p className="text-xs text-muted-foreground">Dùng khi có xác nhận đi làm (ví dụ chỉ huy trưởng xác nhận quên chấm). Nghỉ thì dùng "Ghi đơn nghỉ thay" để trừ phép đúng.</p>
      </div>}
      {mode === 'excuse' && <p className="mt-2 text-sm text-foreground">Miễn <b className="tabular-nums">{blocks} phút</b> đi muộn / về sớm; ngày này tính đủ công.</p>}
      {mode === 'leave' && <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <select value={leaveType} onChange={event => setLeaveType(event.target.value)} aria-label="Loại nghỉ" className={inputCls}>
          {leaveTypes.filter(type => type.unit === 'day' && type.isActive).map(type => <option key={type.code} value={type.code}>{type.name}</option>)}
        </select>
        <select value={session} onChange={event => setSession(event.target.value as LeaveSession)} aria-label="Buổi" className={inputCls}>
          <option value="full">Cả ngày</option><option value="morning">Buổi sáng</option><option value="afternoon">Buổi chiều</option>
        </select>
        <p className="text-xs text-muted-foreground sm:col-span-2">Tạo đơn đã duyệt thay nhân viên: trừ số phép, ghi sổ phép, nhân viên nhận thông báo.</p>
      </div>}
      {mode && <label className="mt-2 block text-xs font-semibold text-muted-foreground">Lý do (bắt buộc)
        <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className={`${inputCls} mt-1 w-full resize-none`}
          placeholder={mode === 'leave' ? 'Ví dụ: Nghỉ ốm, đã báo trưởng bộ phận qua điện thoại' : 'Ví dụ: CHT Phạm Ngọc Sơn xác nhận đi làm, điện thoại hỏng'} /></label>}
    </section>}
    {!editable && board.period.status === 'closed' && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock size={13} />Tháng đã chốt — muốn sửa, HR Manage mở lại kỳ công.</p>}
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Employee's own month + feedback.
// ---------------------------------------------------------------------------
const MyMonth: React.FC<{ board: TimesheetCloseBoard; year: number; month: number; onChanged: () => Promise<void> }> = ({ board, year, month, onChanged }) => {
  const toast = useToast();
  const row = board.employees[0];
  const [date, setDate] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  if (!row) return <StateBox kind="empty" title="Chưa có bảng công" message="Tài khoản chưa liên kết hồ sơ nhân sự." />;
  const totals = row.timesheet.totals;
  const send = async () => {
    setSending(true);
    try {
      await timesheetCloseService.sendFeedback(year, month, date || null, message.trim());
      toast.success('Đã gửi phản hồi', 'HR xem trong lúc chốt công và trả lời bạn.');
      setDate(''); setMessage('');
      await onChanged();
    } catch (error) {
      toast.error('Chưa gửi được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  };
  const open = board.period.status === 'reviewing' || board.period.status === 'open';
  return <section className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[['Công tính lương', payableDays(totals)], ['Công đi làm', totals.workDays], ['Nghỉ có lương', totals.paidLeaveDays], ['Vắng / thiếu chấm', totals.absentDays + totals.missingPunchDays]].map(([label, value]) =>
        <div key={label as string} className="rounded-xl border border-border bg-card p-3"><span className="block text-xs text-muted-foreground">{label}</span>
          <span className={`text-xl ${label === 'Vắng / thiếu chấm' && Number(value) > 0 ? 'font-semibold tabular-nums text-amber-700 dark:text-amber-300' : NUM}`}>{days(Number(value))}</span></div>)}
    </div>
    <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{row.timesheet.days.filter(day => day.status !== 'future' && day.status !== 'off').map(day => {
      const symbol = daySymbol(day);
      return <li key={day.date} className="flex items-center gap-3 px-3 py-2 text-sm">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">{WEEKDAY[day.weekday]} {dateVi(day.date).slice(0, 5)}</span>
        <span className={`inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-xs font-bold ${toneOf(symbol)}`}>{symbol}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{STATUS_TEXT[day.status]}{day.leaveName ? ` · ${day.leaveName}` : ''}</span>
        <span className="tabular-nums text-xs text-muted-foreground">{day.checkIn || '—'} → {day.checkOut || '—'}</span>
      </li>;
    })}</ul>
    {open ? <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Công chưa đúng? Báo HR</h3>
      <div className="flex flex-wrap gap-2">
        <select value={date} onChange={event => setDate(event.target.value)} aria-label="Ngày" className={inputCls}>
          <option value="">Cả tháng</option>{row.timesheet.days.filter(day => day.status !== 'future').map(day => <option key={day.date} value={day.date}>{dateVi(day.date)}</option>)}
        </select>
        <input value={message} onChange={event => setMessage(event.target.value)} placeholder="Ví dụ: Ngày 02/10 em đi làm ở SMB nhưng quên chấm ra" className={`${inputCls} min-w-[220px] flex-1`} />
        <button type="button" disabled={sending || message.trim().length < 5} onClick={() => void send()} className={primaryBtn}><Send size={15} />Gửi</button>
      </div>
      {board.feedback.length > 0 && <ul className="space-y-1 text-sm">{board.feedback.map(item => <li key={item.id} className="text-muted-foreground">
        <span className="text-foreground">{item.date ? `${dateVi(item.date)}: ` : ''}{item.message}</span> — {item.status === 'resolved' ? <span className="text-leaf-700">HR đã trả lời{item.reply ? `: ${item.reply}` : ''}</span> : 'chờ HR xem'}
      </li>)}</ul>}
    </div> : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock size={13} />Tháng đã gửi duyệt hoặc đã chốt; còn thắc mắc thì liên hệ HR.</p>}
  </section>;
};

// ---------------------------------------------------------------------------
// People not required to punch: working days count in full; leave still needs a request.
// ---------------------------------------------------------------------------
const NotRequiredCard: React.FC<{ board: TimesheetCloseBoard; editable: boolean; onChanged: () => Promise<void> }> = ({ board, editable, onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const listed = new Set(board.notRequired.map(item => item.employeeId));
  const save = async (id: string, on: boolean, note: string | null, name: string) => {
    setSaving(true);
    try {
      await timesheetCloseService.setNotRequired(id, on, note);
      toast.success(on ? `${name}: không chấm công` : `${name}: chấm công như thường`,
        on ? 'Các ngày làm việc tính đủ công; nghỉ vẫn cần đơn.' : 'Từ giờ ngày không chấm công tính là vắng.');
      setEmployeeId(''); setReason('');
      await onChanged();
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string, name: string) => {
    const ok = await confirm({ title: 'Bỏ khỏi danh sách không chấm công', targetName: name, actionLabel: 'Bỏ', confirmText: 'Bỏ', intent: 'warning', countdownSeconds: 0,
      subtitle: 'Người này phải chấm công; ngày không chấm và không có đơn sẽ tính vắng.' });
    if (ok) await save(id, false, null, name);
  };
  return <details className="rounded-2xl border border-border bg-card p-4">
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck size={15} className="text-teal-600" />
      Không chấm công — tính đủ công <span className="text-xs font-normal text-muted-foreground">({board.notRequired.length} người)</span></summary>
    <p className="mt-2 text-xs text-muted-foreground">Dành cho người không phải chấm công (ví dụ Ban lãnh đạo): ngày làm việc tự tính đủ công, không tính đi muộn; nghỉ vẫn phải có đơn và trừ phép.</p>
    {board.notRequired.length > 0 && <ul className="mt-2 divide-y divide-border">{board.notRequired.map(item => <li key={item.employeeId} className="flex items-center gap-2 py-1.5 text-sm">
      <span className={`w-44 truncate ${ENT}`}>{item.fullName}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.reason}{item.setByName ? ` · ${item.setByName}` : ''}</span>
      {editable && <button type="button" disabled={saving} onClick={() => void remove(item.employeeId, item.fullName)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={`Bỏ ${item.fullName}`}><X size={14} /></button>}
    </li>)}</ul>}
    {editable && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
      <SearchableSelect value={employeeId || null} options={board.employees.filter(row => !listed.has(row.employeeId))}
        onChange={row => setEmployeeId(row?.employeeId || '')} getOptionValue={row => row.employeeId}
        getOptionLabel={row => `${row.fullName}${row.employeeCode ? ` (${row.employeeCode})` : ''}`}
        getOptionSearchText={row => [row.fullName, row.employeeCode, row.orgUnitName].filter(Boolean).join(' ')}
        placeholder="Gõ tên hoặc mã nhân viên…" emptyLabel="Không tìm thấy" className="flex-1" />
      <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Lý do, ví dụ: Ban lãnh đạo" className={`${inputCls} sm:w-56`} />
      <button type="button" disabled={saving || !employeeId || reason.trim().length < 5} onClick={() => void save(employeeId, true, reason.trim(),
        board.employees.find(row => row.employeeId === employeeId)?.fullName || '')} className={primaryBtn}>Thêm</button>
    </div>}
  </details>;
};

// ---------------------------------------------------------------------------
// Main view.
// ---------------------------------------------------------------------------
const TimesheetCloseView: React.FC<{ initialYear?: number; initialMonth?: number }> = ({ initialYear, initialMonth }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(initialYear ?? lastMonth.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? lastMonth.getMonth() + 1);
  const [board, setBoard] = useState<TimesheetCloseBoard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [issueKind, setIssueKind] = useState<IssueKind | null>(null);
  const [openCell, setOpenCell] = useState<{ employeeId: string; date: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await timesheetCloseService.board(year, month));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được bảng chốt công.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { leaveService.listTypes().then(setLeaveTypes).catch(() => setLeaveTypes([])); }, []);

  const issues = useMemo(() => board ? collectIssues(board) : [], [board]);
  const issueCells = useMemo(() => new Set(issues.filter(item => item.date).map(item => keyOf(item.employeeId, item.date!))), [issues]);
  const adjustedCells = useMemo(() => new Set([
    ...(board?.adjustments || []).map(item => keyOf(item.employeeId, item.date)),
    ...(board?.employees || []).flatMap(row => row.timesheet.days.filter(day => day.adjusted).map(day => keyOf(row.employeeId, day.date))),
  ]), [board]);

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear()); setMonth(next.getMonth() + 1); setOpenCell(null);
  };
  const act = async (action: () => Promise<void>, title: string, detail: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(title, detail);
      await load();
    } catch (actionError) {
      toast.error('Chưa thực hiện được', actionError instanceof Error ? actionError.message : 'Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !board) return <StateBox kind={/quyền|42501/i.test(error) ? 'denied' : 'error'} title={/quyền|42501/i.test(error) ? 'Bạn chưa có quyền xem chốt công' : undefined} message={error} onRetry={() => void load()} />;
  if (!board) return <StateBox kind="loading" title="Đang tải bảng công…" />;

  const label = `tháng ${String(month).padStart(2, '0')}/${year}`;
  const period = board.period;
  const editable = board.can.review && period.status === 'reviewing';
  const blocking = issues.filter(item => item.blocking);
  const monthEnded = new Date(year, month, 1) <= now;

  if (!board.can.review && !board.can.approve) {
    return <section className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4">
        <CalendarCheck2 size={20} className="text-teal-600" /><h2 className="flex-1 text-lg font-bold text-foreground">Công {label} của tôi</h2>
        <button type="button" onClick={() => shiftMonth(-1)} className={secondaryBtn} aria-label="Tháng trước"><ChevronLeft size={15} /></button>
        <button type="button" onClick={() => shiftMonth(1)} className={secondaryBtn} aria-label="Tháng sau"><ChevronRight size={15} /></button>
      </header>
      <MyMonth board={board} year={year} month={month} onChanged={load} />
    </section>;
  }

  const rows = board.employees
    .filter(row => !search || matchesSearchQueryMultiple([row.fullName, row.employeeCode, row.orgUnitName], search))
    .filter(row => !onlyIssues || issues.some(item => item.employeeId === row.employeeId && (!issueKind || item.kind === issueKind)));
  const monthDays = board.employees[0]?.timesheet.days || [];
  const totalPayable = board.employees.reduce((sum, row) => sum + payableDays(row.timesheet.totals), 0);
  const counts = (Object.keys(ISSUE_LABEL) as IssueKind[]).map(kind => ({ kind, count: issues.filter(item => item.kind === kind).length, people: new Set(issues.filter(item => item.kind === kind).map(item => item.employeeId)).size }));
  const shownIssues = issues.filter(item => !issueKind || item.kind === issueKind);
  const grouped = Object.values(shownIssues.reduce<Record<string, { first: TimesheetIssue; dates: string[] }>>((acc, item) => {
    const key = `${item.kind}|${item.employeeId}`;
    (acc[key] ||= { first: item, dates: [] }).dates.push(item.date || '');
    return acc;
  }, {}));
  const openRow = openCell ? board.employees.find(row => row.employeeId === openCell.employeeId) : null;
  const openDay = openRow?.timesheet.days.find(day => day.date === openCell?.date) || null;

  const start = () => act(() => timesheetCloseService.open(year, month), `Đã bắt đầu chốt công ${label}`, 'Nhân viên xem được công của mình và gửi phản hồi; HR rà soát rồi gửi HR Manage duyệt.');
  const submit = async () => {
    const ok = await confirm({ title: 'Gửi HR Manage duyệt', targetName: `Công ${label}`, actionLabel: 'Gửi duyệt', confirmText: 'Gửi duyệt', intent: 'success', countdownSeconds: 0,
      subtitle: `${board.employees.length} người · ${days(totalPayable)} công tính lương · ${board.adjustments.length} điều chỉnh`,
      warningText: 'Trong lúc chờ duyệt không sửa được; HR Manage có thể trả lại để sửa tiếp.' });
    if (ok) await act(() => timesheetCloseService.submit(year, month), 'Đã gửi duyệt', `Công ${label} chờ HR Manage duyệt.`);
  };
  const approve = async () => {
    const ok = await confirm({ title: 'Duyệt chốt công', targetName: `Công ${label}`, actionLabel: 'Duyệt chốt', confirmText: 'Duyệt chốt', intent: 'success', countdownSeconds: 0,
      subtitle: `${days(totalPayable)} công tính lương · ${board.adjustments.length} điều chỉnh`,
      warningText: 'Tháng sẽ khóa: không tạo hoặc duyệt thêm đơn nghỉ, chấm bù, giải trình cho tháng này. Cần sửa thì mở lại kỳ công.' });
    if (ok) await act(() => timesheetCloseService.decide(year, month, true, null), `Đã chốt công ${label}`, 'Bản chốt đã lưu và sẵn sàng cho tính lương.');
  };
  const sendBack = async () => {
    const note = await reasonConfirm({ title: 'Trả lại HR', targetName: `Công ${label}`, reasonLabel: 'Cần sửa gì', reasonPlaceholder: 'Ví dụ: Kiểm tra lại công của đội SMB ngày 02/10', actionLabel: 'Trả lại', intent: 'warning', minLength: 5 });
    if (note !== null) await act(() => timesheetCloseService.decide(year, month, false, note), 'Đã trả lại', 'HR nhận thông báo kèm lý do và sửa tiếp.');
  };
  const reopen = async () => {
    const note = await reasonConfirm({ title: 'Mở lại kỳ công', targetName: `Công ${label}`, subtitle: 'Bản chốt hiện tại được giữ làm lịch sử; HR rà soát và gửi duyệt lại.', reasonLabel: 'Lý do mở lại', actionLabel: 'Mở lại', intent: 'danger', minLength: 5 });
    if (note !== null) await act(() => timesheetCloseService.reopen(year, month, note), 'Đã mở lại kỳ công', `Công ${label} quay về bước HR rà soát.`);
  };
  const exportExcel = async () => {
    const XLSX = await loadXlsx();
    const header = ['Mã NV', 'Họ tên', 'Đơn vị', ...monthDays.map(day => `${dayNum(day.date)}`), 'Công đi làm', 'Nghỉ có lương', 'Lễ', 'Không lương', 'BHXH', 'Vắng', 'Thiếu chấm', 'Muộn/sớm (phút)', 'Làm thêm đã duyệt (phút)', 'Công tính lương'];
    const data = board.employees.map(row => {
      const t = row.timesheet.totals;
      const bhxh = t.insuranceLeaveDays ?? 0;
      return [row.employeeCode, row.fullName, row.orgUnitName, ...row.timesheet.days.map(daySymbol), t.workDays, t.paidLeaveDays, t.holidays, t.unpaidLeaveDays, bhxh, t.absentDays, t.missingPunchDays,
        t.lateBlockMinutes + t.earlyBlockMinutes, t.overtimeApprovedMinutes, payableDays(t)];
    });
    const adjust = board.adjustments.map(item => [board.employees.find(row => row.employeeId === item.employeeId)?.fullName, dateVi(item.date),
      item.kind === 'credit' ? 'Sửa công' : item.kind === 'excuse' ? 'Miễn muộn/sớm' : 'Ghi đơn nghỉ thay', item.before, item.value, item.reason, item.byName]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[`BẢNG CHẤM CÔNG ${label.toUpperCase()}${period.status === 'closed' ? ` — ĐÃ CHỐT lần ${period.version}` : ' — CHƯA CHỐT'}`], header, ...data]), 'Bảng công');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nhân viên', 'Ngày', 'Loại', 'Trước', 'Sau', 'Lý do', 'Người sửa'], ...adjust]), 'Điều chỉnh');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url; link.download = `cham-cong-${year}-${String(month).padStart(2, '0')}.xlsx`; link.click();
    URL.revokeObjectURL(url);
  };

  const step = PERIOD_STEP[period.status];
  return <section className="space-y-3">
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white"><CalendarCheck2 size={20} /></span>
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">Chốt công {label}</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg p-1 hover:bg-muted" aria-label="Tháng trước"><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg p-1 hover:bg-muted" aria-label="Tháng sau"><ChevronRight size={16} /></button>
          </div>
          {period.status === 'closed' && <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200"><Lock size={11} />Đã chốt lần {period.version}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">Bảng công từ chấm công và đơn nghỉ đã duyệt. HR rà soát, sửa có lý do, rồi HR Manage duyệt; tháng đã chốt là số dùng để tính lương.</p>
        <details className="mt-1 text-sm">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">Cách làm <ChevronDown size={13} /></summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Sau ngày cuối tháng, HR bấm <b>Bắt đầu chốt công</b>; nhân viên xem công của mình và gửi phản hồi nếu sai.</li>
            <li>Xử lý khung <b>Cần xử lý</b>: duyệt hết đơn còn chờ, xem phản hồi, bấm vào ô ngày để <b>Sửa công</b>, <b>Miễn đi muộn</b> hoặc <b>Ghi đơn nghỉ thay</b> (luôn có lý do).</li>
            <li><b>Gửi HR Manage duyệt</b>. HR Manage duyệt thì tháng khóa; trả lại thì HR sửa tiếp.</li>
            <li>Đã chốt mà cần sửa: HR Manage <b>Mở lại kỳ công</b> (bản cũ vẫn giữ).</li>
          </ol>
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void exportExcel()} className={secondaryBtn}><Download size={15} />Excel</button>
        {period.status === 'open' && board.can.review && <button type="button" disabled={busy || !monthEnded} onClick={() => void start()} className={primaryBtn}
          title={monthEnded ? undefined : 'Chờ hết tháng mới chốt được'}><ClipboardCheck size={15} />Bắt đầu chốt công</button>}
        {period.status === 'reviewing' && board.can.review && <button type="button" disabled={busy || blocking.length > 0} onClick={() => void submit()} className={primaryBtn}
          title={blocking.length ? `Còn ${blocking.length} đơn chờ duyệt` : undefined}><Send size={15} />Gửi HR Manage duyệt</button>}
        {period.status === 'submitted' && board.can.approve && !board.can.isSubmitter && <>
          <button type="button" disabled={busy} onClick={() => void sendBack()} className={secondaryBtn}><RotateCcw size={15} />Trả lại</button>
          <button type="button" disabled={busy} onClick={() => void approve()} className={primaryBtn}><ShieldCheck size={15} />Duyệt chốt</button>
        </>}
        {period.status === 'closed' && board.can.approve && <button type="button" disabled={busy} onClick={() => void reopen()} className={secondaryBtn}><RotateCcw size={15} />Mở lại kỳ công</button>}
      </div>
    </div>

    <ol aria-label="Các bước chốt công" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {STEPS.map((item, index) => {
        const current = item.status === period.status;
        const done = PERIOD_STEP[item.status] < step;
        return <li key={item.status} aria-current={current ? 'step' : undefined}
          className={`flex items-start gap-3 rounded-2xl border bg-card p-3 ${current ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-leaf-600 text-white' : current ? 'bg-teal-600 text-white' : 'bg-muted text-muted-foreground'}`}>{done ? '✓' : index + 1}</span>
          <span className="min-w-0">
            <span className={`block text-sm font-semibold ${current ? 'text-teal-800 dark:text-teal-200' : 'text-foreground'}`}>{item.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.status === 'reviewing' && current ? (issues.length ? <span className="font-semibold text-amber-700 dark:text-amber-300">{issues.length} việc cần xử lý</span> : 'đã xử lý hết')
                : item.status === 'submitted' && period.submittedAt && step >= 3 ? `${period.submittedByName} gửi ${new Date(period.submittedAt).toLocaleDateString('vi-VN')}`
                : item.status === 'closed' && period.decidedAt && step === 4 ? `${period.decidedByName} duyệt ${new Date(period.decidedAt).toLocaleDateString('vi-VN')}`
                : item.hint}
            </span>
          </span>
        </li>;
      })}
    </ol>

    {period.returnNote && period.status === 'reviewing' && <p className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <RotateCcw size={15} className="mt-0.5 shrink-0" /><span><b>{period.decidedByName || 'HR Manage'}</b> trả lại / mở lại: {period.returnNote}</span></p>}
    {period.status === 'submitted' && <p className="flex items-start gap-2 rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100">
      <ShieldCheck size={15} className="mt-0.5 shrink-0" /><span>{board.can.approve && !board.can.isSubmitter ? 'Kiểm tra tổng hợp và danh sách điều chỉnh bên dưới, rồi Duyệt chốt hoặc Trả lại.' : 'Đã gửi, đang chờ HR Manage duyệt. Trong lúc chờ không sửa được.'}</span></p>}

    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {[
        ['Nhân sự', board.employees.length, 'người trong kỳ'],
        ['Công tính lương', days(totalPayable), 'đi làm + nghỉ có lương + lễ'],
        ['Đã điều chỉnh', board.adjustments.length, 'ô ngày HR sửa'],
        ['Phản hồi chờ xem', board.feedback.filter(item => item.status === 'open').length, 'từ nhân viên'],
      ].map(([title, value, hint]) => <div key={title as string} className="rounded-xl border border-border bg-card p-3">
        <span className="block text-xs text-muted-foreground">{title}</span><span className={`block text-xl ${NUM}`}>{value}</span><span className="block text-[11px] text-muted-foreground">{hint}</span>
      </div>)}
    </div>

    {(board.can.review || board.can.approve) && <NotRequiredCard board={board} editable={board.can.review && period.status !== 'submitted' && period.status !== 'closed'} onChanged={load} />}

    {(period.status === 'reviewing' || period.status === 'submitted') && <p className="flex items-start gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
      <CalendarCheck2 size={15} className="mt-0.5 shrink-0" />
      <span>Kiểm tra ngày lễ: {board.holidays.length
        ? <>tháng này hệ thống có <b>{board.holidays.map(item => `${dateVi(item.date).slice(0, 5)} ${item.name}`).join(', ')}</b>.</>
        : <>tháng này <b>chưa khai báo ngày lễ nào</b>.</>} Thiếu ngày lễ thì ngày đó bị tính vắng — khai báo ở Chấm công → Ngày lễ trước khi gửi duyệt.</span>
    </p>}

    {(period.status === 'reviewing' || period.status === 'submitted') && issues.length > 0 && <section aria-label="Cần xử lý" className="rounded-2xl border border-amber-200 bg-card dark:border-amber-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <AlertTriangle size={16} className="text-amber-600" /><h3 className="text-sm font-semibold text-foreground">Cần xử lý</h3>
        {counts.filter(item => item.count > 0).map(item => <button key={item.kind} type="button" aria-pressed={issueKind === item.kind} onClick={() => setIssueKind(current => current === item.kind ? null : item.kind)}
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${issueKind === item.kind ? 'border-teal-500 bg-teal-600 text-white' : item.kind === 'pending' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          {ISSUE_LABEL[item.kind]} <span className="tabular-nums">{item.kind === 'absent' || item.kind === 'missing_punch' ? `${item.people} người · ${item.count} ngày` : item.count}</span></button>)}
        {blocking.length > 0 && <span className="w-full text-xs font-semibold text-rose-700 dark:text-rose-300 sm:ml-auto sm:w-auto">Còn {blocking.length} đơn chờ duyệt — chưa gửi duyệt được</span>}
      </header>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto">{grouped.slice(0, 200).map(({ first, dates }) =>
        <li key={`${first.kind}|${first.employeeId}`}><button type="button" onClick={() => first.date && setOpenCell({ employeeId: first.employeeId, date: first.date })}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
          <span className={`w-40 shrink-0 truncate ${ENT}`}>{first.employeeName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ISSUE_LABEL[first.kind]}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{dates.filter(Boolean).map(value => value.slice(8, 10)).join(', ')}{dates[0] ? ` · ` : ''}{first.label}</span>
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        </button></li>)}</ul>
    </section>}

    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
      <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Tìm nhân viên" placeholder="Tìm tên, mã, đơn vị…" className="w-full bg-transparent py-1.5 text-sm focus:outline-none" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
      </label>
      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} />Chỉ người cần xử lý</label>
      <button type="button" onClick={() => void load()} className={`${secondaryBtn} ml-auto`}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Tải lại</span></button>
    </div>

    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-max border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-card">
            <tr>
              <th className="sticky left-0 z-30 min-w-[180px] border-b border-r border-border bg-card px-2 py-2 text-left font-semibold text-muted-foreground">Nhân viên</th>
              {monthDays.map(day => <th key={day.date} className={`w-7 border-b border-border px-0 py-1 text-center font-semibold ${day.weekday === 7 ? 'text-rose-500' : 'text-muted-foreground'}`}>
                <span className="block tabular-nums">{dayNum(day.date)}</span><span className="block text-[9px] font-normal">{WEEKDAY[day.weekday]}</span></th>)}
              {['Đi làm', 'Nghỉ có lương', 'Lễ', 'KL', 'BHXH', 'Vắng', 'Thiếu chấm', 'Muộn/sớm', 'Làm thêm', 'Công tính lương'].map(title =>
                <th key={title} className={`border-b border-l border-border px-2 py-1 text-right font-semibold ${title === 'Công tính lương' ? 'text-leaf-800 dark:text-leaf-200' : 'text-muted-foreground'}`}>{title}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const t = row.timesheet.totals;
              return <tr key={row.employeeId} className="hover:bg-muted/30">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1 text-left font-normal">
                  <span className={`block truncate ${ENT}`}>{row.fullName}</span><span className="block truncate text-[10px] text-muted-foreground">{row.employeeCode}{row.orgUnitName ? ` · ${row.orgUnitName}` : ''}</span>
                </th>
                {row.timesheet.days.map(day => {
                  const symbol = daySymbol(day);
                  const key = keyOf(row.employeeId, day.date);
                  const clickable = day.status !== 'future';
                  return <td key={day.date} className={`border-b border-border p-0.5 text-center ${day.weekday === 7 ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''}`}>
                    {clickable ? <button type="button" onClick={() => setOpenCell({ employeeId: row.employeeId, date: day.date })}
                      title={`${dateVi(day.date)} · ${STATUS_TEXT[day.status] || day.status}${day.checkIn ? ` · ${day.checkIn}–${day.checkOut || '?'}` : ''}`}
                      className={`relative inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${toneOf(symbol)} ${issueCells.has(key) ? 'ring-2 ring-amber-400' : ''}`}>
                      {symbol}
                      {adjustedCells.has(key) && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-teal-500 ring-1 ring-card" aria-label="Đã điều chỉnh" />}
                    </button> : null}
                  </td>;
                })}
                {[t.workDays, t.paidLeaveDays, t.holidays, t.unpaidLeaveDays, t.insuranceLeaveDays ?? 0, t.absentDays, t.missingPunchDays].map((value, index) =>
                  <td key={index} className={`border-b border-l border-border px-2 text-right tabular-nums ${index >= 5 && value > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>{value ? days(value) : '·'}</td>)}
                <td className="border-b border-l border-border px-2 text-right tabular-nums text-foreground">{t.lateBlockMinutes + t.earlyBlockMinutes ? formatMinutes(t.lateBlockMinutes + t.earlyBlockMinutes) : '·'}</td>
                <td className="border-b border-l border-border px-2 text-right tabular-nums text-foreground">{t.overtimeApprovedMinutes ? formatMinutes(t.overtimeApprovedMinutes) : '·'}</td>
                <td className={`border-b border-l border-border px-2 text-right text-sm ${NUM}`}>{days(payableDays(t))}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        {LEGEND.map(([symbol, text]) => <span key={symbol} className="inline-flex items-center gap-1"><span className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-bold ${toneOf(symbol)}`}>{symbol}</span>{text}</span>)}
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal-500" />HR đã điều chỉnh</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded ring-2 ring-amber-400" />Cần xử lý</span>
      </div>
    </div>

    <ul className="space-y-2 md:hidden">{rows.map(row => {
      const t = row.timesheet.totals;
      const rowIssues = issues.filter(item => item.employeeId === row.employeeId);
      return <li key={row.employeeId} className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1"><span className={`block truncate ${ENT}`}>{row.fullName}</span><span className="text-xs text-muted-foreground">{row.employeeCode}</span></span>
          <span className="text-right"><span className={`block text-lg ${NUM}`}>{days(payableDays(t))}</span><span className="text-[11px] text-muted-foreground">công tính lương</span></span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Đi làm {days(t.workDays)} · Nghỉ có lương {days(t.paidLeaveDays)} · Vắng {t.absentDays} · Thiếu chấm {t.missingPunchDays}</p>
        <div className="mt-2 flex flex-wrap gap-1">{row.timesheet.days.filter(day => day.status !== 'future' && day.status !== 'off').map(day => {
          const symbol = daySymbol(day);
          const key = keyOf(row.employeeId, day.date);
          return <button key={day.date} type="button" onClick={() => setOpenCell({ employeeId: row.employeeId, date: day.date })} aria-label={`Ngày ${dateVi(day.date)}`}
            className={`relative flex h-9 w-9 flex-col items-center justify-center rounded text-[10px] font-bold ${toneOf(symbol)} ${issueCells.has(key) ? 'ring-2 ring-amber-400' : ''}`}>
            <span className="text-[8px] font-normal opacity-70">{dayNum(day.date)}</span>{symbol}
            {adjustedCells.has(key) && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-teal-500" />}
          </button>;
        })}</div>
        {rowIssues.length > 0 && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">{rowIssues.length} việc cần xử lý</p>}
      </li>;
    })}</ul>

    {board.adjustments.length > 0 && <details className="rounded-2xl border border-border bg-card p-4" open={period.status === 'submitted'}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground"><CheckCircle2 size={15} className="text-teal-600" />Điều chỉnh trong kỳ ({board.adjustments.length})</summary>
      <ul className="mt-2 divide-y divide-border">{board.adjustments.map(item => {
        const person = board.employees.find(row => row.employeeId === item.employeeId);
        return <li key={item.id}><button type="button" onClick={() => setOpenCell({ employeeId: item.employeeId, date: item.date })} className="flex w-full flex-wrap items-center gap-2 py-2 text-left text-sm hover:bg-muted/40">
          <span className={`w-40 truncate ${ENT}`}>{person?.fullName}</span>
          <span className="w-12 tabular-nums text-muted-foreground">{dateVi(item.date).slice(0, 5)}</span>
          <span className="font-semibold text-foreground">{item.kind === 'credit' ? `Công ${days(Number(item.before ?? 0))} → ${days(Number(item.value))}` : item.kind === 'excuse' ? `Miễn ${item.value} phút` : `Ghi đơn nghỉ thay${item.leaveCode ? ` ${item.leaveCode}` : ''}`}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.reason} · {item.byName}</span>
        </button></li>;
      })}</ul>
    </details>}

    {openRow && openDay && <DayDrawer key={`${openRow.employeeId}|${openDay.date}`} board={board} row={openRow} day={openDay} leaveTypes={leaveTypes} editable={editable}
      onClose={() => setOpenCell(null)} onChanged={load} />}
  </section>;
};

export default TimesheetCloseView;
