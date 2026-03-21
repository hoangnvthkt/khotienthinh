import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  CalendarOff, Plus, CheckCircle, XCircle, Clock, Search, Filter,
  Calendar, ChevronDown, AlertTriangle, Settings, Users
} from 'lucide-react';
import {
  LeaveType, LeaveRequest, LeaveRequestStatus, LeaveBalance,
  LEAVE_TYPE_LABELS, PAID_LEAVE_TYPES, UNPAID_LEAVE_TYPES, isLeaveTypePaid
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

const LEAVE_CATEGORY_LABELS = {
  paid: '🟢 Nghỉ có lương',
  unpaid: '🔴 Nghỉ không lương',
};

const LeaveManagement: React.FC = () => {
  const { employees, leaveRequests, leaveBalances, attendanceRecords, addHrmItem, updateHrmItem, user } = useApp();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [showModal, setShowModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<'requests' | 'balances'>('requests');

  // Form state
  const [formEmployee, setFormEmployee] = useState('');
  const [formType, setFormType] = useState<LeaveType>('annual');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formReason, setFormReason] = useState('');

  // Balance config modal state
  const [balanceEmployee, setBalanceEmployee] = useState('');
  const [balanceInitialDays, setBalanceInitialDays] = useState(12);
  const [balanceMonthlyAccrual, setBalanceMonthlyAccrual] = useState(1);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // Calculate total working days (skip weekends)
  const calcDays = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    let days = 0;
    const cur = new Date(s);
    while (cur <= e) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) days++;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  };

  // Get or compute leave balance for an employee in current year
  const getBalance = useCallback((employeeId: string): LeaveBalance | null => {
    return leaveBalances.find(b => b.employeeId === employeeId && b.year === currentYear) || null;
  }, [leaveBalances, currentYear]);

  // Compute remaining paid leave days
  const getRemainingPaidDays = useCallback((employeeId: string): number => {
    const balance = getBalance(employeeId);
    if (!balance) return 0;
    // Available = min(accruedDays, initialDays) - usedPaidDays
    // Accrued days are capped at initialDays max
    const available = Math.min(balance.accruedDays, balance.initialDays);
    // Also count pending paid leave
    const pendingPaid = leaveRequests
      .filter(r => r.employeeId === employeeId && r.status === 'pending' && r.isPaid && new Date(r.startDate).getFullYear() === currentYear)
      .reduce((sum, r) => sum + r.totalDays, 0);
    return available - balance.usedPaidDays - pendingPaid;
  }, [getBalance, leaveRequests, currentYear]);

  // Auto-accrue monthly leave balances (run on render, idempotent)
  useMemo(() => {
    leaveBalances.forEach(balance => {
      if (balance.year === currentYear && balance.lastAccrualMonth < currentMonth) {
        // Accrue months from lastAccrualMonth+1 to currentMonth
        const monthsToAccrue = currentMonth - balance.lastAccrualMonth;
        const newAccrued = Math.min(
          balance.accruedDays + (monthsToAccrue * balance.monthlyAccrual),
          balance.initialDays
        );
        updateHrmItem('hrm_leave_balances', {
          ...balance,
          accruedDays: newAccrued,
          lastAccrualMonth: currentMonth,
        });
      }
    });
  }, [leaveBalances, currentMonth, currentYear]);

  // Filter leave requests
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

  // Summary KPIs
  const summaryKPIs = useMemo(() => {
    const pending = leaveRequests.filter(r => r.status === 'pending').length;
    const approvedPaid = leaveRequests
      .filter(r => r.status === 'approved' && r.isPaid && new Date(r.startDate).getFullYear() === currentYear).length;
    const approvedUnpaid = leaveRequests
      .filter(r => r.status === 'approved' && !r.isPaid && new Date(r.startDate).getFullYear() === currentYear).length;
    const totalDaysUsed = leaveRequests
      .filter(r => r.status === 'approved' && new Date(r.startDate).getFullYear() === currentYear)
      .reduce((sum, r) => sum + r.totalDays, 0);
    return { pending, approvedPaid, approvedUnpaid, totalDaysUsed };
  }, [leaveRequests, currentYear]);

  // Handle form submit
  const handleSubmit = () => {
    if (!formEmployee || !formStart || !formEnd || !formReason) return;
    const totalDays = calcDays(formStart, formEnd);
    if (totalDays <= 0) return;

    const isPaid = isLeaveTypePaid(formType);

    // Check if balance exists for the employee
    if (isPaid) {
      const remaining = getRemainingPaidDays(formEmployee);
      if (remaining < totalDays) {
        const switchToUnpaid = confirm(
          `⚠️ Nhân viên chỉ còn ${Math.max(0, remaining)} ngày phép có lương.\n\n` +
          `Bạn đang đăng ký ${totalDays} ngày.\n\n` +
          `Bạn có muốn chuyển sang "Nghỉ không lương" không?\n\n` +
          `• OK = Chuyển sang nghỉ không lương\n` +
          `• Cancel = Huỷ đăng ký`
        );
        if (switchToUnpaid) {
          // Switch to unpaid
          const newReq: LeaveRequest = {
            id: crypto.randomUUID(),
            employeeId: formEmployee,
            type: 'unpaid',
            isPaid: false,
            startDate: formStart,
            endDate: formEnd,
            totalDays,
            reason: formReason,
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          addHrmItem('hrm_leave_requests', newReq);
          setShowModal(false);
          resetForm();
          return;
        } else {
          return; // Cancel
        }
      }
    }

    const newReq: LeaveRequest = {
      id: crypto.randomUUID(),
      employeeId: formEmployee,
      type: formType,
      isPaid,
      startDate: formStart,
      endDate: formEnd,
      totalDays,
      reason: formReason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    addHrmItem('hrm_leave_requests', newReq);
    setShowModal(false);
    resetForm();
  };

  const resetForm = () => {
    setFormEmployee(''); setFormStart(''); setFormEnd(''); setFormReason('');
    setFormType('annual');
  };

  // Approve leave request
  const handleApprove = (req: LeaveRequest) => {
    // 1. Update leave request status
    updateHrmItem('hrm_leave_requests', { ...req, status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString() });

    // 2. Update leave balance
    const balance = getBalance(req.employeeId);
    if (balance) {
      if (req.isPaid) {
        updateHrmItem('hrm_leave_balances', { ...balance, usedPaidDays: balance.usedPaidDays + req.totalDays });
      } else {
        updateHrmItem('hrm_leave_balances', { ...balance, usedUnpaidDays: balance.usedUnpaidDays + req.totalDays });
      }
    }

    // 3. Auto-create attendance records for each weekday in the leave period
    const start = new Date(req.startDate);
    const end = new Date(req.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        const dateStr = cur.toISOString().split('T')[0];
        const existing = attendanceRecords.find(a => a.employeeId === req.employeeId && a.date === dateStr);
        if (existing) {
          updateHrmItem('hrm_attendance', { ...existing, status: 'leave', note: `Nghỉ phép: ${LEAVE_TYPE_LABELS[req.type]}` });
        } else {
          addHrmItem('hrm_attendance', {
            id: crypto.randomUUID(),
            employeeId: req.employeeId,
            date: dateStr,
            status: 'leave',
            note: `Nghỉ phép: ${LEAVE_TYPE_LABELS[req.type]}`,
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

  // Create or update leave balance for an employee
  const handleSaveBalance = () => {
    if (!balanceEmployee) return;
    const existing = getBalance(balanceEmployee);
    if (existing) {
      updateHrmItem('hrm_leave_balances', {
        ...existing,
        initialDays: balanceInitialDays,
        monthlyAccrual: balanceMonthlyAccrual,
        accruedDays: Math.min(existing.accruedDays, balanceInitialDays),
      });
    } else {
      // New balance: accrue from month 1 to current month
      const accruedDays = Math.min(currentMonth * balanceMonthlyAccrual, balanceInitialDays);
      addHrmItem('hrm_leave_balances', {
        id: crypto.randomUUID(),
        employeeId: balanceEmployee,
        year: currentYear,
        initialDays: balanceInitialDays,
        monthlyAccrual: balanceMonthlyAccrual,
        accruedDays,
        usedPaidDays: 0,
        usedUnpaidDays: 0,
        lastAccrualMonth: currentMonth,
        createdAt: new Date().toISOString(),
      });
    }
    setShowBalanceModal(false);
    setBalanceEmployee('');
  };

  // Create balances for all employees who don't have one yet
  const handleInitAllBalances = () => {
    const count = activeEmployees.filter(e => !getBalance(e.id)).length;
    if (count === 0) { alert('Tất cả nhân viên đã có khai báo ngày phép.'); return; }
    if (!confirm(`Tạo khai báo phép năm cho ${count} nhân viên (${balanceInitialDays} ngày/năm, +${balanceMonthlyAccrual}/tháng)?`)) return;
    activeEmployees.forEach(e => {
      if (!getBalance(e.id)) {
        const accruedDays = Math.min(currentMonth * balanceMonthlyAccrual, balanceInitialDays);
        addHrmItem('hrm_leave_balances', {
          id: crypto.randomUUID(),
          employeeId: e.id,
          year: currentYear,
          initialDays: balanceInitialDays,
          monthlyAccrual: balanceMonthlyAccrual,
          accruedDays,
          usedPaidDays: 0,
          usedUnpaidDays: 0,
          lastAccrualMonth: currentMonth,
          createdAt: new Date().toISOString(),
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <CalendarOff className="text-blue-500" size={24} /> Quản lý Nghỉ phép
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Đăng ký, phê duyệt nghỉ phép nhân viên — Có lương & Không lương</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBalanceModal(true)} className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center gap-1.5 border border-slate-200 dark:border-slate-700">
            <Settings size={14} /> Khai báo ngày phép
          </button>
          <button onClick={() => setShowModal(true)} className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition flex items-center gap-1.5">
            <Plus size={16} /> Đăng ký nghỉ
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Chờ duyệt</p>
          <p className="text-xl font-black text-amber-500">{summaryKPIs.pending}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Có lương ({currentYear})</p>
          <p className="text-xl font-black text-emerald-600">{summaryKPIs.approvedPaid}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Không lương ({currentYear})</p>
          <p className="text-xl font-black text-red-500">{summaryKPIs.approvedUnpaid}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng ngày đã nghỉ</p>
          <p className="text-xl font-black text-blue-500">{summaryKPIs.totalDaysUsed}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
        <button onClick={() => setActiveTab('requests')}
          className={`flex-1 py-2 text-xs font-black rounded-lg transition ${activeTab === 'requests' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow' : 'text-slate-500'}`}>
          Đơn nghỉ phép
        </button>
        <button onClick={() => setActiveTab('balances')}
          className={`flex-1 py-2 text-xs font-black rounded-lg transition ${activeTab === 'balances' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow' : 'text-slate-500'}`}>
          Ngày phép nhân viên
        </button>
      </div>

      {activeTab === 'requests' && (
        <>
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
                          <div className="text-[10px] font-mono text-slate-400">
                            {emp?.employeeCode} • {LEAVE_TYPE_LABELS[req.type]}
                            {req.isPaid !== undefined && (
                              <span className={`ml-1 ${req.isPaid ? 'text-emerald-500' : 'text-red-400'}`}>
                                ({req.isPaid ? 'Có lương' : 'Không lương'})
                              </span>
                            )}
                          </div>
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
                            <button onClick={() => handleApprove(req)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition" title="Duyệt">
                              <CheckCircle size={14} />
                            </button>
                            <button onClick={() => handleReject(req)} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition" title="Từ chối">
                              <XCircle size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'balances' && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-800 dark:text-white">Ngày phép năm {currentYear}</h3>
            <button onClick={handleInitAllBalances}
              className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-lg text-[10px] font-black hover:bg-blue-100 transition flex items-center gap-1">
              <Users size={12} /> Khởi tạo tất cả NV
            </button>
          </div>
          {leaveBalances.filter(b => b.year === currentYear).length === 0 ? (
            <div className="py-16 text-center">
              <Calendar size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-black text-slate-400">Chưa khai báo ngày phép</p>
              <p className="text-xs text-slate-400 mt-1">Bấm "Khai báo ngày phép" hoặc "Khởi tạo tất cả NV" để bắt đầu</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left p-3 font-black text-slate-500 uppercase tracking-widest">Nhân viên</th>
                    <th className="text-center p-3 font-black text-slate-500 uppercase tracking-widest">Phép năm</th>
                    <th className="text-center p-3 font-black text-slate-500 uppercase tracking-widest">+/Tháng</th>
                    <th className="text-center p-3 font-black text-slate-500 uppercase tracking-widest">Đã tích luỹ</th>
                    <th className="text-center p-3 font-black text-emerald-500 uppercase tracking-widest">Có lương đã dùng</th>
                    <th className="text-center p-3 font-black text-red-500 uppercase tracking-widest">Không lương đã dùng</th>
                    <th className="text-center p-3 font-black text-blue-500 uppercase tracking-widest">Còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {leaveBalances.filter(b => b.year === currentYear).map(balance => {
                    const emp = employeeMap.get(balance.employeeId);
                    const remaining = Math.max(0, Math.min(balance.accruedDays, balance.initialDays) - balance.usedPaidDays);
                    return (
                      <tr key={balance.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                              {emp?.fullName.charAt(0) || '?'}
                            </div>
                            <div>
                              <div className="font-black text-slate-800 dark:text-white">{emp?.fullName || 'N/A'}</div>
                              <div className="text-[10px] font-mono text-slate-400">{emp?.employeeCode}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-center font-black">{balance.initialDays}</td>
                        <td className="p-3 text-center font-bold text-slate-500">+{balance.monthlyAccrual}</td>
                        <td className="p-3 text-center font-black text-slate-700 dark:text-slate-300">{balance.accruedDays}</td>
                        <td className="p-3 text-center font-black text-emerald-600">{balance.usedPaidDays}</td>
                        <td className="p-3 text-center font-black text-red-500">{balance.usedUnpaidDays}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-lg font-black ${remaining > 3 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : remaining > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {remaining}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Leave Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">Đăng ký nghỉ phép</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Nhân viên</label>
                <select value={formEmployee} onChange={e => setFormEmployee(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <option value="">Chọn nhân viên</option>
                  {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName}</option>)}
                </select>
              </div>

              {/* Leave type grouped by paid/unpaid */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Loại nghỉ phép</label>
                <select value={formType} onChange={e => setFormType(e.target.value as LeaveType)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <optgroup label="🟢 Nghỉ có lương">
                    {PAID_LEAVE_TYPES.map(k => <option key={k} value={k}>{LEAVE_TYPE_LABELS[k]}</option>)}
                  </optgroup>
                  <optgroup label="🔴 Nghỉ không lương">
                    {UNPAID_LEAVE_TYPES.map(k => <option key={k} value={k}>{LEAVE_TYPE_LABELS[k]}</option>)}
                  </optgroup>
                </select>
              </div>

              {/* Leave balance display */}
              {formEmployee && (
                <div className={`p-3 rounded-xl ${isLeaveTypePaid(formType) ? 'bg-blue-50 dark:bg-blue-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
                  <p className={`text-[10px] font-black uppercase ${isLeaveTypePaid(formType) ? 'text-blue-500' : 'text-red-500'}`}>
                    {isLeaveTypePaid(formType) ? 'Phép có lương còn lại' : 'Nghỉ không lương (không giới hạn)'}
                  </p>
                  {isLeaveTypePaid(formType) ? (
                    (() => {
                      const balance = getBalance(formEmployee);
                      const remaining = getRemainingPaidDays(formEmployee);
                      if (!balance) return (
                        <div className="flex items-center gap-1 mt-1">
                          <AlertTriangle size={14} className="text-amber-500" />
                          <p className="text-xs font-black text-amber-600">Chưa khai báo ngày phép cho NV này</p>
                        </div>
                      );
                      return (
                        <p className={`text-lg font-black ${remaining > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-red-600'}`}>
                          {remaining} / {balance.initialDays} ngày
                          {remaining <= 0 && <span className="text-xs ml-2 text-red-500">⚠️ Hết phép!</span>}
                        </p>
                      );
                    })()
                  ) : (
                    <p className="text-lg font-black text-red-600 dark:text-red-400">∞</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Từ ngày</label>
                  <input type="date" value={formStart} onChange={e => setFormStart(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Đến ngày</label>
                  <input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
              </div>
              {formStart && formEnd && (
                <div className="text-sm font-black text-slate-600 dark:text-slate-300">
                  Tổng: <span className="text-blue-600">{calcDays(formStart, formEnd)}</span> ngày làm việc
                </div>
              )}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Lý do</label>
                <textarea value={formReason} onChange={e => setFormReason(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none resize-none"
                  placeholder="Nhập lý do nghỉ..." />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => { setShowModal(false); resetForm(); }} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={handleSubmit} className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition">
                Gửi đơn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Balance Config Modal */}
      {showBalanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">Khai báo ngày phép năm {currentYear}</h3>
              <p className="text-xs text-slate-400 mt-1">Thiết lập số phép năm và tốc độ tích luỹ cho nhân viên</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Nhân viên</label>
                <select value={balanceEmployee} onChange={e => {
                  setBalanceEmployee(e.target.value);
                  const existing = leaveBalances.find(b => b.employeeId === e.target.value && b.year === currentYear);
                  if (existing) {
                    setBalanceInitialDays(existing.initialDays);
                    setBalanceMonthlyAccrual(existing.monthlyAccrual);
                  }
                }}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <option value="">Chọn nhân viên</option>
                  {activeEmployees.map(e => {
                    const has = getBalance(e.id);
                    return <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName} {has ? '✅' : ''}</option>;
                  })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Tổng phép năm</label>
                  <input type="number" value={balanceInitialDays} onChange={e => setBalanceInitialDays(Number(e.target.value))}
                    min={0} max={365}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none text-center font-black" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Cộng mỗi tháng</label>
                  <input type="number" value={balanceMonthlyAccrual} onChange={e => setBalanceMonthlyAccrual(Number(e.target.value))}
                    min={0} max={30} step={0.5}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none text-center font-black" />
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-xs text-slate-500">
                <p><strong>Quy tắc:</strong></p>
                <ul className="list-disc pl-4 space-y-1 mt-1">
                  <li>Mỗi ngày 1 hàng tháng, hệ thống tự cộng <strong>{balanceMonthlyAccrual}</strong> ngày phép</li>
                  <li>Phép tích luỹ tối đa: <strong>{balanceInitialDays}</strong> ngày/năm</li>
                  <li>Khi duyệt nghỉ "Có lương" → trừ vào phép còn lại</li>
                  <li>Nghỉ "Không lương" → không ảnh hưởng phép năm</li>
                </ul>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowBalanceModal(false)} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={handleSaveBalance} disabled={!balanceEmployee}
                className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition disabled:opacity-40">
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManagement;
