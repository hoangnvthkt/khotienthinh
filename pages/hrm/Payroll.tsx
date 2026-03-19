import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  DollarSign, Plus, Download, Search, ChevronDown, Calculator,
  CheckCircle, FileText, Users, TrendingUp
} from 'lucide-react';
import { PayrollRecord, AttendanceStatus } from '../../types';

const PAYROLL_STATUS_LABELS: Record<string, string> = { draft: 'Nháp', confirmed: 'Xác nhận', paid: 'Đã trả' };
const PAYROLL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const Payroll: React.FC = () => {
  const { employees, payrollRecords, attendanceRecords, laborContracts, addHrmItem, updateHrmItem } = useApp();
  const { theme } = useTheme();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [showGenModal, setShowGenModal] = useState(false);
  const [standardDays, setStandardDays] = useState(26);
  const [searchText, setSearchText] = useState('');

  // Current month payrolls
  const currentPayrolls = useMemo(() =>
    payrollRecords.filter(p => p.month === selectedMonth && p.year === selectedYear)
      .sort((a, b) => {
        const ea = employeeMap.get(a.employeeId)?.fullName || '';
        const eb = employeeMap.get(b.employeeId)?.fullName || '';
        return ea.localeCompare(eb);
      }), [payrollRecords, selectedMonth, selectedYear, employeeMap]);

  const filteredPayrolls = useMemo(() => {
    if (!searchText) return currentPayrolls;
    const q = searchText.toLowerCase();
    return currentPayrolls.filter(p => {
      const emp = employeeMap.get(p.employeeId);
      return emp?.fullName.toLowerCase().includes(q) || emp?.employeeCode.toLowerCase().includes(q);
    });
  }, [currentPayrolls, searchText, employeeMap]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const total = currentPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const draft = currentPayrolls.filter(p => p.status === 'draft').length;
    const paid = currentPayrolls.filter(p => p.status === 'paid').length;
    return { total, draft, paid, count: currentPayrolls.length };
  }, [currentPayrolls]);

  // Generate payroll from attendance + contracts
  const generatePayroll = () => {
    const monthStr = String(selectedMonth).padStart(2, '0');
    const existing = new Set(currentPayrolls.map(p => p.employeeId));

    activeEmployees.forEach(emp => {
      if (existing.has(emp.id)) return;

      // Find contract for salary
      const contract = laborContracts
        .filter(c => c.employeeId === emp.id && c.status === 'active')
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

      const baseSalary = contract?.baseSalary || 0;
      const allowancePosition = contract?.allowancePosition || 0;
      const dailyRate = baseSalary > 0 ? Math.round(baseSalary / standardDays) : 0;

      // Count working days from attendance
      let workingDays = 0;
      let overtimeHours = 0;
      for (let d = 1; d <= 31; d++) {
        const dateStr = `${selectedYear}-${monthStr}-${String(d).padStart(2, '0')}`;
        const rec = attendanceRecords.find(r => r.employeeId === emp.id && r.date === dateStr);
        if (rec) {
          if (rec.status === 'present' || rec.status === 'business_trip') workingDays += 1;
          else if (rec.status === 'half_day') workingDays += 0.5;
          else if (rec.status === 'holiday') workingDays += 1;
          overtimeHours += rec.overtimeHours || 0;
        }
      }

      const overtimeRate = Math.round(dailyRate / 8 * 1.5);
      const allowanceMeal = workingDays * 30000; // 30k/ngày
      const allowanceTransport = 0;
      const allowancePhone = 0;
      const allowanceOther = contract?.allowanceOther || 0;

      const grossSalary = dailyRate * workingDays
        + overtimeRate * overtimeHours
        + allowancePosition + allowanceMeal + allowanceTransport + allowancePhone + allowanceOther;

      // Deductions
      const deductionInsurance = Math.round(baseSalary * 0.105); // 10.5% BHXH+BHYT+BHTN
      const deductionTax = 0; // Simplified
      const deductionAdvance = 0;
      const deductionOther = 0;

      const netSalary = grossSalary - deductionInsurance - deductionTax - deductionAdvance - deductionOther;

      const record: PayrollRecord = {
        id: crypto.randomUUID(),
        employeeId: emp.id,
        month: selectedMonth,
        year: selectedYear,
        workingDays, standardDays, overtimeHours,
        baseSalary, dailyRate, overtimeRate,
        allowancePosition, allowanceMeal, allowanceTransport, allowancePhone, allowanceOther,
        deductionInsurance, deductionTax, deductionAdvance, deductionOther,
        grossSalary, netSalary,
        status: 'draft',
        createdAt: new Date().toISOString(),
      };

      addHrmItem('hrm_payrolls', record);
    });

    setShowGenModal(false);
  };

  const confirmPayroll = (p: PayrollRecord) => updateHrmItem('hrm_payrolls', { ...p, status: 'confirmed' });
  const markPaid = (p: PayrollRecord) => updateHrmItem('hrm_payrolls', { ...p, status: 'paid', paidDate: new Date().toISOString().split('T')[0] });

  // Export CSV
  const exportCSV = () => {
    const header = ['Mã NV', 'Họ tên', 'Ngày công', 'Lương CB', 'Tổng phụ cấp', 'Tổng khấu trừ', 'Tổng TN', 'Thực lĩnh', 'Trạng thái'];
    const rows = filteredPayrolls.map(p => {
      const emp = employeeMap.get(p.employeeId);
      const totalAllowance = p.allowancePosition + p.allowanceMeal + p.allowanceTransport + p.allowancePhone + p.allowanceOther;
      const totalDeduction = p.deductionInsurance + p.deductionTax + p.deductionAdvance + p.deductionOther;
      return [emp?.employeeCode, emp?.fullName, p.workingDays, p.baseSalary, totalAllowance, totalDeduction, p.grossSalary, p.netSalary, PAYROLL_STATUS_LABELS[p.status]];
    });
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bangluong_T${selectedMonth}_${selectedYear}.csv`;
    link.click();
  };

  const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + 'đ';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <DollarSign className="text-emerald-500" size={24} /> Bảng Lương
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">Tính lương và quản lý chi trả hàng tháng</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowGenModal(true)} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5">
            <Calculator size={14} /> Tính lương
          </button>
          <button onClick={exportCSV} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-1.5">
            <Download size={14} /> Xuất CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Phiếu lương</p>
          <p className="text-xl font-black text-slate-800 dark:text-white">{kpis.count}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng chi</p>
          <p className="text-xl font-black text-emerald-600">{(kpis.total / 1000000).toFixed(1)}M</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Chưa xác nhận</p>
          <p className="text-xl font-black text-amber-500">{kpis.draft}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đã trả</p>
          <p className="text-xl font-black text-blue-500">{kpis.paid}</p>
        </div>
      </div>

      {/* Month selector + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 text-sm font-black border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>)}
          </select>
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 text-sm font-black border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
            {Array.from({ length: 5 }, (_, i) => <option key={selectedYear - 2 + i} value={selectedYear - 2 + i}>{selectedYear - 2 + i}</option>)}
          </select>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm NV..." value={searchText} onChange={e => setSearchText(e.target.value)}
            className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-40" />
        </div>
      </div>

      {/* Payroll Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ display: 'table' }}>
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800">
                <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Nhân viên</th>
                <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Ngày công</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Lương CB</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase hidden md:table-cell">Phụ cấp</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase hidden md:table-cell">Khấu trừ</th>
                <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">Thực lĩnh</th>
                <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Trạng thái</th>
                <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayrolls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <DollarSign size={40} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black text-slate-400">Chưa có bảng lương</p>
                    <p className="text-xs text-slate-400 mt-1">Nhấn "Tính lương" để tạo bảng lương từ chấm công</p>
                  </td>
                </tr>
              ) : (
                filteredPayrolls.map((p, idx) => {
                  const emp = employeeMap.get(p.employeeId);
                  const totalAllowance = p.allowancePosition + p.allowanceMeal + p.allowanceTransport + p.allowancePhone + p.allowanceOther;
                  const totalDeduction = p.deductionInsurance + p.deductionTax + p.deductionAdvance + p.deductionOther;
                  return (
                    <tr key={p.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'} hover:bg-blue-50/50 dark:hover:bg-blue-950/10 transition`}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-black text-slate-800 dark:text-white">{emp?.fullName || 'N/A'}</div>
                        <div className="text-[10px] font-mono text-slate-400">{emp?.employeeCode}</div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm font-black text-blue-600">{p.workingDays}</span>
                        <span className="text-[10px] text-slate-400">/{p.standardDays}</span>
                        {p.overtimeHours > 0 && <div className="text-[9px] text-amber-500 font-bold">+{p.overtimeHours}h OT</div>}
                      </td>
                      <td className="px-3 py-3 text-right text-xs font-bold text-slate-600 dark:text-slate-400">{fmtMoney(p.baseSalary)}</td>
                      <td className="px-3 py-3 text-right text-xs font-bold text-emerald-600 hidden md:table-cell">+{fmtMoney(totalAllowance)}</td>
                      <td className="px-3 py-3 text-right text-xs font-bold text-red-500 hidden md:table-cell">-{fmtMoney(totalDeduction)}</td>
                      <td className="px-3 py-3 text-right text-sm font-black text-slate-800 dark:text-white">{fmtMoney(p.netSalary)}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${PAYROLL_STATUS_COLORS[p.status]}`}>
                          {PAYROLL_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {p.status === 'draft' && (
                            <button onClick={() => confirmPayroll(p)} className="p-1.5 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 transition text-[10px] font-black" title="Xác nhận">
                              <CheckCircle size={14} />
                            </button>
                          )}
                          {p.status === 'confirmed' && (
                            <button onClick={() => markPaid(p)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition text-[10px] font-black" title="Đánh dấu đã trả">
                              <DollarSign size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Total row */}
        {filteredPayrolls.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
            <span className="text-xs font-black text-slate-500 uppercase">Tổng cộng ({filteredPayrolls.length} NV)</span>
            <span className="text-lg font-black text-emerald-600">{fmtMoney(filteredPayrolls.reduce((s, p) => s + p.netSalary, 0))}</span>
          </div>
        )}
      </div>

      {/* Generate Modal */}
      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Calculator size={20} className="text-emerald-500" /> Tính lương tháng {selectedMonth}/{selectedYear}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Ngày công chuẩn</label>
                <input type="number" value={standardDays} onChange={e => setStandardDays(Number(e.target.value))}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
              </div>
              <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-xl text-xs text-amber-700 dark:text-amber-400 font-bold">
                ⚠️ Hệ thống sẽ tính lương dựa trên:<br/>
                • Bảng chấm công tháng {selectedMonth}<br/>
                • Hợp đồng lao động hiện tại<br/>
                • Những NV chưa có phiếu lương sẽ được tạo mới
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowGenModal(false)} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={generatePayroll} className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition">
                Tạo bảng lương
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payroll;
