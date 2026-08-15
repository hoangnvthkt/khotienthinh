import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Clock, MapPin, Users, Send, Info, User, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  createVehicleBooking,
  buildVehicleBookingParticipantPayload,
  replaceVehicleBookingParticipants,
  submitVehicleBooking,
  previewVehicleBookingSubmissionRoute,
  fetchFleetSystemSettings,
  fetchFleetVehicleProfiles,
  fetchDriverAuthorizationsEligible,
  toVietnamISOString
} from '../../lib/vehicleBookingService';
import type {
  VehicleTripType,
  VehicleRequestedMode,
  FleetVehicleProfileView,
  VehicleDriverAuthorizationEligible
} from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getVehicleBookingSubmitSuccessMessage,
  mapVehicleBookingSubmissionError,
} from '../../lib/vehicleBookingPresentation';

const VehicleBookingCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<FleetVehicleProfileView[]>([]);
  const [drivers, setDrivers] = useState<VehicleDriverAuthorizationEligible[]>([]);
  const [requiresManagerApproval, setRequiresManagerApproval] = useState(true);

  // Form State
  const [pickupAt, setPickupAt] = useState('');
  const [returnAt, setReturnAt] = useState('');
  const [tripType, setTripType] = useState<VehicleTripType>('ROUND_TRIP');
  const [pickupText, setPickupText] = useState('Trụ sở Vioo ERP (123 Nguyễn Trãi, Hà Nội)');
  const [destinationText, setDestinationText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [passengerCount, setPassengerCount] = useState(1);
  const [participantNames, setParticipantNames] = useState('');
  const [requestedMode, setRequestedMode] = useState<VehicleRequestedMode>('WITH_DRIVER');
  const [preferredAssetId, setPreferredAssetId] = useState('');
  const [preferredDriverId, setPreferredDriverId] = useState('');
  const [note, setNote] = useState('');

  // Default default datetimes (pickup in 2 hours, return in 6 hours)
  useEffect(() => {
    const now = new Date();
    const pickup = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const ret = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    const formatForInput = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setPickupAt(formatForInput(pickup));
    setReturnAt(formatForInput(ret));
  }, []);

  // Fetch Master Data
  useEffect(() => {
    async function loadMasterData() {
      try {
        const [vList, dList, settings] = await Promise.all([
          fetchFleetVehicleProfiles(),
          fetchDriverAuthorizationsEligible(),
          fetchFleetSystemSettings(),
        ]);
        setVehicles(vList);
        setDrivers(dList);
        setRequiresManagerApproval(settings.require_direct_manager_approval);
      } catch (err: any) {
        console.error('Failed to load master data for booking form:', err);
      }
    }
    loadMasterData();
  }, []);

  const handleSubmit = async (e: React.FormEvent, autoSubmit = true) => {
    e.preventDefault();

    if (!pickupAt || !returnAt) {
      toast.error('Vui lòng chọn thời gian xuất phát và thời gian về!');
      return;
    }
    if (new Date(returnAt) <= new Date(pickupAt)) {
      toast.error('Thời gian về phải sau thời gian xuất phát!');
      return;
    }
    if (!destinationText.trim()) {
      toast.error('Vui lòng nhập điểm đến!');
      return;
    }
    if (!purpose.trim()) {
      toast.error('Vui lòng nhập mục đích chuyến đi!');
      return;
    }

    let bookingId: string | null = null;
    let bookingCode = '';
    try {
      setLoading(true);

      let confirmMissingManagerBypass = false;
      if (autoSubmit) {
        const preview = await previewVehicleBookingSubmissionRoute();
        setRequiresManagerApproval(preview.route !== 'CONFIG_DISABLED');
        if (preview.route === 'MISSING_MANAGER_CONFIRMATION_REQUIRED') {
          const proceed = await confirm({
            title: 'Chưa có quản lý trực tiếp',
            targetName: 'Đơn sẽ chuyển thẳng đến Điều phối',
            subtitle: 'Bạn chưa được thiết lập người quản lý trực tiếp.',
            warningText: 'Nếu tiếp tục, đơn sẽ bỏ qua bước duyệt và chuyển thẳng đến bộ phận Điều phối.',
            confirmText: 'Bạn có muốn gửi không?',
            actionLabel: 'Vẫn gửi',
            cancelLabel: 'Quay lại',
            intent: 'warning',
            countdownSeconds: 0,
          });
          if (!proceed) return;
          confirmMissingManagerBypass = true;
        }
      }

      const pickupIso = toVietnamISOString(pickupAt);
      const returnIso = toVietnamISOString(returnAt);

      const res = await createVehicleBooking({
        requested_pickup_at: pickupIso,
        expected_return_at: returnIso,
        trip_type: tripType,
        pickup_location_text: pickupText,
        destination_text: destinationText,
        purpose: purpose,
        passenger_count: passengerCount,
        requested_mode: requestedMode,
        preferred_vehicle_asset_id: preferredAssetId || undefined,
        preferred_driver_user_id: preferredDriverId || undefined,
        note: note || undefined,
      });

      bookingId = res.id;
      bookingCode = res.booking_code;
      const participants = buildVehicleBookingParticipantPayload(participantNames);

      if (bookingId && participants.length > 0) {
        await replaceVehicleBookingParticipants(bookingId, participants);
      }

      if (autoSubmit && bookingId) {
        const submitResult = await submitVehicleBooking(bookingId, { confirmMissingManagerBypass });
        toast.success(getVehicleBookingSubmitSuccessMessage(
          submitResult.managerApprovalRoute,
          res.booking_code,
        ));
      } else {
        toast.success(`Đã lưu nháp đơn đặt xe! Mã đơn: ${res.booking_code}`);
      }

      navigate('/booking/vehicle/my');
    } catch (err: any) {
      const mapped = mapVehicleBookingSubmissionError(err);
      if (
        mapped.code === 'VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED'
        && bookingId
      ) {
        const proceed = await confirm({
          title: 'Thiết lập quản lý vừa thay đổi',
          targetName: 'Đơn sẽ chuyển thẳng đến Điều phối',
          subtitle: 'Hiện tại tài khoản của bạn không có quản lý trực tiếp hợp lệ.',
          warningText: 'Nếu tiếp tục, đơn sẽ bỏ qua bước duyệt và chuyển thẳng đến bộ phận Điều phối.',
          confirmText: 'Bạn có muốn gửi không?',
          actionLabel: 'Vẫn gửi',
          cancelLabel: 'Quay lại',
          intent: 'warning',
          countdownSeconds: 0,
        });
        if (proceed) {
          try {
            const submitResult = await submitVehicleBooking(bookingId, {
              confirmMissingManagerBypass: true,
            });
            toast.success(getVehicleBookingSubmitSuccessMessage(
              submitResult.managerApprovalRoute,
              bookingCode,
            ));
            navigate('/booking/vehicle/my');
            return;
          } catch (retryError) {
            toast.error(mapVehicleBookingSubmissionError(retryError).message);
            return;
          }
        }
        return;
      }
      toast.error(mapped.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Informational Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start space-x-3 text-amber-900 dark:text-amber-200">
        <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <span className="font-semibold text-amber-800 dark:text-amber-300">Lưu ý nghiệp vụ đặt xe:</span>
          {' '}{requiresManagerApproval
            ? 'Đơn đặt xe sau khi nộp sẽ được gửi đến quản lý trực tiếp phê duyệt. Nếu tài khoản chưa có quản lý, bạn có thể xác nhận chuyển thẳng đến Điều phối.'
            : 'Đơn đặt xe sau khi nộp sẽ được chuyển thẳng đến Điều phối theo cấu hình hiện tại.'}
          <span className="italic block mt-1 text-amber-700 dark:text-amber-400">
            * Các lựa chọn xe/tài xế mong muốn chỉ mang tính chất nguyện vọng cá nhân.
          </span>
        </div>
      </div>

      <form onSubmit={(e) => handleSubmit(e, true)} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">
        <div className="border-b border-slate-100 dark:border-slate-700 pb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Car className="w-5 h-5 text-amber-500" />
            <span>Tạo Yêu Cầu Đặt Xe Công Ty</span>
          </h2>
        </div>

        {/* SECTION 1: THỜI GIAN & HÌNH THỨC */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Thời gian đi dự kiến <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="datetime-local"
                value={pickupAt}
                onChange={(e) => setPickupAt(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Thời gian về dự kiến <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="datetime-local"
                value={returnAt}
                onChange={(e) => setReturnAt(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Loại hình chuyến đi
            </label>
            <select
              value={tripType}
              onChange={(e) => setTripType(e.target.value as VehicleTripType)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            >
              <option value="ROUND_TRIP">Khứ hồi (Đi và về trong đợt)</option>
              <option value="ONE_WAY">Một chiều</option>
              <option value="MULTI_STOP">Nhiều điểm dừng công tác</option>
              <option value="MULTI_DAY">Công tác nhiều ngày</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Hình thức phục vụ mong muốn
            </label>
            <select
              value={requestedMode}
              onChange={(e) => setRequestedMode(e.target.value as VehicleRequestedMode)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            >
              <option value="WITH_DRIVER">Có tài xế chuyên trách</option>
              <option value="SELF_DRIVE">Tự lái (Dành cho NV đã ủy quyền bằng lái)</option>
              <option value="FLEXIBLE">Linh hoạt theo sự điều phối của công ty</option>
            </select>
          </div>
        </div>

        {/* SECTION 2: ĐỊA ĐIỂM & MỤC ĐÍCH */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Điểm đón ban đầu <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={pickupText}
              onChange={(e) => setPickupText(e.target.value)}
              placeholder="VD: Trụ sở Vioo Hà Nội / Công trường Hòa Bình"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Điểm đến chính <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={destinationText}
              onChange={(e) => setDestinationText(e.target.value)}
              placeholder="VD: Dự án Vinhomes Ocean Park / Sở Xây dựng Hà Nội"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Mục đích chuyến đi <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="VD: Đi họp với Ban quản lý dự án & kiểm tra hiện trường công trường"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>
        </div>

        {/* SECTION 3: SỐ NGƯỜI & NGUYỆN VỌNG XE */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Số người di chuyển (Bao gồm người đặt)
            </label>
            <input
              type="number"
              min={1}
              max={45}
              value={passengerCount}
              onChange={(e) => setPassengerCount(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Xe nguyện vọng (Không bắt buộc)
            </label>
            <select
              value={preferredAssetId}
              onChange={(e) => setPreferredAssetId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            >
              <option value="">-- Để điều phối viên chọn xe --</option>
              {vehicles.map((v) => (
                <option key={v.asset_id} value={v.asset_id}>
                   {v.asset_code} · {v.asset_name} ({v.vehicle_type} - {v.seat_count} chỗ)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Tài xế nguyện vọng (Không bắt buộc)
            </label>
            <select
              value={preferredDriverId}
              onChange={(e) => setPreferredDriverId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            >
              <option value="">-- Để điều phối viên xếp tài xế --</option>
              {drivers.map((d) => (
                <option key={d.user_id} value={d.user_id}>
                   {d.employee_name || `Tài xế ${d.license_class}`} · {d.employee_title || d.license_class}
                </option>
              ))}
            </select>
           </div>

          {(preferredAssetId || preferredDriverId) && (
            <div className="md:col-span-3 grid gap-3 sm:grid-cols-2">
              {preferredAssetId && (() => {
                const vehicle = vehicles.find(item => item.asset_id === preferredAssetId);
                return vehicle ? <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  {vehicle.asset_image_url ? <img src={vehicle.asset_image_url} alt={vehicle.asset_name} className="h-14 w-20 rounded-lg object-cover" /> : <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-200"><Car className="h-5 w-5 text-slate-400" /></div>}
                  <div><div className="text-xs font-bold">{vehicle.asset_code} · {vehicle.asset_name}</div><div className="text-[11px] text-slate-500">{vehicle.vehicle_type} · {vehicle.seat_count} chỗ</div></div>
                </div> : null;
              })()}
              {preferredDriverId && (() => {
                const driver = drivers.find(item => item.user_id === preferredDriverId);
                return driver ? <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  {driver.employee_avatar_url ? <img src={driver.employee_avatar_url} alt={driver.employee_name || 'Tài xế'} className="h-12 w-12 rounded-full object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">{(driver.employee_name || 'TX').split(' ').slice(-2).map(word => word[0]).join('')}</div>}
                  <div><div className="text-xs font-bold">{driver.employee_name || 'Tài xế'}</div><div className="text-[11px] text-slate-500">{driver.employee_title || `Bằng ${driver.license_class}`}</div></div>
                </div> : null;
              })()}
            </div>
          )}

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Danh sách người đi cùng (mỗi người một dòng)
            </label>
            <textarea
              rows={3}
              value={participantNames}
              onChange={(e) => setParticipantNames(e.target.value)}
              placeholder={'Nguyễn Văn A\nTrần Thị B'}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">Người đặt không cần nhập lại trong danh sách này.</p>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Ghi chú bổ sung
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Mang theo cốp xe 2 vali tài liệu nặng..."
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* SUBMIT BUTTONS */}
        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            disabled={loading}
            onClick={(e) => handleSubmit(e, false)}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Lưu nháp
          </button>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-amber-500 text-white font-semibold text-xs hover:bg-amber-600 shadow-md shadow-amber-500/20 disabled:opacity-50 transition"
          >
            <Send className="w-4 h-4" />
            <span>{loading ? 'Đang gửi...' : 'Nộp Đơn Đặt Xe'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default VehicleBookingCreatePage;
