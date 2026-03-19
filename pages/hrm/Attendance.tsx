import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Calendar, ChevronLeft, ChevronRight, Clock, Users, Download,
  CheckCircle, XCircle, Sun, Coffee, Plane, Filter, Search,
  Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AttendanceStatus, AttendanceRecord,
  ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_COLORS
} from '../../types';

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'half_day', 'leave', 'holiday', 'business_trip'];

const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: '✓', absent: '✗', half_day: '½', leave: 'P', holiday: 'L', business_trip: 'CT',
};

const Attendance: React.FC = () => {
  const { employees, attendanceRecords, hrmConstructionSites, addHrmItem, updateHrmItem } = useApp();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'Đang làm việc'), [employees]);

  // Month/Year picker
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [filterSite, setFilterSite] = useState<string>('');
  const [searchText, setSearchText] = useState('');

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<Array<Record<string, any>>>([]);
  const [importErrors, setImportErrors] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const daysInMonth = useMemo(() => new Date(currentYear, currentMonth, 0).getDate(), [currentYear, currentMonth]);
  const dayHeaders = useMemo(() => {
    const days: { dayNum: number; dayOfWeek: string; isWeekend: boolean }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, currentMonth - 1, d);
      const dow = date.getDay();
      const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      days.push({ dayNum: d, dayOfWeek: dayNames[dow], isWeekend: dow === 0 || dow === 6 });
    }
    return days;
  }, [daysInMonth, currentYear, currentMonth]);

  // Filter employees
  const filteredEmployees = useMemo(() => {
    let list = activeEmployees;
    if (filterSite) list = list.filter(e => e.constructionSiteId === filterSite);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(e => e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q));
    }
    return list;
  }, [activeEmployees, filterSite, searchText]);

  // Build lookup: employeeId + date -> record
  const recordMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    attendanceRecords.forEach(r => {
      map.set(`${r.employeeId}_${r.date}`, r);
    });
    return map;
  }, [attendanceRecords]);

  // Get or toggle cell
  const getDateKey = (day: number) => `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const handleCellClick = useCallback((employeeId: string, day: number) => {
    const dateStr = getDateKey(day);
    const key = `${employeeId}_${dateStr}`;
    const existing = recordMap.get(key);

    if (existing) {
      const currentIdx = STATUS_CYCLE.indexOf(existing.status);
      const nextIdx = (currentIdx + 1) % STATUS_CYCLE.length;
      updateHrmItem('hrm_attendance', { ...existing, status: STATUS_CYCLE[nextIdx] });
    } else {
      addHrmItem('hrm_attendance', {
        id: crypto.randomUUID(),
        employeeId,
        date: dateStr,
        status: 'present' as AttendanceStatus,
        createdAt: new Date().toISOString(),
      });
    }
  }, [recordMap, addHrmItem, updateHrmItem, currentYear, currentMonth]);

  // Stats per employee
  const getStats = useCallback((employeeId: string) => {
    let present = 0, absent = 0, halfDay = 0, leave = 0, holiday = 0, trip = 0, overtime = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${employeeId}_${getDateKey(d)}`;
      const rec = recordMap.get(key);
      if (rec) {
        if (rec.status === 'present') present++;
        else if (rec.status === 'absent') absent++;
        else if (rec.status === 'half_day') halfDay++;
        else if (rec.status === 'leave') leave++;
        else if (rec.status === 'holiday') holiday++;
        else if (rec.status === 'business_trip') trip++;
        overtime += rec.overtimeHours || 0;
      }
    }
    const workDays = present + halfDay * 0.5 + trip;
    return { present, absent, halfDay, leave, holiday, trip, overtime, workDays };
  }, [recordMap, daysInMonth, currentYear, currentMonth]);

  // Month nav
  const prevMonth = () => {
    if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  // Summary stats
  const totalStats = useMemo(() => {
    let totalWork = 0, totalAbsent = 0, totalLeave = 0;
    filteredEmployees.forEach(emp => {
      const s = getStats(emp.id);
      totalWork += s.workDays;
      totalAbsent += s.absent;
      totalLeave += s.leave;
    });
    return { totalWork, totalAbsent, totalLeave, totalEmployees: filteredEmployees.length };
  }, [filteredEmployees, getStats]);

  // Quick fill: mark all empty cells of today as 'present'
  const quickFillToday = () => {
    const today = new Date();
    if (today.getMonth() + 1 !== currentMonth || today.getFullYear() !== currentYear) return;
    const dateStr = getDateKey(today.getDate());
    filteredEmployees.forEach(emp => {
      const key = `${emp.id}_${dateStr}`;
      if (!recordMap.has(key)) {
        addHrmItem('hrm_attendance', {
          id: crypto.randomUUID(),
          employeeId: emp.id,
          date: dateStr,
          status: 'present' as AttendanceStatus,
          createdAt: new Date().toISOString(),
        });
      }
    });
  };

  // Export CSV
  const exportCSV = () => {
    const header = ['Mã NV', 'Họ tên', ...dayHeaders.map(d => `${d.dayNum}`), 'Ngày công', 'Vắng', 'Phép', 'OT(h)'];
    const rows = filteredEmployees.map(emp => {
      const s = getStats(emp.id);
      const days = dayHeaders.map(d => {
        const key = `${emp.id}_${getDateKey(d.dayNum)}`;
        const rec = recordMap.get(key);
        return rec ? STATUS_SHORT[rec.status] : '';
      });
      return [emp.employeeCode, emp.fullName, ...days, s.workDays, s.absent, s.leave, s.overtime];
    });
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chamcong_${currentMonth}_${currentYear}.csv`;
    link.click();
  };

  // ==================== IMPORT TỪ MÁY CHẤM CÔNG ====================

  const downloadTemplate = () => {
    const header = ['Mã NV', 'Ngày (dd/mm/yyyy)', 'Giờ vào', 'Giờ ra', 'Trạng thái', 'OT (giờ)', 'Ghi chú'];
    const sampleRows = [
      ['TT001', '01/03/2026', '07:30', '17:00', '', '', ''],
      ['TT002', '01/03/2026', '08:00', '17:30', '', '1.5', 'Tăng ca'],
      ['TT003', '01/03/2026', '', '', 'V', '', 'Vắng không phép'],
      ['TT001', '02/03/2026', '07:45', '12:00', 'N', '', 'Nửa ngày'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...sampleRows]);
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 25 }];
    // Add instruction row
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['Hướng dẫn:'],
      ['Mã NV', 'Mã nhân viên trong hệ thống (VD: TT001)'],
      ['Ngày', 'Định dạng dd/mm/yyyy'],
      ['Giờ vào/ra', 'Định dạng HH:mm (24h)'],
      ['Trạng thái', 'Để trống = tự tính | V=Vắng | N=Nửa ngày | P=Phép | L=Lễ | CT=Công tác'],
      ['OT', 'Số giờ tăng ca (VD: 1.5)'],
    ], { origin: `A${sampleRows.length + 3}` });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chấm công');
    XLSX.writeFile(wb, `mau_chamcong_T${currentMonth}_${currentYear}.xlsx`);
  };

  const STATUS_MAP: Record<string, AttendanceStatus> = {
    '': 'present', 'V': 'absent', 'N': 'half_day', 'P': 'leave', 'L': 'holiday', 'CT': 'business_trip',
  };

  const parseDate = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).trim();
    // dd/mm/yyyy
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
    // yyyy-mm-dd
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
    // Excel serial number
    if (!isNaN(Number(val))) {
      const excelDate = new Date((Number(val) - 25569) * 86400 * 1000);
      if (!isNaN(excelDate.getTime())) {
        return excelDate.toISOString().split('T')[0];
      }
    }
    return null;
  };

  const parseTime = (val: any): string | null => {
    if (!val) return null;
    const s = String(val).trim();
    // HH:mm or H:mm
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    // Excel decimal time (0.3125 = 07:30)
    if (!isNaN(Number(val))) {
      const totalMinutes = Math.round(Number(val) * 24 * 60);
      const h = Math.floor(totalMinutes / 60) % 24;
      const min = totalMinutes % 60;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return null;
  };

  const empCodeMap = useMemo(() => {
    const map = new Map<string, string>(); // code -> id
    employees.forEach(e => map.set(e.employeeCode.toUpperCase(), e.id));
    return map;
  }, [employees]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const errors: Record<number, string> = {};
      const rows = rawRows.map((row, idx) => {
        const code = String(Object.values(row)[0] || '').trim().toUpperCase();
        const dateRaw = Object.values(row)[1];
        const checkInRaw = Object.values(row)[2];
        const checkOutRaw = Object.values(row)[3];
        const statusRaw = String(Object.values(row)[4] || '').trim().toUpperCase();
        const otRaw = Object.values(row)[5];
        const noteRaw = String(Object.values(row)[6] || '').trim();

        // Validate
        if (!code) { errors[idx] = 'Thiếu Mã NV'; return row; }
        if (!empCodeMap.has(code)) { errors[idx] = `Mã NV "${code}" không tồn tại`; return row; }
        const dateStr = parseDate(dateRaw);
        if (!dateStr) { errors[idx] = 'Ngày không hợp lệ'; return row; }

        const checkIn = parseTime(checkInRaw);
        const checkOut = parseTime(checkOutRaw);
        const ot = otRaw ? parseFloat(String(otRaw)) : 0;

        // Determine status
        let status: AttendanceStatus = 'present';
        if (statusRaw && STATUS_MAP[statusRaw] !== undefined) {
          status = STATUS_MAP[statusRaw];
        } else if (!checkIn && !checkOut) {
          status = 'absent';
        }

        return {
          ...row,
          _code: code,
          _empId: empCodeMap.get(code),
          _date: dateStr,
          _checkIn: checkIn,
          _checkOut: checkOut,
          _status: status,
          _ot: isNaN(ot) ? 0 : ot,
          _note: noteRaw,
        };
      });

      setImportRows(rows);
      setImportErrors(errors);
      setShowImportModal(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
  };

  const handleBulkImport = async () => {
    setImporting(true);
    const validRows = importRows.filter((_, idx) => !importErrors[idx]);
    let imported = 0;

    for (const row of validRows) {
      if (!row._empId || !row._date) continue;
      const key = `${row._empId}_${row._date}`;
      const existing = recordMap.get(key);

      const record: AttendanceRecord = {
        id: existing?.id || crypto.randomUUID(),
        employeeId: row._empId,
        date: row._date,
        status: row._status,
        checkIn: row._checkIn || undefined,
        checkOut: row._checkOut || undefined,
        overtimeHours: row._ot || undefined,
        note: row._note || undefined,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };

      if (existing) {
        updateHrmItem('hrm_attendance', record);
      } else {
        addHrmItem('hrm_attendance', record);
      }
      imported++;
    }

    setImporting(false);
    setShowImportModal(false);
    setImportRows([]);
    setImportErrors({});
    alert(`Đã import ${imported} bản ghi chấm công thành công!`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <Calendar className="text-teal-500" size={24} /> Bảng Chấm Công
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Theo dõi ngày công nhân viên hàng tháng
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={quickFillToday} className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5">
            <CheckCircle size={14} /> Chấm hôm nay
          </button>
          <button onClick={downloadTemplate} className="px-3 py-2 bg-teal-500 text-white rounded-xl text-xs font-black hover:bg-teal-600 transition flex items-center gap-1.5">
            <FileSpreadsheet size={14} /> Tải mẫu
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition flex items-center gap-1.5">
            <Upload size={14} /> Nhập máy CC
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          <button onClick={exportCSV} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center gap-1.5">
            <Download size={14} /> Xuất CSV
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nhân viên</p>
          <p className="text-xl font-black text-slate-800 dark:text-white">{totalStats.totalEmployees}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng ngày công</p>
          <p className="text-xl font-black text-emerald-600">{totalStats.totalWork.toFixed(1)}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vắng mặt</p>
          <p className="text-xl font-black text-red-500">{totalStats.totalAbsent}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nghỉ phép</p>
          <p className="text-xl font-black text-blue-500">{totalStats.totalLeave}</p>
        </div>
      </div>

      {/* Month Navigator + Filters */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <select value={currentMonth} onChange={e => setCurrentMonth(Number(e.target.value))}
              className="bg-transparent text-lg font-black text-slate-800 dark:text-white outline-none cursor-pointer">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Tháng {i + 1}</option>
              ))}
            </select>
            <select value={currentYear} onChange={e => setCurrentYear(Number(e.target.value))}
              className="bg-transparent text-lg font-black text-slate-800 dark:text-white outline-none cursor-pointer">
              {Array.from({ length: 5 }, (_, i) => (
                <option key={currentYear - 2 + i} value={currentYear - 2 + i}>{currentYear - 2 + i}</option>
              ))}
            </select>
          </div>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hrmConstructionSites.length > 0 && (
            <select value={filterSite} onChange={e => setFilterSite(e.target.value)}
              className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
              <option value="">Tất cả công trường</option>
              {hrmConstructionSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Tìm NV..." value={searchText} onChange={e => setSearchText(e.target.value)}
              className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none w-36" />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {STATUS_CYCLE.map(s => (
          <div key={s} className="flex items-center gap-1">
            <span className={`w-5 h-5 rounded text-[9px] font-black flex items-center justify-center ${ATTENDANCE_STATUS_COLORS[s]}`}>
              {STATUS_SHORT[s]}
            </span>
            <span className="text-[10px] font-bold text-slate-500">{ATTENDANCE_STATUS_LABELS[s]}</span>
          </div>
        ))}
        <span className="text-[10px] text-slate-400 font-bold ml-2">• Click ô để chuyển trạng thái</span>
      </div>

      {/* Timesheet Grid */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ display: 'table' }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 px-2 py-2 text-left border-b border-r border-slate-200 dark:border-slate-700 min-w-[140px]">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nhân viên</span>
                </th>
                {dayHeaders.map(d => (
                  <th key={d.dayNum}
                    className={`px-0.5 py-1.5 text-center border-b border-slate-200 dark:border-slate-700 min-w-[28px] ${
                      d.isWeekend ? 'bg-rose-50/70 dark:bg-rose-950/20' : 'bg-slate-50 dark:bg-slate-800'
                    }`}>
                    <div className="text-[8px] font-bold text-slate-400">{d.dayOfWeek}</div>
                    <div className={`text-[10px] font-black ${d.isWeekend ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'}`}>{d.dayNum}</div>
                  </th>
                ))}
                <th className="sticky right-0 z-20 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-2 text-center border-b border-l border-slate-200 dark:border-slate-700 min-w-[50px]">
                  <span className="text-[9px] font-black text-emerald-600 uppercase">Công</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={daysInMonth + 2} className="py-12 text-center">
                    <Users size={40} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black text-slate-400">Chưa có nhân viên</p>
                    <p className="text-xs text-slate-400 mt-1">Thêm nhân viên trong module NS để bắt đầu chấm công</p>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp, idx) => {
                  const stats = getStats(emp.id);
                  return (
                    <tr key={emp.id} className={`${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/30'} hover:bg-blue-50/50 dark:hover:bg-blue-950/10 transition-colors`}>
                      <td className="sticky left-0 z-10 bg-inherit px-2 py-1.5 border-b border-r border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 min-w-[130px]">
                          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-white text-[9px] font-black shrink-0">
                            {emp.fullName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-black text-slate-800 dark:text-white truncate">{emp.fullName}</div>
                            <div className="text-[9px] font-mono text-slate-400">{emp.employeeCode}</div>
                          </div>
                        </div>
                      </td>
                      {dayHeaders.map(d => {
                        const key = `${emp.id}_${getDateKey(d.dayNum)}`;
                        const rec = recordMap.get(key);
                        return (
                          <td key={d.dayNum}
                            onClick={() => handleCellClick(emp.id, d.dayNum)}
                            className={`px-0 py-0.5 text-center border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-all hover:scale-110 hover:z-10 ${
                              d.isWeekend ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''
                            }`}>
                            {rec ? (
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-black ${ATTENDANCE_STATUS_COLORS[rec.status]}`}>
                                {STATUS_SHORT[rec.status]}
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                                ·
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 bg-emerald-50/80 dark:bg-emerald-950/20 px-2 py-1.5 text-center border-b border-l border-slate-100 dark:border-slate-800">
                        <span className="text-sm font-black text-emerald-600">{stats.workDays}</span>
                        {stats.overtime > 0 && (
                          <div className="text-[8px] text-amber-500 font-bold">+{stats.overtime}h</div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Preview Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                  <Upload size={20} className="text-blue-500" /> Xem trước dữ liệu chấm công
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {importRows.length} dòng • <span className="text-emerald-600 font-bold">{importRows.length - Object.keys(importErrors).length} hợp lệ</span>
                  {Object.keys(importErrors).length > 0 && <> • <span className="text-red-500 font-bold">{Object.keys(importErrors).length} lỗi</span></>}
                </p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportRows([]); setImportErrors({}); }} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <XCircle size={20} className="text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-xs" style={{ display: 'table' }}>
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase text-[10px]">#</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase text-[10px]">Mã NV</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase text-[10px]">Họ tên</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">Ngày</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">Giờ vào</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">Giờ ra</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">Trạng thái</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">OT</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase text-[10px]">KQ</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, idx) => {
                    const err = importErrors[idx];
                    const emp = row._empId ? employees.find(e => e.id === row._empId) : null;
                    return (
                      <tr key={idx} className={`border-b border-slate-100 dark:border-slate-800 ${err ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                        <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-300">{row._code || String(Object.values(row)[0])}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{emp?.fullName || '-'}</td>
                        <td className="px-3 py-2 text-center font-mono">{row._date ? new Date(row._date).toLocaleDateString('vi-VN') : '-'}</td>
                        <td className="px-3 py-2 text-center font-mono text-blue-600">{row._checkIn || '-'}</td>
                        <td className="px-3 py-2 text-center font-mono text-orange-600">{row._checkOut || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          {row._status && (
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black ${ATTENDANCE_STATUS_COLORS[row._status as AttendanceStatus]}`}>
                              {ATTENDANCE_STATUS_LABELS[row._status as AttendanceStatus]}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">{row._ot > 0 ? `${row._ot}h` : ''}</td>
                        <td className="px-3 py-2 text-center">
                          {err ? (
                            <div className="flex items-center gap-1 text-red-500">
                              <XCircle size={12} />
                              <span className="text-[10px] font-bold">{err}</span>
                            </div>
                          ) : (
                            <CheckCircle2 size={14} className="text-emerald-500 mx-auto" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <div className="text-xs text-slate-500">
                {recordMap.size > 0 && (
                  <span className="text-amber-500 font-bold flex items-center gap-1">
                    <AlertTriangle size={12} /> Dữ liệu trùng ngày sẽ được ghi đè
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowImportModal(false); setImportRows([]); setImportErrors({}); }} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                <button onClick={handleBulkImport} disabled={importing || importRows.length === Object.keys(importErrors).length}
                  className="px-4 py-2.5 bg-blue-500 text-white rounded-xl text-xs font-black hover:bg-blue-600 transition disabled:opacity-50 flex items-center gap-1.5">
                  {importing ? <><Loader2 size={14} className="animate-spin" /> Đang nhập...</> : <><Upload size={14} /> Nhập {importRows.length - Object.keys(importErrors).length} bản ghi</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
