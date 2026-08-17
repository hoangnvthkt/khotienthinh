import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Car,
  User,
  Wrench,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Plus,
  RefreshCw,
  Info,
  CheckCircle2,
  XCircle,
  MapPin,
  Phone,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Activity,
  X,
  Trash2,
  ExternalLink,
  LayoutGrid,
  BarChart3
} from 'lucide-react';
import type {
  FleetLocation,
  FleetVehicleProfileView,
  VehicleBooking,
  VehicleTimelineEvent,
  VehicleUnavailabilityReason
} from '../../types/vehicleBooking';
import {
  fetchVehicleTimelineEvents,
  createVehicleUnavailability,
  cancelVehicleUnavailability,
  formatVietnamDateTime
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';

export type TimeViewMode = 'DAY' | 'THREE_DAYS' | 'WEEK' | 'TWO_WEEKS';
export type DisplayLayoutMode = 'GANTT' | 'CALENDAR';

interface Props {
  vehicles: FleetVehicleProfileView[];
  locations: FleetLocation[];
  waitingBookings?: VehicleBooking[];
  onSelectBookingToDispatch?: (booking: VehicleBooking) => void;
  onRefresh?: () => void;
  canManageFleet?: boolean;
  canDispatch?: boolean;
}

const REASON_LABELS: Record<VehicleUnavailabilityReason, { label: string; color: string }> = {
  MAINTENANCE: { label: 'Bảo dưỡng định kỳ', color: 'bg-amber-500 text-white' },
  REPAIR: { label: 'Sửa chữa xưởng', color: 'bg-rose-500 text-white' },
  LOCKED: { label: 'Tạm khóa / Niêm phong', color: 'bg-red-600 text-white' },
  OTHER: { label: 'Khóa xe / Tạm ngưng', color: 'bg-slate-600 text-white' },
};

const toInputDateTime = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const formatTimeOnly = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
};

