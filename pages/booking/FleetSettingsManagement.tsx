import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Settings, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { FleetSystemSetting, VehicleBookingDispatcherCandidate } from '../../types/vehicleBooking';
import {
  fetchFleetSystemSettings,
  fetchVehicleBookingDispatcherCandidates,
  mergeFleetSystemSettings,
  setVehicleBookingDispatchers,
  updateFleetSystemSettings,
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

const FleetSettingsManagement: React.FC = () => {
  const toast = useToast();
  const [settings, setSettings] = useState<FleetSystemSetting | null>(null);
  const [dispatcherCandidates, setDispatcherCandidates] = useState<VehicleBookingDispatcherCandidate[]>([]);
  const [selectedDispatcherIds, setSelectedDispatcherIds] = useState<Set<string>>(new Set());
  const [dispatcherSearch, setDispatcherSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingDispatchers, setSavingDispatchers] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [nextSettings, candidates] = await Promise.all([
        fetchFleetSystemSettings(),
        fetchVehicleBookingDispatcherCandidates(),
      ]);
      setSettings(nextSettings);
      setDispatcherCandidates(candidates);
      setSelectedDispatcherIds(new Set(
        candidates.filter(candidate => candidate.is_dispatcher).map(candidate => candidate.user_id),
      ));
    } catch (error: any) {
      toast.error(error.message || 'Không thể tải cấu hình Booking.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredCandidates = useMemo(() => {
    const normalizedSearch = dispatcherSearch.trim().toLocaleLowerCase('vi');
    if (!normalizedSearch) return dispatcherCandidates;
    return dispatcherCandidates.filter(candidate => [
      candidate.employee_name,
      candidate.employee_code,
      candidate.employee_title,
      candidate.department_name,
    ].some(value => value?.toLocaleLowerCase('vi').includes(normalizedSearch)));
  }, [dispatcherCandidates, dispatcherSearch]);

  const numberField = (key: keyof FleetSystemSetting, label: string, step = 1) => settings && (
    <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={Number(settings[key])}
        onChange={event => setSettings(previous => previous
          ? ({ ...previous, [key]: Number(event.target.value) })
          : previous)}
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 font-normal dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    try {
      setSavingSettings(true);
      await updateFleetSystemSettings(mergeFleetSystemSettings(settings, settings));
      toast.success('Đã cập nhật cấu hình vận hành Booking.');
    } catch (error: any) {
      toast.error(error.message || 'Không thể lưu cấu hình.');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleDispatcher = (userId: string) => {
    setSelectedDispatcherIds(previous => {
      const next = new Set(previous);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const saveDispatchers = async () => {
    try {
      setSavingDispatchers(true);
      await setVehicleBookingDispatchers([...selectedDispatcherIds]);
      setDispatcherCandidates(previous => previous.map(candidate => ({
        ...candidate,
        is_dispatcher: selectedDispatcherIds.has(candidate.user_id),
      })));
      toast.success(`Đã phân công ${selectedDispatcherIds.size} người điều phối Booking.`);
    } catch (error: any) {
      toast.error(error.message || 'Không thể cập nhật nhân sự điều phối.');
    } finally {
      setSavingDispatchers(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Đang tải cấu hình...
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <Settings className="h-5 w-5 text-amber-500" />
            Cấu hình vận hành
          </h2>
          <p className="mt-1 text-xs text-slate-500">ADMIN quản lý tham số vận hành và nhân sự điều phối tại đây.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          title="Làm mới dữ liệu"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-700">
          <div className="rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Nhân sự điều phối</h3>
            <p className="mt-1 text-xs text-slate-500">
              Chọn một hoặc nhiều nhân sự HRM phụ trách duyệt thay, xếp xe và tài xế. ADMIN luôn có quyền điều phối nên không cần xuất hiện trong danh sách.
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={dispatcherSearch}
                onChange={event => setDispatcherSearch(event.target.value)}
                placeholder="Tìm theo tên, mã nhân viên, chức danh, phòng ban..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              Đã chọn {selectedDispatcherIds.size} người
            </span>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-500 dark:border-slate-700">
              Không tìm thấy nhân sự đang làm việc có tài khoản hệ thống.
            </div>
          ) : (
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {filteredCandidates.map(candidate => {
                const checked = selectedDispatcherIds.has(candidate.user_id);
                return (
                  <label
                    key={candidate.user_id}
                    className={`flex cursor-pointer items-center gap-3 p-3 transition ${checked ? 'bg-emerald-50 dark:bg-emerald-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDispatcher(candidate.user_id)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {candidate.employee_avatar_url ? (
                      <img
                        src={candidate.employee_avatar_url}
                        alt={candidate.employee_name}
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700">
                        <UserRound className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{candidate.employee_name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[candidate.employee_code, candidate.employee_title, candidate.department_name].filter(Boolean).join(' · ') || 'Chưa cập nhật thông tin HRM'}
                      </p>
                    </div>
                    {checked && <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />}
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingDispatchers}
              onClick={() => void saveDispatchers()}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingDispatchers ? 'Đang lưu...' : 'Lưu nhân sự điều phối'}
            </button>
          </div>
        </div>
      </section>

      <form onSubmit={saveSettings} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tham số vận hành</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {numberField('booking_buffer_minutes', 'Thời gian đệm giữa hai chuyến (phút)')}
          {numberField('late_cancellation_cutoff_minutes', 'Ngưỡng hủy sát giờ (phút)')}
          {numberField('feedback_auto_close_hours', 'Tự đóng đánh giá sau (giờ)')}
          {numberField('home_base_warning_radius_meters', 'Bán kính cảnh báo ngoài bãi (mét)')}
          {numberField('on_time_tolerance_minutes', 'Dung sai đúng giờ (phút)')}
          {numberField('trip_reminder_minutes', 'Nhắc chuyến trước giờ đi (phút)')}
          {numberField('max_evidence_image_mb', 'Ảnh bằng chứng tối đa (MB)', 0.1)}
          <div className="space-y-3 pt-5">
            <label className="flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={settings.require_handover_for_self_drive}
                onChange={event => setSettings(previous => previous
                  ? ({ ...previous, require_handover_for_self_drive: event.target.checked })
                  : previous)}
              />
              Bắt buộc bàn giao xe tự lái
            </label>
            <label className="flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={settings.allow_dispatch_approval_override}
                onChange={event => setSettings(previous => previous
                  ? ({ ...previous, allow_dispatch_approval_override: event.target.checked })
                  : previous)}
              />
              Cho phép điều phối duyệt thay
            </label>
            <label className="flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={settings.require_direct_manager_approval}
                onChange={event => setSettings(previous => previous
                  ? ({ ...previous, require_direct_manager_approval: event.target.checked })
                  : previous)}
              />
              Yêu cầu quản lý trực tiếp duyệt trước khi điều phối
            </label>
          </div>
        </div>
        <button
          disabled={savingSettings}
          className="w-full rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {savingSettings ? 'Đang lưu...' : 'Lưu cấu hình vận hành'}
        </button>
      </form>
    </div>
  );
};

export default FleetSettingsManagement;
