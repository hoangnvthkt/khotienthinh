import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  BarChart3, Users, Calendar, DollarSign, Clock, Download,
  TrendingUp, AlertTriangle, Award, CalendarOff
} from 'lucide-react';

type ReportTab = 'overview' | 'attendance' | 'payroll' | 'leave';

const HrmReports: React.FC = () => {
  const {
    employees, attendanceRecords, leaveRequests, leaveBalances,
    payrollRecords, laborContracts, holidays
  } = useApp();
  useModuleData('hrm');
  const { theme } = useTheme();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  const [tab, setTab] = useState<ReportTab>('overview');
  const [reportMonth, setReportMonth] = useState(() => new Date().getMonth() + 1);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());

  const monthStr = String(reportMonth).padStart(2, '0');

  // ==================== ATTENDANCE DATA ====================

  const attendanceData = useMemo(() => {
    return activeEmployees.map(emp => {
      let present = 0, absent = 0, halfDay = 0, leave = 0, holiday = 0, trip = 0, ot = 0;
      let lateCount = 0, earlyCount = 0;
      const daysInMonth = new Date(reportYear, reportMonth, 0).getDate();

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${reportYear}-${monthStr}-${String(d).padStart(2, '0')}`;
        const rec = attendanceRecords.find(r => r.employeeId === emp.id && r.date === dateStr);
        if (rec) {
          if (rec.status === 'present') present++;
          else if (rec.status === 'absent') absent++;
          else if (rec.status === 'half_day') halfDay++;
          else if (rec.status === 'leave') leave++;
          else if (rec.status === 'holiday') holiday++;
          else if (rec.status === 'business_trip') trip++;
          ot += rec.overtimeHours || 0;
          if (rec.checkIn) {
            const [h, m] = rec.checkIn.split(':').map(Number);
            if (h * 60 + m > 480) lateCount++; // > 08:00
          }
          if (rec.checkOut) {
            const [h, m] = rec.checkOut.split(':').map(Number);
            if (h * 60 + m < 1020) earlyCount++; // < 17:00
          }
        }
      }
      const workDays = present + halfDay * 0.5 + trip;
      return { emp, present, absent, halfDay, leave, holiday, trip, ot, workDays, lateCount, earlyCount };
    });
  }, [activeEmployees, attendanceRecords, reportMonth, reportYear]);

  // ==================== PAYROLL DATA ====================

  const payrollData = useMemo(() => {
    return payrollRecords
      .filter(p => p.month === reportMonth && p.year === reportYear)
      .map(p => {
        const emp = employeeMap.get(p.employeeId);
        const totalAllowance = p.allowancePosition + p.allowanceMeal + p.allowanceTransport + p.allowancePhone + p.allowanceOther;
        const totalDeduction = p.deductionInsurance + p.deductionTax + p.deductionAdvance + p.deductionOther;
        return { ...p, emp, totalAllowance, totalDeduction };
      })
      .sort((a, b) => (a.emp?.fullName || '').localeCompare(b.emp?.fullName || ''));
  }, [payrollRecords, reportMonth, reportYear, employeeMap]);

  // ==================== LEAVE DATA ====================

  const leaveData = useMemo(() => {
    return activeEmployees.map(emp => {
      const bal = leaveBalances.find(b => b.employeeId === emp.id && b.year === reportYear);
      const requests = leaveRequests.filter(r =>
        r.employeeId === emp.id && r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === reportYear
      );
      const totalUsed = requests.reduce((s, r) => s + r.totalDays, 0);
      const monthRequests = requests.filter(r => new Date(r.startDate).getMonth() + 1 === reportMonth);
      const monthUsed = monthRequests.reduce((s, r) => s + r.totalDays, 0);
      return {
        emp,
        totalDays: bal?.initialDays || 12,
        accrued: bal?.accruedDays || 0,
        usedPaid: bal?.usedPaidDays || 0,
        usedUnpaid: bal?.usedUnpaidDays || 0,
        remaining: (bal?.accruedDays || 0) - (bal?.usedPaidDays || 0),
        totalUsed,
        monthUsed,
      };
    });
  }, [activeEmployees, leaveBalances, leaveRequests, reportYear, reportMonth]);

  // ==================== OVERVIEW STATS ====================

  const overviewStats = useMemo(() => {
    const totalWork = attendanceData.reduce((s, d) => s + d.workDays, 0);
    const totalAbsent = attendanceData.reduce((s, d) => s + d.absent, 0);
    const totalLeave = attendanceData.reduce((s, d) => s + d.leave, 0);
    const totalLate = attendanceData.reduce((s, d) => s + d.lateCount, 0);
    const totalEarly = attendanceData.reduce((s, d) => s + d.earlyCount, 0);
    const totalOT = attendanceData.reduce((s, d) => s + d.ot, 0);
    const payrollTotal = payrollData.reduce((s, d) => s + d.netSalary, 0);
    const payrollGross = payrollData.reduce((s, d) => s + d.grossSalary, 0);
    const totalDeductions = payrollData.reduce((s, d) => s + d.totalDeduction, 0);
    const avgSalary = payrollData.length > 0 ? payrollTotal / payrollData.length : 0;
    // Top late employees
    const topLate = [...attendanceData]
      .filter(d => d.lateCount > 0)
      .sort((a, b) => b.lateCount - a.lateCount)
      .slice(0, 5);
    // Top OT
    const topOT = [...attendanceData]
      .filter(d => d.ot > 0)
      .sort((a, b) => b.ot - a.ot)
      .slice(0, 5);
    return { totalWork, totalAbsent, totalLeave, totalLate, totalEarly, totalOT, payrollTotal, payrollGross, totalDeductions, avgSalary, topLate, topOT };
  }, [attendanceData, payrollData]);

  // ==================== EXPORT ====================

  const exportReport = (type: string) => {
    let csv = '';
    if (type === 'attendance') {
      csv = 'Mã NV,Họ tên,Ngày công,Vắng,Nghỉ phép,Lễ,CT,OT (h),Đi muộn,Về sớm\n';
      attendanceData.forEach(d => {
        csv += `${d.emp.employeeCode},${d.emp.fullName},${d.workDays},${d.absent},${d.leave},${d.holiday},${d.trip},${d.ot},${d.lateCount},${d.earlyCount}\n`;
      });
    } else if (type === 'payroll') {
      csv = 'Mã NV,Họ tên,Lương CB,Phụ cấp,Khấu trừ,Tổng TN,Thực lĩnh,Trạng thái\n';
      payrollData.forEach(d => {
        csv += `${d.emp?.employeeCode},${d.emp?.fullName},${d.baseSalary},${d.totalAllowance},${d.totalDeduction},${d.grossSalary},${d.netSalary},${d.status}\n`;
      });
    } else if (type === 'leave') {
      csv = 'Mã NV,Họ tên,Tổng phép,Đã tích lũy,Đã dùng (có lương),KXL,Còn lại,Tháng này\n';
      leaveData.forEach(d => {
        csv += `${d.emp.employeeCode},${d.emp.fullName},${d.totalDays},${d.accrued},${d.usedPaid},${d.usedUnpaid},${d.remaining},${d.monthUsed}\n`;
      });
    }
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_T${reportMonth}_${reportYear}.csv`;
    link.click();
  };

  const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + 'đ';
  const fmtShort = (v: number) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v.toLocaleString('vi-VN');

  const tabs: { id: ReportTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Tổng quan', icon: <BarChart3 size={14} /> },
    { id: 'attendance', label: 'Chấm công', icon: <Calendar size={14} /> },
    { id: 'payroll', label: 'Bảng lương', icon: <DollarSign size={14} /> },
    { id: 'leave', label: 'Nghỉ phép', icon: <CalendarOff size={14} /> },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="text-indigo-500" size={24} /> Báo cáo Nhân sự
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Tổng hợp chấm công, lương, nghỉ phép tháng {reportMonth}/{reportYear}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={reportMonth} onChange={e => setReportMonth(Number(e.target.value))}
            className="px-3 py-2 text-sm font-black border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}
          </select>
          <select value={reportYear} onChange={e => setReportYear(Number(e.target.value))}
            className="px-3 py-2 text-sm font-black border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
            {Array.from({ length: 5 }, (_, i) => <option key={reportYear - 2 + i} value={reportYear - 2 + i}>{reportYear - 2 + i}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-black transition flex items-center gap-1.5 ${
              tab === t.id ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ==================== OVERVIEW TAB ==================== */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nhân viên</p>
              <p className="text-2xl font-black text-slate-800 dark:text-white">{activeEmployees.length}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng ngày công</p>
              <p className="text-2xl font-black text-emerald-600">{overviewStats.totalWork.toFixed(1)}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vắng mặt</p>
              <p className="text-2xl font-black text-red-500">{overviewStats.totalAbsent}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đi muộn</p>
              <p className="text-2xl font-black text-orange-500">{overviewStats.totalLate}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng OT</p>
              <p className="text-2xl font-black text-amber-500">{overviewStats.totalOT}h</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng chi lương</p>
              <p className="text-2xl font-black text-indigo-600">{fmtShort(overviewStats.payrollTotal)}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lương TB/NV</p>
              <p className="text-2xl font-black text-teal-600">{fmtShort(overviewStats.avgSalary)}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng bảo hiểm</p>
              <p className="text-2xl font-black text-rose-500">{fmtShort(overviewStats.totalDeductions)}</p>
            </div>
          </div>

          {/* Two-column layout: Top Late + Top OT */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Late */}
            <div className="glass-panel rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-orange-500" /> Top đi muộn
              </h3>
              {overviewStats.topLate.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">Không có ai đi muộn 🎉</p>
              ) : (
                <div className="space-y-2">
                  {overviewStats.topLate.map((d, i) => (
                    <div key={d.emp.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-[9px] font-black text-white ${
                          i === 0 ? 'bg-red-500' : i === 1 ? 'bg-orange-400' : 'bg-slate-400'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{d.emp.fullName}</span>
                      </div>
                      <span className="text-xs font-black text-orange-500">{d.lateCount} lần</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top OT */}
            <div className="glass-panel rounded-2xl p-5">
              <h3 className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Award size={14} className="text-amber-500" /> Top tăng ca
              </h3>
              {overviewStats.topOT.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">Không có tăng ca</p>
              ) : (
                <div className="space-y-2">
                  {overviewStats.topOT.map((d, i) => (
                    <div key={d.emp.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-[9px] font-black text-white ${
                          i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-yellow-400' : 'bg-slate-400'
                        }`}>{i + 1}</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{d.emp.fullName}</span>
                      </div>
                      <span className="text-xs font-black text-amber-500">{d.ot}h</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== ATTENDANCE TAB ==================== */}
      {tab === 'attendance' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => exportReport('attendance')} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-1.5">
              <Download size={14} /> Xuất CSV
            </button>
          </div>
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Nhân viên</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Công</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Vắng</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Phép</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Lễ</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">CT</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">OT</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Muộn</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Sớm</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceData.map((d, idx) => (
                    <tr key={d.emp.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-black text-slate-800 dark:text-white">{d.emp.fullName}</div>
                        <div className="text-[10px] font-mono text-slate-400">{d.emp.employeeCode}</div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm font-black text-emerald-600">{d.workDays}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-red-500">{d.absent || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-blue-500">{d.leave || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-purple-500">{d.holiday || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-teal-500">{d.trip || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-amber-500">{d.ot || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-orange-500">{d.lateCount || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-orange-400">{d.earlyCount || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Totals */}
            <div className="border-t border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <span className="text-xs font-black text-slate-500">TỔNG ({attendanceData.length} NV)</span>
              <div className="flex gap-4 text-xs font-black">
                <span className="text-emerald-600">Công: {attendanceData.reduce((s, d) => s + d.workDays, 0).toFixed(1)}</span>
                <span className="text-amber-500">OT: {attendanceData.reduce((s, d) => s + d.ot, 0)}h</span>
                <span className="text-orange-500">Muộn: {attendanceData.reduce((s, d) => s + d.lateCount, 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== PAYROLL TAB ==================== */}
      {tab === 'payroll' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => exportReport('payroll')} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-1.5">
              <Download size={14} /> Xuất CSV
            </button>
          </div>
          {payrollData.length === 0 ? (
            <div className="glass-panel rounded-2xl p-16 text-center">
              <DollarSign size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-sm font-black text-slate-400">Chưa có bảng lương tháng {reportMonth}/{reportYear}</p>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Nhân viên</th>
                      <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Công</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Lương CB</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Phụ cấp</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Khấu trừ</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Tổng TN</th>
                      <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Thực lĩnh</th>
                      <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">TT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollData.map((d, idx) => (
                      <tr key={d.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}>
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-black text-slate-800 dark:text-white">{d.emp?.fullName || 'N/A'}</div>
                          <div className="text-[10px] font-mono text-slate-400">{d.emp?.employeeCode}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-bold text-blue-600">{d.workingDays}/{d.standardDays}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">{fmtMoney(d.baseSalary)}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-emerald-600">+{fmtMoney(d.totalAllowance)}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-red-500">-{fmtMoney(d.totalDeduction)}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-slate-600">{fmtMoney(d.grossSalary)}</td>
                        <td className="px-3 py-2.5 text-right text-sm font-black text-slate-800 dark:text-white">{fmtMoney(d.netSalary)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                            d.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            d.status === 'confirmed' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {d.status === 'paid' ? 'Đã trả' : d.status === 'confirmed' ? 'XN' : 'Nháp'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                <span className="text-xs font-black text-slate-500">TỔNG ({payrollData.length} NV)</span>
                <div className="flex gap-4 text-xs font-black">
                  <span className="text-emerald-600">Phụ cấp: {fmtShort(payrollData.reduce((s, d) => s + d.totalAllowance, 0))}</span>
                  <span className="text-red-500">Khấu trừ: {fmtShort(payrollData.reduce((s, d) => s + d.totalDeduction, 0))}</span>
                  <span className="text-indigo-600">Thực lĩnh: {fmtShort(payrollData.reduce((s, d) => s + d.netSalary, 0))}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== LEAVE TAB ==================== */}
      {tab === 'leave' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => exportReport('leave')} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-1.5">
              <Download size={14} /> Xuất CSV
            </button>
          </div>
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Nhân viên</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Tổng phép</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Tích lũy</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Đã dùng</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">KXL</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Còn lại</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Tháng này</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveData.map((d, idx) => (
                    <tr key={d.emp.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-black text-slate-800 dark:text-white">{d.emp.fullName}</div>
                        <div className="text-[10px] font-mono text-slate-400">{d.emp.employeeCode}</div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-slate-600">{d.totalDays}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-blue-500">{d.accrued}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-amber-500">{d.usedPaid || '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-red-400">{d.usedUnpaid || '-'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-sm font-black ${d.remaining > 3 ? 'text-emerald-600' : d.remaining > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                          {d.remaining}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold text-indigo-500">{d.monthUsed || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <span className="text-xs font-black text-slate-500">TỔNG ({leaveData.length} NV)</span>
              <div className="flex gap-4 text-xs font-black">
                <span className="text-amber-500">Đã dùng: {leaveData.reduce((s, d) => s + d.usedPaid, 0)} ngày</span>
                <span className="text-emerald-600">Còn lại: {leaveData.reduce((s, d) => s + d.remaining, 0)} ngày</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HrmReports;
