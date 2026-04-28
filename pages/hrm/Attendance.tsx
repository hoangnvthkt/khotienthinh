import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  Calendar, ChevronLeft, ChevronRight, Clock, Users, Download,
  CheckCircle, XCircle, Sun, Coffee, Plane, Filter, Search,
  Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Trash2, Star, Plus,
  MapPin, Eye, Save, X, Edit3
} from 'lucide-react';
import {
  AttendanceStatus, AttendanceRecord,
  ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_COLORS,
  Role, HrmHoliday,
  AttendanceProposal, AttendanceProposalStatus,
  PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_COLORS
} from '../../types';
import { usePermission } from '../../hooks/usePermission';
import { loadXlsx } from '../../lib/loadXlsx';

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'half_day', 'leave', 'holiday', 'business_trip'];

const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: '✓', late: 'M', absent: '✗', half_day: '½', leave: 'P', holiday: 'L', business_trip: 'CT',
};

const Attendance: React.FC = () => {
  const { employees, attendanceRecords, hrmConstructionSites, hrmOffices, hrmWorkSchedules, holidays, attendanceProposals, addHrmItem, updateHrmItem, removeHrmItem, user, users, shiftTypes, employeeShifts } = useApp();
  useModuleData('hrm');
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { canManage, isAdmin } = usePermission();
  const canCRUD = canManage('/hrm/attendance');

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

  // Holiday state
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');

  // Tab: 'timesheet' | 'proposals'
  const [activeTab, setActiveTab] = useState<'timesheet' | 'proposals'>('timesheet');

  // Proposal state
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [pTargetEmployeeId, setPTargetEmployeeId] = useState('');
  const [pDate, setPDate] = useState('');
  const [pCheckIn, setPCheckIn] = useState('');
  const [pCheckOut, setPCheckOut] = useState('');
  const [pStatus, setPStatus] = useState<AttendanceStatus>('present');
  const [pReason, setPReason] = useState('');
  const [pLocationId, setPLocationId] = useState('');
  const [pLocationType, setPLocationType] = useState<'construction_site' | 'office'>('construction_site');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Detail panel state
  const [detailCell, setDetailCell] = useState<{ employeeId: string; day: number } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editNote, setEditNote] = useState('');
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Build schedule lookup: employeeId + date -> shift info
  // Priority: employeeShifts (specific date) -> employeeShifts (default, no date) -> hrmWorkSchedules fallback
  const getEmployeeShiftForDate = useCallback((employeeId: string, dateStr?: string) => {
    const defaultResult = { startTime: '08:00', endTime: '17:00', graceLateMins: 15, graceEarlyMins: 15, standardWorkingHours: 8, shiftName: '', shiftColor: '#3b82f6' };

    // 1. Check specific date assignment
    let assignment = dateStr ? employeeShifts.find(s => s.employeeId === employeeId && s.shiftDate === dateStr) : undefined;
    // 2. Fallback to default assignment (no date)
    if (!assignment) assignment = employeeShifts.find(s => s.employeeId === employeeId && !s.shiftDate);
    // 3. If assignment found, look up shift type
    if (assignment) {
      const shift = shiftTypes.find(s => s.id === assignment!.shiftTypeId);
      if (shift) {
        return {
          startTime: shift.startTime?.slice(0, 5) || '08:00',
          endTime: shift.endTime?.slice(0, 5) || '17:00',
          graceLateMins: shift.graceLateMins || 15,
          graceEarlyMins: shift.graceEarlyMins || 15,
          standardWorkingHours: shift.standardWorkingHours || 8,
          shiftName: shift.name,
          shiftColor: shift.color,
        };
      }
    }
    // 4. Fallback to old HrmWorkSchedule
    const emp = employees.find(e => e.id === employeeId);
    if (emp?.workScheduleId) {
      const schedule = hrmWorkSchedules.find(s => s.id === emp.workScheduleId);
      if (schedule) {
        return {
          ...defaultResult,
          startTime: schedule.morningStart?.slice(0, 5) || '08:00',
          endTime: schedule.afternoonEnd?.slice(0, 5) || '17:00',
        };
      }
    }
    return defaultResult;
  }, [employees, hrmWorkSchedules, shiftTypes, employeeShifts]);

  // Legacy wrapper for backward compat
  const getEmployeeSchedule = useCallback((employeeId: string) => {
    const shift = getEmployeeShiftForDate(employeeId);
    return {
      morningStart: shift.startTime,
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: shift.endTime,
    };
  }, [getEmployeeShiftForDate]);

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

  // Open detail panel
  const handleOpenDetail = useCallback((employeeId: string, day: number) => {
    const dateStr = getDateKey(day);
    const key = `${employeeId}_${dateStr}`;
    const rec = recordMap.get(key);
    setDetailCell({ employeeId, day });
    setEditMode(false);
    setEditCheckIn(rec?.checkIn || '');
    setEditCheckOut(rec?.checkOut || '');
    setEditNote(rec?.note || '');
    setShowSaveConfirm(false);
  }, [recordMap, currentYear, currentMonth]);

  // Save edited attendance with confirmation
  const handleSaveEdit = useCallback(() => {
    if (!detailCell) return;
    const dateStr = getDateKey(detailCell.day);
    const key = `${detailCell.employeeId}_${dateStr}`;
    const existing = recordMap.get(key);
    if (existing) {
      updateHrmItem('hrm_attendance', {
        ...existing,
        checkIn: editCheckIn || undefined,
        checkOut: editCheckOut || undefined,
        note: editNote || undefined,
      });
    } else {
      addHrmItem('hrm_attendance', {
        id: crypto.randomUUID(),
        employeeId: detailCell.employeeId,
        date: dateStr,
        status: 'present' as AttendanceStatus,
        checkIn: editCheckIn || undefined,
        checkOut: editCheckOut || undefined,
        note: editNote || undefined,
        createdAt: new Date().toISOString(),
      });
    }
    setShowSaveConfirm(false);
    setEditMode(false);
    // Keep detail panel open to see updated data
  }, [detailCell, editCheckIn, editCheckOut, editNote, recordMap, updateHrmItem, addHrmItem, currentYear, currentMonth]);

  // Determine cell color for past days (shift-aware with grace period)
  // 🟢 green = đúng giờ (within grace period)
  // 🟡 yellow = đi muộn (beyond grace period)
  // 🟠 orange = nửa ngày (checkOut quá sớm, < 50% standard hours)
  // 🔴 red = vắng (không chấm hoặc absent)
  const getCellIndicator = useCallback((rec: AttendanceRecord | undefined, dayNum: number, employeeId: string): 'green' | 'yellow' | 'orange' | 'red' | null => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cellDate = new Date(currentYear, currentMonth - 1, dayNum);
    if (cellDate >= today) return null; // Only past days

    if (!rec || rec.status === 'absent') return 'red';
    if (rec.status === 'leave' || rec.status === 'holiday') return null;

    const dateStr = getDateKey(dayNum);
    const shift = getEmployeeShiftForDate(employeeId, dateStr);
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const shiftStart = toMin(shift.startTime);
    const shiftEnd = toMin(shift.endTime);
    const halfShiftMins = (shift.standardWorkingHours * 60) / 2;

    const hasCheckIn = !!rec.checkIn;
    const hasCheckOut = !!rec.checkOut;

    if (!hasCheckIn && !hasCheckOut) return 'red';

    if (hasCheckIn && !hasCheckOut) {
      const ciMin = toMin(rec.checkIn!);
      if (ciMin <= shiftStart + shift.graceLateMins) return 'orange';
      return 'red';
    }
    if (!hasCheckIn && hasCheckOut) return 'orange';

    const ciMin = toMin(rec.checkIn!);
    const coMin = toMin(rec.checkOut!);
    const workedMins = coMin - ciMin;

    // Worked less than half shift -> orange (nửa ngày)
    if (workedMins < halfShiftMins) {
      return ciMin <= shiftStart + shift.graceLateMins ? 'orange' : 'red';
    }

    // Full day: check grace period for on-time vs late
    const isLate = ciMin > shiftStart + shift.graceLateMins;
    const isEarly = coMin < shiftEnd - shift.graceEarlyMins;

    if (isLate || isEarly) return 'yellow';
    return 'green';
  }, [currentYear, currentMonth, getEmployeeShiftForDate]);

  // Admin: right-click để xóa ngày công
  const handleCellDelete = useCallback((e: React.MouseEvent, employeeId: string, day: number) => {
    e.preventDefault();
    if (!canCRUD) return;
    const dateStr = getDateKey(day);
    const key = `${employeeId}_${dateStr}`;
    const existing = recordMap.get(key);
    if (existing) {
      removeHrmItem('hrm_attendance', existing.id);
    }
  }, [canCRUD, recordMap, removeHrmItem, currentYear, currentMonth]);

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
    // Late / early tracking (shift-aware with grace period)
    let lateCount = 0, earlyCount = 0, totalLateMin = 0, totalEarlyMin = 0;
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = getDateKey(d);
      const key = `${employeeId}_${dateStr}`;
      const rec = recordMap.get(key);
      if (rec && (rec.status === 'present' || rec.status === 'half_day' || rec.status === 'business_trip')) {
        const shift = getEmployeeShiftForDate(employeeId, dateStr);
        const stdStart = toMin(shift.startTime);
        const stdEnd = toMin(shift.endTime);
        if (rec.checkIn) {
          const ciMin = toMin(rec.checkIn);
          // Only count as late if beyond grace period
          if (ciMin > stdStart + shift.graceLateMins) { lateCount++; totalLateMin += ciMin - stdStart; }
        }
        if (rec.checkOut) {
          const coMin = toMin(rec.checkOut);
          // Only count as early if beyond grace period
          if (coMin < stdEnd - shift.graceEarlyMins) { earlyCount++; totalEarlyMin += stdEnd - coMin; }
        }
      }
    }
    return { present, absent, halfDay, leave, holiday, trip, overtime, workDays, lateCount, earlyCount, totalLateMin, totalEarlyMin };
  }, [recordMap, daysInMonth, currentYear, currentMonth, getEmployeeShiftForDate]);

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
    let totalWork = 0, totalAbsent = 0, totalLeave = 0, totalLate = 0, totalEarly = 0;
    filteredEmployees.forEach(emp => {
      const s = getStats(emp.id);
      totalWork += s.workDays;
      totalAbsent += s.absent;
      totalLeave += s.leave;
      totalLate += s.lateCount;
      totalEarly += s.earlyCount;
    });
    return { totalWork, totalAbsent, totalLeave, totalLate, totalEarly, totalEmployees: filteredEmployees.length };
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

  const downloadTemplate = async () => {
    const XLSX = await loadXlsx();
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
    // Use Blob + anchor for reliable filename on mobile
    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mau_chamcong_T${currentMonth}_${currentYear}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    reader.onload = async (evt) => {
      const XLSX = await loadXlsx();
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

  // ==================== ĐỀ XUẤT CHẤM CÔNG ====================

  const currentEmployee = useMemo(() => employees.find(e => e.userId === user.id), [employees, user.id]);

  // Location options for proposal form
  const locationOptions = useMemo(() => {
    const sites = hrmConstructionSites.map(s => ({ id: s.id, name: `🏗️ ${s.name}`, type: 'construction_site' as const }));
    const offices = hrmOffices.map(o => ({ id: o.id, name: `🏢 ${o.name}`, type: 'office' as const }));
    return [...sites, ...offices];
  }, [hrmConstructionSites, hrmOffices]);

  // Manager check: is current user a manager of any site/office?
  const managedSiteIds = useMemo(() => hrmConstructionSites.filter(s => s.managerId === user.id).map(s => s.id), [hrmConstructionSites, user.id]);
  const managedOfficeIds = useMemo(() => hrmOffices.filter(o => o.managerId === user.id).map(o => o.id), [hrmOffices, user.id]);
  const isManager = isAdmin || managedSiteIds.length > 0 || managedOfficeIds.length > 0;

  // Filter proposals: admin sees all, managers see proposals for their sites/offices, others see their own
  const filteredProposals = useMemo(() => {
    if (isAdmin) return attendanceProposals;
    const myEmpId = currentEmployee?.id;
    return attendanceProposals.filter(p => {
      if (p.proposerEmployeeId === myEmpId || p.targetEmployeeId === myEmpId) return true;
      if (p.locationType === 'construction_site' && p.locationId && managedSiteIds.includes(p.locationId)) return true;
      if (p.locationType === 'office' && p.locationId && managedOfficeIds.includes(p.locationId)) return true;
      return false;
    });
  }, [attendanceProposals, currentEmployee, isAdmin, managedSiteIds, managedOfficeIds]);

  const pendingCount = useMemo(() => filteredProposals.filter(p => p.proposalStatus === 'pending').length, [filteredProposals]);

  const resetProposalForm = () => {
    setShowProposalForm(false);
    setPTargetEmployeeId(currentEmployee?.id || '');
    setPDate('');
    setPCheckIn('');
    setPCheckOut('');
    setPStatus('present');
    setPReason('');
    setPLocationId('');
    setPLocationType('construction_site');
  };

  const handleCreateProposal = () => {
    if (!currentEmployee || !pTargetEmployeeId || !pDate || !pReason) return;
    const proposal: AttendanceProposal = {
      id: crypto.randomUUID(),
      proposerEmployeeId: currentEmployee.id,
      targetEmployeeId: pTargetEmployeeId,
      date: pDate,
      checkIn: pCheckIn || undefined,
      checkOut: pCheckOut || undefined,
      status: pStatus,
      reason: pReason,
      locationId: pLocationId || undefined,
      locationType: pLocationId ? pLocationType : undefined,
      proposalStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    addHrmItem('hrm_attendance_proposals', proposal);
    resetProposalForm();
  };

  const handleApprove = (proposal: AttendanceProposal) => {
    const updated: AttendanceProposal = {
      ...proposal,
      proposalStatus: 'approved',
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
    };
    updateHrmItem('hrm_attendance_proposals', updated);

    // Create/update attendance record
    const key = `${proposal.targetEmployeeId}_${proposal.date}`;
    const existing = recordMap.get(key);
    const locationName = proposal.locationId ? (
      proposal.locationType === 'construction_site'
        ? hrmConstructionSites.find(s => s.id === proposal.locationId)?.name
        : hrmOffices.find(o => o.id === proposal.locationId)?.name
    ) : undefined;

    if (existing) {
      updateHrmItem('hrm_attendance', {
        ...existing,
        status: proposal.status,
        checkIn: proposal.checkIn || existing.checkIn,
        checkOut: proposal.checkOut || existing.checkOut,
        constructionSiteId: proposal.locationType === 'construction_site' ? proposal.locationId : existing.constructionSiteId,
        locationName: locationName || existing.locationName,
        locationType: proposal.locationType || existing.locationType,
        note: `Bù công (đề xuất bởi ${employees.find(e => e.id === proposal.proposerEmployeeId)?.fullName || 'N/A'})`,
      });
    } else {
      addHrmItem('hrm_attendance', {
        id: crypto.randomUUID(),
        employeeId: proposal.targetEmployeeId,
        date: proposal.date,
        status: proposal.status,
        checkIn: proposal.checkIn || undefined,
        checkOut: proposal.checkOut || undefined,
        constructionSiteId: proposal.locationType === 'construction_site' ? proposal.locationId : undefined,
        locationName,
        locationType: proposal.locationType,
        note: `Bù công (đề xuất bởi ${employees.find(e => e.id === proposal.proposerEmployeeId)?.fullName || 'N/A'})`,
        createdAt: new Date().toISOString(),
      } as AttendanceRecord);
    }
  };

  const handleReject = (proposalId: string) => {
    const proposal = attendanceProposals.find(p => p.id === proposalId);
    if (!proposal) return;
    updateHrmItem('hrm_attendance_proposals', {
      ...proposal,
      proposalStatus: 'rejected',
      approvedBy: user.id,
      approvedAt: new Date().toISOString(),
      rejectionReason: rejectReason || 'Từ chối',
    });
    setRejectId(null);
    setRejectReason('');
  };

  const canApprove = (proposal: AttendanceProposal): boolean => {
    if (isAdmin) return true;
    if (proposal.locationType === 'construction_site' && proposal.locationId && managedSiteIds.includes(proposal.locationId)) return true;
    if (proposal.locationType === 'office' && proposal.locationId && managedOfficeIds.includes(proposal.locationId)) return true;
    return false;
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
          {canCRUD && (
            <>
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
              <button onClick={() => setShowHolidayModal(true)} className="px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition flex items-center gap-1.5">
                <Star size={14} /> Ngày lễ
              </button>
            </>
          )}
          <button onClick={exportCSV} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center gap-1.5">
            <Download size={14} /> Xuất CSV
          </button>
          <button onClick={() => { resetProposalForm(); setPTargetEmployeeId(currentEmployee?.id || ''); setShowProposalForm(true); }} className="px-3 py-2 bg-violet-500 text-white rounded-xl text-xs font-black hover:bg-violet-600 transition flex items-center gap-1.5">
            <Plus size={14} /> Đề xuất CC
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
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đi muộn</p>
          <p className="text-xl font-black text-orange-500">{totalStats.totalLate}</p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1">
        <button onClick={() => setActiveTab('timesheet')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 'timesheet' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Calendar size={14} className="inline mr-1.5" />Bảng Công
        </button>
        <button onClick={() => setActiveTab('proposals')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition relative ${activeTab === 'proposals' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Plus size={14} className="inline mr-1.5" />Đề Xuất CC
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{pendingCount}</span>
          )}
        </button>
      </div>

      {activeTab === 'timesheet' && (
      <>

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
      </>
      )}

      {/* Legend */}
      {activeTab === 'timesheet' && (
      <div className="flex flex-wrap items-center gap-2 px-1">
        {STATUS_CYCLE.map(s => (
          <div key={s} className="flex items-center gap-1">
            <span className={`w-5 h-5 rounded text-[9px] font-black flex items-center justify-center ${ATTENDANCE_STATUS_COLORS[s]}`}>
              {STATUS_SHORT[s]}
            </span>
            <span className="text-[10px] font-bold text-slate-500">{ATTENDANCE_STATUS_LABELS[s]}</span>
          </div>
        ))}
        <span className="mx-2 text-slate-300">|</span>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-emerald-400"></span><span className="text-[9px] font-bold text-slate-400">Đúng giờ</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-amber-400"></span><span className="text-[9px] font-bold text-slate-400">Muộn</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-orange-400"></span><span className="text-[9px] font-bold text-slate-400">½ ngày</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-2 ring-red-400"></span><span className="text-[9px] font-bold text-slate-400">Vắng</span></div>
        <span className="text-[10px] text-slate-400 font-bold ml-2">• Click ô để xem chi tiết</span>
        {isAdmin && <span className="text-[10px] text-red-400 font-bold ml-1">• Chuột phải để xóa</span>}
      </div>
      )}

      {/* Timesheet Grid */}
      {activeTab === 'timesheet' && (
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
                        const indicator = getCellIndicator(rec, d.dayNum, emp.id);
                        const indicatorBorder = indicator === 'green' ? 'ring-2 ring-emerald-400' : indicator === 'yellow' ? 'ring-2 ring-amber-400' : indicator === 'orange' ? 'ring-2 ring-orange-400' : indicator === 'red' ? 'ring-2 ring-red-400' : '';
                        return (
                          <td key={d.dayNum}
                            onClick={() => handleOpenDetail(emp.id, d.dayNum)}
                            onContextMenu={(e) => handleCellDelete(e, emp.id, d.dayNum)}
                            className={`px-0 py-0.5 text-center border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-all hover:scale-110 hover:z-10 ${
                              d.isWeekend ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''
                            }`}>
                            {rec ? (
                            <div className="relative inline-flex">
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-black ${ATTENDANCE_STATUS_COLORS[rec.status]} ${indicatorBorder}`}
                                title={`Click để xem chi tiết`}>
                                {STATUS_SHORT[rec.status]}
                              </span>
                              {/* Late/early dot */}
                              {(rec.status === 'present' || rec.status === 'half_day' || rec.status === 'business_trip') && (() => {
                                const dateStr = getDateKey(d.dayNum);
                                const shift = getEmployeeShiftForDate(emp.id, dateStr);
                                const toM = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                                const stdS = toM(shift.startTime);
                                const stdE = toM(shift.endTime);
                                let isLate = false, isEarly = false;
                                if (rec.checkIn) { const ciM = toM(rec.checkIn); if (ciM > stdS + shift.graceLateMins) isLate = true; }
                                if (rec.checkOut) { const coM = toM(rec.checkOut); if (coM < stdE - shift.graceEarlyMins) isEarly = true; }
                                if (isLate || isEarly) return <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500 border border-white dark:border-slate-900"></span>;
                                return null;
                              })()}
                            </div>
                            ) : (
                              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 ${indicatorBorder}`}
                                title="Click để xem chi tiết">
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
                        {(stats.lateCount > 0 || stats.earlyCount > 0) && (
                          <div className="text-[8px] text-orange-500 font-bold" title={`Muộn: ${stats.totalLateMin} phút, Sớm: ${stats.totalEarlyMin} phút`}>
                            {stats.lateCount > 0 && `⏰${stats.lateCount}`}
                            {stats.earlyCount > 0 && ` 🏃${stats.earlyCount}`}
                          </div>
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
      )}

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

      {/* Holiday Management Modal */}
      {showHolidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Star size={20} className="text-amber-500" /> Quản lý Ngày lễ — {currentYear}
              </h3>
              <button onClick={() => setShowHolidayModal(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <XCircle size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Add holiday form */}
              <div className="flex gap-2">
                <input type="text" value={holidayName} onChange={e => setHolidayName(e.target.value)}
                  placeholder="Tên ngày lễ..." className="flex-1 px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                <input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}
                  className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                <button onClick={() => {
                  if (!holidayName || !holidayDate) return;
                  addHrmItem('hrm_holidays', { id: crypto.randomUUID(), name: holidayName, date: holidayDate, year: parseInt(holidayDate.split('-')[0]), createdAt: new Date().toISOString() });
                  setHolidayName(''); setHolidayDate('');
                }} className="px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition">
                  <Plus size={14} />
                </button>
              </div>

              {/* Pre-fill VN defaults */}
              {holidays.filter(h => h.year === currentYear).length === 0 && (
                <button onClick={() => {
                  const defaults = [
                    { name: 'Tết Dương lịch', date: `${currentYear}-01-01` },
                    { name: 'Giải phóng miền Nam', date: `${currentYear}-04-30` },
                    { name: 'Quốc tế Lao động', date: `${currentYear}-05-01` },
                    { name: 'Quốc khánh', date: `${currentYear}-09-02` },
                    { name: 'Nghỉ bù Quốc khánh', date: `${currentYear}-09-03` },
                  ];
                  defaults.forEach(d => addHrmItem('hrm_holidays', { id: crypto.randomUUID(), ...d, year: currentYear, createdAt: new Date().toISOString() }));
                }} className="w-full px-3 py-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-bold hover:bg-amber-100 transition border border-amber-200 dark:border-amber-800">
                  🇻🇳 Thêm ngày lễ mặc định Việt Nam ({currentYear})
                </button>
              )}

              {/* Holiday list */}
              <div className="space-y-1">
                {holidays.filter(h => h.year === currentYear).sort((a, b) => a.date.localeCompare(b.date)).map(h => (
                  <div key={h.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 group">
                    <div>
                      <span className="text-xs font-black text-slate-800 dark:text-white">{h.name}</span>
                      <span className="text-[10px] text-slate-400 ml-2">{new Date(h.date).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
                    </div>
                    {canCRUD && (
                      <button onClick={() => removeHrmItem('hrm_holidays', h.id)} className="p-1 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {holidays.filter(h => h.year === currentYear).length === 0 && (
                  <p className="text-center text-xs text-slate-400 py-4">Chưa có ngày lễ nào cho năm {currentYear}</p>
                )}
              </div>

              {/* Apply to attendance */}
              {holidays.filter(h => h.year === currentYear).length > 0 && (
                <button onClick={() => {
                  const yearHolidays = holidays.filter(h => h.year === currentYear);
                  let count = 0;
                  yearHolidays.forEach(h => {
                    activeEmployees.forEach(emp => {
                      const existing = attendanceRecords.find(r => r.employeeId === emp.id && r.date === h.date);
                      if (existing) {
                        if (existing.status !== 'holiday') {
                          updateHrmItem('hrm_attendance', { ...existing, status: 'holiday', note: h.name });
                          count++;
                        }
                      } else {
                        addHrmItem('hrm_attendance', { id: crypto.randomUUID(), employeeId: emp.id, date: h.date, status: 'holiday' as any, note: h.name, createdAt: new Date().toISOString() });
                        count++;
                      }
                    });
                  });
                  alert(`Đã áp dụng ${yearHolidays.length} ngày lễ cho ${activeEmployees.length} NV (${count} bản ghi cập nhật)`);
                  setShowHolidayModal(false);
                }} className="w-full px-4 py-3 bg-emerald-500 text-white rounded-xl text-sm font-black hover:bg-emerald-600 transition flex items-center justify-center gap-2">
                  <CheckCircle size={16} /> Áp dụng tất cả ngày lễ vào chấm công
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== PROPOSALS TAB ==================== */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          {/* Proposals List */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            {filteredProposals.length === 0 ? (
              <div className="py-12 text-center">
                <Plus size={40} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-black text-slate-400">Chưa có đề xuất chấm công</p>
                <p className="text-xs text-slate-400 mt-1">Bấm nút "Đề xuất CC" để tạo đề xuất mới</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...filteredProposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(p => {
                  const proposer = employees.find(e => e.id === p.proposerEmployeeId);
                  const target = employees.find(e => e.id === p.targetEmployeeId);
                  const loc = p.locationId ? (
                    p.locationType === 'construction_site'
                      ? hrmConstructionSites.find(s => s.id === p.locationId)?.name
                      : hrmOffices.find(o => o.id === p.locationId)?.name
                  ) : null;
                  const isSelf = p.proposerEmployeeId === p.targetEmployeeId;

                  return (
                    <div key={p.id} className="p-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${PROPOSAL_STATUS_COLORS[p.proposalStatus]}`}>
                              {PROPOSAL_STATUS_LABELS[p.proposalStatus]}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black ${ATTENDANCE_STATUS_COLORS[p.status]}`}>
                              {ATTENDANCE_STATUS_LABELS[p.status]}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(p.date).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </span>
                          </div>
                          <div className="text-xs font-black text-slate-700 dark:text-slate-300">
                            {isSelf ? (
                              <>{target?.fullName || 'N/A'} <span className="text-slate-400 font-bold">(tự đề xuất)</span></>
                            ) : (
                              <>{proposer?.fullName || 'N/A'} <span className="text-slate-400">→</span> {target?.fullName || 'N/A'}</>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                            {p.checkIn && <span className="text-emerald-600 font-bold">Vào: {p.checkIn}</span>}
                            {p.checkOut && <span className="text-orange-600 font-bold">Ra: {p.checkOut}</span>}
                            {loc && <span>📍 {loc}</span>}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 italic">💬 {p.reason}</p>
                          {p.proposalStatus === 'rejected' && p.rejectionReason && (
                            <p className="text-[10px] text-red-500 mt-1 font-bold">❌ Lý do từ chối: {p.rejectionReason}</p>
                          )}
                          {p.approvedBy && (
                            <p className="text-[9px] text-slate-400 mt-0.5">
                              {p.proposalStatus === 'approved' ? '✅' : '❌'} Bởi: {users.find(u => u.id === p.approvedBy)?.name || 'N/A'}
                              {p.approvedAt && ` • ${new Date(p.approvedAt).toLocaleString('vi-VN')}`}
                            </p>
                          )}
                        </div>
                        {/* Actions for managers */}
                        {p.proposalStatus === 'pending' && canApprove(p) && (
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => handleApprove(p)}
                              className="px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black hover:bg-emerald-600 transition flex items-center gap-1">
                              <CheckCircle size={12} /> Duyệt
                            </button>
                            <button onClick={() => { setRejectId(p.id); setRejectReason(''); }}
                              className="px-3 py-1.5 bg-red-500 text-white rounded-xl text-[10px] font-black hover:bg-red-600 transition flex items-center gap-1">
                              <XCircle size={12} /> Từ chối
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
        </div>
      )}

      {/* ==================== REJECT REASON MODAL ==================== */}
      {rejectId && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-red-500 to-rose-500 rounded-t-3xl flex items-center justify-between">
              <span className="font-bold text-lg text-white flex items-center gap-2"><XCircle size={18} /> Từ chối đề xuất</span>
              <button onClick={() => setRejectId(null)} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><XCircle size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Lý do từ chối</label>
                <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                  placeholder="Nhập lý do từ chối..."
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-red-300" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setRejectId(null)} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                <button onClick={() => handleReject(rejectId)} className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-xs font-black hover:bg-red-600 transition">Xác nhận từ chối</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== PROPOSAL FORM MODAL ==================== */}
      {showProposalForm && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-violet-500 to-purple-500 rounded-t-3xl flex items-center justify-between">
              <span className="font-bold text-lg text-white flex items-center gap-2"><Plus size={18} /> Đề xuất chấm công</span>
              <button onClick={resetProposalForm} className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center"><XCircle size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Target employee */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Chấm công cho *</label>
                <select value={pTargetEmployeeId} onChange={e => setPTargetEmployeeId(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">— Chọn nhân viên —</option>
                  {activeEmployees.map(e => (
                    <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode}){e.id === currentEmployee?.id ? ' ← Tôi' : ''}</option>
                  ))}
                </select>
              </div>
              {/* Date */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Ngày cần bù công *</label>
                <input type="date" value={pDate} onChange={e => setPDate(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              {/* Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Giờ vào</label>
                  <input type="time" value={pCheckIn} onChange={e => setPCheckIn(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Giờ ra</label>
                  <input type="time" value={pCheckOut} onChange={e => setPCheckOut(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
                </div>
              </div>
              {/* Status */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Trạng thái</label>
                <select value={pStatus} onChange={e => setPStatus(e.target.value as AttendanceStatus)}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="present">Đi làm (✓)</option>
                  <option value="half_day">Nửa ngày (½)</option>
                  <option value="business_trip">Công tác (CT)</option>
                </select>
              </div>
              {/* Location */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Địa điểm</label>
                <select value={pLocationId ? `${pLocationType}:${pLocationId}` : ''}
                  onChange={e => {
                    if (!e.target.value) { setPLocationId(''); return; }
                    const [type, id] = e.target.value.split(':');
                    setPLocationType(type as 'construction_site' | 'office');
                    setPLocationId(id);
                  }}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">— Không chọn —</option>
                  {locationOptions.map(l => (
                    <option key={l.id} value={`${l.type}:${l.id}`}>{l.name}</option>
                  ))}
                </select>
              </div>
              {/* Reason */}
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">Lý do đề xuất *</label>
                <textarea value={pReason} onChange={e => setPReason(e.target.value)} rows={3}
                  placeholder="VD: Quên chấm công, hỏng máy chấm công, sự cố khẩn cấp..."
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={resetProposalForm} className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
                <button onClick={handleCreateProposal}
                  disabled={!pTargetEmployeeId || !pDate || !pReason}
                  className="px-4 py-2.5 bg-violet-500 text-white rounded-xl text-xs font-black hover:bg-violet-600 transition disabled:opacity-50 flex items-center gap-1.5">
                  <Plus size={14} /> Gửi đề xuất
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DETAIL PANEL MODAL ═══════ */}
      {detailCell && (() => {
        const dateStr = getDateKey(detailCell.day);
        const recKey = `${detailCell.employeeId}_${dateStr}`;
        const rec = recordMap.get(recKey);
        const emp = employees.find(e => e.id === detailCell.employeeId);
        const dayInfo = dayHeaders.find(d => d.dayNum === detailCell.day);
        const indicator = getCellIndicator(rec, detailCell.day, detailCell.employeeId);

        // Location info
        let locationDisplay = rec?.locationName || '';
        if (!locationDisplay && rec?.constructionSiteId) {
          locationDisplay = hrmConstructionSites.find(s => s.id === rec.constructionSiteId)?.name || '';
        }
        if (!locationDisplay && rec?.locationType === 'office') {
          locationDisplay = 'Văn phòng';
        }

        const hasGPS = rec?.checkInLat != null && rec?.checkInLng != null;
        const mapsUrl = hasGPS ? `https://maps.google.com/?q=${rec!.checkInLat},${rec!.checkInLng}` : null;

        // Formatted date
        const dateParts = dateStr.split('-');
        const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setDetailCell(null); setEditMode(false); setShowSaveConfirm(false); }}>
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header — purple gradient giống mockup */}
              <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-5 text-white text-center relative">
                <button onClick={() => { setDetailCell(null); setEditMode(false); setShowSaveConfirm(false); }} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/20 transition">
                  <X size={18} />
                </button>
                <div className="flex items-center gap-2 text-xs text-white/70 mb-3 justify-center">
                  <ChevronLeft size={14} />
                  <span className="font-bold">Dữ liệu chấm công</span>
                </div>
                <div className="w-14 h-14 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center mx-auto mb-3">
                  <Clock size={28} className="text-white" />
                </div>
                <h3 className="text-lg font-black">{emp?.fullName || 'N/A'}</h3>
                <p className="text-sm text-white/80 mt-0.5">{emp?.title || emp?.employeeCode || ''}</p>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4">
                {/* Date + Status indicator */}
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <Calendar size={15} className="text-violet-500" />
                    Dữ liệu chấm công — {dayInfo?.dayOfWeek} {formattedDate}
                  </h4>
                  {indicator && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      indicator === 'green' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                      : indicator === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                    }`}>
                      {indicator === 'green' ? '✅ Đúng giờ' : indicator === 'yellow' ? '⚠️ Đi muộn' : '❌ Vắng mặt'}
                    </span>
                  )}
                </div>

                {rec ? (
                  <div className="space-y-3">
                    {/* Check-in time */}
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${rec.checkIn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="flex-1">
                        {editMode ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase w-12">Vào:</span>
                            <input type="time" value={editCheckIn} onChange={e => setEditCheckIn(e.target.value)}
                              className="px-2 py-1 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300 w-28" />
                          </div>
                        ) : (
                          <>
                            <p className="text-base font-black text-slate-800 dark:text-white">{rec.checkIn || '—'}</p>
                            {locationDisplay && (
                              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                <MapPin size={10} className="shrink-0" />
                                {rec.locationType === 'construction_site' ? '🏗️' : '🏢'} {locationDisplay}
                              </p>
                            )}
                            {hasGPS && (
                              <a href={mapsUrl!} target="_blank" rel="noopener noreferrer" className="text-[10px] text-violet-500 hover:underline mt-0.5 inline-block">
                                📍 Vị trí chấm công ({rec.checkInLat?.toFixed(4)}, {rec.checkInLng?.toFixed(4)})
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Check-out time */}
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${rec.checkOut ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div className="flex-1">
                        {editMode ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase w-12">Ra:</span>
                            <input type="time" value={editCheckOut} onChange={e => setEditCheckOut(e.target.value)}
                              className="px-2 py-1 text-sm font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300 w-28" />
                          </div>
                        ) : (
                          <>
                            <p className="text-base font-black text-slate-800 dark:text-white">{rec.checkOut || '—'}</p>
                            {rec.checkOutLat != null && rec.checkOutLng != null && (
                              <a href={`https://maps.google.com/?q=${rec.checkOutLat},${rec.checkOutLng}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-violet-500 hover:underline mt-0.5 inline-block">
                                📍 Vị trí ra ({rec.checkOutLat?.toFixed(4)}, {rec.checkOutLng?.toFixed(4)})
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Trạng thái:</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black ${ATTENDANCE_STATUS_COLORS[rec.status]}`}>
                        {ATTENDANCE_STATUS_LABELS[rec.status]}
                      </span>
                      {rec.overtimeHours && rec.overtimeHours > 0 && (
                        <span className="text-[10px] text-amber-500 font-bold">+{rec.overtimeHours}h OT</span>
                      )}
                    </div>

                    {/* Note */}
                    {editMode ? (
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Ghi chú:</span>
                        <textarea value={editNote} onChange={e => setEditNote(e.target.value)}
                          rows={2}
                          className="w-full mt-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                          placeholder="Ghi chú..." />
                      </div>
                    ) : rec.note ? (
                      <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Ghi chú</span>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{rec.note}</p>
                      </div>
                    ) : null}

                    {/* Out of range warning */}
                    {rec.isOutOfRange && (
                      <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-500/10 rounded-xl p-2.5">
                        <AlertTriangle size={14} />
                        <span className="text-xs font-bold">Nhân viên ngoài phạm vi khi chấm công</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Clock size={32} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400 font-bold">Chưa có dữ liệu chấm công</p>
                    <p className="text-xs text-slate-300 mt-1">Ngày này chưa được chấm công</p>
                  </div>
                )}
              </div>

              {/* Footer — Admin actions */}
              <div className="border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between gap-2">
                {/* Left: cycle status */}
                <button
                  onClick={() => handleCellClick(detailCell.employeeId, detailCell.day)}
                  className="px-3 py-2 text-xs font-black text-slate-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-500/10 rounded-xl transition flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} /> Chuyển trạng thái
                </button>

                {/* Right: admin edit */}
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <>
                        <button onClick={() => setEditMode(false)} className="px-3 py-2 text-xs font-black text-slate-400 hover:text-slate-600 transition">Huỷ</button>
                        <button onClick={() => setShowSaveConfirm(true)}
                          className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5">
                          <Save size={13} /> Xác nhận sửa
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { setEditMode(true); setEditCheckIn(rec?.checkIn || ''); setEditCheckOut(rec?.checkOut || ''); setEditNote(rec?.note || ''); }}
                        className="px-3 py-2 bg-violet-500 text-white rounded-xl text-xs font-black hover:bg-violet-600 transition flex items-center gap-1.5">
                        <Edit3 size={13} /> Sửa giờ
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Confirm Dialog */}
            {showSaveConfirm && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
                      <AlertTriangle size={24} className="text-amber-500" />
                    </div>
                    <h4 className="text-base font-black text-slate-800 dark:text-white">Xác nhận sửa chấm công</h4>
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      Bạn có chắc muốn sửa giờ chấm công của <strong>{emp?.fullName}</strong> ngày <strong>{formattedDate}</strong>?
                    </p>
                    {editCheckIn && <p className="text-xs text-slate-500 mt-1">Giờ vào: <strong>{editCheckIn}</strong></p>}
                    {editCheckOut && <p className="text-xs text-slate-500">Giờ ra: <strong>{editCheckOut}</strong></p>}
                  </div>
                  <div className="flex items-center gap-2 mt-5">
                    <button onClick={() => setShowSaveConfirm(false)} className="flex-1 px-4 py-2.5 text-xs font-black text-slate-500 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition">Huỷ</button>
                    <button onClick={handleSaveEdit} className="flex-1 px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center justify-center gap-1.5">
                      <CheckCircle size={14} /> Xác nhận
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default Attendance;
