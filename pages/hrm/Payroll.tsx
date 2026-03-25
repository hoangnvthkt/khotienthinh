import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  DollarSign, Plus, Download, Search, Calculator,
  CheckCircle, Users, Trash2, GripVertical, FileText,
  Settings, ArrowLeft, ChevronDown, ChevronUp, Edit3, Copy, X
} from 'lucide-react';
import {
  PayrollRecord, PayrollTemplate, PayrollTemplateField,
  PayrollFieldType, PayrollFieldSource,
  PAYROLL_FIELD_SOURCE_LABELS, PAYROLL_FIELD_TYPE_LABELS,
  AttendanceStatus
} from '../../types';

const PAYROLL_STATUS_LABELS: Record<string, string> = { draft: 'Nháp', confirmed: 'Xác nhận', paid: 'Đã trả' };
const PAYROLL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const FIELD_TYPE_COLORS: Record<PayrollFieldType, string> = {
  income: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  deduction: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  formula: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

// ==================== FORMULA ENGINE ====================

/**
 * Evaluate formula string like "{Lương HĐ} * 10.5%" or "{A} + {B} - {C}"
 * Supports: +, -, *, /, %
 */
function evaluateFormula(formula: string, fieldValues: Record<string, number>): number {
  if (!formula) return 0;
  try {
    // Replace {FieldName} with values
    let expr = formula.replace(/\{([^}]+)\}/g, (_, fieldName) => {
      const val = fieldValues[fieldName.trim()];
      return String(val ?? 0);
    });
    // Handle percentage: "10.5%" → "* 0.105" ... but "* 10.5%" → "* 0.105"
    expr = expr.replace(/(\d+\.?\d*)%/g, (_, num) => String(parseFloat(num) / 100));
    // Sanitize: only allow numbers, operators, spaces, dots, parens
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
    // eslint-disable-next-line no-eval
    const result = Function('"use strict"; return (' + expr + ')')();
    return isNaN(result) || !isFinite(result) ? 0 : Math.round(result);
  } catch {
    return 0;
  }
}

// ==================== DEFAULT TEMPLATE FIELDS ====================

function getDefaultFields(): PayrollTemplateField[] {
  return [
    { id: crypto.randomUUID(), name: 'Ngày công', type: 'info', source: 'attendance_days', order: 1 },
    { id: crypto.randomUUID(), name: 'Lương hợp đồng', type: 'income', source: 'contract_salary', order: 2 },
    { id: crypto.randomUUID(), name: 'Đơn giá ngày', type: 'info', source: 'contract_daily_rate', order: 3 },
    { id: crypto.randomUUID(), name: 'Lương theo ngày công', type: 'formula', formula: '{Ngày công} * {Đơn giá ngày}', order: 4 },
    { id: crypto.randomUUID(), name: 'Phụ cấp chức vụ', type: 'income', source: 'contract_allowance', order: 5 },
    { id: crypto.randomUUID(), name: 'Phụ cấp ăn trưa', type: 'income', source: 'manual', order: 6 },
    { id: crypto.randomUUID(), name: 'OT ngày thường (giờ)', type: 'info', source: 'attendance_ot_normal', order: 7 },
    { id: crypto.randomUUID(), name: 'Tiền OT thường', type: 'formula', formula: '{OT ngày thường (giờ)} * {Đơn giá ngày} / 8 * 1.5', order: 8 },
    { id: crypto.randomUUID(), name: 'Tổng thu nhập', type: 'formula', formula: '{Lương theo ngày công} + {Phụ cấp chức vụ} + {Phụ cấp ăn trưa} + {Tiền OT thường}', order: 9 },
    { id: crypto.randomUUID(), name: 'Trừ BHXH (8%)', type: 'formula', formula: '{Lương hợp đồng} * 8%', order: 10 },
    { id: crypto.randomUUID(), name: 'Trừ BHYT (1.5%)', type: 'formula', formula: '{Lương hợp đồng} * 1.5%', order: 11 },
    { id: crypto.randomUUID(), name: 'Trừ BHTN (1%)', type: 'formula', formula: '{Lương hợp đồng} * 1%', order: 12 },
    { id: crypto.randomUUID(), name: 'Thuế TNCN', type: 'deduction', source: 'manual', order: 13 },
    { id: crypto.randomUUID(), name: 'Tổng khấu trừ', type: 'formula', formula: '{Trừ BHXH (8%)} + {Trừ BHYT (1.5%)} + {Trừ BHTN (1%)} + {Thuế TNCN}', order: 14 },
    { id: crypto.randomUUID(), name: 'Thực lĩnh', type: 'formula', formula: '{Tổng thu nhập} - {Tổng khấu trừ}', order: 15 },
  ];
}

