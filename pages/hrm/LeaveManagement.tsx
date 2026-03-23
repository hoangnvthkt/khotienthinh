import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  CalendarOff, Plus, CheckCircle, XCircle, Clock, Search, Filter,
  Calendar, ChevronDown, AlertTriangle, RotateCcw
} from 'lucide-react';
import {
  LeaveType, LeaveRequest, LeaveRequestStatus,
  LEAVE_TYPE_LABELS
} from '../../types';

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã huỷ',
};
const STATUS_COLORS: Record<LeaveRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const LeaveManagement: React.FC = () => {
  const { employees, leaveRequests, leaveBalances, attendanceRecords, holidays, addHrmItem, updateHrmItem, removeHrmItem, user } = useApp();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchText, setSearchText] = useState('');

  // Form state
  const [formEmployee, setFormEmployee] = useState('');
  const [formType, setFormType] = useState<LeaveType>('annual');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formHalfDay, setFormHalfDay] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  // Calculate total days (skip weekends + holidays)
  const calcDays = (start: string, end: string, isHalfDay: boolean = false): number => {
    if (!start || !end) return 0;
    if (isHalfDay) return 0.5;
    const s = new Date(start);
    const e = new Date(end);
    const holidayDates = new Set(holidays.map(h => h.date));
    let days = 0;
    const cur = new Date(s);
    while (cur <= e) {
      const dow = cur.getDay();
      const dateStr = cur.toISOString().split('T')[0];
      if (dow !== 0 && dow !== 6 && !holidayDates.has(dateStr)) days++;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  };

  // Filter
  const filtered = useMemo(() => {
    let list = [...leaveRequests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filterStatus) list = list.filter(r => r.status === filterStatus);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(r => {
        const emp = employeeMap.get(r.employeeId);
        return emp?.fullName.toLowerCase().includes(q) || emp?.employeeCode.toLowerCase().includes(q);
      });
    }
    return list;
  }, [leaveRequests, filterStatus, searchText, employeeMap]);

  // Leave balance per employee (current year) — from leaveBalances context
  const currentYear = new Date().getFullYear();
  const balanceMap = useMemo(() => {
    const map = new Map<string, { total: number; accrued: number; used: number; pending: number; remaining: number }>();
    activeEmployees.forEach(e => {
      const bal = leaveBalances.find(b => b.employeeId === e.id && b.year === currentYear);
      const accrued = bal ? bal.accruedDays : 0;
      const used = bal ? bal.usedPaidDays : 0;
      const total = bal ? bal.initialDays : 12;
      // Also count pending requests
      const pendingDays = leaveRequests
        .filter(r => r.employeeId === e.id && r.type === 'annual' && r.status === 'pending' && new Date(r.startDate).getFullYear() === currentYear)
        .reduce((sum, r) => sum + r.totalDays, 0);
      map.set(e.id, { total, accrued, used, pending: pendingDays, remaining: accrued - used - pendingDays });
    });
    return map;
  }, [activeEmployees, leaveRequests, leaveBalances, currentYear]);

  // Summary KPIs
  const summaryKPIs = useMemo(() => {
    const pending = leaveRequests.filter(r => r.status === 'pending').length;
    const approved = leaveRequests.filter(r => r.status === 'approved' && new Date(r.startDate).getFullYear() === currentYear).length;
    const totalDaysUsed = leaveRequests
      .filter(r => r.status === 'approved' && new Date(r.startDate).getFullYear() === currentYear)
      .reduce((sum, r) => sum + r.totalDays, 0);
    return { pending, approved, totalDaysUsed };
  }, [leaveRequests, currentYear]);

  const handleSubmit = () => {
    setFormSubmitted(true);
    
    // Validate required fields with feedback
    if (!formEmployee) {
      setSubmitError('Vui lòng chọn nhân viên.');
      return;
    }
    if (!formStart || !formEnd) {
      setSubmitError('Vui lòng chọn ngày bắt đầu và kết thúc.');
      return;
    }
    if (!formReason.trim()) {
      setSubmitError('Vui lòng nhập lý do nghỉ phép.');
      return;
    }
    
    const totalDays = calcDays(formStart, formEnd, formHalfDay);
    if (totalDays <= 0) {
      setSubmitError('Khoảng thời gian không hợp lệ (0 ngày làm việc).');
      return;
    }

    // Kiểm tra số ngày phép còn lại nếu là phép năm
    if (formType === 'annual') {
      const bal = balanceMap.get(formEmployee);
      const remaining = bal ? bal.remaining : 0;
      if (totalDays > remaining) {
        setSubmitError(`Không đủ ngày phép! Còn lại: ${remaining} ngày, yêu cầu: ${totalDays} ngày.`);
        return;
      }
    }

    setSubmitError('');
    const newReq: LeaveRequest = {
      id: crypto.randomUUID(),
      employeeId: formEmployee,
      type: formType,
      startDate: formStart,
      endDate: formEnd,
      totalDays,
      reason: formReason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    addHrmItem('hrm_leave_requests', newReq);
    setShowModal(false);
    setFormEmployee(''); setFormStart(''); setFormEnd(''); setFormReason(''); setFormHalfDay(false); setSubmitError(''); setFormSubmitted(false);
    // Show success toast
    const emp = employeeMap.get(formEmployee);
    setSuccessMsg(`Đã gửi đơn nghỉ phép ${totalDays} ngày cho ${emp?.fullName || 'NV'}!`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleApprove = (req: LeaveRequest) => {
    updateHrmItem('hrm_leave_requests', { ...req, status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString() });
    // Tự động trừ ngày phép
    const bal = leaveBalances.find(b => b.employeeId === req.employeeId && b.year === currentYear);
    if (bal) {
      if (req.type === 'unpaid') {
        updateHrmItem('hrm_leave_balances', { ...bal, usedUnpaidDays: bal.usedUnpaidDays + req.totalDays });
      } else {
        updateHrmItem('hrm_leave_balances', { ...bal, usedPaidDays: bal.usedPaidDays + req.totalDays });
      }
    }
    // Tự động đánh dấu chấm công = 'leave' cho các ngày trong đơn (bỏ qua T7/CN)
    const start = new Date(req.startDate);
    const end = new Date(req.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        const dateStr = cur.toISOString().split('T')[0];
        const existingRec = attendanceRecords.find(r => r.employeeId === req.employeeId && r.date === dateStr);
        if (existingRec) {
          // Update existing record to 'leave'
          updateHrmItem('hrm_attendance', { ...existingRec, status: 'leave' });
        } else {
          // Create new record
          addHrmItem('hrm_attendance', {
            id: crypto.randomUUID(),
            employeeId: req.employeeId,
            date: dateStr,
            status: 'leave' as any,
            note: `Nghỉ phép: ${req.reason}`,
            createdAt: new Date().toISOString(),
          });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  };

  const handleReject = (req: LeaveRequest) => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    updateHrmItem('hrm_leave_requests', { ...req, status: 'rejected', approvedBy: user.id, approvedAt: new Date().toISOString(), rejectionReason: reason });
  };

  // Thu hồi đơn đã duyệt: hoàn phép + xoá attendance
  const handleRevoke = (req: LeaveRequest) => {
    if (!confirm(`Thu hồi đơn nghỉ phép ${req.totalDays} ngày của NV? Sẽ hoàn lại ngày phép và xoá chấm công.`)) return;
    // 1. Update status
    updateHrmItem('hrm_leave_requests', { ...req, status: 'cancelled' as any });
    // 2. Restore leave balance
    const bal = leaveBalances.find(b => b.employeeId === req.employeeId && b.year === currentYear);
    if (bal) {
      if (req.type === 'unpaid') {
        updateHrmItem('hrm_leave_balances', { ...bal, usedUnpaidDays: Math.max(0, bal.usedUnpaidDays - req.totalDays) });
      } else {
        updateHrmItem('hrm_leave_balances', { ...bal, usedPaidDays: Math.max(0, bal.usedPaidDays - req.totalDays) });
      }
    }
    // 3. Remove attendance 'leave' records for these dates
    const start = new Date(req.startDate);
    const end = new Date(req.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      const rec = attendanceRecords.find(r => r.employeeId === req.employeeId && r.date === dateStr && r.status === 'leave');
      if (rec) removeHrmItem('hrm_attendance', rec.id);
      cur.setDate(cur.getDate() + 1);
    }
  };

  return (
    <div className="space-y-4">
      {/* Success Toast */}
      {successMsg && (
        <div className="fixed top-6 right-6 z-[60] bg-emerald-500 text-white px-5 py-3 rounded-2xl shadow-2xl shadow-emerald-500/30 text-sm font-black flex items-center gap-2 animate-fade-in">
          <CheckCircle size={18} /> {successMsg}
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <CalendarOff className="text-blue-500" size={24} /> Quản lý Nghỉ phép
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Đăng ký, phê duyệt nghỉ phép nhân viên</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition flex items-center gap-1.5">
          <Plus size={16} /> Đăng ký nghỉ
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Chờ duyệt</p>
          <p className="text-xl font-black text-amber-500">{summaryKPIs.pending}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đã duyệt ({currentYear})</p>
          <p className="text-xl font-black text-emerald-600">{summaryKPIs.approved}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng ngày phép đã dùng</p>
          <p className="text-xl font-black text-blue-500">{summaryKPIs.totalDaysUsed}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm NV..." value={searchText} onChange={e => setSearchText(e.target.value)}
            className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-40" />
        </div>
      </div>

      {/* Leave Request List */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarOff size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-black text-slate-400">Chưa có đơn nghỉ phép</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map(req => {
              const emp = employeeMap.get(req.employeeId);
              return (
                <div key={req.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-black shrink-0">
                      {emp?.fullName.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-800 dark:text-white truncate">{emp?.fullName || 'N/A'}</div>
                      <div className="text-[10px] font-mono text-slate-400">{emp?.employeeCode} • {LEAVE_TYPE_LABELS[req.type]}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 font-bold">Từ:</span> <span className="font-black text-slate-700 dark:text-slate-300">{new Date(req.startDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold">Đến:</span> <span className="font-black text-slate-700 dark:text-slate-300">{new Date(req.endDate).toLocaleDateString('vi-VN')}</span>
                    </div>
                    <div className="font-black text-blue-600">{req.totalDays} ngày</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${STATUS_COLORS[req.status]}`}>
                      {STATUS_LABELS[req.status]}
                    </span>
                    {req.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleApprove(req)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition">
                          <CheckCircle size={14} />
                        </button>
                        <button onClick={() => handleReject(req)} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition">
                          <XCircle size={14} />
                        </button>
                      </div>
                    )}
                    {req.status === 'approved' && (
                      <button onClick={() => handleRevoke(req)} className="p-1.5 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 transition" title="Thu hồi đơn">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">Đăng ký nghỉ phép</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Nhân viên</label>
                <select value={formEmployee} onChange={e => { setFormEmployee(e.target.value); setSubmitError(''); }}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white dark:bg-slate-800 outline-none ${formSubmitted && !formEmployee ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 dark:border-slate-700'}`}>
                  <option value="">Chọn nhân viên</option>
                  {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName}</option>)}
                </select>
                {formSubmitted && !formEmployee && <p className="text-[10px] text-red-500 font-bold mt-1">⚠ Bắt buộc chọn nhân viên</p>}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Loại phép</label>
                <select value={formType} onChange={e => setFormType(e.target.value as LeaveType)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {formEmployee && (
                (() => {
                  const bal = balanceMap.get(formEmployee);
                  const remaining = bal ? bal.remaining : 0;
                  const accrued = bal ? bal.accrued : 0;
                  const isInsufficient = formType === 'annual' && remaining <= 0;
                  return (
                    <div className={`p-3 rounded-xl ${isInsufficient ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30' : 'bg-blue-50 dark:bg-blue-950/20'}`}>
                      <p className={`text-[10px] font-black uppercase ${isInsufficient ? 'text-red-500' : 'text-blue-500'}`}>Phép năm còn lại</p>
                      <p className={`text-lg font-black ${isInsufficient ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300'}`}>
                        {remaining} / {accrued} ngày tích lũy
                      </p>
                      {isInsufficient && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs font-bold text-red-600 dark:text-red-400">
                          <AlertTriangle size={14} /> Hết ngày phép! Không thể đăng ký phép năm.
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Từ ngày</label>
                  <input type="date" value={formStart} onChange={e => { setFormStart(e.target.value); setSubmitError(''); }}
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white dark:bg-slate-800 outline-none ${formSubmitted && !formStart ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 dark:border-slate-700'}`} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Đến ngày</label>
                  <input type="date" value={formEnd} onChange={e => { setFormEnd(e.target.value); setSubmitError(''); }}
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white dark:bg-slate-800 outline-none ${formSubmitted && !formEnd ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 dark:border-slate-700'}`} />
                </div>
              </div>
              {formStart && formEnd && (
                <div className="text-sm font-black text-slate-600 dark:text-slate-300">
                  Tổng: <span className="text-blue-600">{calcDays(formStart, formEnd, formHalfDay)}</span> ngày làm việc
                  {holidays.filter(h => {
                    return h.date >= formStart && h.date <= formEnd;
                  }).length > 0 && (
                    <span className="text-[10px] text-amber-500 ml-2">(đã trừ ngày lễ)</span>
                  )}
                </div>
              )}
              {/* Half-day option */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formHalfDay} onChange={e => {
                  setFormHalfDay(e.target.checked);
                  if (e.target.checked && formStart) setFormEnd(formStart);
                }} className="w-4 h-4 rounded-md border-slate-300 text-blue-500 focus:ring-blue-500" />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Nghỉ nửa ngày (0.5 ngày)</span>
              </label>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Lý do</label>
                <textarea value={formReason} onChange={e => { setFormReason(e.target.value); setSubmitError(''); }} rows={2}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white dark:bg-slate-800 outline-none resize-none ${formSubmitted && !formReason.trim() ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200 dark:border-slate-700'}`}
                  placeholder="Nhập lý do nghỉ..." />
                {formSubmitted && !formReason.trim() && <p className="text-[10px] text-red-500 font-bold mt-1">⚠ Bắt buộc nhập lý do</p>}
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
              {submitError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-xs font-bold">
                  <AlertTriangle size={16} /> {submitError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowModal(false); setSubmitError(''); setFormSubmitted(false); }} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                <button onClick={handleSubmit} className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition">
                  Gửi đơn
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManagement;
