import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  DollarSign, Plus, Settings, Users, Award, Edit3, Trash2, Save, X,
  ChevronDown, ChevronUp, Target, TrendingUp, Search, CheckCircle, AlertCircle
} from 'lucide-react';
import { SalaryGrade, KpiPeriod, KpiScore, KPI_RATINGS, BASE_SALARY_COEFFICIENT } from '../../types';

const fmtMoney = (v: number) => v.toLocaleString('vi-VN') + 'đ';

// ==================== GROUP COLORS ====================
const GROUP_COLORS: Record<string, string> = {
  'A': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'B': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'C': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'D': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const GRADE_GROUP_COLORS: Record<string, string> = {
  'BQĐ': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'Quản lý': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Nhân viên': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Công nhân': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const Salary3PConfig: React.FC = () => {
  const { salaryGrades, kpiPeriods, kpiScores, employees, addHrmItem, updateHrmItem, removeHrmItem } = useApp();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<'grades' | 'kpi' | 'overview'>('grades');

  // ==================== GRADES STATE ====================
  const [editingGrade, setEditingGrade] = useState<SalaryGrade | null>(null);
  const [gradeForm, setGradeForm] = useState({ code: '', name: '', groupName: '', level: 1, bhxhCoefficient: 2.2, regulatedSalary: 0, pc1ChucDanh: 0, pc2ThuLao: 0, pc3LienLac: 0 });

  // ==================== KPI STATE ====================
  const [editingPeriod, setEditingPeriod] = useState<KpiPeriod | null>(null);
  const [periodForm, setPeriodForm] = useState({ name: '', startDate: '', endDate: '' });
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [kpiSearch, setKpiSearch] = useState('');
  const [showNewPeriod, setShowNewPeriod] = useState(false);

  // ==================== COMPUTED ====================
  const sortedGrades = useMemo(() => [...salaryGrades].sort((a, b) => a.level - b.level), [salaryGrades]);
  const activeEmployees = useMemo(() => employees.filter((e: any) => e.status === 'Đang làm việc'), [employees]);
  const selectedPeriod = useMemo(() => kpiPeriods.find(p => p.id === selectedPeriodId), [kpiPeriods, selectedPeriodId]);
  const periodScores = useMemo(() => kpiScores.filter(s => s.periodId === selectedPeriodId), [kpiScores, selectedPeriodId]);

  const filteredEmployees = useMemo(() => {
    if (!kpiSearch) return activeEmployees;
    const q = kpiSearch.toLowerCase();
    return activeEmployees.filter((e: any) => e.fullName?.toLowerCase().includes(q) || e.employeeCode?.toLowerCase().includes(q));
  }, [activeEmployees, kpiSearch]);

  // ==================== GRADE CRUD ====================
  const openNewGrade = () => {
    setEditingGrade({ id: '', code: '', name: '', level: sortedGrades.length + 1, bhxhCoefficient: 2.2, regulatedSalary: 0, pc1ChucDanh: 0, pc2ThuLao: 0, pc3LienLac: 0 } as SalaryGrade);
    setGradeForm({ code: '', name: '', groupName: '', level: sortedGrades.length + 1, bhxhCoefficient: 2.2, regulatedSalary: 0, pc1ChucDanh: 0, pc2ThuLao: 0, pc3LienLac: 0 });
  };

  const openEditGrade = (g: SalaryGrade) => {
    setEditingGrade(g);
    setGradeForm({
      code: g.code, name: g.name, groupName: g.groupName || '', level: g.level,
      bhxhCoefficient: g.bhxhCoefficient, regulatedSalary: g.regulatedSalary,
      pc1ChucDanh: g.pc1ChucDanh, pc2ThuLao: g.pc2ThuLao, pc3LienLac: g.pc3LienLac,
    });
  };

  const saveGrade = () => {
    if (!gradeForm.code || !gradeForm.name) return;
    const item: any = {
      ...gradeForm,
      bhxh_coefficient: gradeForm.bhxhCoefficient,
      regulated_salary: gradeForm.regulatedSalary,
      pc1_chuc_danh: gradeForm.pc1ChucDanh,
      pc2_thu_lao: gradeForm.pc2ThuLao,
      pc3_lien_lac: gradeForm.pc3LienLac,
      group_name: gradeForm.groupName,
    };
    if (editingGrade?.id) {
      updateHrmItem('salary_grades', { id: editingGrade.id, ...item });
    } else {
      addHrmItem('salary_grades', { id: crypto.randomUUID(), ...item, created_at: new Date().toISOString() });
    }
    setEditingGrade(null);
  };

  const deleteGrade = (id: string) => {
    if (confirm('Xóa bậc lương này?')) removeHrmItem('salary_grades', id);
  };

  // ==================== KPI PERIOD CRUD ====================
  const savePeriod = () => {
    if (!periodForm.name || !periodForm.startDate || !periodForm.endDate) return;
    const item: any = { name: periodForm.name, start_date: periodForm.startDate, end_date: periodForm.endDate, status: 'active' };
    addHrmItem('kpi_periods', { id: crypto.randomUUID(), ...item, created_at: new Date().toISOString() });
    setShowNewPeriod(false);
    setPeriodForm({ name: '', startDate: '', endDate: '' });
  };

  const closePeriod = (id: string) => {
    const period = kpiPeriods.find(p => p.id === id);
    if (period) updateHrmItem('kpi_periods', { ...period, status: 'closed' });
  };

  // ==================== KPI SCORE CRUD ====================
  const setScore = (employeeId: string, rating: string) => {
    const ratingObj = KPI_RATINGS.find(r => r.code === rating);
    if (!ratingObj || !selectedPeriodId) return;
    const existing = periodScores.find(s => s.employeeId === employeeId);
    if (existing) {
      updateHrmItem('kpi_scores', {
        ...existing,
        kpi_rating: rating, kpiRating: rating,
        kpi_coefficient: ratingObj.coefficient, kpiCoefficient: ratingObj.coefficient,
      });
    } else {
      addHrmItem('kpi_scores', {
        id: crypto.randomUUID(),
        period_id: selectedPeriodId, periodId: selectedPeriodId,
        employee_id: employeeId, employeeId: employeeId,
        kpi_rating: rating, kpiRating: rating,
        kpi_coefficient: ratingObj.coefficient, kpiCoefficient: ratingObj.coefficient,
        created_at: new Date().toISOString(),
      });
    }
  };

  // ==================== KPI STATS ====================
  const kpiStats = useMemo(() => {
    const scored = periodScores.length;
    const total = activeEmployees.length;
    const avgCoeff = scored > 0 ? periodScores.reduce((s, sc) => s + (sc.kpiCoefficient || 0), 0) / scored : 0;
    const byGroup: Record<string, number> = {};
    periodScores.forEach(sc => {
      const r = KPI_RATINGS.find(k => k.code === (sc.kpiRating || ''));
      if (r) byGroup[r.group] = (byGroup[r.group] || 0) + 1;
    });
    return { scored, total, avgCoeff, byGroup };
  }, [periodScores, activeEmployees]);

  // ==================== RENDER ====================
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <TrendingUp className="text-indigo-500" size={24} /> Lương 3P
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Cấu hình Bậc lương (P1) • Phụ cấp (P2) • KPI (P3)
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button onClick={() => setActiveTab('grades')}
            className={`px-4 py-2 text-xs font-black transition flex items-center gap-1.5 ${activeTab === 'grades' ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'}`}>
            <Settings size={14} /> Bậc lương
          </button>
          <button onClick={() => setActiveTab('kpi')}
            className={`px-4 py-2 text-xs font-black transition flex items-center gap-1.5 ${activeTab === 'kpi' ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'}`}>
            <Award size={14} /> Đánh giá KPI
          </button>
          <button onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-xs font-black transition flex items-center gap-1.5 ${activeTab === 'overview' ? 'bg-indigo-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50'}`}>
            <Target size={14} /> Tổng quan
          </button>
        </div>
      </div>

      {/* ==================== TAB: GRADES ==================== */}
      {activeTab === 'grades' && (
        <>
          <div className="flex items-center gap-2">
            <button onClick={openNewGrade} className="px-3 py-2 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition flex items-center gap-1.5">
              <Plus size={14} /> Thêm bậc lương
            </button>
            <div className="ml-auto text-xs font-bold text-slate-400">
              Lương cơ sở: <span className="text-indigo-600 font-black">{fmtMoney(BASE_SALARY_COEFFICIENT)}</span>
            </div>
          </div>

          {/* Grade Table */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Cấp</th>
                    <th className="px-3 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Chức danh</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Nhóm</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">HS BHXH</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">P1 (BHXH)</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase hidden lg:table-cell">Bậc lương QĐ</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase hidden lg:table-cell">PC Chức danh</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase hidden lg:table-cell">PC Liên lạc</th>
                    <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGrades.length === 0 ? (
                    <tr><td colSpan={9} className="py-16 text-center">
                      <Settings size={40} className="mx-auto text-slate-300 mb-3" />
                      <p className="text-sm font-black text-slate-400">Chưa có bậc lương</p>
                    </td></tr>
                  ) : (
                    sortedGrades.map((g, idx) => {
                      const p1 = Math.round(g.bhxhCoefficient * BASE_SALARY_COEFFICIENT);
                      return (
                        <tr key={g.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'} hover:bg-indigo-50/50 dark:hover:bg-indigo-950/10 transition`}>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-sm font-black">{g.code}</span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="text-sm font-bold text-slate-800 dark:text-white">{g.name}</div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${GRADE_GROUP_COLORS[g.groupName || ''] || 'bg-slate-100 text-slate-600'}`}>
                              {g.groupName || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center text-sm font-black text-indigo-600">{g.bhxhCoefficient}</td>
                          <td className="px-3 py-3 text-right text-sm font-bold text-emerald-600">{fmtMoney(p1)}</td>
                          <td className="px-3 py-3 text-right text-xs font-bold text-slate-500 hidden lg:table-cell">{fmtMoney(g.regulatedSalary)}</td>
                          <td className="px-3 py-3 text-center text-xs font-bold text-slate-500 hidden lg:table-cell">{g.pc1ChucDanh > 0 ? g.pc1ChucDanh : '—'}</td>
                          <td className="px-3 py-3 text-center text-xs font-bold text-slate-500 hidden lg:table-cell">{g.pc3LienLac > 0 ? g.pc3LienLac : '—'}</td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => openEditGrade(g)} className="p-1.5 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"><Edit3 size={14} /></button>
                              <button onClick={() => deleteGrade(g.id)} className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* KPI Reference */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Award size={14} className="text-indigo-500" /> Bảng hệ số KPI tham chiếu
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['A', 'B', 'C', 'D'].map(group => (
                <div key={group} className="space-y-1">
                  <div className={`px-2 py-1 rounded-lg text-[10px] font-black text-center ${GROUP_COLORS[group]}`}>
                    Hạng {group}
                  </div>
                  {KPI_RATINGS.filter(r => r.group === group).map(r => (
                    <div key={r.code} className="flex justify-between px-2 py-1 text-xs">
                      <span className="font-bold text-slate-600 dark:text-slate-400">{r.code}</span>
                      <span className="font-black text-slate-800 dark:text-white">{r.coefficient.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Grade Edit Modal */}
          {editingGrade && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="text-lg font-black text-slate-800 dark:text-white">{editingGrade.id ? 'Sửa bậc lương' : 'Thêm bậc lương'}</h3>
                  <button onClick={() => setEditingGrade(null)} className="p-2 rounded-xl hover:bg-slate-100 transition"><X size={18} /></button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Mã cấp *</label>
                      <input type="text" value={gradeForm.code} onChange={e => setGradeForm(p => ({ ...p, code: e.target.value }))} placeholder="E5"
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Nhóm</label>
                      <select value={gradeForm.groupName} onChange={e => setGradeForm(p => ({ ...p, groupName: e.target.value }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                        <option value="">—</option>
                        <option value="BQĐ">BQĐ</option>
                        <option value="Quản lý">Quản lý</option>
                        <option value="Nhân viên">Nhân viên</option>
                        <option value="Công nhân">Công nhân</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Thứ tự</label>
                      <input type="number" value={gradeForm.level} onChange={e => setGradeForm(p => ({ ...p, level: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Tên chức danh *</label>
                    <input type="text" value={gradeForm.name} onChange={e => setGradeForm(p => ({ ...p, name: e.target.value }))} placeholder="NV kỹ thuật..."
                      className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Hệ số BHXH *</label>
                      <input type="number" step="0.1" value={gradeForm.bhxhCoefficient} onChange={e => setGradeForm(p => ({ ...p, bhxhCoefficient: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                      <p className="text-[10px] text-slate-400 mt-1">P1 = {fmtMoney(Math.round(gradeForm.bhxhCoefficient * BASE_SALARY_COEFFICIENT))}</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Bậc lương QĐ (B-)</label>
                      <input type="number" value={gradeForm.regulatedSalary} onChange={e => setGradeForm(p => ({ ...p, regulatedSalary: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">HS PC Chức danh</label>
                      <input type="number" step="0.1" value={gradeForm.pc1ChucDanh} onChange={e => setGradeForm(p => ({ ...p, pc1ChucDanh: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">HS PC Thù lao</label>
                      <input type="number" step="0.1" value={gradeForm.pc2ThuLao} onChange={e => setGradeForm(p => ({ ...p, pc2ThuLao: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">HS PC Liên lạc</label>
                      <input type="number" step="0.1" value={gradeForm.pc3LienLac} onChange={e => setGradeForm(p => ({ ...p, pc3LienLac: Number(e.target.value) }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                  <button onClick={() => setEditingGrade(null)} className="px-4 py-2.5 text-xs font-black text-slate-500">Huỷ</button>
                  <button onClick={saveGrade} className="px-5 py-2.5 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition flex items-center gap-1.5">
                    <Save size={14} /> Lưu
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== TAB: KPI ==================== */}
      {activeTab === 'kpi' && (
        <>
          {/* Period selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <select value={selectedPeriodId} onChange={e => setSelectedPeriodId(e.target.value)}
              className="px-3 py-2 text-sm font-black border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none min-w-48">
              <option value="">— Chọn kỳ đánh giá —</option>
              {kpiPeriods.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.status === 'closed' ? '(Đã đóng)' : ''}</option>
              ))}
            </select>
            <button onClick={() => setShowNewPeriod(true)} className="px-3 py-2 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition flex items-center gap-1.5">
              <Plus size={14} /> Kỳ mới
            </button>
            {selectedPeriod && selectedPeriod.status === 'active' && (
              <button onClick={() => closePeriod(selectedPeriodId)} className="px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition flex items-center gap-1.5">
                <CheckCircle size={14} /> Đóng kỳ
              </button>
            )}
            <div className="ml-auto relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Tìm NV..." value={kpiSearch} onChange={e => setKpiSearch(e.target.value)}
                className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-40" />
            </div>
          </div>

          {/* KPI Stats */}
          {selectedPeriodId && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="glass-card p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đã đánh giá</p>
                <p className="text-xl font-black text-indigo-600">{kpiStats.scored}<span className="text-sm text-slate-400">/{kpiStats.total}</span></p>
              </div>
              <div className="glass-card p-4 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">HS trung bình</p>
                <p className="text-xl font-black text-emerald-600">{kpiStats.avgCoeff.toFixed(2)}</p>
              </div>
              {['A', 'B', 'C'].map(g => (
                <div key={g} className="glass-card p-4 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Hạng {g}</p>
                  <p className="text-xl font-black text-slate-800 dark:text-white">{kpiStats.byGroup[g] || 0}</p>
                </div>
              ))}
            </div>
          )}

          {/* KPI Scoring Table */}
          {selectedPeriodId ? (
            <div className="glass-panel rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Nhân viên</th>
                      <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Bậc lương</th>
                      <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Xếp hạng KPI</th>
                      <th className="px-3 py-3 text-center text-[10px] font-black text-slate-500 uppercase">Hệ số</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp: any, idx: number) => {
                      const score = periodScores.find(s => s.employeeId === emp.id);
                      const grade = salaryGrades.find(g => g.id === (emp as any).salaryGradeId);
                      const ratingGroup = score?.kpiRating?.[0] || '';
                      return (
                        <tr key={emp.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'} hover:bg-indigo-50/50 transition`}>
                          <td className="px-4 py-3">
                            <div className="text-sm font-bold text-slate-800 dark:text-white">{emp.fullName}</div>
                            <div className="text-[10px] font-mono text-slate-400">{emp.employeeCode}</div>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {grade ? (
                              <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">{grade.code}</span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Chưa gán</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <select
                              value={score?.kpiRating || ''}
                              onChange={e => setScore(emp.id, e.target.value)}
                              disabled={selectedPeriod?.status === 'closed'}
                              className={`px-2 py-1.5 text-xs font-black border rounded-lg outline-none ${
                                ratingGroup ? `${GROUP_COLORS[ratingGroup]?.replace('bg-', 'border-').split(' ')[0] || 'border-slate-200'} bg-white dark:bg-slate-800` : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                              } disabled:opacity-50`}
                            >
                              <option value="">— Chọn —</option>
                              {KPI_RATINGS.map(r => (
                                <option key={r.code} value={r.code}>{r.label} ({r.coefficient.toFixed(2)})</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3 text-center">
                            {score ? (
                              <span className={`px-2 py-1 rounded-lg text-xs font-black ${GROUP_COLORS[ratingGroup] || ''}`}>
                                {score.kpiCoefficient?.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl p-16 text-center">
              <Award size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-sm font-black text-slate-400">Chọn hoặc tạo kỳ đánh giá KPI để bắt đầu</p>
            </div>
          )}

          {/* New Period Modal */}
          {showNewPeriod && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-lg font-black text-slate-800 dark:text-white">Tạo kỳ đánh giá KPI</h3>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Tên kỳ *</label>
                    <input type="text" value={periodForm.name} onChange={e => setPeriodForm(p => ({ ...p, name: e.target.value }))} placeholder="Q1/2026"
                      className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Từ ngày</label>
                      <input type="date" value={periodForm.startDate} onChange={e => setPeriodForm(p => ({ ...p, startDate: e.target.value }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Đến ngày</label>
                      <input type="date" value={periodForm.endDate} onChange={e => setPeriodForm(p => ({ ...p, endDate: e.target.value }))}
                        className="w-full px-3 py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                  <button onClick={() => setShowNewPeriod(false)} className="px-4 py-2.5 text-xs font-black text-slate-500">Huỷ</button>
                  <button onClick={savePeriod} className="px-5 py-2.5 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition">Tạo kỳ</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== TAB: OVERVIEW ==================== */}
      {activeTab === 'overview' && (
        <>
          {/* Formula explanation */}
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Target size={16} className="text-indigo-500" /> Công thức lương 3P
            </h3>
            <div className="bg-indigo-50 dark:bg-indigo-950/30 p-5 rounded-2xl font-mono text-sm text-indigo-800 dark:text-indigo-300 space-y-2">
              <p className="font-black text-base">Tổng thu nhập 3P = P1 + P2 + P3</p>
              <div className="border-t border-indigo-200 dark:border-indigo-800 pt-3 mt-3 space-y-1.5">
                <p><span className="font-black text-indigo-600">P1</span> = Hệ số BHXH × {fmtMoney(BASE_SALARY_COEFFICIENT)} (lương cơ sở)</p>
                <p><span className="font-black text-indigo-600">P2</span> = PC Chức danh + PC Thù lao + PC Liên lạc</p>
                <p><span className="font-black text-indigo-600">P3</span> = (Bậc lương QĐ − P1) × Hệ số KPI</p>
              </div>
            </div>
          </div>

          {/* Simulation table */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Mô phỏng lương — tất cả bậc × KPI B2 (1.00)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase">Cấp</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">P1 (BHXH)</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">P2 (PC)</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">P3 (Gap×KPI)</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-emerald-600 uppercase">Tổng 3P</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">% P1</th>
                    <th className="px-3 py-3 text-right text-[10px] font-black text-slate-500 uppercase">% P3</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGrades.map((g, idx) => {
                    const p1 = Math.round(g.bhxhCoefficient * BASE_SALARY_COEFFICIENT);
                    const pc1 = Math.round(g.pc1ChucDanh * 1000000);
                    const pc3 = Math.round(g.pc3LienLac * 1000000);
                    const p2 = pc1 + pc3;
                    const gap = g.regulatedSalary - p1;
                    const p3 = Math.round(gap * 1.0); // KPI B2 = 1.00
                    const total = p1 + p2 + p3;
                    const pctP1 = total > 0 ? Math.round(p1 / total * 100) : 0;
                    const pctP3 = total > 0 ? Math.round(p3 / total * 100) : 0;
                    return (
                      <tr key={g.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}>
                        <td className="px-4 py-2.5">
                          <span className="text-sm font-black text-indigo-600">{g.code}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{g.groupName}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-blue-600">{fmtMoney(p1)}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-amber-600">{fmtMoney(p2)}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-purple-600">{fmtMoney(p3)}</td>
                        <td className="px-3 py-2.5 text-right text-sm font-black text-emerald-600">{fmtMoney(total)}</td>
                        <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-400">{pctP1}%</td>
                        <td className="px-3 py-2.5 text-right text-[10px] font-bold text-slate-400">{pctP3}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Salary3PConfig;
