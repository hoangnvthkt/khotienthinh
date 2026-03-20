import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, DollarSign, Clock, AlertTriangle,
  Cake, FileSignature, TrendingUp, TrendingDown, ArrowRight,
  CheckCircle, XCircle, CalendarOff, MapPin, Award
} from 'lucide-react';

const HrmDashboard: React.FC = () => {
  const {
    employees, attendanceRecords, leaveRequests, leaveBalances,
    payrollRecords, laborContracts, salaryHistory, holidays,
    hrmPositions
  } = useApp();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthStr = String(currentMonth).padStart(2, '0');

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);
  const positionMap = useMemo(() => new Map(hrmPositions.map(p => [p.id, p.name])), [hrmPositions]);

  // ==================== EMPLOYEE STATS ====================

  const empStats = useMemo(() => {
    const total = activeEmployees.length;
    const male = activeEmployees.filter(e => e.gender === 'Nam').length;
    const female = activeEmployees.filter(e => e.gender === 'Nữ').length;
    // New hires this month
    const newHires = activeEmployees.filter(e => {
      if (!e.startDate) return false;
      const d = new Date(e.startDate);
      return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
    });
    // Birthdays this month
    const birthdays = activeEmployees.filter(e => {
      if (!e.dateOfBirth) return false;
      return new Date(e.dateOfBirth).getMonth() + 1 === currentMonth;
    }).sort((a, b) => {
      const da = new Date(a.dateOfBirth!).getDate();
      const db = new Date(b.dateOfBirth!).getDate();
      return da - db;
    });
    return { total, male, female, newHires, birthdays };
  }, [activeEmployees, currentMonth, currentYear]);

  // ==================== ATTENDANCE ====================

  const attendStats = useMemo(() => {
    const today = now.toISOString().split('T')[0];
    const todayRecs = attendanceRecords.filter(r => r.date === today);
    const presentToday = todayRecs.filter(r => r.status === 'present' || r.status === 'business_trip').length;
    const absentToday = todayRecs.filter(r => r.status === 'absent').length;
    const leaveToday = todayRecs.filter(r => r.status === 'leave').length;

    // Month totals
    let totalWorkDays = 0, totalLate = 0, totalOT = 0;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (const emp of activeEmployees) {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${currentYear}-${monthStr}-${String(d).padStart(2, '0')}`;
        const rec = attendanceRecords.find(r => r.employeeId === emp.id && r.date === dateStr);
        if (rec) {
          if (rec.status === 'present' || rec.status === 'business_trip') totalWorkDays++;
          else if (rec.status === 'half_day') totalWorkDays += 0.5;
          totalOT += rec.overtimeHours || 0;
          if (rec.checkIn) {
            const [h, m] = rec.checkIn.split(':').map(Number);
            if (h * 60 + m > 480) totalLate++;
          }
        }
      }
    }
    return { presentToday, absentToday, leaveToday, totalWorkDays, totalLate, totalOT };
  }, [activeEmployees, attendanceRecords, currentMonth, currentYear]);

  // ==================== LEAVE ====================

  const leaveStats = useMemo(() => {
    const pending = leaveRequests.filter(r => r.status === 'pending').length;
    const approvedThisMonth = leaveRequests.filter(r =>
      r.status === 'approved' && new Date(r.startDate).getMonth() + 1 === currentMonth
    ).length;
    const lowBalance = activeEmployees.filter(emp => {
      const bal = leaveBalances.find(b => b.employeeId === emp.id && b.year === currentYear);
      return bal && (bal.accruedDays - bal.usedPaidDays) <= 1;
    });
    return { pending, approvedThisMonth, lowBalance };
  }, [leaveRequests, activeEmployees, leaveBalances, currentMonth, currentYear]);

  // ==================== PAYROLL ====================

  const payrollStats = useMemo(() => {
    const monthPayrolls = payrollRecords.filter(p => p.month === currentMonth && p.year === currentYear);
    const totalNet = monthPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const draft = monthPayrolls.filter(p => p.status === 'draft').length;
    const paid = monthPayrolls.filter(p => p.status === 'paid').length;
    const confirmed = monthPayrolls.filter(p => p.status === 'confirmed').length;
    return { count: monthPayrolls.length, totalNet, draft, paid, confirmed };
  }, [payrollRecords, currentMonth, currentYear]);

  // ==================== CONTRACTS ====================

  const contractStats = useMemo(() => {
    const active = laborContracts.filter(c => c.status === 'active').length;
    const expiring = laborContracts.filter(c => {
      if (c.status !== 'active' || !c.endDate) return false;
      const daysLeft = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / 86400000);
      return daysLeft > 0 && daysLeft <= 30;
    });
    const expired = laborContracts.filter(c => c.status === 'expired').length;
    return { active, expiring, expired };
  }, [laborContracts]);

  // ==================== SALARY HISTORY ====================

  const recentSalaryChanges = useMemo(() =>
    [...salaryHistory]
      .sort((a, b) => new Date(b.changeDate).getTime() - new Date(a.changeDate).getTime())
      .slice(0, 5),
  [salaryHistory]);

  // ==================== PENDING LEAVE REQUESTS ====================

  const pendingLeaves = useMemo(() =>
    leaveRequests
      .filter(r => r.status === 'pending')
      .sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime())
      .slice(0, 5),
  [leaveRequests]);

  const fmtShort = (v: number) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v.toLocaleString('vi-VN');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
          <LayoutDashboard className="text-indigo-500" size={24} /> Dashboard Nhân sự
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
          Tổng quan tháng {currentMonth}/{currentYear}
        </p>
      </div>

      {/* ==================== TOP KPIs ==================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="glass-card p-4 rounded-2xl cursor-pointer hover:ring-2 hover:ring-indigo-300 transition" onClick={() => navigate('/hrm/employees')}>
          <div className="flex items-center gap-2 mb-2"><Users size={16} className="text-indigo-500" /><span className="text-[10px] font-black text-slate-400 uppercase">Nhân viên</span></div>
          <p className="text-2xl font-black text-slate-800 dark:text-white">{empStats.total}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{empStats.male}♂ · {empStats.female}♀</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-2"><CheckCircle size={16} className="text-emerald-500" /><span className="text-[10px] font-black text-slate-400 uppercase">Có mặt HN</span></div>
          <p className="text-2xl font-black text-emerald-600">{attendStats.presentToday}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">/{empStats.total} NV</p>
        </div>
        <div className="glass-card p-4 rounded-2xl cursor-pointer hover:ring-2 hover:ring-amber-300 transition" onClick={() => navigate('/hrm/leave')}>
          <div className="flex items-center gap-2 mb-2"><CalendarOff size={16} className="text-amber-500" /><span className="text-[10px] font-black text-slate-400 uppercase">Chờ duyệt</span></div>
          <p className="text-2xl font-black text-amber-500">{leaveStats.pending}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">đơn nghỉ phép</p>
        </div>
        <div className="glass-card p-4 rounded-2xl cursor-pointer hover:ring-2 hover:ring-orange-300 transition" onClick={() => navigate('/hrm/attendance')}>
          <div className="flex items-center gap-2 mb-2"><Clock size={16} className="text-orange-500" /><span className="text-[10px] font-black text-slate-400 uppercase">Đi muộn</span></div>
          <p className="text-2xl font-black text-orange-500">{attendStats.totalLate}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">lần trong tháng</p>
        </div>
        <div className="glass-card p-4 rounded-2xl cursor-pointer hover:ring-2 hover:ring-emerald-300 transition" onClick={() => navigate('/hrm/payroll')}>
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-emerald-500" /><span className="text-[10px] font-black text-slate-400 uppercase">Tổng lương</span></div>
          <p className="text-2xl font-black text-emerald-600">{fmtShort(payrollStats.totalNet)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{payrollStats.count} phiếu</p>
        </div>
        <div className="glass-card p-4 rounded-2xl cursor-pointer hover:ring-2 hover:ring-red-300 transition" onClick={() => navigate('/hrm/contracts')}>
          <div className="flex items-center gap-2 mb-2"><FileSignature size={16} className={contractStats.expiring.length > 0 ? 'text-red-500' : 'text-slate-400'} /><span className="text-[10px] font-black text-slate-400 uppercase">HĐ sắp hết</span></div>
          <p className={`text-2xl font-black ${contractStats.expiring.length > 0 ? 'text-red-500' : 'text-slate-400'}`}>{contractStats.expiring.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">≤ 30 ngày</p>
        </div>
      </div>

      {/* ==================== 3-COLUMN WIDGETS ==================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* === Left: Pending Leave + Birthdays === */}
        <div className="space-y-4">
          {/* Pending Leave Requests */}
          <div className="glass-panel rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <CalendarOff size={14} className="text-amber-500" /> Đơn chờ duyệt
              </h3>
              {leaveStats.pending > 0 && (
                <button onClick={() => navigate('/hrm/leave')} className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center gap-0.5">
                  Xem tất cả <ArrowRight size={10} />
                </button>
              )}
            </div>
            {pendingLeaves.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">Không có đơn chờ 🎉</p>
            ) : (
              <div className="space-y-2">
                {pendingLeaves.map(req => {
                  const emp = employeeMap.get(req.employeeId);
                  return (
                    <div key={req.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/10">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                        {emp?.fullName.charAt(0) || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-black text-slate-700 dark:text-white truncate">{emp?.fullName || 'N/A'}</div>
                        <div className="text-[10px] text-slate-400">{new Date(req.startDate).toLocaleDateString('vi-VN')} — {req.totalDays}d</div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-700">⏳</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Birthdays */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Cake size={14} className="text-pink-500" /> Sinh nhật tháng {currentMonth}
            </h3>
            {empStats.birthdays.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">Không có ai</p>
            ) : (
              <div className="space-y-2">
                {empStats.birthdays.slice(0, 8).map(emp => {
                  const day = new Date(emp.dateOfBirth!).getDate();
                  const isPast = day < now.getDate();
                  const isToday = day === now.getDate();
                  return (
                    <div key={emp.id} className={`flex items-center gap-2.5 p-2 rounded-xl ${isToday ? 'bg-pink-50 dark:bg-pink-950/10 ring-1 ring-pink-200' : ''}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black ${
                        isToday ? 'bg-pink-500 text-white' : isPast ? 'bg-slate-200 dark:bg-slate-700 text-slate-500' : 'bg-pink-100 text-pink-600'
                      }`}>{day}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-700 dark:text-white truncate">{emp.fullName}</div>
                        <div className="text-[10px] text-slate-400">{emp.employeeCode}</div>
                      </div>
                      {isToday && <span className="text-xs">🎂</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* === Middle: Attendance + Contract Alerts === */}
        <div className="space-y-4">
          {/* Attendance Summary */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Calendar size={14} className="text-blue-500" /> Chấm công tháng {currentMonth}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/10">
                <p className="text-[10px] font-black text-emerald-500 uppercase">Tổng công</p>
                <p className="text-xl font-black text-emerald-600">{attendStats.totalWorkDays.toFixed(0)}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/10">
                <p className="text-[10px] font-black text-amber-500 uppercase">Tổng OT</p>
                <p className="text-xl font-black text-amber-600">{attendStats.totalOT}h</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/10">
                <p className="text-[10px] font-black text-red-500 uppercase">Vắng HN</p>
                <p className="text-xl font-black text-red-500">{attendStats.absentToday}</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/10">
                <p className="text-[10px] font-black text-blue-500 uppercase">Nghỉ phép HN</p>
                <p className="text-xl font-black text-blue-500">{attendStats.leaveToday}</p>
              </div>
            </div>
          </div>

          {/* Contract Alerts */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <FileSignature size={14} className="text-violet-500" /> Hợp đồng
            </h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/10 text-center">
                <p className="text-lg font-black text-emerald-600">{contractStats.active}</p>
                <p className="text-[9px] font-bold text-slate-400">Hiệu lực</p>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/10 text-center">
                <p className="text-lg font-black text-amber-500">{contractStats.expiring.length}</p>
                <p className="text-[9px] font-bold text-slate-400">Sắp hết</p>
              </div>
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/10 text-center">
                <p className="text-lg font-black text-red-500">{contractStats.expired}</p>
                <p className="text-[9px] font-bold text-slate-400">Đã hết</p>
              </div>
            </div>
            {contractStats.expiring.length > 0 && (
              <div className="space-y-1.5">
                {contractStats.expiring.map(c => {
                  const emp = employeeMap.get(c.employeeId);
                  const daysLeft = Math.ceil((new Date(c.endDate!).getTime() - now.getTime()) / 86400000);
                  return (
                    <div key={c.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/10">
                      <span className="font-bold text-slate-700 dark:text-slate-300 truncate">{emp?.fullName} ({c.contractNumber})</span>
                      <span className={`font-black ${daysLeft <= 7 ? 'text-red-500' : 'text-amber-500'}`}>{daysLeft}d</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* === Right: Payroll + Salary Changes === */}
        <div className="space-y-4">
          {/* Payroll Summary */}
          <div className="glass-panel rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign size={14} className="text-emerald-500" /> Lương T{currentMonth}
              </h3>
              <button onClick={() => navigate('/hrm/payroll')} className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center gap-0.5">
                Chi tiết <ArrowRight size={10} />
              </button>
            </div>
            {payrollStats.count === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">Chưa có bảng lương</p>
            ) : (
              <>
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white mb-3">
                  <p className="text-[10px] font-bold opacity-80 uppercase">Tổng thực lĩnh</p>
                  <p className="text-2xl font-black">{payrollStats.totalNet.toLocaleString('vi-VN')}đ</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <p className="text-sm font-black text-slate-500">{payrollStats.draft}</p>
                    <p className="text-[9px] text-slate-400">Nháp</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-amber-500">{payrollStats.confirmed}</p>
                    <p className="text-[9px] text-slate-400">Xác nhận</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-emerald-600">{payrollStats.paid}</p>
                    <p className="text-[9px] text-slate-400">Đã trả</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Recent Salary Changes */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingUp size={14} className="text-indigo-500" /> Biến động lương gần đây
            </h3>
            {recentSalaryChanges.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">Chưa có thay đổi</p>
            ) : (
              <div className="space-y-2">
                {recentSalaryChanges.map(h => {
                  const emp = employeeMap.get(h.employeeId);
                  const diff = h.newSalary - h.previousSalary;
                  const isIncrease = diff > 0;
                  const isNew = h.previousSalary === 0;
                  return (
                    <div key={h.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/30">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-black ${
                        isNew ? 'bg-blue-500' : isIncrease ? 'bg-emerald-500' : 'bg-red-500'
                      }`}>
                        {isNew ? '+' : isIncrease ? '↑' : '↓'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-black text-slate-700 dark:text-white truncate">{emp?.fullName || 'N/A'}</div>
                        <div className="text-[9px] text-slate-400">{new Date(h.changeDate).toLocaleDateString('vi-VN')}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-black text-slate-800 dark:text-white">{fmtShort(h.newSalary)}</div>
                        {!isNew && (
                          <div className={`text-[9px] font-black ${isIncrease ? 'text-emerald-500' : 'text-red-500'}`}>
                            {isIncrease ? '+' : ''}{fmtShort(diff)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* New Hires */}
          {empStats.newHires.length > 0 && (
            <div className="glass-panel rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Award size={14} className="text-teal-500" /> NV mới tháng này ({empStats.newHires.length})
              </h3>
              <div className="space-y-2">
                {empStats.newHires.map(emp => (
                  <div key={emp.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-teal-50/50 dark:bg-teal-950/10">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white text-[10px] font-black">
                      {emp.fullName.charAt(0)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-700 dark:text-white">{emp.fullName}</div>
                      <div className="text-[10px] text-slate-400">{emp.title || positionMap.get(emp.positionId || '') || emp.employeeCode}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== QUICK NAV ==================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Chấm công', icon: <Calendar size={18} />, path: '/hrm/attendance', color: 'from-blue-500 to-indigo-600' },
          { label: 'Nghỉ phép', icon: <CalendarOff size={18} />, path: '/hrm/leave', color: 'from-amber-500 to-orange-600' },
          { label: 'Bảng lương', icon: <DollarSign size={18} />, path: '/hrm/payroll', color: 'from-emerald-500 to-teal-600' },
          { label: 'Hợp đồng', icon: <FileSignature size={18} />, path: '/hrm/contracts', color: 'from-violet-500 to-purple-600' },
        ].map(q => (
          <button key={q.path} onClick={() => navigate(q.path)}
            className={`p-4 rounded-2xl bg-gradient-to-br ${q.color} text-white font-black text-sm flex items-center gap-2 hover:opacity-90 transition shadow-lg`}>
            {q.icon} {q.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default HrmDashboard;
