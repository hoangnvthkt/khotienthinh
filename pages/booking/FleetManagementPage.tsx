import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wrench, Plus, RefreshCw } from 'lucide-react';
import {
  buildFleetVehicleProfileUpdate,
  fetchFleetVehicleProfiles,
  fetchDriverAuthorizations,
  fetchFleetSystemSettings,
  mergeFleetSystemSettings,
  upsertFleetVehicleProfile,
  upsertDriverAuthorization,
  updateFleetSystemSettings,
} from '../../lib/vehicleBookingService';
import type {
  FleetVehicleProfile,
  VehicleDriverAuthorization,
  FleetSystemSetting
} from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { hasActiveVehicleBookingGrant } from '../../lib/vehicleBookingPermissions';

const FleetManagementPage: React.FC = () => {
  const toast = useToast();
  const { user } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageFleet = hasActiveVehicleBookingGrant(user, ['booking.vehicle.manage_fleet']);
  const canManageDrivers = hasActiveVehicleBookingGrant(user, ['booking.vehicle.manage_authorizations']);
  const canManageSettings = hasActiveVehicleBookingGrant(user, ['booking.vehicle.admin']);
  const requestedTab = searchParams.get('tab')?.toUpperCase();
  const initialTab = requestedTab === 'SETTINGS' && canManageSettings
    ? 'SETTINGS'
    : requestedTab === 'DRIVERS' && canManageDrivers
    ? 'DRIVERS'
    : canManageFleet
    ? 'VEHICLES'
    : canManageDrivers
    ? 'DRIVERS'
    : 'SETTINGS';
  const [activeTab, setActiveTab] = useState<'VEHICLES' | 'DRIVERS' | 'SETTINGS'>(initialTab);

  const selectTab = (tab: 'VEHICLES' | 'DRIVERS' | 'SETTINGS') => {
    setActiveTab(tab);
    setSearchParams(tab === 'VEHICLES' ? {} : { tab: tab.toLowerCase() });
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [vehicles, setVehicles] = useState<FleetVehicleProfile[]>([]);
  const [drivers, setDrivers] = useState<VehicleDriverAuthorization[]>([]);
  const [settings, setSettings] = useState<FleetSystemSetting | null>(null);

  // Form State for Vehicle Upsert Modal
  const [editingVehicleAssetId, setEditingVehicleAssetId] = useState<string | null>(null);
  const [vType, setVType] = useState('SUV 7 chỗ');
  const [vSeats, setVSeats] = useState(7);
  const [vStatus, setVStatus] = useState<'AVAILABLE' | 'MAINTENANCE' | 'LOCKED'>('AVAILABLE');
  const [vAllowSelfDrive, setVAllowSelfDrive] = useState(true);
  const [vCertNo, setVCertNo] = useState('');
  const [vCertExp, setVCertExp] = useState('');
  const [vInsExp, setVInsExp] = useState('');
  const [vParkingSpot, setVParkingSpot] = useState('BAY-A01');

  // Form State for Driver Upsert Modal
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [dUserId, setDUserId] = useState('');
  const [dType, setDType] = useState<'PROFESSIONAL_DRIVER' | 'SELF_DRIVE'>('PROFESSIONAL_DRIVER');
  const [dLicNo, setDLicNo] = useState('');
  const [dLicClass, setDLicClass] = useState('B2');
  const [dLicExp, setDLicExp] = useState('');
  const [dStatus, setDStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'EXPIRED'>('ACTIVE');

  // Settings Form State
  const [bufferMin, setBufferMin] = useState(30);
  const [cutoffMin, setCutoffMin] = useState(120);
  const [autoCloseHr, setAutoCloseHr] = useState(24);
  const [homeBaseRadiusM, setHomeBaseRadiusM] = useState(500);
  const [onTimeToleranceMin, setOnTimeToleranceMin] = useState(15);
  const [tripReminderMin, setTripReminderMin] = useState(60);
  const [maxPhotoMb, setMaxPhotoMb] = useState(5);
  const [requireHandover, setRequireHandover] = useState(true);
  const [allowDispatchOverride, setAllowDispatchOverride] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [vData, dData, sData] = await Promise.all([
        fetchFleetVehicleProfiles(),
        fetchDriverAuthorizations(),
        fetchFleetSystemSettings()
      ]);
      setVehicles(vData);
      setDrivers(dData);
      setSettings(sData);
      if (sData) {
        setBufferMin(sData.booking_buffer_minutes);
        setCutoffMin(sData.late_cancellation_cutoff_minutes);
        setAutoCloseHr(sData.feedback_auto_close_hours);
        setHomeBaseRadiusM(sData.home_base_warning_radius_meters);
        setOnTimeToleranceMin(sData.on_time_tolerance_minutes);
        setTripReminderMin(sData.trip_reminder_minutes);
        setMaxPhotoMb(Number(sData.max_evidence_image_mb));
        setRequireHandover(sData.require_handover_for_self_drive);
        setAllowDispatchOverride(sData.allow_dispatch_approval_override);
      }
    } catch (err: any) {
      toast.error('Không thể tải danh mục quản lý xe và tài xế!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicleAssetId) return;
    const currentVehicle = vehicles.find(vehicle => vehicle.asset_id === editingVehicleAssetId);
    if (!currentVehicle) {
      toast.error('Không tìm thấy hồ sơ xe cần cập nhật.');
      return;
    }

    try {
      setSaving(true);
      await upsertFleetVehicleProfile(buildFleetVehicleProfileUpdate(currentVehicle, {
        vehicle_type: vType,
        seat_count: vSeats,
        availability_status: vStatus,
        allow_self_drive: vAllowSelfDrive,
        inspection_certificate_number: vCertNo || undefined,
        inspection_expiry_date: vCertExp || undefined,
        insurance_expiry_date: vInsExp || undefined,
        parking_spot_code: vParkingSpot || undefined,
      }));

      toast.success(`Đã cập nhật hồ sơ xe ${editingVehicleAssetId}!`);
      setEditingVehicleAssetId(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Cập nhật xe thất bại!');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dUserId) {
      toast.error('Vui lòng nhập User ID nhân viên!');
      return;
    }

    try {
      setSaving(true);
      await upsertDriverAuthorization({
        target_user_id: dUserId,
        authorization_type: dType,
        license_number: dLicNo,
        license_class: dLicClass,
        license_expiry: dLicExp || new Date(Date.now() + 365*24*3600*1000).toISOString().split('T')[0],
        status: dStatus,
      });

      toast.success('Đã cập nhật ủy quyền tài xế thành công!');
      setEditingDriverId(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Cập nhật tài xế thất bại!');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) {
      toast.error('Chưa tải được cấu hình hệ thống.');
      return;
    }
    try {
      setSaving(true);
      await updateFleetSystemSettings(mergeFleetSystemSettings(settings, {
        booking_buffer_minutes: bufferMin,
        late_cancellation_cutoff_minutes: cutoffMin,
        feedback_auto_close_hours: autoCloseHr,
        home_base_warning_radius_meters: homeBaseRadiusM,
        on_time_tolerance_minutes: onTimeToleranceMin,
        trip_reminder_minutes: tripReminderMin,
        max_evidence_image_mb: maxPhotoMb,
        require_handover_for_self_drive: requireHandover,
        allow_dispatch_approval_override: allowDispatchOverride,
      }));
      toast.success('Đã cập nhật cài đặt hệ thống thành công!');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Cập nhật cài đặt thất bại!');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            <span>Quản Lý Danh Mục Xe, Tài Xế & Cài Đặt Hệ Thống</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Thiết lập danh mục xe công ty, ủy quyền bằng lái nhân viên & tham số vận hành
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          title="Làm mới"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* TABS SWITCHER */}
      <div className="flex space-x-2 border-b border-slate-200 dark:border-slate-700 pb-2 text-xs font-semibold">
        {canManageFleet && (
          <button
            onClick={() => selectTab('VEHICLES')}
            className={`px-4 py-2 rounded-xl transition ${
              activeTab === 'VEHICLES' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            Danh Mục Xe Công Ty ({vehicles.length})
          </button>
        )}

        {canManageDrivers && (
          <button
            onClick={() => selectTab('DRIVERS')}
            className={`px-4 py-2 rounded-xl transition ${
              activeTab === 'DRIVERS' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            Ủy Quyền Tài Xế ({drivers.length})
          </button>
        )}

        {canManageSettings && (
          <button
            onClick={() => selectTab('SETTINGS')}
            className={`px-4 py-2 rounded-xl transition ${
              activeTab === 'SETTINGS' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            Cấu Hình Tham Số Hệ Thống
          </button>
        )}
      </div>

      {/* TAB 1: VEHICLES MANAGEMENT */}
      {activeTab === 'VEHICLES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map((v) => (
            <div key={v.asset_id} className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">{v.asset_id}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  {v.availability_status}
                </span>
              </div>

              <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <p>● Loại xe: {v.vehicle_type} ({v.seat_count} chỗ)</p>
                <p>● Ô đỗ bãi xe: <span className="font-mono font-bold text-slate-900 dark:text-white">{v.parking_spot_code || 'Chưa gán'}</span></p>
                <p>● Cho phép tự lái: {v.allow_self_drive ? 'Có' : 'Không'}</p>
                <p>● Số Odometer: {v.current_odometer} km</p>
                <p>● Hạn kiểm định: {v.inspection_expiry_date || 'Chưa nhập'}</p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  onClick={() => {
                    setEditingVehicleAssetId(v.asset_id);
                    setVType(v.vehicle_type);
                    setVSeats(v.seat_count);
                    setVStatus(v.availability_status);
                    setVAllowSelfDrive(v.allow_self_drive);
                    setVCertNo(v.inspection_certificate_number || '');
                    setVCertExp(v.inspection_expiry_date || '');
                    setVInsExp(v.insurance_expiry_date || '');
                    setVParkingSpot(v.parking_spot_code || 'BAY-A01');
                  }}
                  className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-semibold hover:bg-slate-100"
                >
                  Cập Nhật Đăng Kiểm & Ô Đỗ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: DRIVERS MANAGEMENT */}
      {activeTab === 'DRIVERS' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setEditingDriverId('NEW');
                setDUserId('');
                setDLicNo('B2-' + Math.floor(Math.random()*1000000));
                setDLicClass('B2');
              }}
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold text-xs shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm Uỷ Quyền Lái Xe Mới</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drivers.map((d) => (
              <div key={d.id} className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                  <span>Ủy quyền: {d.authorization_type}</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">{d.status}</span>
                </div>
                <p>● User ID: {d.user_id}</p>
                <p>● Số bằng lái: {d.license_number} (Hạng {d.license_class})</p>
                <p>● Ngày hết hạn: {d.license_expiry}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: SYSTEM SETTINGS */}
      {activeTab === 'SETTINGS' && (
        <form onSubmit={handleSaveSettings} className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 max-w-xl space-y-4 text-xs">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Cấu Hình Vận Hành Hệ Thống Đặt Xe</h3>

          <div>
            <label className="block font-medium mb-1">Thời gian đệm tối thiểu giữa 2 chuyến (phút):</label>
            <input
              type="number"
              value={bufferMin}
              onChange={(e) => setBufferMin(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Ngưỡng thời gian cảnh báo hủy sát giờ (phút):</label>
            <input
              type="number"
              value={cutoffMin}
              onChange={(e) => setCutoffMin(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Thời gian tự động đóng Feedback (giờ):</label>
            <input
              type="number"
              value={autoCloseHr}
              onChange={(e) => setAutoCloseHr(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Dung lượng tối đa ảnh chụp kilomet (MB):</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={maxPhotoMb}
              onChange={(e) => setMaxPhotoMb(parseFloat(e.target.value) || 0.1)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Bán kính cảnh báo ngoài bãi xe (mét):</label>
            <input
              type="number"
              min="0"
              value={homeBaseRadiusM}
              onChange={(e) => setHomeBaseRadiusM(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Dung sai đúng giờ (phút):</label>
            <input
              type="number"
              min="0"
              value={onTimeToleranceMin}
              onChange={(e) => setOnTimeToleranceMin(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Nhắc chuyến trước giờ đi (phút):</label>
            <input
              type="number"
              min="0"
              value={tripReminderMin}
              onChange={(e) => setTripReminderMin(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireHandover}
              onChange={(e) => setRequireHandover(e.target.checked)}
            />
            <span>Bắt buộc bàn giao/nhận lại chìa khóa với chuyến tự lái</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowDispatchOverride}
              onChange={(e) => setAllowDispatchOverride(e.target.checked)}
            />
            <span>Cho phép điều phối viên duyệt thay quản lý</span>
          </label>

          <div className="pt-3">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-white font-bold text-xs hover:bg-amber-600 shadow-md"
            >
              {saving ? 'Đang lưu...' : 'Lưu Cài Đặt Hệ Thống'}
            </button>
          </div>
        </form>
      )}

      {/* EDIT VEHICLE MODAL */}
      {editingVehicleAssetId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleSaveVehicle} className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <h3 className="font-bold text-sm">Cập Nhật Hồ Sơ Xe {editingVehicleAssetId}</h3>

            <div>
              <label className="block mb-1">Mã Ô Đỗ Bãi Xe (Parking Spot Code):</label>
              <select
                value={vParkingSpot}
                onChange={(e) => setVParkingSpot(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
              >
                <option value="BAY-A01">BAY-A01 (Ô số 1)</option>
                <option value="BAY-A02">BAY-A02 (Ô số 2)</option>
                <option value="BAY-A03">BAY-A03 (Ô số 3)</option>
                <option value="BAY-A04">BAY-A04 (Ô số 4)</option>
                <option value="BAY-A05">BAY-A05 (Ô số 5)</option>
              </select>
            </div>

            <div>
              <label className="block mb-1">Số sổ đăng kiểm:</label>
              <input
                type="text"
                value={vCertNo}
                onChange={(e) => setVCertNo(e.target.value)}
                placeholder="VD: KD-999888"
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
              />
            </div>

            <div>
              <label className="block mb-1">Ngày hết hạn kiểm định:</label>
              <input
                type="date"
                value={vCertExp}
                onChange={(e) => setVCertExp(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
              />
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingVehicleAssetId(null)}
                className="px-4 py-2 border rounded-xl"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-amber-500 text-white rounded-xl font-bold"
              >
                Lưu Hồ Sơ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT DRIVER MODAL */}
      {editingDriverId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleSaveDriver} className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <h3 className="font-bold text-sm">Thêm / Cập Nhật Ủy Quyền Bằng Lái</h3>

            <div>
              <label className="block mb-1">User ID nhân viên *:</label>
              <input
                type="text"
                value={dUserId}
                onChange={(e) => setDUserId(e.target.value)}
                placeholder="Nhập UUID user_id..."
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
                required
              />
            </div>

            <div>
              <label className="block mb-1">Loại ủy quyền:</label>
              <select
                value={dType}
                onChange={(e) => setDType(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
              >
                <option value="PROFESSIONAL_DRIVER">Tài xế chuyên trách</option>
                <option value="SELF_DRIVE">Nhân viên được phép tự lái</option>
              </select>
            </div>

            <div>
              <label className="block mb-1">Số bằng lái:</label>
              <input
                type="text"
                value={dLicNo}
                onChange={(e) => setDLicNo(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border rounded-xl p-2.5"
                required
              />
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingDriverId(null)}
                className="px-4 py-2 border rounded-xl"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-amber-500 text-white rounded-xl font-bold"
              >
                Lưu Ủy Quyền
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default FleetManagementPage;
