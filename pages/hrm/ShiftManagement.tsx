import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  Clock, Plus, Edit3, Trash2, Save, X, Sun, Moon, AlertTriangle,
  ChevronLeft, ChevronRight, Users, Calendar, Settings, Check
} from 'lucide-react';
import { HrmShiftType, HrmEmployeeShift } from '../../types';

const SHIFT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

const ShiftManagement: React.FC = () => {
  const { employees, shiftTypes, employeeShifts, addHrmItem, updateHrmItem, removeHrmItem } = useApp();
  useModuleData('hrm');
  const { isDark } = useTheme();

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);

  // Tab state
  const [activeTab, setActiveTab] = useState<'types' | 'assign'>('types');

  // ==================== TAB 1: SHIFT TYPES ====================
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', startTime: '08:00', endTime: '17:00', breakMinutes: 60,
    graceLateMins: 15, graceEarlyMins: 15, standardWorkingHours: 8,
    otMultiplierNormal: 1.5, otMultiplierWeekend: 2.0, otMultiplierHoliday: 3.0,
    nightShiftPremium: 0.3, isNightShift: false, color: '#3b82f6', isActive: true,
  });

  const resetForm = () => {
    setForm({
      name: '', startTime: '08:00', endTime: '17:00', breakMinutes: 60,
      graceLateMins: 15, graceEarlyMins: 15, standardWorkingHours: 8,
      otMultiplierNormal: 1.5, otMultiplierWeekend: 2.0, otMultiplierHoliday: 3.0,
      nightShiftPremium: 0.3, isNightShift: false, color: '#3b82f6', isActive: true,
    });
    setEditId(null);
    setShowForm(false);
  };

  const openEdit = (shift: HrmShiftType) => {
    setForm({
      name: shift.name, startTime: shift.startTime, endTime: shift.endTime,
      breakMinutes: shift.breakMinutes, graceLateMins: shift.graceLateMins,
      graceEarlyMins: shift.graceEarlyMins, standardWorkingHours: shift.standardWorkingHours,
      otMultiplierNormal: shift.otMultiplierNormal, otMultiplierWeekend: shift.otMultiplierWeekend,
      otMultiplierHoliday: shift.otMultiplierHoliday, nightShiftPremium: shift.nightShiftPremium,
      isNightShift: shift.isNightShift, color: shift.color, isActive: shift.isActive,
    });
    setEditId(shift.id);
    setShowForm(true);
  };

  const handleSaveShift = () => {
    if (!form.name.trim()) return;
    const item: HrmShiftType = {
      id: editId || crypto.randomUUID(),
      ...form,
      createdAt: editId ? shiftTypes.find(s => s.id === editId)?.createdAt : new Date().toISOString(),
    };
    if (editId) {
      updateHrmItem('hrm_shift_types', item);
    } else {
      addHrmItem('hrm_shift_types', item);
    }
    resetForm();
  };

  const handleDeleteShift = (id: string) => {
    if (!confirm('Xóa ca làm việc này?')) return;
    removeHrmItem('hrm_shift_types', id);
  };

  // ==================== TAB 2: ASSIGN SHIFTS ====================
  const [assignMonth, setAssignMonth] = useState(() => new Date().getMonth() + 1);
  const [assignYear, setAssignYear] = useState(() => new Date().getFullYear());
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [searchText, setSearchText] = useState('');

  const daysInMonth = useMemo(() => new Date(assignYear, assignMonth, 0).getDate(), [assignYear, assignMonth]);

  const dayHeaders = useMemo(() => {
    const days: { dayNum: number; dayOfWeek: string; isWeekend: boolean }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(assignYear, assignMonth - 1, d);
      const dow = date.getDay();
      const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      days.push({ dayNum: d, dayOfWeek: dayNames[dow], isWeekend: dow === 0 || dow === 6 });
    }
    return days;
  }, [daysInMonth, assignYear, assignMonth]);

  const filteredEmps = useMemo(() => {
    if (!searchText) return activeEmployees;
    const q = searchText.toLowerCase();
    return activeEmployees.filter(e => e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q));
  }, [activeEmployees, searchText]);

  // Build lookup: employeeId + date -> HrmEmployeeShift
  const shiftMap = useMemo(() => {
    const map = new Map<string, HrmEmployeeShift>();
    employeeShifts.forEach(s => {
      if (s.shiftDate) map.set(`${s.employeeId}_${s.shiftDate}`, s);
    });
    return map;
  }, [employeeShifts]);

  // Default shift per employee (no date = default)
  const defaultShiftMap = useMemo(() => {
    const map = new Map<string, HrmEmployeeShift>();
    employeeShifts.forEach(s => {
      if (!s.shiftDate) map.set(s.employeeId, s);
    });
    return map;
  }, [employeeShifts]);

  const getDateKey = (day: number) => `${assignYear}-${String(assignMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const getShiftForCell = useCallback((employeeId: string, day: number): HrmEmployeeShift | undefined => {
    const dateStr = getDateKey(day);
    return shiftMap.get(`${employeeId}_${dateStr}`) || defaultShiftMap.get(employeeId);
  }, [shiftMap, defaultShiftMap, assignYear, assignMonth]);

  const handleCellClick = useCallback((employeeId: string, day: number) => {
    if (!selectedShiftId) return;
    const dateStr = getDateKey(day);
    const key = `${employeeId}_${dateStr}`;
    const existing = shiftMap.get(key);

    if (existing) {
      // Toggle: nếu cùng shift thì xóa, khác thì update
      if (existing.shiftTypeId === selectedShiftId && !existing.isDayOff) {
        removeHrmItem('hrm_employee_shifts', existing.id);
      } else {
        updateHrmItem('hrm_employee_shifts', {
          ...existing,
          shiftTypeId: selectedShiftId,
          isDayOff: false,
        });
      }
    } else {
      addHrmItem('hrm_employee_shifts', {
        id: crypto.randomUUID(),
        employeeId,
        shiftTypeId: selectedShiftId,
        shiftDate: dateStr,
        isDayOff: false,
        createdAt: new Date().toISOString(),
      });
    }
  }, [selectedShiftId, shiftMap, addHrmItem, updateHrmItem, removeHrmItem, assignYear, assignMonth]);

  // Gán ca mặc định cho nhân viên
  const handleSetDefault = useCallback((employeeId: string) => {
    if (!selectedShiftId) return;
    const existing = defaultShiftMap.get(employeeId);
    if (existing) {
      updateHrmItem('hrm_employee_shifts', { ...existing, shiftTypeId: selectedShiftId });
    } else {
      addHrmItem('hrm_employee_shifts', {
        id: crypto.randomUUID(),
        employeeId,
        shiftTypeId: selectedShiftId,
        shiftDate: null,
        isDayOff: false,
        createdAt: new Date().toISOString(),
      });
    }
  }, [selectedShiftId, defaultShiftMap, addHrmItem, updateHrmItem]);

  // Quick fill: gán ca cho tất cả ngày thường trong tháng
  const handleFillMonth = useCallback((employeeId: string) => {
    if (!selectedShiftId) return;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(assignYear, assignMonth - 1, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // Skip weekends
      const dateStr = getDateKey(d);
      const key = `${employeeId}_${dateStr}`;
      if (!shiftMap.has(key)) {
        addHrmItem('hrm_employee_shifts', {
          id: crypto.randomUUID(),
          employeeId,
          shiftTypeId: selectedShiftId,
          shiftDate: dateStr,
          isDayOff: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }, [selectedShiftId, daysInMonth, shiftMap, addHrmItem, assignYear, assignMonth]);

  const prevMonth = () => {
    if (assignMonth === 1) { setAssignMonth(12); setAssignYear(y => y - 1); }
    else setAssignMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (assignMonth === 12) { setAssignMonth(1); setAssignYear(y => y + 1); }
    else setAssignMonth(m => m + 1);
  };

  const activeShiftTypes = useMemo(() => shiftTypes.filter(s => s.isActive), [shiftTypes]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <Clock className="text-teal-500" size={24} /> Ca Làm Việc
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Quản lý ca làm việc & phân ca nhân viên
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1">
        <button onClick={() => setActiveTab('types')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 'types' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Settings size={14} className="inline mr-1.5" />Ca làm việc
        </button>
        <button onClick={() => setActiveTab('assign')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 'assign' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Calendar size={14} className="inline mr-1.5" />Phân ca
        </button>
      </div>

      {/* ==================== TAB 1: SHIFT TYPES ==================== */}
      {activeTab === 'types' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="px-4 py-2 bg-teal-500 text-white rounded-xl text-xs font-black hover:bg-teal-600 transition flex items-center gap-1.5">
              <Plus size={14} /> Tạo ca mới
            </button>
          </div>

          {/* Shift Type Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shiftTypes.map(shift => (
              <div key={shift.id}
                className={`glass-card rounded-2xl p-5 border-l-4 transition-all hover:shadow-lg ${!shift.isActive ? 'opacity-50' : ''}`}
                style={{ borderLeftColor: shift.color }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: shift.color }} />
                    <h3 className="font-black text-slate-800 dark:text-white">{shift.name}</h3>
                    {shift.isNightShift && <Moon size={14} className="text-indigo-400" />}
                    {!shift.isActive && <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Tắt</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(shift)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                      <Edit3 size={14} className="text-slate-400" />
                    </button>
                    <button onClick={() => handleDeleteShift(shift.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition">
                      <Trash2 size={14} className="text-red-400" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    <span className="text-slate-400 text-[10px] font-bold block">Giờ làm</span>
                    <span className="font-black text-slate-700 dark:text-white">{shift.startTime?.slice(0,5)} → {shift.endTime?.slice(0,5)}</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    <span className="text-slate-400 text-[10px] font-bold block">Giờ chuẩn</span>
                    <span className="font-black text-slate-700 dark:text-white">{shift.standardWorkingHours}h</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    <span className="text-slate-400 text-[10px] font-bold block">Nghỉ trưa</span>
                    <span className="font-black text-slate-700 dark:text-white">{shift.breakMinutes} phút</span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2">
                    <span className="text-slate-400 text-[10px] font-bold block">Grace</span>
                    <span className="font-black text-slate-700 dark:text-white">±{shift.graceLateMins} phút</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                  <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">OT: ×{shift.otMultiplierNormal}</span>
                  <span className="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">T7/CN: ×{shift.otMultiplierWeekend}</span>
                  <span className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">Lễ: ×{shift.otMultiplierHoliday}</span>
                  {shift.isNightShift && <span className="bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">Đêm: +{(shift.nightShiftPremium * 100).toFixed(0)}%</span>}
                </div>
              </div>
            ))}

            {shiftTypes.length === 0 && (
              <div className="col-span-full text-center py-12 text-slate-400">
                <Clock size={48} className="mx-auto mb-3 opacity-30" />
                <p className="font-bold">Chưa có ca làm việc nào</p>
                <p className="text-xs mt-1">Nhấn "Tạo ca mới" để bắt đầu</p>
              </div>
            )}
          </div>

          {/* Create/Edit Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="glass-card rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-black text-slate-800 dark:text-white">
                    {editId ? 'Sửa ca làm việc' : 'Tạo ca làm việc mới'}
                  </h2>
                  <button onClick={resetForm} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><X size={18} /></button>
                </div>

                <div className="space-y-4">
                  {/* Name + Color */}
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tên ca</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-teal-500"
                        placeholder="VD: Ca Hành chính" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Màu</label>
                      <div className="flex gap-1 flex-wrap">
                        {SHIFT_COLORS.map(c => (
                          <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                            className={`w-7 h-7 rounded-lg transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-teal-500 scale-110' : 'hover:scale-105'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Time */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Giờ bắt đầu</label>
                      <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Giờ kết thúc</label>
                      <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nghỉ trưa (phút)</label>
                      <input type="number" value={form.breakMinutes} onChange={e => setForm(f => ({ ...f, breakMinutes: parseInt(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>

                  {/* Grace + Standard hours */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Grace muộn (phút)</label>
                      <input type="number" value={form.graceLateMins} onChange={e => setForm(f => ({ ...f, graceLateMins: parseInt(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Grace sớm (phút)</label>
                      <input type="number" value={form.graceEarlyMins} onChange={e => setForm(f => ({ ...f, graceEarlyMins: parseInt(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Giờ chuẩn</label>
                      <input type="number" step="0.5" value={form.standardWorkingHours} onChange={e => setForm(f => ({ ...f, standardWorkingHours: parseFloat(e.target.value) || 8 }))}
                        className="w-full px-3 py-2 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                    </div>
                  </div>

                  {/* OT Multipliers */}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Hệ số OT (theo Luật LĐ VN 2019)</label>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                        <span className="text-[9px] font-black text-blue-500 block mb-1">NGÀY THƯỜNG</span>
                        <input type="number" step="0.1" value={form.otMultiplierNormal} onChange={e => setForm(f => ({ ...f, otMultiplierNormal: parseFloat(e.target.value) || 1.5 }))}
                          className="w-full px-2 py-1 text-sm font-black text-center border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-slate-800 outline-none" />
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
                        <span className="text-[9px] font-black text-amber-500 block mb-1">T7 / CN</span>
                        <input type="number" step="0.1" value={form.otMultiplierWeekend} onChange={e => setForm(f => ({ ...f, otMultiplierWeekend: parseFloat(e.target.value) || 2.0 }))}
                          className="w-full px-2 py-1 text-sm font-black text-center border border-amber-200 dark:border-amber-700 rounded-lg bg-white dark:bg-slate-800 outline-none" />
                      </div>
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
                        <span className="text-[9px] font-black text-red-500 block mb-1">LỄ / TẾT</span>
                        <input type="number" step="0.1" value={form.otMultiplierHoliday} onChange={e => setForm(f => ({ ...f, otMultiplierHoliday: parseFloat(e.target.value) || 3.0 }))}
                          className="w-full px-2 py-1 text-sm font-black text-center border border-red-200 dark:border-red-700 rounded-lg bg-white dark:bg-slate-800 outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* Night shift */}
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.isNightShift} onChange={e => setForm(f => ({ ...f, isNightShift: e.target.checked }))}
                        className="w-4 h-4 rounded border-slate-300 text-teal-500 focus:ring-teal-500" />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Ca đêm (22h-6h)</span>
                    </label>
                    {form.isNightShift && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400">Phụ cấp:</span>
                        <input type="number" step="0.05" value={form.nightShiftPremium} onChange={e => setForm(f => ({ ...f, nightShiftPremium: parseFloat(e.target.value) || 0.3 }))}
                          className="w-16 px-2 py-1 text-xs font-bold text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none" />
                        <span className="text-[10px] font-bold text-slate-400">(={(form.nightShiftPremium * 100).toFixed(0)}%)</span>
                      </div>
                    )}
                  </div>

                  {/* Active toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                      className="w-4 h-4 rounded border-slate-300 text-teal-500 focus:ring-teal-500" />
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Đang hoạt động</span>
                  </label>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    <button onClick={handleSaveShift}
                      className="flex-1 px-4 py-2.5 bg-teal-500 text-white rounded-xl text-xs font-black hover:bg-teal-600 transition flex items-center justify-center gap-2">
                      <Save size={14} /> {editId ? 'Cập nhật' : 'Tạo ca'}
                    </button>
                    <button onClick={resetForm}
                      className="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                      Hủy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: ASSIGN SHIFTS ==================== */}
      {activeTab === 'assign' && (
        <div className="space-y-4">
          {/* Shift Picker + Month Nav */}
          <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                <ChevronLeft size={18} />
              </button>
              <div className="flex items-center gap-2">
                <select value={assignMonth} onChange={e => setAssignMonth(Number(e.target.value))}
                  className="bg-transparent text-lg font-black text-slate-800 dark:text-white outline-none cursor-pointer">
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
                  ))}
                </select>
                <select value={assignYear} onChange={e => setAssignYear(Number(e.target.value))}
                  className="bg-transparent text-lg font-black text-slate-800 dark:text-white outline-none cursor-pointer">
                  {Array.from({ length: 5 }, (_, i) => (
                    <option key={assignYear - 2 + i} value={assignYear - 2 + i}>{assignYear - 2 + i}</option>
                  ))}
                </select>
              </div>
              <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input type="text" placeholder="Tìm NV..." value={searchText} onChange={e => setSearchText(e.target.value)}
                className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-36" />
            </div>
          </div>

          {/* Shift Palette */}
          <div className="glass-panel rounded-2xl p-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Chọn ca để gán (click ô trong bảng)</p>
            <div className="flex flex-wrap gap-2">
              {activeShiftTypes.map(s => (
                <button key={s.id} onClick={() => setSelectedShiftId(s.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${selectedShiftId === s.id ? 'ring-2 ring-offset-2 ring-teal-500 shadow-lg scale-105' : 'hover:scale-102 opacity-80 hover:opacity-100'}`}
                  style={{ backgroundColor: s.color, color: '#fff' }}>
                  {selectedShiftId === s.id && <Check size={12} />}
                  {s.name} ({s.startTime?.slice(0,5)}-{s.endTime?.slice(0,5)})
                </button>
              ))}
              {!selectedShiftId && (
                <span className="text-xs font-bold text-amber-500 flex items-center gap-1">
                  <AlertTriangle size={12} /> Hãy chọn 1 ca trước khi gán
                </span>
              )}
            </div>
          </div>

          {/* Assignment Grid */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-left font-black text-slate-500 min-w-[180px]">
                      Nhân viên
                    </th>
                    <th className="px-1 py-1 text-center font-bold text-slate-400 min-w-[40px]">
                      Mặc định
                    </th>
                    {dayHeaders.map(d => (
                      <th key={d.dayNum} className={`px-0.5 py-1 text-center min-w-[32px] ${d.isWeekend ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                        <div className={`text-[9px] font-bold ${d.isWeekend ? 'text-red-400' : 'text-slate-400'}`}>{d.dayOfWeek}</div>
                        <div className={`text-[10px] font-black ${d.isWeekend ? 'text-red-500' : 'text-slate-600 dark:text-slate-300'}`}>{d.dayNum}</div>
                      </th>
                    ))}
                    <th className="px-2 py-1 text-center font-bold text-slate-400 min-w-[60px]">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmps.map(emp => {
                    const defShift = defaultShiftMap.get(emp.id);
                    const defType = defShift ? shiftTypes.find(s => s.id === defShift.shiftTypeId) : null;
                    return (
                      <tr key={emp.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-1.5">
                          <div className="font-bold text-slate-800 dark:text-white truncate">{emp.fullName}</div>
                          <div className="text-[9px] text-slate-400 font-bold">{emp.employeeCode}</div>
                        </td>
                        <td className="px-1 py-1 text-center">
                          {defType ? (
                            <div className="w-6 h-6 rounded-md mx-auto flex items-center justify-center text-white text-[8px] font-black cursor-pointer hover:scale-110 transition"
                              style={{ backgroundColor: defType.color }}
                              title={`Mặc định: ${defType.name}`}
                              onClick={() => handleSetDefault(emp.id)}>
                              {defType.name.charAt(0)}
                            </div>
                          ) : (
                            <button onClick={() => handleSetDefault(emp.id)}
                              className="w-6 h-6 rounded-md mx-auto border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-300 hover:border-teal-400 hover:text-teal-400 transition"
                              title="Gán ca mặc định">
                              <Plus size={10} />
                            </button>
                          )}
                        </td>
                        {dayHeaders.map(d => {
                          const cellShift = getShiftForCell(emp.id, d.dayNum);
                          const dateStr = getDateKey(d.dayNum);
                          const specificShift = shiftMap.get(`${emp.id}_${dateStr}`);
                          const shiftType = specificShift ? shiftTypes.find(s => s.id === specificShift.shiftTypeId) : null;
                          return (
                            <td key={d.dayNum}
                              className={`px-0.5 py-1 text-center ${d.isWeekend ? 'bg-red-50/50 dark:bg-red-900/5' : ''}`}
                              onClick={() => handleCellClick(emp.id, d.dayNum)}>
                              {shiftType ? (
                                <div className="w-6 h-6 rounded-md mx-auto flex items-center justify-center text-white text-[8px] font-black cursor-pointer hover:scale-110 transition-all"
                                  style={{ backgroundColor: shiftType.color }}
                                  title={`${shiftType.name} (${shiftType.startTime}-${shiftType.endTime})`}>
                                  {shiftType.name.charAt(0)}
                                </div>
                              ) : cellShift && !specificShift ? (
                                <div className="w-6 h-6 rounded-md mx-auto flex items-center justify-center text-[8px] font-bold cursor-pointer hover:scale-110 transition-all opacity-30"
                                  style={{ backgroundColor: shiftTypes.find(s => s.id === cellShift.shiftTypeId)?.color || '#ccc' }}
                                  title="Từ ca mặc định">
                                  {shiftTypes.find(s => s.id === cellShift.shiftTypeId)?.name.charAt(0) || '?'}
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-md mx-auto border border-dashed border-slate-200 dark:border-slate-700 cursor-pointer hover:border-teal-400 transition" />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-1 py-1 text-center">
                          <button onClick={() => handleFillMonth(emp.id)}
                            className="px-2 py-1 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 rounded-lg text-[9px] font-black hover:bg-teal-100 dark:hover:bg-teal-900/40 transition"
                            title="Gán ca cho tất cả ngày thường">
                            Gán tháng
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredEmps.length === 0 && (
                    <tr>
                      <td colSpan={daysInMonth + 3} className="text-center py-8 text-slate-400">
                        <Users size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="font-bold text-sm">Không tìm thấy nhân viên</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShiftManagement;
