import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  CalendarOff, Plus, CheckCircle, XCircle, Clock, Search, Timer,
  Calendar, AlertTriangle, RotateCcw, LayoutGrid, List as ListIcon,
  ArrowRight, Eye, X, Send, User, MessageSquare, ChevronDown
} from 'lucide-react';
import {
  LeaveType, LeaveRequest, LeaveRequestStatus, LeaveApprover,
  LEAVE_TYPE_LABELS
} from '../../types';

const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', cancelled: 'Đã huỷ',
};
const STATUS_COLORS: Record<LeaveRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};
const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  low: { label: 'Thấp', color: 'bg-slate-100 text-slate-600' },
  medium: { label: 'TB', color: 'bg-blue-100 text-blue-600' },
  high: { label: 'Cao', color: 'bg-orange-100 text-orange-600' },
  urgent: { label: 'Khẩn', color: 'bg-red-100 text-red-600' },
};

const KANBAN_STATUS: LeaveRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
const KANBAN_COLORS: Record<string, string> = {
  pending: 'from-amber-400 to-orange-500',
  approved: 'from-emerald-400 to-green-600',
  rejected: 'from-red-400 to-rose-600',
  cancelled: 'from-slate-300 to-slate-500',
};
const KANBAN_ICONS: Record<string, any> = {
  pending: Clock, approved: CheckCircle, rejected: XCircle, cancelled: CalendarOff,
};

