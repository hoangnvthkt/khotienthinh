import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft,
  CalendarRange,
  ClipboardList,
  History,
  KeyRound,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { buildVehicleBookingCustomReportingPeriod } from '../../lib/vehicleBookingAnalyticsService';
import { fetchVehicleBookingAuditTimeline } from '../../lib/vehicleBookingAuditService';
import type {
  VehicleBookingAuditEvent,
  VehicleBookingAuditSourceType,
  VehicleBookingReportingPeriod,
} from '../../types';

const SOURCE_LABELS: Record<VehicleBookingAuditSourceType, string> = {
  BOOKING_EVENT: 'Sự kiện booking',
  ASSIGNMENT_VERSION: 'Phiên bản phân công',
  HANDOVER: 'Bàn giao xe',
};

const DETAIL_LABELS: Record<string, string> = {
  oldStatus: 'Trạng thái cũ',
  newStatus: 'Trạng thái mới',
  rating: 'Đánh giá',
  issueCategory: 'Nhóm phản ánh',
  approvalSource: 'Nguồn phê duyệt',
  closeReason: 'Lý do đóng',
  version: 'Phiên bản',
  fulfillmentType: 'Hình thức phục vụ',
  vehicleAssetId: 'Mã tài sản xe',
  operatorUserId: 'Người vận hành',
  supersedeReason: 'Lý do thay đổi',
  dispatchReasonCode: 'Lý do điều phối',
  assignmentVersion: 'Phiên bản phân công',
  confirmedOnBehalf: 'Xác nhận thay',
  overrideReason: 'Lý do xác nhận thay',
  note: 'Ghi chú bàn giao',
};

const vietnamDate = (date = new Date()): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const formatDateTime = (value: string): string => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const isLiveGrant = (expiresAt?: string): boolean => !expiresAt || Date.parse(expiresAt) > Date.now();

const SourceIcon = ({ source }: { source: VehicleBookingAuditSourceType }) => {
  if (source === 'ASSIGNMENT_VERSION') return <ArrowRightLeft className="h-4 w-4" />;
  if (source === 'HANDOVER') return <KeyRound className="h-4 w-4" />;
  return <ClipboardList className="h-4 w-4" />;
};

