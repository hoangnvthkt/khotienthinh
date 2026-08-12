import React, { useState, useEffect } from 'react';
import { ClipboardCheck, Check, X, Clock, MapPin, User, Car, AlertCircle, RefreshCw } from 'lucide-react';
import { fetchPendingApprovalCards, approveVehicleBooking, rejectVehicleBooking, formatVietnamDateTime } from '../../lib/vehicleBookingService';
import type { VehicleBookingApprovalCard } from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';

const ManagerApprovalPage: React.FC = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [pendingBookings, setPendingBookings] = useState<VehicleBookingApprovalCard[]>([]);

  // Reject Modal State
  const [rejectingBookingId, setRejectingBookingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [actioning, setActioning] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchPendingApprovalCards();
      setPendingBookings(data);
    } catch (err: any) {
      toast.error('Không thể tải danh sách đơn chờ duyệt!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      setActioning(true);
      await approveVehicleBooking(id, 'Duyệt nhu cầu sử dụng xe công ty');
      toast.success('Đã phê duyệt đơn thành công! Đơn đã được chuyển sang Bảng điều phối.');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Phê duyệt thất bại!');
    } finally {
      setActioning(false);
    }
  };

  const handleExecuteReject = async () => {
    if (!rejectingBookingId) return;
    if (!rejectNote.trim()) {
      toast.error('Vui lòng nhập lý do từ chối!');
      return;
    }
    try {
      setActioning(true);
      await rejectVehicleBooking(rejectingBookingId, rejectNote);
      toast.success('Đã từ chối đơn đặt xe thành công!');
      setRejectingBookingId(null);
      setRejectNote('');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Từ chối đơn thất bại!');
    } finally {
      setActioning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <ClipboardCheck className="w-5 h-5 text-amber-500" />
            <span>Phê Duyệt Đặt Xe Dành Cho Quản Lý</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Duyệt nhu cầu di chuyển của nhân viên trực thuộc trước khi chuyển sang bộ phận điều phối xe
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          title="Làm mới danh sách"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500">Đang tải các đơn chờ phê duyệt...</p>
        </div>
      ) : pendingBookings.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <ClipboardCheck className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Không có đơn đặt xe nào chờ bạn phê duyệt</p>
          <p className="text-xs text-slate-500">Tất cả các đơn yêu cầu đã được xử lý xong</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingBookings.map((b) => (
            <div
              key={b.id}
              className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-700">
                <div className="flex min-w-0 items-center gap-3">
                  {b.requester_avatar_url ? (
                    <img
                      src={b.requester_avatar_url}
                      alt={b.requester_employee_name || 'Người đặt xe'}
                      className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-slate-100 dark:ring-slate-700"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                      {b.booking_code}
                    </span>
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {b.requester_employee_name || 'Chưa cập nhật thông tin người đặt'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[b.requester_employee_code, b.requester_employee_title, b.requester_department_name].filter(Boolean).join(' · ') || 'Chưa có thông tin HRM'}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Chờ duyệt
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <div className="flex items-center space-x-2">
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-semibold">{formatVietnamDateTime(b.requested_pickup_at)}</span>
                  <span>→</span>
                  <span>{formatVietnamDateTime(b.expected_return_at)}</span>
                </div>

                <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="truncate">{b.pickup_location_text} → {b.destination_text}</span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-white">Mục đích: {b.purpose}</p>
                  <p className="text-slate-500">
                    ● Số người: {b.passenger_count} người | Hình thức: {b.requested_mode === 'WITH_DRIVER' ? 'Có tài xế' : b.requested_mode === 'SELF_DRIVE' ? 'Tự lái' : 'Linh hoạt'}
                  </p>
                  {b.preferred_vehicle_asset_id && (
                    <div className="mt-2 flex items-center gap-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                      {b.preferred_vehicle_image_url ? (
                        <img
                          src={b.preferred_vehicle_image_url}
                          alt={b.preferred_vehicle_asset_name || 'Xe nguyện vọng'}
                          className="h-11 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/30">
                          <Car className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-amber-700 dark:text-amber-300">
                          Nguyện vọng xe: {b.preferred_vehicle_asset_name || 'Chưa cập nhật thông tin xe'}
                        </p>
                        <p className="truncate text-slate-500">
                          {[b.preferred_vehicle_asset_code, b.preferred_vehicle_type, b.preferred_vehicle_seat_count ? `${b.preferred_vehicle_seat_count} chỗ` : null].filter(Boolean).join(' · ') || 'Chưa có hồ sơ xe'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  disabled={actioning}
                  onClick={() => setRejectingBookingId(b.id)}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-xs font-semibold transition"
                >
                  <X className="w-4 h-4" />
                  <span>Từ Chối</span>
                </button>

                <button
                  disabled={actioning}
                  onClick={() => handleApprove(b.id)}
                  className="inline-flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold shadow-md shadow-emerald-600/20 transition"
                >
                  <Check className="w-4 h-4" />
                  <span>Phê Duyệt</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingBookingId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-rose-600 dark:text-rose-400 flex items-center space-x-2">
              <AlertCircle className="w-5 h-5" />
              <span>Từ Chối Đơn Đặt Xe</span>
            </h3>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Vui lòng nhập lý do từ chối đơn đặt xe này để thông báo rõ ràng đến người đặt.
            </p>

            <textarea
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Nhập chi tiết lý do không phê duyệt..."
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs"
              required
            />

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                disabled={actioning}
                onClick={() => {
                  setRejectingBookingId(null);
                  setRejectNote('');
                }}
                className="px-4 py-2 rounded-xl border text-xs font-semibold"
              >
                Hủy bỏ
              </button>
              <button
                disabled={actioning}
                onClick={handleExecuteReject}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                {actioning ? 'Đang gửi...' : 'Xác Nhận Từ Chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerApprovalPage;