// Approval Progress
const ApprovalProgress: React.FC<{ approvers: LeaveApprover[]; users: any[] }> = ({ approvers, users }) => {
  if (!approvers || approvers.length === 0) return null;
  const sorted = [...approvers].sort((a, b) => a.order - b.order);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {sorted.map((step, idx) => {
        const u = users.find(usr => usr.id === step.userId);
        const isApproved = step.status === 'approved';
        const isRejected = step.status === 'rejected';
        const isCurrent = step.status === 'waiting' && (idx === 0 || sorted[idx - 1]?.status === 'approved');
        return (
          <React.Fragment key={step.order}>
            {idx > 0 && <ArrowRight size={10} className="text-slate-300 shrink-0" />}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
              isApproved ? 'bg-emerald-100 text-emerald-700' :
              isRejected ? 'bg-red-100 text-red-700' :
              isCurrent ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300 animate-pulse' :
              'bg-slate-100 text-slate-400'
            }`} title={step.comment || ''}>
              {isApproved ? <CheckCircle size={10} /> : isRejected ? <XCircle size={10} /> : <Clock size={10} />}
              <span>B{step.order}: {u?.name || 'N/A'}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const LeaveManagement: React.FC = () => {
  const {
    employees, users, leaveRequests, leaveLogs, leaveBalances, attendanceRecords, holidays,
    addHrmItem, updateHrmItem, removeHrmItem,
    approveLeave, rejectLeave, addLeaveLog, user
  } = useApp();
  const { theme } = useTheme();

  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [showModal, setShowModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [selectedReq, setSelectedReq] = useState<LeaveRequest | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form state
  const [formEmployee, setFormEmployee] = useState('');
  const [formType, setFormType] = useState<LeaveType>('annual');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formHalfDay, setFormHalfDay] = useState(false);
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formApprovers, setFormApprovers] = useState<{ userId: string }[]>([]);
  const [formDueDate, setFormDueDate] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [formSubmitted, setFormSubmitted] = useState(false);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  // Calculate total days
  const calcDays = (start: string, end: string, isHalfDay: boolean = false): number => {
    if (!start || !end) return 0;
    if (isHalfDay) return 0.5;
    const s = new Date(start); const e = new Date(end);
    const holidayDates = new Set(holidays.map(h => h.date));
    let days = 0; const cur = new Date(s);
    while (cur <= e) {
      const dow = cur.getDay(); const dateStr = cur.toISOString().split('T')[0];
      if (dow !== 0 && dow !== 6 && !holidayDates.has(dateStr)) days++;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  };

  // Auto-generate code
  const generateCode = () => {
    const existing = leaveRequests.filter(r => r.code && r.code.startsWith('NP-'));
    const max = existing.reduce((m, r) => { const n = parseInt(r.code?.replace('NP-', '') || '0'); return n > m ? n : m; }, 0);
    return `NP-${String(max + 1).padStart(4, '0')}`;
  };

  // Filter
  const filtered = useMemo(() => {
    let list = [...leaveRequests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filterStatus) list = list.filter(r => r.status === filterStatus);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(r => {
        const emp = employeeMap.get(r.employeeId);
        return emp?.fullName.toLowerCase().includes(q) || emp?.employeeCode.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q);
      });
    }
    return list;
  }, [leaveRequests, filterStatus, searchText, employeeMap]);

  // Leave balance
  const currentYear = new Date().getFullYear();
  const balanceMap = useMemo(() => {
    const map = new Map<string, { total: number; accrued: number; used: number; pending: number; remaining: number }>();
    activeEmployees.forEach(e => {
      const bal = leaveBalances.find(b => b.employeeId === e.id && b.year === currentYear);
      const accrued = bal ? bal.accruedDays : 0;
      const used = bal ? bal.usedPaidDays : 0;
      const total = bal ? bal.initialDays : 12;
      const pendingDays = leaveRequests
        .filter(r => r.employeeId === e.id && r.type === 'annual' && r.status === 'pending' && new Date(r.startDate).getFullYear() === currentYear)
        .reduce((sum, r) => sum + r.totalDays, 0);
      map.set(e.id, { total, accrued, used, pending: pendingDays, remaining: accrued - used - pendingDays });
    });
    return map;
  }, [activeEmployees, leaveRequests, leaveBalances, currentYear]);

  // SLA helper
  const isOverdue = (req: LeaveRequest) => {
    if (!req.dueDate) return false;
    return new Date() > new Date(req.dueDate) && !['approved', 'cancelled', 'rejected'].includes(req.status);
  };

  // KPIs
  const kpis = useMemo(() => ({
    pending: leaveRequests.filter(r => r.status === 'pending').length,
    approved: leaveRequests.filter(r => r.status === 'approved' && new Date(r.startDate).getFullYear() === currentYear).length,
    totalDaysUsed: leaveRequests
      .filter(r => r.status === 'approved' && new Date(r.startDate).getFullYear() === currentYear)
      .reduce((sum, r) => sum + r.totalDays, 0),
    rejected: leaveRequests.filter(r => r.status === 'rejected').length,
    overdue: leaveRequests.filter(r => isOverdue(r)).length,
  }), [leaveRequests, currentYear]);

  // Current approver step for a request
  const getCurrentStep = (req: LeaveRequest): LeaveApprover | null => {
    if (!req.approvers || req.approvers.length === 0) return null;
    const sorted = [...req.approvers].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].status === 'waiting') {
        if (i === 0 || sorted[i - 1].status === 'approved') return sorted[i];
        break;
      }
    }
    return null;
  };

  // Submit
  const handleSubmit = () => {
    setFormSubmitted(true);
    if (!formEmployee) { setSubmitError('Vui lòng chọn nhân viên.'); return; }
    if (!formStart || !formEnd) { setSubmitError('Vui lòng chọn ngày.'); return; }
    if (!formReason.trim()) { setSubmitError('Vui lòng nhập lý do.'); return; }
    const totalDays = calcDays(formStart, formEnd, formHalfDay);
    if (totalDays <= 0) { setSubmitError('Khoảng thời gian không hợp lệ.'); return; }
    if (formType === 'annual') {
      const bal = balanceMap.get(formEmployee);
      if (bal && totalDays > bal.remaining) { setSubmitError(`Không đủ phép! Còn lại: ${bal.remaining} ngày.`); return; }
    }
    setSubmitError('');
    const approvers: LeaveApprover[] = formApprovers.map((a, i) => ({ userId: a.userId, order: i + 1, status: 'waiting' }));
    const newReq: LeaveRequest = {
      id: crypto.randomUUID(),
      code: generateCode(),
      employeeId: formEmployee,
      type: formType,
      startDate: formStart, endDate: formEnd,
      totalDays, reason: formReason,
      priority: formPriority as any,
      status: approvers.length > 0 ? 'pending' : 'pending',
      approvers,
      dueDate: formDueDate || undefined,
      createdAt: new Date().toISOString(),
    };
    addHrmItem('hrm_leave_requests', newReq);
    addLeaveLog({ leaveRequestId: newReq.id, action: 'create', actedBy: user.id, comment: 'Tạo đơn nghỉ phép' });
    setShowModal(false);
    setFormEmployee(''); setFormStart(''); setFormEnd(''); setFormReason(''); setFormHalfDay(false); setFormPriority('medium'); setFormApprovers([]); setFormDueDate(''); setSubmitError(''); setFormSubmitted(false);
    const emp = employeeMap.get(formEmployee);
    setSuccessMsg(`Đã gửi đơn nghỉ phép ${totalDays} ngày cho ${emp?.fullName || 'NV'}!`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Approve (old simple method - kept for backward compat)
  const handleApprove = (req: LeaveRequest) => {
    if (req.approvers && req.approvers.length > 0) {
      const currentStep = getCurrentStep(req);
      if (currentStep) approveLeave(req.id, currentStep.userId, approveComment || 'Đã duyệt');
      else approveLeave(req.id, user.id, approveComment || 'Đã duyệt');
    } else {
      updateHrmItem('hrm_leave_requests', { ...req, status: 'approved', approvedBy: user.id, approvedAt: new Date().toISOString() });
      addLeaveLog({ leaveRequestId: req.id, action: 'approve', actedBy: user.id, comment: 'Đã duyệt' });
    }
    // Auto deduct leave
    const bal = leaveBalances.find(b => b.employeeId === req.employeeId && b.year === currentYear);
    if (bal) {
      if (req.type === 'unpaid') updateHrmItem('hrm_leave_balances', { ...bal, usedUnpaidDays: bal.usedUnpaidDays + req.totalDays });
      else updateHrmItem('hrm_leave_balances', { ...bal, usedPaidDays: bal.usedPaidDays + req.totalDays });
    }
    // Auto attendance
    const start = new Date(req.startDate); const end = new Date(req.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        const dateStr = cur.toISOString().split('T')[0];
        const existingRec = attendanceRecords.find(r => r.employeeId === req.employeeId && r.date === dateStr);
        if (existingRec) updateHrmItem('hrm_attendance', { ...existingRec, status: 'leave' });
        else addHrmItem('hrm_attendance', { id: crypto.randomUUID(), employeeId: req.employeeId, date: dateStr, status: 'leave' as any, note: `Nghỉ phép: ${req.reason}`, createdAt: new Date().toISOString() });
      }
      cur.setDate(cur.getDate() + 1);
    }
    setApproveComment('');
  };

  const handleReject = (req: LeaveRequest) => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    if (req.approvers && req.approvers.length > 0) {
      rejectLeave(req.id, user.id, reason);
    } else {
      updateHrmItem('hrm_leave_requests', { ...req, status: 'rejected', approvedBy: user.id, approvedAt: new Date().toISOString(), rejectionReason: reason });
      addLeaveLog({ leaveRequestId: req.id, action: 'reject', actedBy: user.id, comment: reason });
    }
  };

  const handleRevoke = (req: LeaveRequest) => {
    if (!confirm('Thu hồi đơn nghỉ phép? Sẽ hoàn lại ngày phép.')) return;
    updateHrmItem('hrm_leave_requests', { ...req, status: 'cancelled' as any });
    addLeaveLog({ leaveRequestId: req.id, action: 'revoke', actedBy: user.id, comment: 'Thu hồi đơn' });
    const bal = leaveBalances.find(b => b.employeeId === req.employeeId && b.year === currentYear);
    if (bal) {
      if (req.type === 'unpaid') updateHrmItem('hrm_leave_balances', { ...bal, usedUnpaidDays: Math.max(0, bal.usedUnpaidDays - req.totalDays) });
      else updateHrmItem('hrm_leave_balances', { ...bal, usedPaidDays: Math.max(0, bal.usedPaidDays - req.totalDays) });
    }
    const start = new Date(req.startDate); const end = new Date(req.endDate);
    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().split('T')[0];
      const rec = attendanceRecords.find(r => r.employeeId === req.employeeId && r.date === dateStr && r.status === 'leave');
      if (rec) removeHrmItem('hrm_attendance', rec.id);
      cur.setDate(cur.getDate() + 1);
    }
  };

  // ==================== RENDER ====================
  // CARD component
  const LeaveCard: React.FC<{ req: LeaveRequest }> = ({ req }) => {
    const emp = employeeMap.get(req.employeeId);
    const pri = PRIORITY_MAP[req.priority || 'medium'];
    return (
      <div onClick={() => setSelectedReq(req)}
        className="bg-white rounded-xl border border-slate-100 p-3 hover:shadow-md hover:border-blue-200 transition cursor-pointer group">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-black text-blue-500">{req.code || '—'}</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${pri?.color || ''}`}>{pri?.label || ''}</span>
        </div>
        <div className="text-xs font-bold text-slate-700 mb-1 truncate">{emp?.fullName || 'N/A'}</div>
        <div className="text-[10px] text-slate-400 mb-2">{LEAVE_TYPE_LABELS[req.type]} • {req.totalDays} ngày</div>
        <div className="text-[10px] text-slate-500 flex items-center gap-1">
          <Calendar size={10} />
          {new Date(req.startDate).toLocaleDateString('vi-VN')} → {new Date(req.endDate).toLocaleDateString('vi-VN')}
        </div>
        {isOverdue(req) && (
          <div className="mt-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-500">
            <AlertTriangle size={10} /> Quá hạn SLA
          </div>
        )}
        {req.dueDate && !isOverdue(req) && (
          <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-400">
            <Timer size={9} /> SLA: {new Date(req.dueDate).toLocaleDateString('vi-VN')}
          </div>
        )}
        {req.approvers && req.approvers.length > 0 && (
          <div className="mt-2">
            <ApprovalProgress approvers={req.approvers} users={users} />
          </div>
        )}
      </div>
    );
  };

  // KANBAN COLUMN
  const KanbanColumn: React.FC<{ status: LeaveRequestStatus }> = ({ status }) => {
    const items = filtered.filter(r => r.status === status);
    const Icon = KANBAN_ICONS[status];
    return (
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${KANBAN_COLORS[status]} flex items-center justify-center text-white`}>
            <Icon size={14} />
          </div>
          <span className="text-xs font-black text-slate-700">{STATUS_LABELS[status]}</span>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{items.length}</span>
        </div>
        <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
          {items.map(r => <LeaveCard key={r.id} req={r} />)}
          {items.length === 0 && (
            <div className="text-center py-8 text-[10px] text-slate-300 font-bold">Trống</div>
          )}
        </div>
      </div>
    );
  };

  // Detail panel logs
  const selectedLogs = useMemo(() => {
    if (!selectedReq) return [];
    return leaveLogs.filter(l => l.leaveRequestId === selectedReq.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedReq, leaveLogs]);

  return (
    <div className="space-y-4">
      {successMsg && (
        <div className="fixed top-6 right-6 z-[60] bg-emerald-500 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-black flex items-center gap-2 animate-fade-in">
          <CheckCircle size={18} /> {successMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <CalendarOff className="text-blue-500" size={24} /> Quản lý Nghỉ phép
          </h1>
          <p className="text-slate-500 text-sm font-medium mt-1">Đăng ký, phê duyệt nghỉ phép nhân viên</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-0.5">
            <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-lg text-xs font-bold transition ${viewMode === 'kanban' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg text-xs font-bold transition ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
              <ListIcon size={16} />
            </button>
          </div>
          <button onClick={() => setShowModal(true)} className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-xs font-black hover:opacity-90 transition flex items-center gap-1.5 shadow-lg shadow-blue-500/20">
            <Plus size={16} /> Đăng ký nghỉ
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Chờ duyệt', value: kpis.pending, color: 'text-amber-500', bg: 'from-amber-50 to-orange-50', icon: Clock },
          { label: 'Đã duyệt', value: kpis.approved, color: 'text-emerald-600', bg: 'from-emerald-50 to-green-50', icon: CheckCircle },
          { label: 'Tổng ngày phép dùng', value: kpis.totalDaysUsed, color: 'text-blue-500', bg: 'from-blue-50 to-indigo-50', icon: Calendar },
          { label: 'Quá hạn SLA', value: kpis.overdue, color: 'text-red-500', bg: 'from-red-50 to-rose-50', icon: AlertTriangle },
        ].map((kpi, i) => (
          <div key={i} className={`bg-gradient-to-br ${kpi.bg} p-4 rounded-2xl border border-white/50`}>
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon size={14} className={kpi.color} />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{kpi.label}</p>
            </div>
            <p className={`text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white outline-none">
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm NV / mã phiếu..." value={searchText} onChange={e => setSearchText(e.target.value)}
            className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white outline-none w-52" />
        </div>
      </div>

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_STATUS.map(s => <KanbanColumn key={s} status={s} />)}
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <CalendarOff size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-black text-slate-400">Chưa có đơn nghỉ phép</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filtered.map(req => {
                const emp = employeeMap.get(req.employeeId);
                const pri = PRIORITY_MAP[req.priority || 'medium'];
                return (
                  <div key={req.id} onClick={() => setSelectedReq(req)}
                    className="p-4 flex flex-col md:flex-row md:items-center gap-3 hover:bg-slate-50 transition cursor-pointer">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-black shrink-0">
                        {emp?.fullName.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-800 truncate">{emp?.fullName || 'N/A'} <span className="text-[10px] font-mono text-blue-500 ml-1">{req.code || ''}</span></div>
                        <div className="text-[10px] text-slate-400">{LEAVE_TYPE_LABELS[req.type]} • {req.totalDays} ngày</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">{new Date(req.startDate).toLocaleDateString('vi-VN')} → {new Date(req.endDate).toLocaleDateString('vi-VN')}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${pri?.color}`}>{pri?.label}</span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${STATUS_COLORS[req.status]}`}>{STATUS_LABELS[req.status]}</span>
                    </div>
                    {req.approvers && req.approvers.length > 0 && (
                      <ApprovalProgress approvers={req.approvers} users={users} />
                    )}
                    <div className="flex items-center gap-1">
                      {req.status === 'pending' && (
                        <>
                          <button onClick={e => { e.stopPropagation(); handleApprove(req); }} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition"><CheckCircle size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); handleReject(req); }} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition"><XCircle size={14} /></button>
                        </>
                      )}
                      {req.status === 'approved' && (
                        <button onClick={e => { e.stopPropagation(); handleRevoke(req); }} className="p-1.5 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 transition" title="Thu hồi"><RotateCcw size={14} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== SLIDE-IN DETAIL PANEL ==================== */}
      {selectedReq && (() => {
        const req = leaveRequests.find(r => r.id === selectedReq.id) || selectedReq;
        const emp = employeeMap.get(req.employeeId);
        const currentStep = getCurrentStep(req);
        const canApprove = currentStep && currentStep.userId === user.id;
        const bal = balanceMap.get(req.employeeId);

        return (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedReq(null)} />
            <div className="w-full max-w-lg bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
              {/* Header */}
              <div className="sticky top-0 bg-white z-10 p-5 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-black text-blue-500">{req.code || '—'}</span>
                    <h2 className="text-lg font-black text-slate-800 mt-1">{emp?.fullName || 'N/A'}</h2>
                    <p className="text-xs text-slate-400">{LEAVE_TYPE_LABELS[req.type]} • {req.totalDays} ngày</p>
                  </div>
                  <button onClick={() => setSelectedReq(null)} className="p-2 hover:bg-slate-100 rounded-xl transition"><X size={18} /></button>
                </div>
                <div className="flex gap-2 mt-3">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${STATUS_COLORS[req.status]}`}>{STATUS_LABELS[req.status]}</span>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${PRIORITY_MAP[req.priority || 'medium']?.color}`}>
                    {PRIORITY_MAP[req.priority || 'medium']?.label}
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="p-5 space-y-5">
                {/* Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 rounded-xl p-3">
                    <p className="text-[10px] font-black text-blue-400 uppercase">Từ ngày</p>
                    <p className="text-sm font-black text-blue-700">{new Date(req.startDate).toLocaleDateString('vi-VN')}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3">
                    <p className="text-[10px] font-black text-blue-400 uppercase">Đến ngày</p>
                    <p className="text-sm font-black text-blue-700">{new Date(req.endDate).toLocaleDateString('vi-VN')}</p>
                  </div>
                </div>

                {/* SLA */}
                {req.dueDate && (
                  <div className={`rounded-xl p-3 ${isOverdue(req) ? 'bg-red-50 border border-red-200' : 'bg-amber-50'}`}>
                    <div className="flex items-center gap-2">
                      <Timer size={14} className={isOverdue(req) ? 'text-red-500' : 'text-amber-500'} />
                      <div>
                        <p className={`text-[10px] font-black uppercase ${isOverdue(req) ? 'text-red-400' : 'text-amber-400'}`}>Hạn xử lý SLA</p>
                        <p className={`text-sm font-black ${isOverdue(req) ? 'text-red-700' : 'text-amber-700'}`}>
                          {new Date(req.dueDate).toLocaleDateString('vi-VN')}
                          {isOverdue(req) && <span className="ml-2 text-[10px] text-red-500 font-bold">⚠ Quá hạn!</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Balance */}
                {bal && (
                  <div className="bg-indigo-50 rounded-xl p-3">
                    <p className="text-[10px] font-black text-indigo-400 uppercase">Phép năm còn lại</p>
                    <p className="text-lg font-black text-indigo-700">{bal.remaining} / {bal.accrued} ngày</p>
                  </div>
                )}

                {/* Reason */}
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Lý do</p>
                  <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-700">{req.reason}</div>
                </div>

                {/* Rejection reason */}
                {req.rejectionReason && (
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                    <p className="text-[10px] font-black text-red-400 uppercase mb-1">Lý do từ chối</p>
                    <p className="text-sm text-red-700">{req.rejectionReason}</p>
                  </div>
                )}

                {/* Approval Progress */}
                {req.approvers && req.approvers.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Tiến trình duyệt</p>
                    <ApprovalProgress approvers={req.approvers} users={users} />
                  </div>
                )}

                {/* Actions */}
                {req.status === 'pending' && (
                  <div className="space-y-3 p-4 bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl border border-slate-100">
                    <textarea value={approveComment} onChange={e => setApproveComment(e.target.value)} rows={2}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white outline-none resize-none" placeholder="Ghi chú (không bắt buộc)..." />
                    <div className="flex gap-2">
                      <button onClick={() => { handleApprove(req); setSelectedReq(null); }}
                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl text-xs font-black hover:opacity-90 transition flex items-center justify-center gap-1.5">
                        <CheckCircle size={14} /> Duyệt
                      </button>
                      <button onClick={() => { handleReject(req); setSelectedReq(null); }}
                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl text-xs font-black hover:opacity-90 transition flex items-center justify-center gap-1.5">
                        <XCircle size={14} /> Từ chối
                      </button>
                    </div>
                  </div>
                )}
                {req.status === 'approved' && (
                  <button onClick={() => { handleRevoke(req); setSelectedReq(null); }}
                    className="w-full px-4 py-2.5 bg-amber-100 text-amber-700 rounded-xl text-xs font-black hover:bg-amber-200 transition flex items-center justify-center gap-1.5">
                    <RotateCcw size={14} /> Thu hồi đơn
                  </button>
                )}

                {/* Activity Log */}
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Lịch sử hoạt động</p>
                  {selectedLogs.length === 0 ? (
                    <p className="text-[10px] text-slate-300 text-center py-4">Chưa có hoạt động</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedLogs.map(log => {
                        const actor = users.find(u => u.id === log.actedBy);
                        return (
                          <div key={log.id} className="flex items-start gap-2 text-xs">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[8px] font-bold shrink-0 mt-0.5">
                              {actor?.name?.charAt(0) || '?'}
                            </div>
                            <div>
                              <span className="font-bold text-slate-700">{actor?.name || 'N/A'}</span>
                              <span className="text-slate-400 ml-1">
                                {log.action === 'create' ? 'tạo đơn' : log.action === 'approve' ? 'duyệt' : log.action === 'reject' ? 'từ chối' : log.action === 'revoke' ? 'thu hồi' : log.action}
                              </span>
                              {log.comment && <div className="text-slate-500 mt-0.5 italic">"{log.comment}"</div>}
                              <div className="text-[9px] text-slate-300 mt-0.5">{new Date(log.createdAt).toLocaleString('vi-VN')}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ==================== CREATE MODAL ==================== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800">Đăng ký nghỉ phép</h3>
              <button onClick={() => { setShowModal(false); setSubmitError(''); setFormSubmitted(false); }} className="p-1.5 hover:bg-slate-100 rounded-xl transition"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Employee */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Nhân viên</label>
                <select value={formEmployee} onChange={e => { setFormEmployee(e.target.value); setSubmitError(''); }}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white outline-none ${formSubmitted && !formEmployee ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}`}>
                  <option value="">Chọn nhân viên</option>
                  {activeEmployees.map(e => <option key={e.id} value={e.id}>{e.employeeCode} - {e.fullName}</option>)}
                </select>
              </div>

              {/* Type + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Loại phép</label>
                  <select value={formType} onChange={e => setFormType(e.target.value as LeaveType)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white outline-none">
                    {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Mức ưu tiên</label>
                  <select value={formPriority} onChange={e => setFormPriority(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white outline-none">
                    {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Balance info */}
              {formEmployee && (() => {
                const bal = balanceMap.get(formEmployee);
                const remaining = bal ? bal.remaining : 0;
                const accrued = bal ? bal.accrued : 0;
                const isInsufficient = formType === 'annual' && remaining <= 0;
                return (
                  <div className={`p-3 rounded-xl ${isInsufficient ? 'bg-red-50 border border-red-200' : 'bg-blue-50'}`}>
                    <p className={`text-[10px] font-black uppercase ${isInsufficient ? 'text-red-500' : 'text-blue-500'}`}>Phép năm còn lại</p>
                    <p className={`text-lg font-black ${isInsufficient ? 'text-red-600' : 'text-blue-700'}`}>{remaining} / {accrued} ngày</p>
                    {isInsufficient && <div className="flex items-center gap-1.5 mt-2 text-xs font-bold text-red-600"><AlertTriangle size={14} /> Hết phép!</div>}
                  </div>
                );
              })()}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Từ ngày</label>
                  <input type="date" value={formStart} onChange={e => { setFormStart(e.target.value); setSubmitError(''); }}
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white outline-none ${formSubmitted && !formStart ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}`} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Đến ngày</label>
                  <input type="date" value={formEnd} onChange={e => { setFormEnd(e.target.value); setSubmitError(''); }}
                    className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white outline-none ${formSubmitted && !formEnd ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}`} />
                </div>
              </div>

              {formStart && formEnd && (
                <div className="text-sm font-black text-slate-600">Tổng: <span className="text-blue-600">{calcDays(formStart, formEnd, formHalfDay)}</span> ngày</div>
              )}

              {/* SLA Due Date */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Hạn xử lý (SLA)</label>
                <input type="date" value={formDueDate} onChange={e => setFormDueDate(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white outline-none" />
                <p className="text-[9px] text-slate-400 mt-1">Không bắt buộc — đặt hạn để theo dõi SLA</p>
              </div>

              {/* Half-day */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formHalfDay} onChange={e => { setFormHalfDay(e.target.checked); if (e.target.checked && formStart) setFormEnd(formStart); }}
                  className="w-4 h-4 rounded-md border-slate-300 text-blue-500" />
                <span className="text-xs font-bold text-slate-600">Nửa ngày (0.5)</span>
              </label>

              {/* Reason */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Lý do</label>
                <textarea value={formReason} onChange={e => { setFormReason(e.target.value); setSubmitError(''); }} rows={2}
                  className={`w-full px-3 py-2.5 text-sm border rounded-xl bg-white outline-none resize-none ${formSubmitted && !formReason.trim() ? 'border-red-400 ring-2 ring-red-200' : 'border-slate-200'}`}
                  placeholder="Nhập lý do nghỉ..." />
              </div>

              {/* Approvers */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Chuỗi duyệt</label>
                {formApprovers.map((a, idx) => {
                  const u = users.find(usr => usr.id === a.userId);
                  return (
                    <div key={idx} className="flex items-center gap-2 mb-1.5">
                      <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-[10px] font-black flex items-center justify-center shrink-0">B{idx + 1}</span>
                      <span className="text-xs font-bold text-slate-700 flex-1">{u?.name || 'N/A'}</span>
                      <button onClick={() => setFormApprovers(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-400 hover:bg-red-50 rounded transition"><X size={12} /></button>
                    </div>
                  );
                })}
                <select value="" onChange={e => { if (e.target.value && !formApprovers.some(a => a.userId === e.target.value)) setFormApprovers(prev => [...prev, { userId: e.target.value }]); e.target.value = ''; }}
                  className="w-full px-3 py-2 text-xs border border-dashed border-blue-300 rounded-xl bg-blue-50 text-blue-500 outline-none">
                  <option value="">+ Thêm người duyệt</option>
                  {users.filter(u => !formApprovers.some(a => a.userId === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 space-y-3">
              {submitError && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold">
                  <AlertTriangle size={16} /> {submitError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowModal(false); setSubmitError(''); setFormSubmitted(false); }} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                <button onClick={handleSubmit} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-xs font-black hover:opacity-90 transition flex items-center gap-1.5 shadow-lg shadow-blue-500/20">
                  <Send size={14} /> Gửi đơn
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