const VehicleBookingAuditTrailPage: React.FC = () => {
  const { user, orgUnits } = useApp();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => vietnamDate(), []);
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [bookingId, setBookingId] = useState(searchParams.get('booking') || '');
  const [departmentId, setDepartmentId] = useState('');
  const [sourceType, setSourceType] = useState<VehicleBookingAuditSourceType | 'ALL'>('ALL');
  const [applied, setApplied] = useState<{
    period: VehicleBookingReportingPeriod;
    bookingId?: string;
    departmentId?: string;
    sourceType?: VehicleBookingAuditSourceType;
  }>(() => ({
    period: buildVehicleBookingCustomReportingPeriod(`${today.slice(0, 8)}01`, today),
    bookingId: searchParams.get('booking') || undefined,
  }));
  const [events, setEvents] = useState<VehicleBookingAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<{ occurredAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auditGrants = useMemo(() => (user.permissionGrants || []).filter(grant =>
    grant.isActive !== false
    && isLiveGrant(grant.expiresAt)
    && ['booking.vehicle.view_audit', 'booking.vehicle.admin'].includes(grant.permissionCode)
  ), [user.permissionGrants]);
  const canViewGlobal = auditGrants.some(grant =>
    grant.permissionCode === 'booking.vehicle.admin' || grant.scopeType === 'global');
  const allowedDepartmentIds = useMemo(() => new Set(auditGrants
    .filter(grant => grant.scopeType === 'department')
    .map(grant => grant.scopeId)), [auditGrants]);
  const departments = useMemo(() => orgUnits
    .filter(unit => unit.type === 'department')
    .filter(unit => canViewGlobal || allowedDepartmentIds.has(unit.id)),
  [allowedDepartmentIds, canViewGlobal, orgUnits]);

  useEffect(() => {
    if (!canViewGlobal && !departmentId && !bookingId && departments[0]) {
      setDepartmentId(departments[0].id);
    }
  }, [bookingId, canViewGlobal, departmentId, departments]);

  const loadTimeline = async (append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      const result = await fetchVehicleBookingAuditTimeline({
        bookingId: applied.bookingId,
        departmentId: applied.departmentId,
        sourceType: applied.sourceType,
        fromAt: applied.period.fromAt,
        toAt: applied.period.toAt,
        limit: 50,
        cursor: append ? nextCursor : null,
      });
      setEvents(current => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (loadError: any) {
      setError(loadError.message || 'Không thể tải lịch sử vận hành.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadTimeline(false);
  }, [applied]);

  const applyFilters = () => {
    try {
      const trimmedBookingId = bookingId.trim();
      if (!canViewGlobal && !departmentId && !trimmedBookingId) {
        toast.error('Vui lòng chọn phòng ban hoặc nhập Booking ID.');
        return;
      }
      const next = new URLSearchParams(searchParams);
      if (trimmedBookingId) next.set('booking', trimmedBookingId); else next.delete('booking');
      setSearchParams(next, { replace: true });
      setApplied({
        period: buildVehicleBookingCustomReportingPeriod(fromDate, toDate),
        bookingId: trimmedBookingId || undefined,
        departmentId: trimmedBookingId ? undefined : departmentId || undefined,
        sourceType: sourceType === 'ALL' ? undefined : sourceType,
      });
    } catch (filterError: any) {
      toast.error(filterError.message || 'Bộ lọc không hợp lệ.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white"><History className="h-5 w-5 text-amber-500" />Lịch sử vận hành đặt xe</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Timeline đã lọc dữ liệu nhạy cảm, gồm booking, phiên bản phân công và bàn giao xe.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
          <label className="space-y-1 text-xs font-semibold">Từ ngày<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="space-y-1 text-xs font-semibold">Đến ngày<input type="date" value={toDate} onChange={event => setToDate(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="space-y-1 text-xs font-semibold">Booking ID<input value={bookingId} onChange={event => setBookingId(event.target.value)} placeholder="UUID booking" className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="space-y-1 text-xs font-semibold">Nguồn sự kiện<select value={sourceType} onChange={event => setSourceType(event.target.value as typeof sourceType)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900"><option value="ALL">Tất cả</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button type="button" onClick={applyFilters} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white"><CalendarRange className="h-4 w-4" />Áp dụng</button>
        </div>
        {!bookingId && <label className="mt-3 block max-w-sm space-y-1 text-xs font-semibold">Phòng ban<select value={departmentId} onChange={event => setDepartmentId(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-normal dark:border-slate-600 dark:bg-slate-900">{canViewGlobal && <option value="">Toàn công ty</option>}{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
      </section>

      {loading ? (
        <div className="space-y-4" aria-label="Đang tải lịch sử">{[0, 1, 2].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</div>
      ) : error ? (
        <div className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200"><span>{error}</span><button type="button" onClick={() => void loadTimeline(false)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4" />Thử lại</button></div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-800"><History className="mx-auto h-8 w-8 text-slate-400" /><h3 className="mt-3 text-sm font-bold">Chưa có sự kiện trong phạm vi này</h3><p className="mt-1 text-xs text-slate-500">Điều chỉnh kỳ báo cáo hoặc bộ lọc booking.</p></div>
      ) : (
        <div className="relative space-y-4 before:absolute before:bottom-4 before:left-5 before:top-4 before:w-px before:bg-slate-200 dark:before:bg-slate-700">
          {events.map(event => (
            <article key={event.id} className="relative pl-12">
              <div className="absolute left-0 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-slate-50 bg-amber-500 text-white dark:border-slate-900"><SourceIcon source={event.sourceType} /></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold">{event.bookingCode}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{SOURCE_LABELS[event.sourceType]}</span></div><h3 className="mt-2 text-sm font-bold">{event.title}</h3><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{event.summary}</p></div>
                  <time className="shrink-0 text-[11px] text-slate-500">{formatDateTime(event.occurredAt)}</time>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><UserRound className="h-3.5 w-3.5" />{event.actorName || 'Hệ thống'}</div>
                {Object.keys(event.details).length > 0 && <dl className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900 sm:grid-cols-2">{Object.entries(event.details).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-slate-500">{DETAIL_LABELS[key] || key}</dt><dd className="text-right font-medium text-slate-700 dark:text-slate-200">{typeof value === 'boolean' ? value ? 'Có' : 'Không' : String(value ?? '—')}</dd></div>)}</dl>}
              </div>
            </article>
          ))}
          {nextCursor && <div className="pl-12"><button type="button" onClick={() => void loadTimeline(true)} disabled={loadingMore} className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">{loadingMore ? 'Đang tải...' : 'Tải thêm lịch sử'}</button></div>}
        </div>
      )}
    </div>
  );
};

export default VehicleBookingAuditTrailPage;
