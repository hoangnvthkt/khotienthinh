import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  ArrowLeft, IdCard, Phone, Mail, Calendar, MapPin, Briefcase,
  Clock, CheckCircle, XCircle, DollarSign, TrendingUp,
  Package, FileText, AlertTriangle, User, FileSignature,
  BarChart3, History, Repeat, Wrench, Eye, CalendarOff,
  Building, ChevronRight, Activity
} from 'lucide-react';

// ======================== TAB DEFINITIONS ========================
const TABS = [
  { key: 'overview', label: 'Tổng quan', icon: User },
  { key: 'attendance', label: 'Chấm công & Nghỉ phép', icon: Calendar },
  { key: 'payroll', label: 'Lương & Thu nhập', icon: DollarSign },
  { key: 'assets', label: 'Tài sản', icon: Package },
  { key: 'requests', label: 'Yêu cầu & Quy trình', icon: FileText },
  { key: 'activity', label: 'Hoạt động', icon: Activity },
] as const;

type TabKey = typeof TABS[number]['key'];

const EmployeeProfile: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const {
    employees, users, attendanceRecords, leaveRequests, leaveBalances,
    payrollRecords, salaryHistory, laborContracts, holidays,
    assets, assetAssignments, assetMaintenances,
    transactions, requests: materialRequests, activities,
    hrmConstructionSites, hrmOffices, shiftTypes, employeeShifts,
  } = useApp();
  useModuleData('hrm');
  useModuleData('ts');
  useModuleData('wms');
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // ======================== DATA RESOLUTION ========================
  const employee = useMemo(() => employees.find(e => e.id === employeeId), [employees, employeeId]);
  const linkedUser = useMemo(() => employee ? users.find(u => u.id === employee.userId) : null, [users, employee]);

  // Attendance
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const empAttendance = useMemo(() =>
    attendanceRecords.filter(r => r.employeeId === employeeId),
    [attendanceRecords, employeeId]);
  const monthAttendance = useMemo(() =>
    empAttendance.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() + 1 === currentMonth && d.getFullYear() === currentYear;
    }), [empAttendance, currentMonth, currentYear]);

  // Leave
  const empLeave = useMemo(() =>
    leaveRequests.filter(r => r.employeeId === employeeId),
    [leaveRequests, employeeId]);
  const empBalance = useMemo(() =>
    leaveBalances.find(b => b.employeeId === employeeId && b.year === currentYear),
    [leaveBalances, employeeId, currentYear]);

  // Payroll
  const empPayroll = useMemo(() =>
    payrollRecords.filter(r => r.employeeId === employeeId).sort((a, b) => {
      const da = `${a.year}-${String(a.month).padStart(2, '0')}`;
      const db = `${b.year}-${String(b.month).padStart(2, '0')}`;
      return db.localeCompare(da);
    }), [payrollRecords, employeeId]);
  const empSalaryHistory = useMemo(() =>
    (salaryHistory || []).filter((s: any) => s.employeeId === employeeId).sort((a: any, b: any) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime()),
    [salaryHistory, employeeId]);

  // Contracts
  const empContracts = useMemo(() =>
    laborContracts.filter(c => c.employeeId === employeeId).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    [laborContracts, employeeId]);

  // Assets
  const empAssignments = useMemo(() =>
    assetAssignments.filter(a => a.employeeId === employeeId).sort((a, b) => new Date(b.assignedDate).getTime() - new Date(a.assignedDate).getTime()),
    [assetAssignments, employeeId]);

  // Material requests by linked user
  const empMaterialRequests = useMemo(() =>
    linkedUser ? materialRequests.filter(r => r.requestedBy === linkedUser.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [],
    [materialRequests, linkedUser]);

  // Transactions by linked user
  const empTransactions = useMemo(() =>
    linkedUser ? transactions.filter(t => t.createdBy === linkedUser.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : [],
    [transactions, linkedUser]);

  // KPIs for header
  const workDays = monthAttendance.filter(r => ['present', 'late'].includes(r.status)).length;
  const leaveRemaining = empBalance ? empBalance.accruedDays - empBalance.usedPaidDays : 0;
  const latestPayroll = empPayroll[0];
  const activeAssets = empAssignments.filter(a => !a.returnedDate).length;

  if (!employee) {
    return (
      <div className="text-center py-20 space-y-4">
        <AlertTriangle className="w-16 h-16 text-amber-400 mx-auto" />
        <p className="text-lg font-bold text-slate-600 dark:text-slate-300">Không tìm thấy nhân viên</p>
        <button onClick={() => navigate('/ep')} className="px-4 py-2 bg-sky-500 text-white rounded-xl text-sm font-bold hover:bg-sky-600 transition">
          ← Quay lại danh sách
        </button>
      </div>
    );
  }

  const isActive = employee.status === 'Đang làm việc';
  const avatarUrl = employee.avatarUrl || linkedUser?.avatar || `https://i.pravatar.cc/150?u=${employee.email || employee.id}`;

  // ======================== RENDER HELPERS ========================
  const StatusBadge: React.FC<{ status: string; colorMap: Record<string, string> }> = ({ status, colorMap }) => (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${colorMap[status] || 'bg-slate-100 text-slate-500'}`}>{status}</span>
  );

  // ======================== TAB: OVERVIEW ========================
  const renderOverview = () => (
    <div className="space-y-5">
      {/* Personal Info */}
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
          <User size={16} className="text-sky-500" /> Thông tin cá nhân
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {[
            { icon: IdCard, label: 'Mã NV', value: employee.employeeCode },
            { icon: User, label: 'Giới tính', value: employee.gender },
            { icon: Phone, label: 'SĐT', value: employee.phone || '—' },
            { icon: Mail, label: 'Email', value: employee.email || '—' },
            { icon: Calendar, label: 'Ngày sinh', value: employee.dateOfBirth ? new Date(employee.dateOfBirth).toLocaleDateString('vi-VN') : '—' },
            { icon: Calendar, label: 'Ngày vào', value: employee.startDate ? new Date(employee.startDate).toLocaleDateString('vi-VN') : '—' },
            { icon: Calendar, label: 'Ngày chính thức', value: employee.officialDate ? new Date(employee.officialDate).toLocaleDateString('vi-VN') : '—' },
            { icon: Building, label: 'Tình trạng HN', value: employee.maritalStatus || '—' },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <Icon size={14} className="text-slate-400 shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">{item.label}</p>
                  <p className="font-bold text-slate-700 dark:text-white text-xs">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Contract */}
      {empContracts.length > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
            <FileSignature size={16} className="text-violet-500" /> Hợp đồng lao động
          </h3>
          <div className="space-y-2">
            {empContracts.slice(0, 3).map(c => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-800/30">
                <div>
                  <p className="text-xs font-black text-violet-700 dark:text-violet-400">{c.contractNumber || 'N/A'} — {c.contractType}</p>
                  <p className="text-[10px] text-slate-400">
                    {new Date(c.startDate).toLocaleDateString('vi-VN')} → {c.endDate ? new Date(c.endDate).toLocaleDateString('vi-VN') : 'Không thời hạn'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'terminated' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                  {c.status === 'active' ? 'Hiệu lực' : c.status === 'terminated' ? 'Đã chấm dứt' : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
          <Activity size={16} className="text-amber-500" /> Hoạt động gần đây
        </h3>
        {renderActivityTimeline(10)}
      </div>
    </div>
  );

  // ======================== TAB: ATTENDANCE ========================
  const renderAttendance = () => {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const attendanceMap = new Map(monthAttendance.map(r => [r.date, r]));
    const statusColors: Record<string, string> = {
      present: 'bg-emerald-400 text-white',
      late: 'bg-amber-400 text-white',
      absent: 'bg-red-400 text-white',
      leave: 'bg-blue-400 text-white',
      holiday: 'bg-purple-400 text-white',
      half_day: 'bg-teal-400 text-white',
    };
    const statusLabels: Record<string, string> = {
      present: 'Đi làm', late: 'Đi muộn', absent: 'Vắng', leave: 'Nghỉ phép', holiday: 'Lễ', half_day: 'Nửa ngày',
    };

    const workCount = monthAttendance.filter(r => ['present', 'late', 'half_day'].includes(r.status)).length;
    const absentCount = monthAttendance.filter(r => r.status === 'absent').length;
    const lateCount = monthAttendance.filter(r => r.status === 'late').length;
    const leaveCount = monthAttendance.filter(r => r.status === 'leave').length;

    return (
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Ngày công', value: workCount, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
            { label: 'Vắng mặt', value: absentCount, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
            { label: 'Đi muộn', value: lateCount, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            { label: 'Nghỉ phép', value: leaveCount, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
          ].map((kpi, i) => (
            <div key={i} className={`p-3 rounded-xl ${kpi.bg} text-center`}>
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{kpi.label}</p>
              <p className={`text-xl font-black ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Mini Calendar Heatmap */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
            <Calendar size={16} className="text-teal-500" /> Tháng {currentMonth}/{currentYear}
          </h3>
          <div className="grid grid-cols-7 gap-1.5">
            {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map(d => (
              <div key={d} className="text-center text-[9px] font-black text-slate-400 py-1">{d}</div>
            ))}
            {/* Empty cells for start day */}
            {Array.from({ length: new Date(currentYear, currentMonth - 1, 1).getDay() }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const rec = attendanceMap.get(dateStr);
              const isToday = day === now.getDate() && currentMonth === now.getMonth() + 1;
              const isHoliday = holidays.some(h => h.date === dateStr);
              const dow = new Date(currentYear, currentMonth - 1, day).getDay();
              const isWeekend = dow === 0 || dow === 6;
              const cellStatus = rec?.status || (isHoliday ? 'holiday' : undefined);
              return (
                <div
                  key={day}
                  title={cellStatus ? statusLabels[cellStatus] || cellStatus : isWeekend ? 'Cuối tuần' : ''}
                  className={`relative aspect-square flex items-center justify-center rounded-lg text-[11px] font-black transition ${
                    cellStatus ? statusColors[cellStatus] || 'bg-slate-100 text-slate-500' :
                    isWeekend ? 'bg-slate-100 dark:bg-slate-800 text-slate-300' :
                    'bg-white dark:bg-slate-800/50 text-slate-500'
                  } ${isToday ? 'ring-2 ring-sky-400 ring-offset-1' : ''}`}
                >
                  {day}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 pt-2">
            {Object.entries(statusLabels).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1">
                <div className={`w-3 h-3 rounded ${statusColors[key]}`} />
                <span className="text-[9px] font-bold text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Leave Balance */}
        {empBalance && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
              <CalendarOff size={16} className="text-blue-500" /> Số dư nghỉ phép {currentYear}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20">
                <p className="text-[10px] font-black text-slate-400">Tích lũy</p>
                <p className="text-lg font-black text-blue-600">{empBalance.accruedDays}</p>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
                <p className="text-[10px] font-black text-slate-400">Đã dùng</p>
                <p className="text-lg font-black text-emerald-600">{empBalance.usedPaidDays}</p>
              </div>
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20">
                <p className="text-[10px] font-black text-slate-400">Không lương</p>
                <p className="text-lg font-black text-amber-600">{empBalance.usedUnpaidDays}</p>
              </div>
              <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-900/20">
                <p className="text-[10px] font-black text-slate-400">Còn lại</p>
                <p className={`text-lg font-black ${leaveRemaining > 0 ? 'text-sky-600' : 'text-red-500'}`}>{leaveRemaining}</p>
              </div>
            </div>
          </div>
        )}

        {/* Leave History */}
        {empLeave.length > 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-700 dark:text-white">Đơn nghỉ phép gần đây</h3>
            <div className="space-y-2">
              {empLeave.slice(0, 10).map(lr => (
                <div key={lr.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div>
                    <p className="text-xs font-bold text-slate-700 dark:text-white">{lr.code || 'N/A'} — {lr.reason.slice(0, 50)}</p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(lr.startDate).toLocaleDateString('vi-VN')} → {new Date(lr.endDate).toLocaleDateString('vi-VN')} ({lr.totalDays} ngày)
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                    lr.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    lr.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    lr.status === 'rejected' ? 'bg-red-100 text-red-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {lr.status === 'approved' ? 'Đã duyệt' : lr.status === 'pending' ? 'Chờ duyệt' : lr.status === 'rejected' ? 'Từ chối' : 'Đã huỷ'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ======================== TAB: PAYROLL ========================
  const renderPayroll = () => {
    const last12 = empPayroll.slice(0, 12).reverse();
    const maxNet = Math.max(...last12.map(p => p.netSalary || 0), 1);
    return (
      <div className="space-y-5">
        {/* Bar Chart */}
        {last12.length > 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
              <BarChart3 size={16} className="text-emerald-500" /> Thu nhập 12 tháng gần nhất
            </h3>
            <div className="flex items-end gap-1.5 h-40">
              {last12.map((p, i) => {
                const h = ((p.netSalary || 0) / maxNet) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="absolute -top-8 hidden group-hover:block">
                      <div className="px-2 py-1 bg-slate-900 text-white text-[9px] font-bold rounded-lg whitespace-nowrap shadow-lg">
                        {(p.netSalary || 0).toLocaleString('vi-VN')}đ
                      </div>
                    </div>
                    <div
                      className="w-full bg-gradient-to-t from-emerald-500 to-sky-400 rounded-t-lg transition-all duration-500 hover:from-emerald-400 hover:to-sky-300"
                      style={{ height: `${Math.max(h, 4)}%` }}
                    />
                    <span className="text-[8px] font-bold text-slate-400">T{p.month}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Latest Payslip */}
        {latestPayroll && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-700 dark:text-white">Phiếu lương gần nhất — T{latestPayroll.month}/{latestPayroll.year}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Lương cơ bản', value: latestPayroll.baseSalary, color: 'text-slate-700' },
                { label: 'Phụ cấp', value: latestPayroll.allowance || 0, color: 'text-blue-600' },
                { label: 'Thưởng', value: latestPayroll.bonus || 0, color: 'text-emerald-600' },
                { label: 'Khấu trừ', value: latestPayroll.deduction || 0, color: 'text-red-500' },
                { label: 'Bảo hiểm', value: latestPayroll.insurance || 0, color: 'text-amber-600' },
                { label: 'Thực nhận', value: latestPayroll.netSalary || 0, color: 'text-sky-600' },
              ].map((item, i) => (
                <div key={i} className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-[10px] font-black text-slate-400 uppercase">{item.label}</p>
                  <p className={`text-sm font-black ${item.color}`}>{(item.value || 0).toLocaleString('vi-VN')}đ</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Salary History */}
        {empSalaryHistory.length > 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
              <TrendingUp size={16} className="text-violet-500" /> Lịch sử điều chỉnh lương
            </h3>
            <div className="space-y-2">
              {empSalaryHistory.map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-900/10">
                  <div>
                    <p className="text-xs font-bold text-violet-700 dark:text-violet-400">{(s.newSalary || 0).toLocaleString('vi-VN')}đ</p>
                    <p className="text-[10px] text-slate-400">{new Date(s.effectiveDate).toLocaleDateString('vi-VN')} — {s.reason || ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {empPayroll.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <DollarSign className="w-12 h-12 mx-auto mb-3 text-slate-200" />
            <p className="font-bold">Chưa có dữ liệu lương</p>
          </div>
        )}
      </div>
    );
  };

  // ======================== TAB: ASSETS ========================
  const renderAssets = () => (
    <div className="space-y-5">
      {empAssignments.length > 0 ? (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
            <Package size={16} className="text-rose-500" /> Tài sản được cấp phát ({empAssignments.length})
          </h3>
          <div className="space-y-2">
            {empAssignments.map(a => {
              const asset = assets.find(ast => ast.id === a.assetId);
              const isReturned = !!a.returnedDate;
              return (
                <div key={a.id} className={`flex items-center justify-between px-3 py-3 rounded-xl border transition ${isReturned ? 'bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700 opacity-60' : 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/30'}`}>
                  <div>
                    <p className="text-xs font-black text-slate-700 dark:text-white">{asset?.name || 'N/A'}</p>
                    <p className="text-[10px] text-slate-400">
                      Mã: {asset?.assetCode || '?'} • Cấp: {new Date(a.assignedDate).toLocaleDateString('vi-VN')}
                      {isReturned && ` • Thu hồi: ${new Date(a.returnedDate!).toLocaleDateString('vi-VN')}`}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${isReturned ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                    {isReturned ? 'Đã thu hồi' : 'Đang giữ'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-400">
          <Package className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="font-bold">Chưa được cấp phát tài sản</p>
        </div>
      )}
    </div>
  );

  // ======================== TAB: REQUESTS ========================
  const renderRequests = () => (
    <div className="space-y-5">
      {/* Material Requests */}
      {empMaterialRequests.length > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
            <FileText size={16} className="text-blue-500" /> Đề xuất vật tư ({empMaterialRequests.length})
          </h3>
          <div className="space-y-2">
            {empMaterialRequests.slice(0, 15).map(r => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-white">{r.code || 'N/A'}</p>
                  <p className="text-[10px] text-slate-400">{new Date(r.date).toLocaleDateString('vi-VN')}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                  r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                  r.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-500'
                }`}>
                  {r.status === 'approved' ? 'Đã duyệt' : r.status === 'pending' ? 'Chờ duyệt' : r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions */}
      {empTransactions.length > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
            <Repeat size={16} className="text-emerald-500" /> Phiếu Nhập / Xuất ({empTransactions.length})
          </h3>
          <div className="space-y-2">
            {empTransactions.slice(0, 15).map(t => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-white">{t.code || t.id.slice(0, 8)}</p>
                  <p className="text-[10px] text-slate-400">{t.type === 'in' ? '📥 Nhập kho' : '📤 Xuất kho'} • {new Date(t.date).toLocaleDateString('vi-VN')}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                  t.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                  t.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-500'
                }`}>
                  {t.status === 'completed' ? 'Hoàn thành' : t.status === 'pending' ? 'Chờ duyệt' : t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {empMaterialRequests.length === 0 && empTransactions.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="font-bold">Chưa có yêu cầu hoặc giao dịch nào</p>
        </div>
      )}
    </div>
  );

  // ======================== TAB: ACTIVITY TIMELINE ========================
  const renderActivityTimeline = (limit = 50) => {
    // Build a combined timeline from all data sources
    const timeline: { date: string; type: string; title: string; detail: string; color: string }[] = [];

    // Attendance
    empAttendance.slice(0, 60).forEach(r => {
      const labels: Record<string, string> = { present: 'Đi làm', late: 'Đi muộn', absent: 'Vắng', leave: 'Nghỉ phép' };
      timeline.push({ date: r.date, type: 'attendance', title: labels[r.status] || r.status, detail: `${r.checkIn || ''} — ${r.checkOut || ''}`, color: 'text-emerald-500' });
    });

    // Leave requests
    empLeave.forEach(lr => {
      timeline.push({ date: lr.createdAt, type: 'leave', title: `Nghỉ phép: ${lr.reason.slice(0, 40)}`, detail: `${lr.totalDays} ngày (${lr.status})`, color: 'text-blue-500' });
    });

    // Payroll
    empPayroll.forEach(p => {
      timeline.push({ date: `${p.year}-${String(p.month).padStart(2, '0')}-28`, type: 'payroll', title: `Lương T${p.month}/${p.year}`, detail: `${(p.netSalary || 0).toLocaleString('vi-VN')}đ`, color: 'text-amber-500' });
    });

    // Contracts
    empContracts.forEach(c => {
      timeline.push({ date: c.startDate, type: 'contract', title: `Hợp đồng: ${c.contractType}`, detail: c.contractNumber || '', color: 'text-violet-500' });
    });

    // Asset assignments
    empAssignments.forEach(a => {
      const asset = assets.find(ast => ast.id === a.assetId);
      timeline.push({ date: a.assignedDate, type: 'asset', title: `Cấp phát: ${asset?.name || 'N/A'}`, detail: asset?.assetCode || '', color: 'text-rose-500' });
    });

    // Sort by date descending
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const items = timeline.slice(0, limit);

    if (items.length === 0) {
      return <p className="text-center text-sm text-slate-400 py-6">Chưa có hoạt động nào.</p>;
    }

    const typeIcons: Record<string, any> = {
      attendance: Calendar, leave: CalendarOff, payroll: DollarSign, contract: FileSignature, asset: Package,
    };

    return (
      <div className="space-y-1">
        {items.map((item, i) => {
          const Icon = typeIcons[item.type] || Activity;
          return (
            <div key={i} className="flex items-start gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
              <div className={`mt-0.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 ${item.color}`}>
                <Icon size={12} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 dark:text-white truncate">{item.title}</p>
                <p className="text-[10px] text-slate-400 truncate">{item.detail}</p>
              </div>
              <span className="text-[10px] text-slate-400 font-medium shrink-0">
                {new Date(item.date).toLocaleDateString('vi-VN')}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderActivity = () => (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-2">
        <Activity size={16} className="text-sky-500" /> Timeline hoạt động toàn bộ
      </h3>
      {renderActivityTimeline(50)}
    </div>
  );

  // ======================== TAB CONTENT MAP ========================
  const tabContent: Record<TabKey, () => React.ReactNode> = {
    overview: renderOverview,
    attendance: renderAttendance,
    payroll: renderPayroll,
    assets: renderAssets,
    requests: renderRequests,
    activity: renderActivity,
  };

  // ======================== MAIN RENDER ========================
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Back Button */}
      <button onClick={() => navigate('/ep')} className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-sky-600 transition">
        <ArrowLeft size={16} /> Danh sách nhân viên
      </button>

      {/* Profile Header */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {/* Top gradient */}
        <div className={`h-2 ${isActive ? 'bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600' : 'bg-gradient-to-r from-red-300 to-red-500'}`} />

        <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar */}
          <div className="relative">
            <img
              src={avatarUrl}
              alt={employee.fullName}
              className="w-20 h-20 rounded-2xl object-cover ring-4 ring-white dark:ring-slate-700 shadow-xl"
            />
            <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-3 border-white dark:border-slate-800 ${isActive ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-xs font-black tracking-wider">
                {employee.employeeCode}
              </span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {employee.status}
              </span>
            </div>
            <h1 className="text-xl font-black text-slate-800 dark:text-white">{employee.fullName}</h1>
            <p className="text-sm text-slate-500 font-medium">{employee.title || 'Chưa có chức vụ'}</p>
          </div>

          {/* Header KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Ngày công', value: workDays, unit: 'ngày', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
              { label: 'Phép còn', value: leaveRemaining, unit: 'ngày', color: leaveRemaining > 0 ? 'text-blue-600' : 'text-red-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
              { label: 'Lương gần nhất', value: latestPayroll ? `${(latestPayroll.netSalary / 1000000).toFixed(1)}tr` : '—', unit: '', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
              { label: 'Tài sản', value: activeAssets, unit: 'TS', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
            ].map((kpi, i) => (
              <div key={i} className={`px-3 py-2 rounded-xl ${kpi.bg} text-center min-w-[80px]`}>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                <p className={`text-base font-black ${kpi.color}`}>
                  {kpi.value}{kpi.unit && <span className="text-[10px] font-bold text-slate-400 ml-0.5">{kpi.unit}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(tab => {
          const TabIcon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                  : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-sky-50 dark:hover:bg-sky-900/10 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <TabIcon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>{tabContent[activeTab]()}</div>
    </div>
  );
};

export default EmployeeProfile;