const formatDateShort = (date: Date) => {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const getDayNameVi = (dayIndex: number) => {
  const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return days[dayIndex] || '';
};

export const VehicleScheduleTimelineBoard: React.FC<Props> = ({
  vehicles,
  locations,
  waitingBookings = [],
  onSelectBookingToDispatch,
  onRefresh,
  canManageFleet = true,
  canDispatch = true,
}) => {
  const toast = useToast();
  const { user } = useApp();
  const timelineRef = useRef<HTMLDivElement>(null);

  // Layout mode: Gantt vs Calendar Grid
  const [displayLayout, setDisplayLayout] = useState<DisplayLayoutMode>('GANTT');

  // Time navigation state
  const [timeView, setTimeView] = useState<TimeViewMode>('DAY');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<VehicleTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [selectedVehicleType, setSelectedVehicleType] = useState<string>('');
  const [selectedVehicleAssetId, setSelectedVehicleAssetId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterOnlyActive, setFilterOnlyActive] = useState<boolean>(false);

  // Interactive Hover & Modals
  const [hoveredEvent, setHoveredEvent] = useState<VehicleTimelineEvent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedEventForModal, setSelectedEventForModal] = useState<VehicleTimelineEvent | null>(null);
  const [selectedDayEventsModal, setSelectedDayEventsModal] = useState<{ dateStr: string; events: VehicleTimelineEvent[] } | null>(null);

  // Maintenance modal state
  const [showCreateMaintenanceModal, setShowCreateMaintenanceModal] = useState(false);
  const [selectedAssetForMaintenance, setSelectedAssetForMaintenance] = useState<string>('');
  const [maintenanceReason, setMaintenanceReason] = useState<VehicleUnavailabilityReason>('MAINTENANCE');
  const [maintenanceStart, setMaintenanceStart] = useState<string>(toInputDateTime(new Date()));
  const [maintenanceEnd, setMaintenanceEnd] = useState<string>(toInputDateTime(new Date(Date.now() + 4 * 3600000)));
  const [maintenanceNote, setMaintenanceNote] = useState<string>('');
  const [submittingMaintenance, setSubmittingMaintenance] = useState(false);

  // Cancel Maintenance state
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingUnavail, setCancellingUnavail] = useState(false);

  // Vehicle Map for fast lookup
  const vehiclesMap = useMemo(() => {
    return new Map(vehicles.map(v => [v.asset_id, v]));
  }, [vehicles]);

  // Calculate Date Window range for Gantt
  const { rangeStart, rangeEnd, timeColumns } = useMemo(() => {
    const start = new Date(currentDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);

    let cols: { label: string; subLabel: string; start: Date; end: Date; isToday: boolean }[] = [];

    if (displayLayout === 'CALENDAR') {
      // Month Calendar boundaries
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      const dayOfWeek = firstDay.getDay();
      const prefixDays = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      const gridStart = new Date(firstDay);
      gridStart.setDate(gridStart.getDate() - prefixDays);
      gridStart.setHours(0, 0, 0, 0);

      const totalDays = prefixDays + lastDay.getDate() > 35 ? 42 : 35;
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridEnd.getDate() + totalDays);
      gridEnd.setHours(23, 59, 59, 999);

      return { rangeStart: gridStart, rangeEnd: gridEnd, timeColumns: [] };
    }

    // Gantt Time Scaling
    if (timeView === 'DAY') {
      end.setHours(23, 59, 59, 999);
      const isToday = new Date().toDateString() === start.toDateString();
      for (let h = 0; h < 24; h++) {
        const colStart = new Date(start);
        colStart.setHours(h, 0, 0, 0);
        const colEnd = new Date(start);
        colEnd.setHours(h, 59, 59, 999);
        cols.push({
          label: `${String(h).padStart(2, '0')}:00`,
          subLabel: `${String((h + 1) % 24).padStart(2, '0')}:00`,
          start: colStart,
          end: colEnd,
          isToday,
        });
      }
    } else if (timeView === 'THREE_DAYS') {
      end.setDate(end.getDate() + 2);
      end.setHours(23, 59, 59, 999);
      const now = new Date();
      for (let d = 0; d < 3; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(dayDate.getDate() + d);
        const isToday = now.toDateString() === dayDate.toDateString();
        const shifts = [
          { name: 'Đêm', startH: 0, endH: 6 },
          { name: 'Sáng', startH: 6, endH: 12 },
          { name: 'Chiều', startH: 12, endH: 18 },
          { name: 'Tối', startH: 18, endH: 24 },
        ];
        for (const s of shifts) {
          const colStart = new Date(dayDate);
          colStart.setHours(s.startH, 0, 0, 0);
          const colEnd = new Date(dayDate);
          colEnd.setHours(s.endH === 24 ? 23 : s.endH - 1, 59, 59, 999);
          cols.push({
            label: `${getDayNameVi(dayDate.getDay())} ${formatDateShort(dayDate)}`,
            subLabel: s.name,
            start: colStart,
            end: colEnd,
            isToday,
          });
        }
      }
    } else if (timeView === 'WEEK') {
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      start.setDate(diff);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const now = new Date();
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(dayDate.getDate() + d);
        const isToday = now.toDateString() === dayDate.toDateString();
        const colStart = new Date(dayDate);
        colStart.setHours(0, 0, 0, 0);
        const colEnd = new Date(dayDate);
        colEnd.setHours(23, 59, 59, 999);
        cols.push({
          label: getDayNameVi(dayDate.getDay()),
          subLabel: formatDateShort(dayDate),
          start: colStart,
          end: colEnd,
          isToday,
        });
      }
    } else if (timeView === 'TWO_WEEKS') {
      end.setDate(end.getDate() + 13);
      end.setHours(23, 59, 59, 999);

      const now = new Date();
      for (let d = 0; d < 14; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(dayDate.getDate() + d);
        const isToday = now.toDateString() === dayDate.toDateString();
        const colStart = new Date(dayDate);
        colStart.setHours(0, 0, 0, 0);
        const colEnd = new Date(dayDate);
        colEnd.setHours(23, 59, 59, 999);
        cols.push({
          label: `${getDayNameVi(dayDate.getDay()).slice(0, 3)}`,
          subLabel: formatDateShort(dayDate),
          start: colStart,
          end: colEnd,
          isToday,
        });
      }
    }

    return { rangeStart: start, rangeEnd: end, timeColumns: cols };
  }, [timeView, currentDate, displayLayout]);

  // Load timeline data
  const loadTimelineData = async () => {
    try {
      setLoading(true);
      const evs = await fetchVehicleTimelineEvents(rangeStart.toISOString(), rangeEnd.toISOString());
      setEvents(evs);
    } catch (err: any) {
      toast.error('Không thể tải lịch trình đội xe!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimelineData();
  }, [rangeStart, rangeEnd]);

  // Navigation handlers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (displayLayout === 'CALENDAR') {
      next.setMonth(next.getMonth() - 1);
    } else {
      if (timeView === 'DAY') next.setDate(next.getDate() - 1);
      else if (timeView === 'THREE_DAYS') next.setDate(next.getDate() - 3);
      else if (timeView === 'WEEK') next.setDate(next.getDate() - 7);
      else if (timeView === 'TWO_WEEKS') next.setDate(next.getDate() - 14);
    }
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (displayLayout === 'CALENDAR') {
      next.setMonth(next.getMonth() + 1);
    } else {
      if (timeView === 'DAY') next.setDate(next.getDate() + 1);
      else if (timeView === 'THREE_DAYS') next.setDate(next.getDate() + 3);
      else if (timeView === 'WEEK') next.setDate(next.getDate() + 7);
      else if (timeView === 'TWO_WEEKS') next.setDate(next.getDate() + 14);
    }
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Filter vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      if (selectedLocationId && v.home_base_id !== selectedLocationId) return false;
      if (selectedVehicleType && v.vehicle_type !== selectedVehicleType) return false;
      if (selectedVehicleAssetId && v.asset_id !== selectedVehicleAssetId) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        const matchCode = (v.asset_code || '').toLowerCase().includes(q);
        const matchName = (v.asset_name || '').toLowerCase().includes(q);
        const matchType = (v.vehicle_type || '').toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchType) return false;
      }
      if (filterOnlyActive) {
        const hasEvent = events.some(e => e.vehicleAssetId === v.asset_id);
        if (!hasEvent) return false;
      }
      return true;
    });
  }, [vehicles, selectedLocationId, selectedVehicleType, selectedVehicleAssetId, searchQuery, filterOnlyActive, events]);

  const filteredAssetIdSet = useMemo(() => {
    return new Set(filteredVehicles.map(v => v.asset_id));
  }, [filteredVehicles]);

  // Filter events matching active filters
  const filteredEvents = useMemo(() => {
    return events.filter(e => filteredAssetIdSet.has(e.vehicleAssetId));
  }, [events, filteredAssetIdSet]);

  // Vehicle types list for filter dropdown
  const vehicleTypes = useMemo(() => {
    const set = new Set(vehicles.map(v => v.vehicle_type).filter(Boolean));
    return Array.from(set);
  }, [vehicles]);

  // Map events by vehicleAssetId
  const eventsByVehicle = useMemo(() => {
    const map = new Map<string, VehicleTimelineEvent[]>();
    for (const v of vehicles) {
      map.set(v.asset_id, []);
    }
    for (const e of filteredEvents) {
      const list = map.get(e.vehicleAssetId) || [];
      list.push(e);
      map.set(e.vehicleAssetId, list);
    }
    return map;
  }, [vehicles, filteredEvents]);

  // Month Grid Calculation for Calendar view
  const monthCalendarGrid = useMemo(() => {
    if (displayLayout !== 'CALENDAR') return [];

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const dayOfWeek = firstDay.getDay();
    const prefixDays = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const gridStart = new Date(firstDay);
    gridStart.setDate(gridStart.getDate() - prefixDays);
    gridStart.setHours(0, 0, 0, 0);

    const totalCells = prefixDays + lastDay.getDate() > 35 ? 42 : 35;
    const nowIso = new Date().toISOString().slice(0, 10);
    const cells: {
      date: Date;
      dateIso: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      events: VehicleTimelineEvent[];
    }[] = [];

    for (let i = 0; i < totalCells; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const dateIso = d.toISOString().slice(0, 10);

      // Find events matching this day
      const dayEvs = filteredEvents.filter(e => {
        const eStartIso = new Date(e.startAt).toISOString().slice(0, 10);
        const eEndIso = new Date(e.endAt).toISOString().slice(0, 10);
        return dateIso >= eStartIso && dateIso <= eEndIso;
      });

      cells.push({
        date: d,
        dateIso,
        dayNum: d.getDate(),
        isCurrentMonth: d.getMonth() === month,
        isToday: dateIso === nowIso,
        events: dayEvs,
      });
    }

    return cells;
  }, [displayLayout, currentDate, filteredEvents]);

  // Realtime "Now" indicator calculation
  const nowMs = Date.now();
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const totalMs = endMs - startMs;
  const isNowInRange = nowMs >= startMs && nowMs <= endMs;
  const nowPercent = isNowInRange ? Math.max(0, Math.min(100, ((nowMs - startMs) / totalMs) * 100)) : null;

  // KPI Metrics for the current visible window
  const kpi = useMemo(() => {
    const totalVehicles = vehicles.length;
    const busyAssetIds = new Set<string>();
    const maintenanceAssetIds = new Set<string>();
    const activeNowAssetIds = new Set<string>();

    for (const e of filteredEvents) {
      const eStart = new Date(e.startAt).getTime();
      const eEnd = new Date(e.endAt).getTime();
      if (e.type === 'BOOKING') {
        busyAssetIds.add(e.vehicleAssetId);
        if (nowMs >= eStart && nowMs <= eEnd) {
          activeNowAssetIds.add(e.vehicleAssetId);
        }
      } else if (e.type === 'MAINTENANCE') {
        maintenanceAssetIds.add(e.vehicleAssetId);
      }
    }

    const freeCount = totalVehicles - busyAssetIds.size - maintenanceAssetIds.size;

    return {
      total: totalVehicles,
      free: Math.max(0, freeCount),
      hasBookings: busyAssetIds.size,
      activeNow: activeNowAssetIds.size,
      maintenance: maintenanceAssetIds.size,
      totalTrips: filteredEvents.filter(e => e.type === 'BOOKING').length,
    };
  }, [vehicles, filteredEvents, nowMs]);

  // Submit new maintenance period
  const handleCreateMaintenance = async () => {
    if (!selectedAssetForMaintenance) {
      toast.error('Vui lòng chọn xe!');
      return;
    }
    if (new Date(maintenanceEnd) <= new Date(maintenanceStart)) {
      toast.error('Thời gian kết thúc phải sau thời gian bắt đầu!');
      return;
    }
    try {
      setSubmittingMaintenance(true);
      await createVehicleUnavailability({
        vehicle_asset_id: selectedAssetForMaintenance,
        start_at: new Date(maintenanceStart).toISOString(),
        end_at: new Date(maintenanceEnd).toISOString(),
        reason_code: maintenanceReason,
        note: maintenanceNote || undefined,
      });
      toast.success('Đã tạo lịch khóa xe / bảo dưỡng thành công!');
      setShowCreateMaintenanceModal(false);
      setMaintenanceNote('');
      loadTimelineData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tạo lịch bảo dưỡng!');
    } finally {
      setSubmittingMaintenance(false);
    }
  };

  // Cancel maintenance period
  const handleCancelMaintenance = async (unavailabilityId: string) => {
    if (!cancelReason.trim()) {
      toast.error('Vui lòng nhập lý do mở khóa xe!');
      return;
    }
    try {
      setCancellingUnavail(true);
      await cancelVehicleUnavailability(unavailabilityId, cancelReason);
      toast.success('Đã mở khóa xe thành công!');
      setSelectedEventForModal(null);
      setCancelReason('');
      loadTimelineData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể hủy lịch bảo dưỡng!');
    } finally {
      setCancellingUnavail(false);
    }
  };

  // Helper to compute event position & width for Gantt
  const computeEventStyle = (e: VehicleTimelineEvent) => {
    const eStart = Math.max(startMs, new Date(e.startAt).getTime());
    const eEnd = Math.min(endMs, new Date(e.endAt).getTime());
    const left = ((eStart - startMs) / totalMs) * 100;
    const width = Math.max(0.6, ((eEnd - eStart) / totalMs) * 100);
    return { left: `${left}%`, width: `${width}%` };
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Control Bar: Display Layout & Date Navigation */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-xs border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: View Mode Switcher + Date Navigation */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Main Layout Switcher: Gantt Chart vs Month Calendar Grid */}
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setDisplayLayout('GANTT')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                displayLayout === 'GANTT'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Sơ Đồ Gantt (Theo Xe)</span>
            </button>
            <button
              onClick={() => setDisplayLayout('CALENDAR')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                displayLayout === 'CALENDAR'
                  ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Lịch Calendar (Ô Lưới Tháng)</span>
            </button>
          </div>

          {/* Time Scale for Gantt View */}
          {displayLayout === 'GANTT' && (
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setTimeView('DAY')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  timeView === 'DAY'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Hôm nay (24h)
              </button>
              <button
                onClick={() => setTimeView('THREE_DAYS')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  timeView === 'THREE_DAYS'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                3 Ngày
              </button>
              <button
                onClick={() => setTimeView('WEEK')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  timeView === 'WEEK'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Tuần (7 Ngày)
              </button>
              <button
                onClick={() => setTimeView('TWO_WEEKS')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  timeView === 'TWO_WEEKS'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                2 Tuần
              </button>
            </div>
          )}

          {/* Date Navigator */}
          <div className="flex items-center space-x-1.5 bg-slate-50 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={handlePrev}
              title="Kỳ trước"
              className="p-1.5 hover:bg-white dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleToday}
              className="px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 rounded-lg transition"
            >
              Hôm nay
            </button>
            <button
              onClick={handleNext}
              title="Kỳ tiếp theo"
              className="p-1.5 hover:bg-white dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Date Range Display */}
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-800 dark:text-slate-200">
            <CalendarIcon className="w-4 h-4 text-amber-500" />
            <span>
              {displayLayout === 'CALENDAR'
                ? `Tháng ${currentDate.getMonth() + 1} / ${currentDate.getFullYear()}`
                : `${formatDateShort(rangeStart)} ${timeView !== 'DAY' ? `→ ${formatDateShort(rangeEnd)}` : ''}`}
            </span>
          </div>
        </div>

        {/* Right: Quick Action & Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          {canManageFleet && (
            <button
              onClick={() => {
                setSelectedAssetForMaintenance(vehicles[0]?.asset_id || '');
                setShowCreateMaintenanceModal(true);
              }}
              className="flex items-center space-x-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-xs transition"
            >
              <Wrench className="w-4 h-4" />
              <span>+ Khóa xe / Bảo dưỡng</span>
            </button>
          )}

          <button
            onClick={() => {
              loadTimelineData();
              if (onRefresh) onRefresh();
            }}
            disabled={loading}
            title="Làm mới dữ liệu"
            className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. KPI Summary Bar for Fleet */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-slate-900 dark:text-white leading-tight">{kpi.total}</div>
            <div className="text-[11px] font-semibold text-slate-500">Tổng số xe</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 leading-tight">{kpi.free}</div>
            <div className="text-[11px] font-semibold text-slate-500">Xe đang rảnh</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-blue-600 dark:text-blue-400 leading-tight">{kpi.activeNow}</div>
            <div className="text-[11px] font-semibold text-slate-500">Đang chạy lúc này</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-indigo-600 dark:text-indigo-400 leading-tight">{kpi.totalTrips}</div>
            <div className="text-[11px] font-semibold text-slate-500">Chuyến trong kỳ</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-amber-600 dark:text-amber-400 leading-tight">{kpi.maintenance}</div>
            <div className="text-[11px] font-semibold text-slate-500">Bảo dưỡng / Khóa</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center space-x-3 shadow-xs">
          <div className="p-2.5 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-xl">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-black text-purple-600 dark:text-purple-400 leading-tight">{waitingBookings.length}</div>
            <div className="text-[11px] font-semibold text-slate-500">Đơn chờ điều phối</div>
          </div>
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-xs border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search box */}
          <div className="relative min-w-[180px] flex-1 sm:flex-initial">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm biển số, tên xe..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Location filter */}
          <select
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300"
          >
            <option value="">Tất cả bãi đỗ ({locations.length})</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          {/* Vehicle Type filter */}
          <select
            value={selectedVehicleType}
            onChange={(e) => setSelectedVehicleType(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300"
          >
            <option value="">Tất cả loại xe ({vehicleTypes.length})</option>
            {vehicleTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Vehicle Specific Filter (Especially useful for Calendar View) */}
          <select
            value={selectedVehicleAssetId}
            onChange={(e) => setSelectedVehicleAssetId(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300 max-w-[200px]"
          >
            <option value="">-- Lọc theo từng xe --</option>
            {vehicles.map(v => (
              <option key={v.asset_id} value={v.asset_id}>
                {v.asset_code} · {v.asset_name || v.vehicle_type}
              </option>
            ))}
          </select>

          {/* Toggle only active */}
          <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterOnlyActive}
              onChange={(e) => setFilterOnlyActive(e.target.checked)}
              className="rounded text-amber-500 focus:ring-amber-400"
            />
            <span>Chỉ xe có lịch</span>
          </label>
        </div>

        {/* Legend Indicator */}
        <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>Chuyến đã gán</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Đang chạy</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-amber-500" />
            <span>Bảo dưỡng / Khóa</span>
          </span>
        </div>
      </div>

      {/* 4A. VIEW MODE 1: GANTT TIMELINE MATRIX */}
      {displayLayout === 'GANTT' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div ref={timelineRef} className="overflow-x-auto relative no-scrollbar">
            <div className="min-w-[1000px]">
              {/* Timeline Header Row */}
              <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 sticky top-0 z-20">
                {/* Sticky Vehicle Info Header */}
                <div className="w-72 shrink-0 p-3 font-bold text-xs text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-900/90 backdrop-blur-xs flex items-center justify-between">
                  <span>Thông tin xe ({filteredVehicles.length})</span>
                  <span className="text-[10px] font-normal text-slate-400">Biển số · Loại</span>
                </div>

                {/* Time Columns Header */}
                <div className="flex-1 flex relative">
                  {timeColumns.map((col, idx) => (
                    <div
                      key={idx}
                      className={`flex-1 border-r border-slate-200/70 dark:border-slate-700/60 p-2 text-center text-xs transition-colors ${
                        col.isToday ? 'bg-amber-500/10 font-black text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400 font-medium'
                      }`}
                    >
                      <div className="leading-tight truncate">{col.label}</div>
                      <div className="text-[10px] font-semibold opacity-70 truncate">{col.subLabel}</div>
                    </div>
                  ))}

                  {/* Realtime Red Line Indicator in Header */}
                  {nowPercent !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none flex flex-col items-center"
                      style={{ left: `${nowPercent}%` }}
                    >
                      <div className="bg-red-500 text-white text-[9px] font-black px-1 rounded-sm shadow-xs -translate-y-1">
                        {formatTimeOnly(new Date().toISOString())}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline Rows */}
              {filteredVehicles.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">
                  <Car className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  Không tìm thấy xe nào phù hợp với bộ lọc hiện tại.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filteredVehicles.map((vehicle) => {
                    const vehicleEvents = eventsByVehicle.get(vehicle.asset_id) || [];
                    const isMaintenance = vehicleEvents.some(
                      e => e.type === 'MAINTENANCE' && nowMs >= new Date(e.startAt).getTime() && nowMs <= new Date(e.endAt).getTime()
                    );
                    const isDrivingNow = vehicleEvents.some(
                      e => e.type === 'BOOKING' && nowMs >= new Date(e.startAt).getTime() && nowMs <= new Date(e.endAt).getTime()
                    );

                    return (
                      <div
                        key={vehicle.asset_id}
                        className="flex hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition-colors group relative"
                      >
                        {/* Left: Vehicle Info Column */}
                        <div className="w-72 shrink-0 p-3 border-r border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xs flex items-center justify-between gap-2 z-10">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            {/* License Plate Badge */}
                            <div className="shrink-0 px-2 py-1 bg-zinc-900 text-amber-400 border border-zinc-700 rounded-lg font-mono font-black text-xs tracking-wider shadow-xs">
                              {vehicle.asset_code}
                            </div>

                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {vehicle.asset_name || vehicle.vehicle_type}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                                <span>{vehicle.vehicle_type}</span>
                                <span>·</span>
                                <span>{vehicle.seat_count} chỗ</span>
                                {vehicle.home_base_name && (
                                  <>
                                    <span>·</span>
                                    <span className="truncate">{vehicle.home_base_name}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Status Icon Indicator */}
                          <div className="shrink-0">
                            {isMaintenance ? (
                              <span className="inline-flex p-1 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 rounded-lg text-[10px] font-bold" title="Đang bảo dưỡng">
                                <Wrench className="w-3.5 h-3.5" />
                              </span>
                            ) : isDrivingNow ? (
                              <span className="inline-flex p-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 rounded-lg text-[10px] font-bold" title="Đang trên đường">
                                <Activity className="w-3.5 h-3.5 animate-pulse" />
                              </span>
                            ) : (
                              <span className="inline-flex p-1 bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 rounded-lg text-[10px] font-bold" title="Sẵn sàng">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Timeline Track */}
                        <div className="flex-1 relative min-h-[56px] flex items-center">
                          {/* Grid Background Columns */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {timeColumns.map((col, idx) => (
                              <div
                                key={idx}
                                className={`flex-1 border-r border-slate-100 dark:border-slate-800/80 ${
                                  col.isToday ? 'bg-amber-500/5' : ''
                                }`}
                              />
                            ))}
                          </div>

                          {/* Red Current Time Line */}
                          {nowPercent !== null && (
                            <div
                              className="absolute top-0 bottom-0 w-[2px] bg-red-500/80 z-20 pointer-events-none"
                              style={{ left: `${nowPercent}%` }}
                            />
                          )}

                          {/* Event Blocks */}
                          {vehicleEvents.map((event) => {
                            const style = computeEventStyle(event);
                            const isNow = nowMs >= new Date(event.startAt).getTime() && nowMs <= new Date(event.endAt).getTime();

                            if (event.type === 'MAINTENANCE') {
                              return (
                                <div
                                  key={event.id}
                                  onClick={() => setSelectedEventForModal(event)}
                                  onMouseEnter={(e) => {
                                    setHoveredEvent(event);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredEvent(null);
                                    setHoverPos(null);
                                  }}
                                  style={style}
                                  className="absolute top-2 bottom-2 z-15 rounded-xl cursor-pointer transition-all duration-150 hover:brightness-110 hover:shadow-md border border-amber-600/40 bg-amber-500/20 text-amber-900 dark:text-amber-200 overflow-hidden flex items-center px-2"
                                >
                                  <div
                                    className="absolute inset-0 opacity-15 pointer-events-none"
                                    style={{
                                      backgroundImage:
                                        'repeating-linear-gradient(45deg, #d97706 0, #d97706 10px, transparent 10px, transparent 20px)',
                                    }}
                                  />
                                  <div className="relative flex items-center space-x-1.5 truncate text-[11px] font-bold">
                                    <Wrench className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span className="truncate">{event.title}</span>
                                  </div>
                                </div>
                              );
                            }

                            // Booking Event
                            const isCompleted = event.status === 'COMPLETED' || event.status === 'RETURNED';

                            return (
                              <div
                                key={event.id}
                                onClick={() => setSelectedEventForModal(event)}
                                onMouseEnter={(e) => {
                                  setHoveredEvent(event);
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
                                }}
                                onMouseLeave={() => {
                                  setHoveredEvent(null);
                                  setHoverPos(null);
                                }}
                                style={style}
                                className={`absolute top-2 bottom-2 z-15 rounded-xl cursor-pointer transition-all duration-150 hover:scale-[1.01] hover:shadow-md border overflow-hidden flex items-center px-2.5 text-white ${
                                  isNow
                                    ? 'bg-emerald-600 border-emerald-400 shadow-xs shadow-emerald-500/30'
                                    : isCompleted
                                    ? 'bg-slate-600/90 border-slate-500 text-slate-100'
                                    : 'bg-blue-600 hover:bg-blue-500 border-blue-400 shadow-xs shadow-blue-500/20'
                                }`}
                              >
                                <div className="flex items-center space-x-1.5 truncate text-[11px] font-bold">
                                  {isNow ? (
                                    <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse shrink-0" />
                                  ) : (
                                    <Car className="w-3.5 h-3.5 shrink-0 opacity-80" />
                                  )}
                                  <span className="truncate">{event.bookingCode || event.title}</span>
                                  {event.driverName && (
                                    <span className="hidden xl:inline text-[10px] font-medium opacity-80 truncate">
                                      · {event.driverName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4B. VIEW MODE 2: MONTH CALENDAR GRID (Google Calendar Style) */}
      {displayLayout === 'CALENDAR' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xs border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Day of Week Column Headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-center text-xs font-bold text-slate-700 dark:text-slate-300">
            {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'].map((dayName, idx) => (
              <div key={idx} className="py-2.5 border-r border-slate-200/60 dark:border-slate-700/60 last:border-r-0">
                {dayName}
              </div>
            ))}
          </div>

          {/* Calendar Grid Matrix */}
          <div className="grid grid-cols-7 auto-rows-fr divide-y divide-slate-100 dark:divide-slate-700/60 bg-slate-100/50 dark:bg-slate-900/50">
            {monthCalendarGrid.map((cell, idx) => (
              <div
                key={idx}
                className={`min-h-[115px] p-2 border-r border-slate-200/60 dark:border-slate-700/60 last:border-r-0 flex flex-col justify-between transition-colors ${
                  cell.isCurrentMonth
                    ? 'bg-white dark:bg-slate-800'
                    : 'bg-slate-50/50 dark:bg-slate-900/30 text-slate-400 dark:text-slate-600'
                } ${cell.isToday ? 'ring-2 ring-amber-500/80 ring-inset bg-amber-50/30 dark:bg-amber-950/10' : ''}`}
              >
                {/* Cell Day Header */}
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-xs font-black inline-flex items-center justify-center w-6 h-6 rounded-full ${
                      cell.isToday
                        ? 'bg-amber-500 text-white shadow-xs'
                        : cell.isCurrentMonth
                        ? 'text-slate-800 dark:text-slate-200'
                        : 'text-slate-400 dark:text-slate-600'
                    }`}
                  >
                    {cell.dayNum}
                  </span>

                  {cell.events.length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {cell.events.length}
                    </span>
                  )}
                </div>

                {/* Day Events List (Up to 3 pills) */}
                <div className="space-y-1 flex-1 overflow-hidden">
                  {cell.events.slice(0, 3).map((ev) => {
                    const vehicle = vehiclesMap.get(ev.vehicleAssetId);
                    const isNow = nowMs >= new Date(ev.startAt).getTime() && nowMs <= new Date(ev.endAt).getTime();
                    const isCompleted = ev.status === 'COMPLETED' || ev.status === 'RETURNED';

                    if (ev.type === 'MAINTENANCE') {
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEventForModal(ev)}
                          onMouseEnter={(e) => {
                            setHoveredEvent(ev);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
                          }}
                          onMouseLeave={() => {
                            setHoveredEvent(null);
                            setHoverPos(null);
                          }}
                          className="px-1.5 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all hover:scale-[1.02] border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex items-center space-x-1 truncate shadow-2xs"
                        >
                          <Wrench className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                          <span className="shrink-0 px-1 py-0.2 bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 rounded text-[9px] font-mono">
                            {vehicle?.asset_code || 'XE'}
                          </span>
                          <span className="truncate">{ev.title}</span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEventForModal(ev)}
                        onMouseEnter={(e) => {
                          setHoveredEvent(ev);
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoverPos({ x: rect.left + rect.width / 2, y: rect.top });
                        }}
                        onMouseLeave={() => {
                          setHoveredEvent(null);
                          setHoverPos(null);
                        }}
                        className={`px-1.5 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all hover:scale-[1.02] border flex items-center space-x-1 truncate shadow-2xs ${
                          isNow
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-500/20'
                            : isCompleted
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600'
                            : 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        <span className="shrink-0 px-1 py-0.2 bg-zinc-900 text-amber-400 rounded text-[9px] font-mono font-black">
                          {vehicle?.asset_code || 'XE'}
                        </span>
                        <span className="truncate">{formatTimeOnly(ev.startAt)} {ev.destination || ev.title}</span>
                      </div>
                    );
                  })}

                  {cell.events.length > 3 && (
                    <button
                      onClick={() => setSelectedDayEventsModal({ dateStr: cell.dateIso, events: cell.events })}
                      className="w-full text-center py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 hover:underline bg-slate-50 dark:bg-slate-900 rounded"
                    >
                      +{cell.events.length - 3} chuyến khác...
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Interactive Floating Hover Card Tooltip (Used for both Gantt & Calendar) */}
      {hoveredEvent && hoverPos && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.min(window.innerWidth - 330, Math.max(20, hoverPos.x - 160))}px`,
            top: `${Math.max(10, hoverPos.y - 145)}px`,
          }}
          className="z-50 w-80 bg-slate-900/95 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700 backdrop-blur-md text-xs pointer-events-none animate-in fade-in zoom-in-95 duration-150"
        >
          {hoveredEvent.type === 'MAINTENANCE' ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded-md bg-amber-500/30 text-amber-300 font-bold text-[10px]">
                  {REASON_LABELS[hoveredEvent.reasonCode || 'MAINTENANCE']?.label || 'Bảo dưỡng'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {vehiclesMap.get(hoveredEvent.vehicleAssetId)?.asset_code || 'Khóa xe'}
                </span>
              </div>
              <div className="font-bold text-slate-100">{hoveredEvent.note || hoveredEvent.title}</div>
              <div className="text-[11px] text-slate-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>{formatVietnamDateTime(hoveredEvent.startAt)} → {formatVietnamDateTime(hoveredEvent.endAt)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <span className="px-1.5 py-0.5 bg-zinc-800 text-amber-400 rounded font-mono font-black text-[10px]">
                    {vehiclesMap.get(hoveredEvent.vehicleAssetId)?.asset_code || 'XE'}
                  </span>
                  <span className="font-black text-amber-400">{hoveredEvent.bookingCode}</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-blue-500/30 text-blue-300 font-bold text-[10px]">
                  {hoveredEvent.status}
                </span>
              </div>

              <div className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{formatVietnamDateTime(hoveredEvent.startAt)} → {formatTimeOnly(hoveredEvent.endAt)}</span>
              </div>

              {hoveredEvent.destination && (
                <div className="text-[11px] text-slate-200 flex items-center gap-1.5 truncate">
                  <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">{hoveredEvent.pickupLocation || 'Công ty'} → {hoveredEvent.destination}</span>
                </div>
              )}

              <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1 text-slate-300">
                  <User className="w-3 h-3 text-slate-400" />
                  <span className="truncate">{hoveredEvent.requesterName}</span>
                </div>
                <div className="font-semibold text-amber-300">
                  TX: {hoveredEvent.driverName || 'Chưa gán'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Event Detail Modal (Click on event) */}
      {selectedEventForModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center space-x-2">
                {selectedEventForModal.type === 'MAINTENANCE' ? (
                  <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
                    <Wrench className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
                    <Car className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {selectedEventForModal.type === 'MAINTENANCE' ? 'Chi Tiết Khóa Xe / Bảo Dưỡng' : `Chuyến Xe ${selectedEventForModal.bookingCode || ''}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Xe {vehiclesMap.get(selectedEventForModal.vehicleAssetId)?.asset_code || ''} · {vehiclesMap.get(selectedEventForModal.vehicleAssetId)?.asset_name || ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEventForModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            {selectedEventForModal.type === 'MAINTENANCE' ? (
              <div className="space-y-4 text-xs">
                <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/40 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-amber-900 dark:text-amber-300">Lý do khóa xe:</span>
                    <span className="px-2 py-0.5 rounded-md bg-amber-500 text-white font-bold">
                      {REASON_LABELS[selectedEventForModal.reasonCode || 'MAINTENANCE']?.label || 'Bảo dưỡng'}
                    </span>
                  </div>
                  {selectedEventForModal.note && (
                    <div>
                      <span className="font-medium text-slate-600 dark:text-slate-400">Ghi chú: </span>
                      <span className="font-bold text-slate-900 dark:text-white">{selectedEventForModal.note}</span>
                    </div>
                  )}
                  <div>
                    <span className="font-medium text-slate-600 dark:text-slate-400">Thời gian: </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatVietnamDateTime(selectedEventForModal.startAt)} → {formatVietnamDateTime(selectedEventForModal.endAt)}
                    </span>
                  </div>
                </div>

                {/* Cancel maintenance box */}
                {canManageFleet && selectedEventForModal.unavailabilityId && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3">
                    <label className="block font-bold text-slate-800 dark:text-slate-200">
                      Mở khóa xe / Kết thúc bảo dưỡng sớm:
                    </label>
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Nhập lý do mở khóa xe (bắt buộc)..."
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 text-xs font-medium"
                    />
                    <button
                      disabled={cancellingUnavail}
                      onClick={() => selectedEventForModal.unavailabilityId && handleCancelMaintenance(selectedEventForModal.unavailabilityId)}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition"
                    >
                      {cancellingUnavail ? 'Đang mở khóa...' : 'Xác Nhận Mở Khóa Xe Sớm'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Booking Key Info Grid */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Thời gian đón:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatVietnamDateTime(selectedEventForModal.startAt)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Dự kiến trả:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatVietnamDateTime(selectedEventForModal.endAt)}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block text-[10px]">Điểm đón → Điểm đến:</span>
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                      <span>{selectedEventForModal.pickupLocation || 'Công ty'}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>{selectedEventForModal.destination || 'Chưa cập nhật'}</span>
                    </div>
                  </div>
                </div>

                {/* People details */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center text-xs">
                        {selectedEventForModal.requesterName?.charAt(0) || 'U'}
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Người đặt / Đại diện:</div>
                        <div className="font-bold text-slate-900 dark:text-white">{selectedEventForModal.requesterName}</div>
                      </div>
                    </div>
                    {selectedEventForModal.requesterPhone && (
                      <a
                        href={`tel:${selectedEventForModal.requesterPhone}`}
                        className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg font-bold"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{selectedEventForModal.requesterPhone}</span>
                      </a>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-xs">
                        {selectedEventForModal.driverName?.charAt(0) || 'D'}
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Tài xế phụ trách:</div>
                        <div className="font-bold text-slate-900 dark:text-white">{selectedEventForModal.driverName}</div>
                      </div>
                    </div>
                    {selectedEventForModal.driverPhone && (
                      <a
                        href={`tel:${selectedEventForModal.driverPhone}`}
                        className="flex items-center space-x-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg font-bold"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{selectedEventForModal.driverPhone}</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end space-x-2">
                  <button
                    onClick={() => setSelectedEventForModal(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold transition"
                  >
                    Đóng
                  </button>
                  {selectedEventForModal.booking && onSelectBookingToDispatch && (
                    <button
                      onClick={() => {
                        const b = selectedEventForModal.booking;
                        setSelectedEventForModal(null);
                        if (b) onSelectBookingToDispatch(b);
                      }}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-xs transition"
                    >
                      Mở Phiếu Điều Phối
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. Modal Day Events Overview (When clicking "+X more" in calendar day cell) */}
      {selectedDayEventsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Danh Sách Chuyến Ngày {selectedDayEventsModal.dateStr}
                </h3>
                <p className="text-xs text-slate-500">Tổng cộng {selectedDayEventsModal.events.length} chuyến / hoạt động</p>
              </div>
              <button
                onClick={() => setSelectedDayEventsModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2 text-xs">
              {selectedDayEventsModal.events.map(ev => {
                const vehicle = vehiclesMap.get(ev.vehicleAssetId);
                return (
                  <div
                    key={ev.id}
                    onClick={() => {
                      setSelectedDayEventsModal(null);
                      setSelectedEventForModal(ev);
                    }}
                    className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-500 cursor-pointer space-y-1.5 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.5 bg-zinc-900 text-amber-400 rounded font-mono font-black text-[10px]">
                          {vehicle?.asset_code || 'XE'}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">{ev.bookingCode || ev.title}</span>
                      </div>
                      <span className="text-[10px] font-semibold text-slate-400">
                        {formatTimeOnly(ev.startAt)} → {formatTimeOnly(ev.endAt)}
                      </span>
                    </div>
                    {ev.destination && (
                      <p className="text-slate-600 dark:text-slate-400 truncate">📍 {ev.destination}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 8. Modal Create Maintenance Period */}
      {showCreateMaintenanceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Đặt Lịch Bảo Dưỡng / Khóa Xe</h3>
                  <p className="text-xs text-slate-500">Chặn khung giờ để xe không nhận đơn booking mới</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateMaintenanceModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold mb-1">Chọn xe *</label>
                <select
                  value={selectedAssetForMaintenance}
                  onChange={(e) => setSelectedAssetForMaintenance(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                >
                  <option value="">-- Chọn xe --</option>
                  {vehicles.map(v => (
                    <option key={v.asset_id} value={v.asset_id}>
                      {v.asset_code} · {v.asset_name || v.vehicle_type} ({v.seat_count} chỗ)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Lý do khóa xe *</label>
                <select
                  value={maintenanceReason}
                  onChange={(e) => setMaintenanceReason(e.target.value as VehicleUnavailabilityReason)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                >
                  <option value="MAINTENANCE">Bảo dưỡng định kỳ</option>
                  <option value="REPAIR">Sửa chữa xưởng / garage</option>
                  <option value="LOCKED">Tạm khóa / Niêm phong</option>
                  <option value="OTHER">Lý do khác / Tạm ngưng</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Thời gian bắt đầu *</label>
                  <input
                    type="datetime-local"
                    value={maintenanceStart}
                    onChange={(e) => setMaintenanceStart(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 font-medium"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Thời gian kết thúc *</label>
                  <input
                    type="datetime-local"
                    value={maintenanceEnd}
                    onChange={(e) => setMaintenanceEnd(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Ghi chú chi tiết</label>
                <textarea
                  rows={2}
                  value={maintenanceNote}
                  onChange={(e) => setMaintenanceNote(e.target.value)}
                  placeholder="Ghi rõ nội dung bảo dưỡng, gara phụ trách..."
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 font-medium"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-end space-x-2">
              <button
                onClick={() => setShowCreateMaintenanceModal(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs transition"
              >
                Hủy
              </button>
              <button
                disabled={submittingMaintenance}
                onClick={handleCreateMaintenance}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-xs shadow-xs transition"
              >
                {submittingMaintenance ? 'Đang lưu...' : 'Xác Nhận Khóa Xe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleScheduleTimelineBoard;
