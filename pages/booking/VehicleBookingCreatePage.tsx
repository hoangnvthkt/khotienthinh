import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Clock, MapPin, Users, Send, Info, User, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  createVehicleBooking,
  buildVehicleBookingParticipantPayload,
  replaceVehicleBookingParticipants,
  submitVehicleBooking,
  fetchFleetVehicleProfiles,
  fetchDriverAuthorizationsEligible,
  toVietnamISOString
} from '../../lib/vehicleBookingService';
import type {
  VehicleTripType,
  VehicleRequestedMode,
  FleetVehicleProfile,
  VehicleDriverAuthorizationEligible
} from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';

const VehicleBookingCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<FleetVehicleProfile[]>([]);
  const [drivers, setDrivers] = useState<VehicleDriverAuthorizationEligible[]>([]);

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
        const [vList, dList] = await Promise.all([
          fetchFleetVehicleProfiles(),
          fetchDriverAuthorizationsEligible()
        ]);
        setVehicles(vList);
        setDrivers(dList);
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

    try {
      setLoading(true);

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

      const bookingId = res.id;
      const participants = buildVehicleBookingParticipantPayload(participantNames);

      if (bookingId && participants.length > 0) {
        await replaceVehicleBookingParticipants(bookingId, participants);
      }

      if (autoSubmit && bookingId) {
        await submitVehicleBooking(bookingId);
        toast.success(`Tạo và nộp đơn đặt xe thành công! Mã đơn: ${res.booking_code}`);
      } else {
        toast.success(`Đã lưu nháp đơn đặt xe! Mã đơn: ${res.booking_code}`);
      }

      navigate('/booking/vehicle/my');
    } catch (err: any) {
      toast.error(err.message || 'Tạo đơn đặt xe thất bại!');
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
          {' '}Đơn đặt xe sau khi nộp sẽ được gửi trực tiếp đến Quản lý của bạn phê duyệt nhu cầu. Sau khi Quản lý duyệt, Điều phối viên tập trung sẽ kiểm tra xung đột lịch và bố trí xe/tài xế phù hợp.
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
                  {v.asset_id} ({v.vehicle_type} - {v.seat_count} chỗ)
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
                  Tài xế {d.license_class} (ID: {d.user_id.substring(0, 8)})
                </option>
              ))}
            </select>
          </div>

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
