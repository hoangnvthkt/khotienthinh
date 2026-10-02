import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Download, FileClock, RefreshCw, Search, Timer, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { loadXlsx } from '../../lib/loadXlsx';
import { leaveService } from '../../lib/leaveService';
import { matchesSearchQueryMultiple } from '../../lib/searchUtils';
import { EmployeeTimesheet, formatMinutes, TimesheetDay, timesheetService } from '../../lib/timesheetService';

const WEEKDAY = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  present: { label: 'Đi làm', tone: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/30 dark:text-leaf-300' },
  missing_punch: { label: 'Thiếu lượt chấm', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' },
  absent: { label: 'Vắng', tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300' },
  leave: { label: 'Nghỉ', tone: 'bg-mint-50 text-mint-700 dark:bg-mint-900/30 dark:text-mint-300' },
  holiday: { label: 'Lễ / Tết', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300' },
  business_trip: { label: 'Công tác', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' },
  off: { label: 'Nghỉ tuần', tone: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
  off_day_work: { label: 'Làm ngày nghỉ', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' },
  future: { label: '', tone: 'text-slate-300' },
};

const monthLabel = (year: number, month: number) => `Tháng ${String(month).padStart(2, '0')}/${year}`;

/**
 * Practical timesheet (G4): late / early in 30-minute blocks, approved explanations
 * covered, extra minutes waiting to become overtime — for payroll.
 */
const AttendanceSummaryPanel: React.FC<{ myEmployeeId: string | null; isHr: boolean; onRequestMakeup?: (date: string) => void }> = ({ myEmployeeId, isHr, onRequestMakeup }) => {
  const toast = useToast();
  const reasonConfirm = useReasonConfirm();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<EmployeeTimesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await timesheetService.month(year, month));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được bảng công.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { void load(); }, [load]);

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const visible = rows.filter(row => !search || matchesSearchQueryMultiple([row.fullName, row.employeeCode, row.orgUnitName], search));
  const selected = rows.find(row => row.employeeId === selectedId) || null;
  const company = useMemo(() => rows.reduce((sum, row) => ({
    late: sum.late + row.timesheet.totals.lateBlockMinutes + row.timesheet.totals.earlyBlockMinutes,
    missing: sum.missing + row.timesheet.totals.missingPunchDays,
    extra: sum.extra + row.timesheet.totals.overtimeUnclaimedMinutes,
    overtime: sum.overtime + row.timesheet.totals.overtimeApprovedMinutes,
  }), { late: 0, missing: 0, extra: 0, overtime: 0 }), [rows]);

  const exportExcel = async () => {
    const XLSX = await loadXlsx();
    const header = ['Mã NV', 'Họ tên', 'Đơn vị', 'Công thực tế', 'Nghỉ hưởng lương', 'Nghỉ không lương', 'Lễ', 'Vắng', 'Thiếu lượt chấm',
      'Số lần muộn', 'Phút muộn (block 30)', 'Số lần về sớm', 'Phút về sớm (block 30)', 'Phút được miễn (đã duyệt)',
      'Phút dư', 'Tăng ca đã duyệt (phút)', 'Tăng ca chờ duyệt (phút)'];
    const data = rows.map(row => {
      const t = row.timesheet.totals;
      return [row.employeeCode, row.fullName, row.orgUnitName, t.workDays, t.paidLeaveDays, t.unpaidLeaveDays, t.holidays, t.absentDays,
        t.missingPunchDays, t.lateCount, t.lateBlockMinutes, t.earlyCount, t.earlyBlockMinutes, t.excusedMinutes,
        t.extraMinutes, t.overtimeApprovedMinutes, t.overtimePendingMinutes];
    });
    const detail = rows.flatMap(row => row.timesheet.days.filter(day => day.status !== 'future').map(day => [
      row.employeeCode, row.fullName, day.date, WEEKDAY[day.weekday], `${day.shiftStart}–${day.shiftEnd}`,
      day.checkIn || '', day.checkOut || '', STATUS_LABEL[day.status]?.label || day.status, day.leaveName || '',
      day.workCredit, day.lateBlock, day.earlyBlock, day.excusedLate + day.excusedEarly, day.extraMinutes,
    ]));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...data]), 'Tổng hợp');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Mã NV', 'Họ tên', 'Ngày', 'Thứ', 'Ca', 'Vào', 'Ra', 'Trạng thái', 'Loại nghỉ', 'Công', 'Muộn (block)', 'Sớm (block)', 'Được miễn', 'Phút dư'],
      ...detail,
    ]), 'Chi tiết ngày');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bang-cong-${year}-${String(month).padStart(2, '0')}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const explainLate = async (day: TimesheetDay) => {
    const late = day.lateMinutes > 0 && day.lateBlock > 0;
    const minutes = Math.min(late ? day.lateMinutes : day.earlyMinutes, 60);
    const reason = await reasonConfirm({
      title: late ? 'Giải trình đi muộn' : 'Giải trình về sớm',
      targetName: `${new Date(day.date).toLocaleDateString('vi-VN')} · ${minutes} phút`,
      subtitle: 'Trưởng bộ phận duyệt rồi HR duyệt; được duyệt thì ngày này tính đủ công.',
      reasonLabel: 'Lý do', reasonPlaceholder: 'Ví dụ: đi xử lý hồ sơ tại công trường RICO theo phân công',
      actionLabel: 'Gửi giải trình', intent: 'warning',
    });
    if (reason === null) return;
    setBusy(true);
    try {
      await leaveService.submit({ type: 'late_early', start: day.date, end: day.date, startSession: 'full', endSession: 'full',
        minutes, subtype: late ? 'Đi muộn' : 'Về sớm', reason });
      toast.success('Đã gửi giải trình', 'Theo dõi ở trang Nghỉ phép → Đơn của tôi.');
      await load();
    } catch (submitError) {
      toast.error('Chưa gửi được', submitError instanceof Error ? submitError.message : 'Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const claimOvertime = async (row: EmployeeTimesheet) => {
    const minutes = row.timesheet.totals.overtimeUnclaimedMinutes;
    const reason = await reasonConfirm({
      title: 'Xác nhận làm thêm giờ',
      targetName: `${monthLabel(year, month)} · ${formatMinutes(minutes)}`,
      subtitle: 'Số phút đến sớm / về muộn trong tháng. Trưởng bộ phận duyệt rồi HR duyệt thì thành giờ làm thêm.',
      reasonLabel: 'Nội dung công việc làm thêm', reasonPlaceholder: 'Ví dụ: đổ bê tông móng M3, nghiệm thu với chủ đầu tư',
      actionLabel: 'Gửi xác nhận', intent: 'success',
    });
    if (reason === null) return;
    setBusy(true);
    try {
      const first = `${year}-${String(month).padStart(2, '0')}-01`;
      await leaveService.submit({ type: 'overtime', start: first, end: first, startSession: 'full', endSession: 'full', minutes, subtype: null, reason });
      toast.success('Đã gửi xác nhận làm thêm giờ', 'Theo dõi ở trang Nghỉ phép → Đơn của tôi.');
      await load();
    } catch (submitError) {
      toast.error('Chưa gửi được', submitError instanceof Error ? submitError.message : 'Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-border bg-card">
          <button type="button" onClick={() => shiftMonth(-1)} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Tháng trước"><ChevronLeft size={16} /></button>
          <span className="px-2 text-sm font-black text-foreground">{monthLabel(year, month)}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Tháng sau"><ChevronRight size={16} /></button>
        </div>
        {rows.length > 1 && (
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm nhân viên, mã, đơn vị…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-8 pr-3 text-sm" />
          </div>
        )}
        <button type="button" onClick={() => void load()} className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted" aria-label="Tải lại">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        {isHr && (
          <button type="button" onClick={() => void exportExcel()} disabled={loading || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-leaf-600 px-3 py-2 text-xs font-black text-white hover:bg-leaf-700 disabled:opacity-40">
            <Download size={14} /> Xuất Excel tính lương
          </button>
        )}
      </div>

      {rows.length > 1 && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { label: 'Phút muộn + sớm (block)', value: formatMinutes(company.late), tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300', icon: Clock },
            { label: 'Ngày thiếu lượt chấm', value: company.missing, tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-300', icon: AlertTriangle },
            { label: 'Phút dư chưa xác nhận', value: formatMinutes(company.extra), tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/20 dark:text-sky-300', icon: Timer },
            { label: 'Tăng ca đã duyệt', value: formatMinutes(company.overtime), tone: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/20 dark:text-leaf-300', icon: FileClock },
          ].map(tile => (
            <div key={tile.label} className={`rounded-2xl p-3 ${tile.tone}`}>
              <tile.icon size={15} />
              <p className="mt-1 text-[11px] font-bold">{tile.label}</p>
              <p className="text-xl font-black">{loading ? '…' : tile.value}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Nhân viên</th>
              <th className="px-2 py-2 text-right">Công</th>
              <th className="px-2 py-2 text-right">Nghỉ</th>
              <th className="px-2 py-2 text-right">Vắng</th>
              <th className="px-2 py-2 text-right">Thiếu lượt</th>
              <th className="px-2 py-2 text-right">Muộn</th>
              <th className="px-2 py-2 text-right">Về sớm</th>
              <th className="px-2 py-2 text-right">Phút dư</th>
              <th className="px-2 py-2 text-right">Tăng ca duyệt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">{loading ? 'Đang tính bảng công…' : 'Không có dữ liệu tháng này.'}</td></tr>
            ) : visible.map(row => {
              const t = row.timesheet.totals;
              return (
                <tr key={row.employeeId} onClick={() => setSelectedId(row.employeeId)} className="cursor-pointer hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <p className="font-bold text-mint-700 dark:text-mint-300">{row.fullName}</p>
                    <p className="text-[11px] text-muted-foreground">{row.employeeCode} · {row.orgUnitName || 'Chưa có đơn vị'}</p>
                  </td>
                  <td className="px-2 py-2 text-right font-black text-foreground">{t.workDays}</td>
                  <td className="px-2 py-2 text-right">{t.paidLeaveDays + t.unpaidLeaveDays || '—'}</td>
                  <td className={`px-2 py-2 text-right ${t.absentDays ? 'font-bold text-rose-600' : ''}`}>{t.absentDays || '—'}</td>
                  <td className={`px-2 py-2 text-right ${t.missingPunchDays ? 'font-bold text-amber-700' : ''}`}>{t.missingPunchDays || '—'}</td>
                  <td className="px-2 py-2 text-right">{t.lateCount ? `${t.lateCount} lần · ${formatMinutes(t.lateBlockMinutes)}` : '—'}</td>
                  <td className="px-2 py-2 text-right">{t.earlyCount ? `${t.earlyCount} lần · ${formatMinutes(t.earlyBlockMinutes)}` : '—'}</td>
                  <td className="px-2 py-2 text-right">{t.extraMinutes ? formatMinutes(t.extraMinutes) : '—'}</td>
                  <td className="px-2 py-2 text-right font-bold text-leaf-700 dark:text-leaf-300">{t.overtimeApprovedMinutes ? formatMinutes(t.overtimeApprovedMinutes) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Muộn / về sớm làm tròn lên mỗi 30 phút (1–30 phút = 30, 31–60 = 60…); phần đã được duyệt giải trình không tính. Phút dư là số phút đến sớm / về muộn thực tế, cần xác nhận để thành giờ làm thêm (tối đa 40 giờ/tháng).
      </p>

      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setSelectedId(null)} />
          <div className="flex w-full max-w-2xl flex-col bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border p-4">
              <div>
                <p className="text-[11px] text-muted-foreground">{monthLabel(year, month)} · {selected.employeeCode}</p>
                <h2 className="text-lg font-black text-mint-700 dark:text-mint-300">{selected.fullName}</h2>
                <p className="text-xs text-muted-foreground">
                  {selected.timesheet.totals.workDays} công · nghỉ {selected.timesheet.totals.paidLeaveDays + selected.timesheet.totals.unpaidLeaveDays} ·
                  muộn {formatMinutes(selected.timesheet.totals.lateBlockMinutes)} · sớm {formatMinutes(selected.timesheet.totals.earlyBlockMinutes)} ·
                  dư {formatMinutes(selected.timesheet.totals.extraMinutes)}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-xl p-2 hover:bg-muted" aria-label="Đóng"><X size={18} /></button>
            </div>
            {selected.employeeId === myEmployeeId && selected.timesheet.totals.overtimeUnclaimedMinutes > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-sky-50 px-4 py-3 dark:bg-sky-950/20">
                <Timer size={16} className="text-sky-700 dark:text-sky-300" />
                <p className="flex-1 text-xs font-bold text-sky-800 dark:text-sky-200">
                  Bạn có {formatMinutes(selected.timesheet.totals.overtimeUnclaimedMinutes)} đến sớm / về muộn chưa xác nhận làm thêm giờ.
                </p>
                <button type="button" disabled={busy} onClick={() => void claimOvertime(selected)}
                  className="rounded-xl bg-leaf-600 px-3 py-1.5 text-xs font-black text-white hover:bg-leaf-700 disabled:opacity-50">
                  Xác nhận làm thêm
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ngày</th>
                    <th className="px-2 py-2 text-left">Ca</th>
                    <th className="px-2 py-2 text-left">Vào – Ra</th>
                    <th className="px-2 py-2 text-left">Trạng thái</th>
                    <th className="px-2 py-2 text-right">Muộn / sớm</th>
                    <th className="px-2 py-2 text-right">Dư</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selected.timesheet.days.filter(day => day.status !== 'future').map(day => {
                    const status = STATUS_LABEL[day.status] || { label: day.status, tone: 'bg-slate-100 text-slate-600' };
                    const canExplain = selected.employeeId === myEmployeeId && (day.lateBlock > 0 || day.earlyBlock > 0);
                    return (
                      <tr key={day.date} className={day.weekday === 7 ? 'bg-muted/30' : ''}>
                        <td className="whitespace-nowrap px-3 py-2 font-bold text-foreground">{WEEKDAY[day.weekday]} {new Date(day.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{day.shiftStart}–{day.shiftEnd}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-foreground">{day.checkIn || '--:--'} – {day.checkOut || '--:--'}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${status.tone}`}>
                            {day.leaveName ? `${day.leaveName}${day.leavePart && day.leavePart !== 'full' ? (day.leavePart === 'morning' ? ' (sáng)' : ' (chiều)') : ''}` : status.label}
                          </span>
                          {day.flags.filter(flag => flag !== 'no_passkey').length > 0 && <span className="ml-1 text-[10px] font-bold text-rose-600">nghi vấn</span>}
                          {day.status === 'missing_punch' && selected.employeeId === myEmployeeId && onRequestMakeup && (
                            <button type="button" onClick={() => { setSelectedId(null); onRequestMakeup(day.date); }}
                              className="ml-2 rounded-lg border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-50">
                              Bù công
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          {day.lateBlock > 0 && <span className="font-bold text-amber-700">M {day.lateBlock}p</span>}
                          {day.earlyBlock > 0 && <span className="ml-1 font-bold text-amber-700">S {day.earlyBlock}p</span>}
                          {day.excusedLate + day.excusedEarly > 0 && <span className="ml-1 text-leaf-700">miễn {day.excusedLate + day.excusedEarly}p</span>}
                          {canExplain && (
                            <button type="button" disabled={busy} onClick={() => void explainLate(day)}
                              className="ml-2 rounded-lg border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                              Giải trình
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-sky-700 dark:text-sky-300">{day.extraMinutes ? `${day.extraMinutes}p` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceSummaryPanel;
