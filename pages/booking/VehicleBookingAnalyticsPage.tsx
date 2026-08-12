import React, { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import {
  BarChart3,
  CalendarRange,
  Car,
  Clock3,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Route,
  TriangleAlert,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  buildVehicleBookingCustomReportingPeriod,
  buildVehicleBookingReportingPeriod,
  fetchVehicleBookingAnalytics,
  fetchVehicleBookingAnalyticsExport,
} from '../../lib/vehicleBookingAnalyticsService';
import {
  buildVehicleBookingAnalyticsCsv,
  buildVehicleBookingAnalyticsWorkbook,
} from '../../lib/vehicleBookingAnalyticsExport';
import {
  formatVehicleBookingDistance,
  formatVehicleBookingRate,
  formatVehicleBookingVnd,
} from '../../lib/vehicleBookingAnalyticsViewModel';
import { loadXlsx } from '../../lib/loadXlsx';
import type {
  VehicleBookingAnalytics,
  VehicleBookingReportPreset,
  VehicleBookingReportingPeriod,
} from '../../types';

type PeriodMode = VehicleBookingReportPreset | 'CUSTOM';

const FULFILLMENT_LABELS: Record<string, string> = {
  INTERNAL_WITH_DRIVER: 'Có tài xế',
  INTERNAL_SELF_DRIVE: 'Tự lái',
  EXTERNAL_TRANSPORT: 'Xe ngoài',
};
const CHART_COLORS = ['#f59e0b', '#475569', '#f97316'];

const vietnamDate = (date = new Date()): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const exportDate = (iso: string): string => new Date(new Date(iso).getTime() + 7 * 3600000)
  .toISOString().slice(0, 10);

const isLiveGrant = (expiresAt?: string): boolean => !expiresAt || Date.parse(expiresAt) > Date.now();

const VehicleBookingAnalyticsPage: React.FC = () => {
  const { user, orgUnits } = useApp();
  const toast = useToast();
  const today = useMemo(() => vietnamDate(), []);
  const [mode, setMode] = useState<PeriodMode>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 8)}01`);
  const [customTo, setCustomTo] = useState(today);
  const [period, setPeriod] = useState<VehicleBookingReportingPeriod>(() =>
    buildVehicleBookingReportingPeriod('THIS_MONTH'));
  const [departmentId, setDepartmentId] = useState('');
  const [analytics, setAnalytics] = useState<VehicleBookingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reportGrants = useMemo(() => (user.permissionGrants || []).filter(grant =>
    grant.isActive !== false
    && isLiveGrant(grant.expiresAt)
    && ['booking.vehicle.view_reports', 'booking.vehicle.admin'].includes(grant.permissionCode)
  ), [user.permissionGrants]);
  const canViewGlobal = reportGrants.some(grant =>
    grant.permissionCode === 'booking.vehicle.admin' || grant.scopeType === 'global');
  const allowedDepartmentIds = useMemo(() => new Set(reportGrants
    .filter(grant => grant.scopeType === 'department')
    .map(grant => grant.scopeId)), [reportGrants]);
  const departments = useMemo(() => orgUnits
    .filter(unit => unit.type === 'department')
    .filter(unit => canViewGlobal || allowedDepartmentIds.has(unit.id)),
  [allowedDepartmentIds, canViewGlobal, orgUnits]);

  useEffect(() => {
    if (!canViewGlobal && !departmentId && departments[0]) setDepartmentId(departments[0].id);
  }, [canViewGlobal, departmentId, departments]);

  const loadAnalytics = async () => {
    if (!canViewGlobal && !departmentId) {
      setLoading(false);
      setError('Tài khoản chưa có phạm vi phòng ban để xem báo cáo.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setAnalytics(await fetchVehicleBookingAnalytics(period, departmentId || undefined));
    } catch (loadError: any) {
      setError(loadError.message || 'Không thể tải báo cáo vận hành.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, [period.fromAt, period.toAt, departmentId, canViewGlobal]);

  const applyPeriod = () => {
    try {
      setPeriod(mode === 'CUSTOM'
        ? buildVehicleBookingCustomReportingPeriod(customFrom, customTo)
        : buildVehicleBookingReportingPeriod(mode));
    } catch (periodError: any) {
      toast.error(periodError.message || 'Khoảng thời gian không hợp lệ.');
    }
  };

  const handleExport = async (format: 'xlsx' | 'csv') => {
    if (!analytics) return;
    try {
      setExporting(format);
      const rows = await fetchVehicleBookingAnalyticsExport(period, departmentId || undefined);
      const stem = `bao-cao-booking-xe_${exportDate(period.fromAt)}_${exportDate(period.toAt)}`;
      if (format === 'csv') {
        saveAs(new Blob([buildVehicleBookingAnalyticsCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${stem}.csv`);
      } else {
        const XLSX = await loadXlsx();
        const workbook = buildVehicleBookingAnalyticsWorkbook(XLSX, analytics, rows);
        const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        saveAs(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${stem}.xlsx`);
      }
    } catch (exportError: any) {
      toast.error(exportError.message || 'Không thể xuất báo cáo.');
    } finally {
      setExporting(null);
    }
  };

  const fulfillmentData = (analytics?.fulfillmentBreakdown || []).map(item => ({
    name: FULFILLMENT_LABELS[item.fulfillmentType] || item.fulfillmentType,
    tripCount: item.tripCount,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <BarChart3 className="h-5 w-5 text-amber-500" />
            Báo cáo vận hành đội xe
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Dữ liệu được tổng hợp tại máy chủ theo múi giờ Việt Nam.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void handleExport('csv')} disabled={!analytics || Boolean(exporting)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button type="button" onClick={() => void handleExport('xlsx')} disabled={!analytics || Boolean(exporting)} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-600 active:scale-[0.98] disabled:opacity-50">
            <FileSpreadsheet className="h-4 w-4" /> {exporting === 'xlsx' ? 'Đang xuất' : 'Excel'}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_auto] xl:items-end">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">Kỳ báo cáo</label>
            <div className="flex flex-wrap gap-2">
              {([
                ['THIS_WEEK', 'Tuần này'], ['THIS_MONTH', 'Tháng này'],
                ['THIS_QUARTER', 'Quý này'], ['CUSTOM', 'Tùy chọn'],
              ] as Array<[PeriodMode, string]>).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === value ? 'bg-slate-900 text-white dark:bg-amber-500' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            {mode === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-slate-600 dark:text-slate-300">Từ ngày<input aria-label="Từ ngày" type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
                <label className="space-y-1 text-xs text-slate-600 dark:text-slate-300">Đến ngày<input aria-label="Đến ngày" type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
              </div>
            )}
          </div>
          <label className="space-y-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            Phạm vi phòng ban
            <select value={departmentId} onChange={event => setDepartmentId(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900">
              {canViewGlobal && <option value="">Toàn công ty</option>}
              {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={applyPeriod} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition active:scale-[0.98] dark:bg-slate-700">
            <CalendarRange className="h-4 w-4" /> Áp dụng
          </button>
        </div>
      </section>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Đang tải báo cáo">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
          <span className="flex items-center gap-2"><TriangleAlert className="h-5 w-5" />{error}</span>
          <button type="button" onClick={() => void loadAnalytics()} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4" />Thử lại</button>
        </div>
      ) : analytics && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Chuyến hoàn thành', value: analytics.kpis.completedTrips.toLocaleString('vi-VN'), note: 'Theo giờ đón yêu cầu', icon: Car },
              { label: 'Tỷ lệ đúng giờ', value: formatVehicleBookingRate(analytics.kpis.onTimeRate), note: `${analytics.kpis.onTimeTrips}/${analytics.kpis.onTimeEligibleTrips} chuyến đủ dữ liệu`, icon: Clock3 },
              { label: 'Hủy sát giờ', value: formatVehicleBookingRate(analytics.kpis.lateCancellationRate), note: `${analytics.kpis.lateCancelledBookings}/${analytics.kpis.submittedBookings} booking đã gửi`, icon: TriangleAlert },
              { label: 'Công suất sử dụng', value: formatVehicleBookingRate(analytics.kpis.vehicleUtilizationRate), note: `${Math.round(analytics.kpis.usedVehicleMinutes).toLocaleString('vi-VN')} phút sử dụng`, icon: Route },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-start justify-between"><span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{card.label}</span><card.icon className="h-5 w-5 text-amber-500" /></div>
                <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{card.value}</div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{card.note}</p>
              </article>
            ))}
          </div>

          {analytics.kpis.completedTrips === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800">
              <Car className="mx-auto h-8 w-8 text-slate-400" />
              <h3 className="mt-3 text-sm font-bold">Chưa có chuyến hoàn thành trong kỳ</h3>
              <p className="mt-1 text-xs text-slate-500">Chọn kỳ khác hoặc kiểm tra phạm vi phòng ban.</p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-sm font-bold">Quãng đường theo xe nội bộ</h3>
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.distanceByVehicle} margin={{ left: 0, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="vehicleCode" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip formatter={(value: number) => formatVehicleBookingDistance(value)} />
                      <Bar dataKey="distanceKm" name="Quãng đường" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <h3 className="text-sm font-bold">Cơ cấu hình thức phục vụ</h3>
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={fulfillmentData} dataKey="tripCount" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                        {fulfillmentData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"><h3 className="text-sm font-bold">Chi phí xe ngoài theo phòng ban</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="px-4 py-3">Phòng ban</th><th className="px-4 py-3 text-right">Số chuyến</th><th className="px-4 py-3 text-right">Chi phí thực tế</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {analytics.externalCostByDepartment.length ? analytics.externalCostByDepartment.map(row => (
                    <tr key={row.departmentId || row.departmentName}><td className="px-4 py-3 font-medium">{row.departmentName}</td><td className="px-4 py-3 text-right">{row.tripCount.toLocaleString('vi-VN')}</td><td className="px-4 py-3 text-right font-semibold">{formatVehicleBookingVnd(row.actualCost)}</td></tr>
                  )) : <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">Không phát sinh chi phí xe ngoài.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Công suất dùng năng lực đội xe active hiện tại làm mẫu số và trừ thời gian bảo dưỡng/khóa xe. Khi lọc phòng ban, tử số chỉ gồm chuyến của phòng ban nhưng mẫu số vẫn là đội xe toàn công ty.
          </p>
        </>
      )}
    </div>
  );
};

export default VehicleBookingAnalyticsPage;