// ==================== COMPONENT ====================

const Payroll: React.FC = () => {
  const {
    employees, payrollRecords, payrollTemplates, attendanceRecords, laborContracts,
    hrmSalaryPolicies, addHrmItem, updateHrmItem, removeHrmItem
  } = useApp();
  useModuleData('hrm');
  const { theme } = useTheme();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);
  const employeeMap = useMemo(() => new Map(activeEmployees.map(e => [e.id, e])), [activeEmployees]);

  // ==================== TAB STATE ====================
  const [activeTab, setActiveTab] = useState<'payroll' | 'templates'>('payroll');

  // ==================== PAYROLL STATE ====================
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [showGenModal, setShowGenModal] = useState(false);
  const [standardDays, setStandardDays] = useState(26);
  const [searchText, setSearchText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [expandedPayroll, setExpandedPayroll] = useState<string | null>(null);
  const [editingPayrollValues, setEditingPayrollValues] = useState<Record<string, number>>({});

  // ==================== TEMPLATE EDITOR STATE ====================
  const [editingTemplate, setEditingTemplate] = useState<PayrollTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplPolicyId, setTplPolicyId] = useState('');
  const [tplFields, setTplFields] = useState<PayrollTemplateField[]>([]);

  // ==================== COMPUTED ====================

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

  const kpis = useMemo(() => {
    const total = currentPayrolls.reduce((s, p) => s + p.netSalary, 0);
    const draft = currentPayrolls.filter(p => p.status === 'draft').length;
    const paid = currentPayrolls.filter(p => p.status === 'paid').length;
    return { total, draft, paid, count: currentPayrolls.length };
  }, [currentPayrolls]);

  // ==================== ATTENDANCE HELPERS ====================

  const getAttendanceStats = useCallback((employeeId: string) => {
    const monthStr = String(selectedMonth).padStart(2, '0');
    let workingDays = 0, otNormal = 0, otWeekend = 0, otHoliday = 0;
    for (let d = 1; d <= 31; d++) {
      const dateStr = `${selectedYear}-${monthStr}-${String(d).padStart(2, '0')}`;
      const rec = attendanceRecords.find(r => r.employeeId === employeeId && r.date === dateStr);
      if (rec) {
        if (rec.status === 'present' || rec.status === 'business_trip') workingDays += 1;
        else if (rec.status === 'half_day') workingDays += 0.5;
        else if (rec.status === 'holiday') workingDays += 1;
        // OT classification based on day of week & status
        const ot = rec.overtimeHours || 0;
        if (ot > 0) {
          if (rec.status === 'holiday') otHoliday += ot;
          else {
            const dow = new Date(dateStr).getDay();
            if (dow === 0 || dow === 6) otWeekend += ot;
            else otNormal += ot;
          }
        }
      }
    }
    return { workingDays, otNormal, otWeekend, otHoliday };
  }, [attendanceRecords, selectedMonth, selectedYear]);

  // ==================== RESOLVE FIELD VALUES ====================

  const resolveFieldValues = useCallback((fields: PayrollTemplateField[], employeeId: string, manualValues?: Record<string, number>): Record<string, number> => {
    const stats = getAttendanceStats(employeeId);
    const contract = laborContracts
      .filter(c => c.employeeId === employeeId && c.status === 'active')
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

    const baseSalary = contract?.baseSalary || 0;
    const dailyRate = standardDays > 0 ? Math.round(baseSalary / standardDays) : 0;

    const values: Record<string, number> = {};

    // Two passes: first resolve source fields, then formula fields
    for (const field of fields.sort((a, b) => a.order - b.order)) {
      if (field.type === 'formula') continue;
      if (manualValues && manualValues[field.name] !== undefined) {
        values[field.name] = manualValues[field.name];
        continue;
      }
      switch (field.source) {
        case 'attendance_days': values[field.name] = stats.workingDays; break;
        case 'attendance_ot_normal': values[field.name] = stats.otNormal; break;
        case 'attendance_ot_weekend': values[field.name] = stats.otWeekend; break;
        case 'attendance_ot_holiday': values[field.name] = stats.otHoliday; break;
        case 'contract_salary': values[field.name] = baseSalary; break;
        case 'contract_allowance': values[field.name] = contract?.allowancePosition || 0; break;
        case 'contract_daily_rate': values[field.name] = dailyRate; break;
        default: values[field.name] = manualValues?.[field.name] || 0; break;
      }
    }

    // Formula pass
    for (const field of fields.sort((a, b) => a.order - b.order)) {
      if (field.type === 'formula' && field.formula) {
        values[field.name] = evaluateFormula(field.formula, values);
      }
    }

    return values;
  }, [getAttendanceStats, laborContracts, standardDays]);

  // ==================== GENERATE PAYROLL ====================

  const generatePayroll = () => {
    const template = payrollTemplates.find(t => t.id === selectedTemplateId);
    if (!template) { alert('Vui lòng chọn mẫu bảng lương!'); return; }

    const existing = new Set(currentPayrolls.map(p => p.employeeId));
    const targetEmployees = activeEmployees.filter(emp => {
      if (existing.has(emp.id)) return false;
      if (template.salaryPolicyId) return (emp as any).salaryPolicyId === template.salaryPolicyId;
      return true;
    });

    targetEmployees.forEach(emp => {
      const values = resolveFieldValues(template.fields, emp.id);

      // Find key totals for PayrollRecord summary
      const netSalary = values['Thực lĩnh'] || values['Lương thực lĩnh'] || 0;
      const grossSalary = values['Tổng thu nhập'] || values['Tổng TN'] || 0;
      const workingDays = values['Ngày công'] || 0;

      const contract = laborContracts
        .filter(c => c.employeeId === emp.id && c.status === 'active')
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

      const record: PayrollRecord = {
        id: crypto.randomUUID(),
        employeeId: emp.id,
        month: selectedMonth,
        year: selectedYear,
        workingDays,
        standardDays,
        overtimeHours: (values['OT ngày thường (giờ)'] || 0) + (values['OT cuối tuần (giờ)'] || 0) + (values['OT ngày lễ (giờ)'] || 0),
        baseSalary: contract?.baseSalary || 0,
        dailyRate: standardDays > 0 ? Math.round((contract?.baseSalary || 0) / standardDays) : 0,
        overtimeRate: 0,
        allowancePosition: contract?.allowancePosition || 0,
        allowanceMeal: values['Phụ cấp ăn trưa'] || 0,
        allowanceTransport: values['Phụ cấp đi lại'] || 0,
        allowancePhone: values['Phụ cấp điện thoại'] || 0,
        allowanceOther: contract?.allowanceOther || 0,
        deductionInsurance: (values['Trừ BHXH (8%)'] || 0) + (values['Trừ BHYT (1.5%)'] || 0) + (values['Trừ BHTN (1%)'] || 0),
        deductionTax: values['Thuế TNCN'] || 0,
        deductionAdvance: values['Tạm ứng'] || 0,
        deductionOther: 0,
        grossSalary,
        netSalary,
        status: 'draft',
        note: `Mẫu: ${template.name}`,
        createdAt: new Date().toISOString(),
        // Store template field values for detail view
        templateValues: values as any,
        templateId: template.id as any,
      };

      addHrmItem('hrm_payrolls', record);
    });

    setShowGenModal(false);
    if (targetEmployees.length > 0) {
      alert(`Đã tạo ${targetEmployees.length} phiếu lương từ mẫu "${template.name}"`);
    } else {
      alert('Tất cả nhân viên đã có phiếu lương tháng này!');
    }
  };

  const confirmPayroll = (p: PayrollRecord) => updateHrmItem('hrm_payrolls', { ...p, status: 'confirmed' });
  const markPaid = (p: PayrollRecord) => updateHrmItem('hrm_payrolls', { ...p, status: 'paid', paidDate: new Date().toISOString().split('T')[0] });
  const deletePayroll = (p: PayrollRecord) => {
    if (p.status !== 'draft') return;
    removeHrmItem('hrm_payrolls', p.id);
  };

  // Save edited payroll values
  const savePayrollEdit = (p: PayrollRecord) => {
    const tplId = (p as any).templateId;
    const tpl = tplId ? payrollTemplates.find(t => t.id === tplId) : null;
    if (!tpl) return;
    // Merge edited values with existing template values, then recalculate formulas
    const oldValues: Record<string, number> = { ...((p as any).templateValues || {}) };
    const merged = { ...oldValues, ...editingPayrollValues };
    // Recalculate formulas in order
    for (const field of tpl.fields.sort((a, b) => a.order - b.order)) {
      if (field.type === 'formula' && field.formula) {
        merged[field.name] = evaluateFormula(field.formula, merged);
      }
    }
    const netSalary = merged['Th\u1ef1c l\u0129nh'] || merged['L\u01b0\u01a1ng th\u1ef1c l\u0129nh'] || 0;
    const grossSalary = merged['T\u1ed5ng thu nh\u1eadp'] || merged['T\u1ed5ng TN'] || 0;
    const workingDays = merged['Ng\u00e0y c\u00f4ng'] || p.workingDays;
    updateHrmItem('hrm_payrolls', {
      ...p,
      workingDays,
      netSalary,
      grossSalary,
      baseSalary: merged['L\u01b0\u01a1ng h\u1ee3p \u0111\u1ed3ng'] || p.baseSalary,
      deductionInsurance: (merged['Tr\u1eeb BHXH (8%)'] || 0) + (merged['Tr\u1eeb BHYT (1.5%)'] || 0) + (merged['Tr\u1eeb BHTN (1%)'] || 0),
      deductionTax: merged['Thu\u1ebf TNCN'] || p.deductionTax,
      allowanceMeal: merged['Ph\u1ee5 c\u1ea5p \u0103n tr\u01b0a'] || p.allowanceMeal,
      templateValues: merged as any,
    });
    setEditingPayrollValues({});
    alert('\u0110\u00e3 c\u1eadp nh\u1eadt phi\u1ebfu l\u01b0\u01a1ng!');
  };

  // ==================== TEMPLATE CRUD ====================

  const openNewTemplate = () => {
    setEditingTemplate({ id: '', name: '', fields: [], salaryPolicyId: '' });
    setTplName('');
    setTplPolicyId('');
    setTplFields(getDefaultFields());
  };

  const openEditTemplate = (tpl: PayrollTemplate) => {
    setEditingTemplate(tpl);
    setTplName(tpl.name);
    setTplPolicyId(tpl.salaryPolicyId || '');
    setTplFields([...tpl.fields].sort((a, b) => a.order - b.order));
  };

  const saveTemplate = () => {
    if (!tplName.trim()) return;
    const orderedFields = tplFields.map((f, i) => ({ ...f, order: i + 1 }));
    if (editingTemplate?.id) {
      updateHrmItem('hrm_payroll_templates', { ...editingTemplate, name: tplName, salaryPolicyId: tplPolicyId || null, fields: orderedFields });
    } else {
      addHrmItem('hrm_payroll_templates', { id: crypto.randomUUID(), name: tplName, salaryPolicyId: tplPolicyId || null, fields: orderedFields, createdAt: new Date().toISOString() });
    }
    setEditingTemplate(null);
  };

  const deleteTemplate = (id: string) => {
    removeHrmItem('hrm_payroll_templates', id);
  };

  const addField = () => {
    setTplFields(prev => [...prev, {
      id: crypto.randomUUID(),
      name: '',
      type: 'income' as PayrollFieldType,
      source: 'manual' as PayrollFieldSource,
      order: prev.length + 1,
    }]);
  };

  const updateField = (id: string, updates: Partial<PayrollTemplateField>) => {
    setTplFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id: string) => {
    setTplFields(prev => prev.filter(f => f.id !== id));
  };

  const moveField = (id: string, direction: 'up' | 'down') => {
    setTplFields(prev => {
      const idx = prev.findIndex(f => f.id === id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  // ==================== EXPORT ====================

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

  // Export Excel
  const exportExcel = () => {
    const header = ['M\u00e3 NV', 'H\u1ecd t\u00ean', 'Ng\u00e0y c\u00f4ng', 'Ng\u00e0y chu\u1ea9n', 'OT(h)', 'L\u01b0\u01a1ng CB', 'PC ch\u1ee9c v\u1ee5', 'PC \u0103n', 'PC \u0111i l\u1ea1i', 'PC \u0111i\u1ec7n tho\u1ea1i', 'PC kh\u00e1c', 'BHXH/YT/TN', 'Thu\u1ebf TNCN', 'T\u1ea1m \u1ee9ng', 'KT kh\u00e1c', 'T\u1ed5ng TN', 'Th\u1ef1c l\u0129nh', 'Tr\u1ea1ng th\u00e1i'];
    const rows = filteredPayrolls.map(p => {
      const emp = employeeMap.get(p.employeeId);
      return [
        emp?.employeeCode, emp?.fullName, p.workingDays, p.standardDays, p.overtimeHours,
        p.baseSalary, p.allowancePosition, p.allowanceMeal, p.allowanceTransport, p.allowancePhone, p.allowanceOther,
        p.deductionInsurance, p.deductionTax, p.deductionAdvance, p.deductionOther,
        p.grossSalary, p.netSalary, PAYROLL_STATUS_LABELS[p.status]
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // Set column widths
    ws['!cols'] = header.map((_, i) => ({ wch: i <= 1 ? 16 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `T${selectedMonth}_${selectedYear}`);
    XLSX.writeFile(wb, `bangluong_T${selectedMonth}_${selectedYear}.xlsx`);
  };

  const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + 'đ';

  // ==================== RENDER ====================

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
          {/* Tab buttons */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button onClick={() => setActiveTab('payroll')}
              className={`px-3 py-2 text-xs font-black transition ${activeTab === 'payroll' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'}`}>
              <DollarSign size={14} className="inline mr-1" /> Bảng lương
            </button>
            <button onClick={() => setActiveTab('templates')}
              className={`px-3 py-2 text-xs font-black transition ${activeTab === 'templates' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'}`}>
              <Settings size={14} className="inline mr-1" /> Mẫu bảng lương
            </button>
          </div>
        </div>
      </div>

      {/* ==================== TAB: PAYROLL ==================== */}
      {activeTab === 'payroll' && (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowGenModal(true)} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5">
              <Calculator size={14} /> Tính lương
            </button>
            <button onClick={exportCSV} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-50 transition flex items-center gap-1.5">
              <Download size={14} /> Xuất CSV
            </button>
            <button onClick={exportExcel} className="px-3 py-2 bg-teal-500 text-white rounded-xl text-xs font-black hover:bg-teal-600 transition flex items-center gap-1.5">
              <Download size={14} /> Xuất Excel
            </button>
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
                        <p className="text-xs text-slate-400 mt-1">Nhấn "Tính lương" để tạo bảng lương từ mẫu</p>
                      </td>
                    </tr>
                  ) : (
                    filteredPayrolls.map((p, idx) => {
                      const emp = employeeMap.get(p.employeeId);
                      const totalAllowance = p.allowancePosition + p.allowanceMeal + p.allowanceTransport + p.allowancePhone + p.allowanceOther;
                      const totalDeduction = p.deductionInsurance + p.deductionTax + p.deductionAdvance + p.deductionOther;
                      const isExpanded = expandedPayroll === p.id;
                      // Get template for detail view
                      const tplId = (p as any).templateId;
                      const tpl = tplId ? payrollTemplates.find(t => t.id === tplId) : null;
                      const tplValues: Record<string, number> = (p as any).templateValues || {};

                      return (
                        <React.Fragment key={p.id}>
                          <tr className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'} hover:bg-blue-50/50 dark:hover:bg-blue-950/10 transition cursor-pointer`}
                            onClick={() => setExpandedPayroll(isExpanded ? null : p.id)}>
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
                            <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {p.status === 'draft' && (
                                  <>
                                    <button onClick={() => confirmPayroll(p)} className="p-1.5 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 transition" title="Xác nhận">
                                      <CheckCircle size={14} />
                                    </button>
                                    <button onClick={() => deletePayroll(p)} className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition" title="Xóa">
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                                {p.status === 'confirmed' && (
                                  <button onClick={() => markPaid(p)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600 hover:bg-emerald-200 transition" title="Đánh dấu đã trả">
                                    <DollarSign size={14} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Expanded detail row — show template fields */}
                          {isExpanded && tpl && (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                                <div className="max-w-2xl">
                                  <p className="text-[10px] font-black text-slate-400 uppercase mb-2 flex items-center gap-1">
                                    <FileText size={12} /> Chi ti\u1ebft phi\u1ebfu l\u01b0\u01a1ng \u2014 M\u1eabu: {tpl.name}
                                    {p.status === 'draft' && <span className="ml-2 text-blue-500">(click s\u1ed1 \u0111\u1ec3 s\u1eeda)</span>}
                                  </p>
                                  <div className="grid grid-cols-1 gap-1">
                                    {tpl.fields.sort((a, b) => a.order - b.order).map(field => {
                                      const rawVal = editingPayrollValues[field.name] ?? tplValues[field.name] ?? 0;
                                      const val = field.type === 'formula' && field.formula
                                        ? evaluateFormula(field.formula, { ...tplValues, ...editingPayrollValues })
                                        : rawVal;
                                      const isFormula = field.type === 'formula';
                                      const isDeduction = field.type === 'deduction' || (isFormula && field.name.toLowerCase().includes('kh\u1ea5u tr\u1eeb'));
                                      const isEditable = p.status === 'draft' && !isFormula;
                                      return (
                                        <div key={field.id} className={`flex justify-between items-center px-3 py-1.5 rounded-lg text-xs ${
                                          isFormula ? 'bg-blue-50/60 dark:bg-blue-950/20 font-black' : ''
                                        }`}>
                                          <span className="text-slate-600 dark:text-slate-400">{field.name}</span>
                                          {isEditable ? (
                                            <input type="number" value={editingPayrollValues[field.name] ?? tplValues[field.name] ?? 0}
                                              onChange={e => setEditingPayrollValues(prev => ({ ...prev, [field.name]: Number(e.target.value) }))}
                                              className="w-32 text-right px-2 py-1 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none"
                                            />
                                          ) : (
                                            <span className={`font-bold ${
                                              isDeduction ? 'text-red-500' :
                                              field.type === 'income' || (isFormula && field.name.toLowerCase().includes('thu nh\u1eadp')) ? 'text-emerald-600' :
                                              field.type === 'info' ? 'text-slate-500' : 'text-slate-800 dark:text-white'
                                            }`}>
                                              {field.type === 'info' && (field.source === 'attendance_days' || field.source === 'contract_daily_rate')
                                                ? val.toLocaleString('vi-VN')
                                                : fmtMoney(val)}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {p.status === 'draft' && Object.keys(editingPayrollValues).length > 0 && (
                                    <button onClick={() => savePayrollEdit(p)}
                                      className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition">
                                      L\u01b0u thay \u0111\u1ed5i
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <Calculator size={20} className="text-emerald-500" /> Tính lương tháng {selectedMonth}/{selectedYear}
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Chọn mẫu bảng lương *</label>
                    <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none font-bold">
                      <option value="">-- Chọn mẫu --</option>
                      {payrollTemplates.map(t => {
                        const policy = hrmSalaryPolicies.find((sp: any) => sp.id === t.salaryPolicyId);
                        return <option key={t.id} value={t.id}>{t.name} {policy ? `(${policy.name})` : ''}</option>;
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Ngày công chuẩn</label>
                    <input type="number" value={standardDays} onChange={e => setStandardDays(Number(e.target.value))}
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                  </div>
                  {selectedTemplateId && (
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-xl text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                      ✅ Hệ thống sẽ:<br/>
                      • Lấy ngày công từ bảng chấm công tháng {selectedMonth}<br/>
                      • Lấy lương từ hợp đồng lao động<br/>
                      • Tính công thức theo mẫu đã chọn<br/>
                      • Chỉ tạo phiếu cho NV chưa có bảng lương
                    </div>
                  )}
                  {payrollTemplates.length === 0 && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-xl text-xs text-amber-700 dark:text-amber-400 font-bold">
                      ⚠️ Chưa có mẫu bảng lương. Vui lòng tạo mẫu trong tab "Mẫu bảng lương" trước.
                    </div>
                  )}
                </div>
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                  <button onClick={() => setShowGenModal(false)} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                  <button onClick={generatePayroll} disabled={!selectedTemplateId}
                    className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition disabled:opacity-50">
                    Tạo bảng lương
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== TAB: TEMPLATES ==================== */}
      {activeTab === 'templates' && (
        <>
          {editingTemplate ? (
            /* ===== TEMPLATE EDITOR ===== */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingTemplate(null)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-lg font-black text-slate-800 dark:text-white">
                  {editingTemplate.id ? 'Sửa mẫu bảng lương' : 'Tạo mẫu bảng lương mới'}
                </h2>
              </div>

              <div className="glass-panel rounded-2xl p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Tên mẫu *</label>
                    <input type="text" value={tplName} onChange={e => setTplName(e.target.value)} placeholder="VD: Bảng lương Văn phòng"
                      className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Chính sách lương</label>
                    <select value={tplPolicyId} onChange={e => setTplPolicyId(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                      <option value="">-- Áp dụng cho tất cả --</option>
                      {hrmSalaryPolicies.map((sp: any) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Fields list */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">Danh sách dòng ({tplFields.length})</label>
                    <button onClick={addField} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-black hover:bg-emerald-600 transition flex items-center gap-1">
                      <Plus size={12} /> Thêm dòng
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {tplFields.map((field, idx) => (
                      <div key={field.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 group hover:border-emerald-300 dark:hover:border-emerald-700 transition">
                        {/* Order controls */}
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button onClick={() => moveField(field.id, 'up')} disabled={idx === 0}
                            className="p-0.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20"><ChevronUp size={12} /></button>
                          <button onClick={() => moveField(field.id, 'down')} disabled={idx === tplFields.length - 1}
                            className="p-0.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-20"><ChevronDown size={12} /></button>
                        </div>

                        {/* Field name */}
                        <input type="text" value={field.name} onChange={e => updateField(field.id, { name: e.target.value })}
                          placeholder="Tên dòng..." className="flex-1 min-w-0 px-2 py-1.5 text-xs font-bold border-0 bg-transparent outline-none" />

                        {/* Field type */}
                        <select value={field.type} onChange={e => updateField(field.id, { type: e.target.value as PayrollFieldType, ...(e.target.value === 'formula' ? { source: undefined } : { formula: undefined, source: field.source || 'manual' }) })}
                          className="px-2 py-1.5 text-[10px] font-black border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none w-24">
                          {Object.entries(PAYROLL_FIELD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>

                        {/* Source or formula */}
                        {field.type === 'formula' ? (
                          <input type="text" value={field.formula || ''} onChange={e => updateField(field.id, { formula: e.target.value })}
                            placeholder="{Lương HĐ} * 10.5%" className="w-60 px-2 py-1.5 text-[10px] font-mono border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50 dark:bg-blue-950/20 outline-none" />
                        ) : (
                          <select value={field.source || 'manual'} onChange={e => updateField(field.id, { source: e.target.value as PayrollFieldSource })}
                            className="px-2 py-1.5 text-[10px] font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none w-48">
                            {Object.entries(PAYROLL_FIELD_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        )}

                        {/* Type badge */}
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black shrink-0 ${FIELD_TYPE_COLORS[field.type]}`}>
                          {field.type === 'income' ? '+' : field.type === 'deduction' ? '−' : field.type === 'formula' ? 'fx' : 'i'}
                        </span>

                        {/* Remove */}
                        <button onClick={() => removeField(field.id)} className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {tplFields.length === 0 && (
                    <div className="text-center py-8 text-slate-400">
                      <FileText size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-bold">Chưa có dòng nào. Nhấn "Thêm dòng" để bắt đầu.</p>
                    </div>
                  )}
                </div>

                {/* Formula hint */}
                <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-xl text-[10px] text-blue-700 dark:text-blue-400 font-bold">
                  💡 <strong>Hướng dẫn công thức:</strong> Dùng <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">{'{Tên dòng}'}</code> để tham chiếu giá trị.
                  Hỗ trợ: <code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code><br/>
                  VD: <code>{'{Lương HĐ} * 8%'}</code> hoặc <code>{'{Tổng TN} - {Tổng KT}'}</code>
                </div>

                {/* Save / Cancel */}
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setEditingTemplate(null)} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                  <button onClick={saveTemplate} disabled={!tplName.trim()}
                    className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition disabled:opacity-50 flex items-center gap-1.5">
                    <CheckCircle size={14} /> Lưu mẫu
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ===== TEMPLATE LIST ===== */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500">Tạo và quản lý cấu trúc bảng lương cho từng chính sách lương</p>
                <button onClick={openNewTemplate} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5">
                  <Plus size={14} /> Tạo mẫu mới
                </button>
              </div>

              {payrollTemplates.length === 0 ? (
                <div className="glass-panel rounded-2xl p-16 text-center">
                  <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                  <p className="text-sm font-black text-slate-400 mb-2">Chưa có mẫu bảng lương</p>
                  <p className="text-xs text-slate-400 mb-4">Tạo mẫu để định nghĩa cấu trúc bảng lương</p>
                  <button onClick={openNewTemplate} className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition inline-flex items-center gap-1.5">
                    <Plus size={14} /> Tạo mẫu đầu tiên
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {payrollTemplates.map(tpl => {
                    const policy = hrmSalaryPolicies.find((sp: any) => sp.id === tpl.salaryPolicyId);
                    const incomeFields = tpl.fields.filter(f => f.type === 'income').length;
                    const deductionFields = tpl.fields.filter(f => f.type === 'deduction').length;
                    const formulaFields = tpl.fields.filter(f => f.type === 'formula').length;
                    return (
                      <div key={tpl.id} className="glass-card rounded-2xl p-5 hover:shadow-lg transition group cursor-pointer" onClick={() => openEditTemplate(tpl)}>
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white">{tpl.name}</h3>
                            {policy && <p className="text-[10px] font-bold text-emerald-500 mt-0.5">{policy.name}</p>}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition" onClick={e => e.stopPropagation()}>
                            <button onClick={() => openEditTemplate(tpl)} className="p-1.5 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition">
                              <Edit3 size={12} />
                            </button>
                            <button onClick={() => deleteTemplate(tpl.id)} className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
                          <span>{tpl.fields.length} dòng</span>
                          <span className="text-emerald-500">+{incomeFields} TN</span>
                          <span className="text-red-400">-{deductionFields} KT</span>
                          <span className="text-blue-500">fx{formulaFields}</span>
                        </div>
                        {/* Preview fields */}
                        <div className="mt-3 space-y-0.5">
                          {tpl.fields.sort((a, b) => a.order - b.order).slice(0, 5).map(f => (
                            <div key={f.id} className="flex items-center gap-2 text-[10px]">
                              <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-black ${FIELD_TYPE_COLORS[f.type]}`}>
                                {f.type === 'income' ? '+' : f.type === 'deduction' ? '−' : f.type === 'formula' ? 'fx' : 'i'}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400 truncate">{f.name || '(chưa đặt tên)'}</span>
                            </div>
                          ))}
                          {tpl.fields.length > 5 && <p className="text-[9px] text-slate-400 pl-6">+{tpl.fields.length - 5} dòng khác...</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Payroll;
