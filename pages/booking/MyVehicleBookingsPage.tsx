import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, MapPin, Car, Clock, AlertTriangle, RefreshCw, Receipt, MessageSquare } from 'lucide-react';
import { fetchMyBookings, fetchVehicleBookingDetails, cancelVehicleBooking, formatVietnamDateTime } from '../../lib/vehicleBookingService';
import type { VehicleBooking, BookingCloseReason } from '../../types/vehicleBooking';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import ExternalTransportCompleteModal from './ExternalTransportCompleteModal';
import VehicleFeedbackModal from './VehicleFeedbackModal';
import {
  getVehicleBookingDeepLinkId,
  removeVehicleBookingDeepLink,
  resolveVehicleBookingDeepLink,
  setVehicleBookingDeepLink,
} from '../../lib/vehicleBookingDeepLink';

const MyVehicleBookingsPage: React.FC = () => {
  const toast = useToast();
  const { user } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBookingQuery = useRef(searchParams.get('booking'));
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<VehicleBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [details, setDetails] = useState<any | null>(null);

  // Cancel Modal State
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<BookingCloseReason>('CANCELLED_BY_REQUESTER');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [externalCompletionBooking, setExternalCompletionBooking] = useState<{ id: string; code: string } | null>(null);
  const [feedbackBooking, setFeedbackBooking] = useState<{ id: string; code: string } | null>(null);

  const clearBookingDeepLink = () => {
    setSearchParams(removeVehicleBookingDeepLink(searchParams), { replace: true });
  };

  const handleSelectBooking = async (id: string, syncUrl = true) => {
    setSelectedBookingId(id);
    setDetails(null);
    if (syncUrl) {
      setSearchParams(setVehicleBookingDeepLink(searchParams, id), { replace: true });
    }
    try {
      const d = await fetchVehicleBookingDetails(id);
      setDetails(d);
    } catch (err: any) {
      setSelectedBookingId(null);
      clearBookingDeepLink();
      toast.error('Không thể tải chi tiết chuyến xe!');
    }
  };

  const closeBookingDetails = () => {
    setSelectedBookingId(null);
    setDetails(null);
    clearBookingDeepLink();
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchMyBookings(user.id);
      setBookings(data);
      const rawBookingId = initialBookingQuery.current;
      initialBookingQuery.current = null;
      if (rawBookingId !== null) {
        const params = new URLSearchParams({ booking: rawBookingId });
        const bookingId = getVehicleBookingDeepLinkId(params);
        if (!bookingId) {
          clearBookingDeepLink();
          toast.error('Không tìm thấy chuyến xe hoặc bạn không có quyền truy cập.');
        } else {
          try {
            const deepLinkDetails = await resolveVehicleBookingDeepLink(
              params,
              fetchVehicleBookingDetails,
            );
            if (!deepLinkDetails) throw new Error('BOOKING_DEEP_LINK_NOT_FOUND');
            setSelectedBookingId(bookingId);
            setDetails(deepLinkDetails);
          } catch {
            setSelectedBookingId(null);
            setDetails(null);
            clearBookingDeepLink();
            toast.error('Không tìm thấy chuyến xe hoặc bạn không có quyền truy cập.');
          }
        }
      }
    } catch (err: any) {
      toast.error('Không thể tải danh sách đơn đặt xe!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const refreshSelectedBooking = async () => {
    await loadData();
    if (selectedBookingId) {
      const refreshedDetails = await fetchVehicleBookingDetails(selectedBookingId);
      setDetails(refreshedDetails);
    }
  };

  const handleExecuteCancel = async () => {
    if (!cancellingBookingId) return;
    try {
      setCancelling(true);
      const reason = cancelNote.trim() || cancelReason;
      await cancelVehicleBooking(cancellingBookingId, reason);
      toast.success('Đã hủy đơn đặt xe thành công!');
      setCancellingBookingId(null);
      closeBookingDetails();
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Hủy đơn thất bại!');
    } finally {
      setCancelling(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">Nháp</span>;
      case 'PENDING_APPROVAL':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Chờ duyệt</span>;
      case 'WAITING_DISPATCH':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Chờ xếp xe</span>;
      case 'ASSIGNED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">Đã xếp xe</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 animate-pulse">Đang chạy</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Hoàn thành</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">Đã hủy</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  const activeAssignment = details?.assignments?.find((assignment: any) => assignment.is_active);

  return (
    <div className="space-y-6">
      {/* HEADER & REFRESH */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Inbox className="w-5 h-5 text-amber-500" />
            <span>Yêu Cầu Đặt Xe Của Tôi</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Quản lý và theo dõi tiến độ các chuyến xe công tác cá nhân
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

      {/* BOOKINGS TABLE LIST */}
      {loading ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500">Đang tải danh sách đơn đặt xe...</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <Car className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Bạn chưa tạo đơn đặt xe nào</p>
          <p className="text-xs text-slate-500">Bấm "Tạo đơn đặt xe" để bắt đầu chuyến xe công tác mới</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bookings.map((b) => (
            <div
              key={b.id}
              onClick={() => handleSelectBooking(b.id)}
              className={`bg-white dark:bg-slate-800 rounded-2xl p-5 border cursor-pointer transition-all duration-200 space-y-3 ${
                selectedBookingId === b.id
                  ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-md'
                  : 'border-slate-200 dark:border-slate-700 hover:border-amber-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {b.booking_code}
                </span>
                {getStatusBadge(b.status)}
              </div>

              <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
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

                <div className="text-slate-500 dark:text-slate-400 line-clamp-1 italic">
                  Mục đích: {b.purpose}
                </div>
              </div>

              {/* ACTION FOOTER */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {b.requested_mode === 'WITH_DRIVER' ? 'Có tài xế' : b.requested_mode === 'SELF_DRIVE' ? 'Tự lái' : 'Linh hoạt'}
                </span>

                {['DRAFT', 'PENDING_APPROVAL', 'WAITING_DISPATCH', 'ASSIGNED'].includes(b.status) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCancellingBookingId(b.id);
                    }}
                    className="text-rose-600 dark:text-rose-400 hover:underline font-semibold"
                  >
                    Hủy đơn
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DETAILS DRAWER / MODAL */}
      {selectedBookingId && details && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 h-full p-6 shadow-2xl overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Chi Tiết Đơn {details.booking.booking_code}
                </h3>
                <p className="text-xs text-slate-500">{getStatusBadge(details.booking.status)}</p>
              </div>
              <button
                onClick={closeBookingDetails}
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                ✕
              </button>
            </div>

            {/* ASSIGNED VEHICLE & DRIVER DETAILS */}
            {activeAssignment && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-2 text-xs">
                <p className="font-bold text-amber-800 dark:text-amber-300">Thông tin xe & tài xế đã xếp:</p>
                <div className="space-y-1 text-slate-700 dark:text-slate-200">
                  <p>● <strong>Hình thức:</strong> {activeAssignment.fulfillment_type}</p>
                  <p>● <strong>Xe phân công:</strong> {activeAssignment.vehicle_asset_id || 'Xe ngoài / Taxi'}</p>
                  <p>● <strong>Tài xế / Người lái:</strong> {activeAssignment.operator_user_id || activeAssignment.external_driver_name || 'Theo nhà cung cấp'}</p>
                  {activeAssignment.external_vehicle_plate && (
                    <p>● <strong>Biển số xe ngoài:</strong> {activeAssignment.external_vehicle_plate}</p>
                  )}
                </div>
              </div>
            )}

            {/* DETAILS CONTENT */}
            <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
              <div>
                <span className="font-semibold text-slate-500 block">Thời gian:</span>
                <p>{formatVietnamDateTime(details.booking.requested_pickup_at)} → {formatVietnamDateTime(details.booking.expected_return_at)}</p>
              </div>

              <div>
                <span className="font-semibold text-slate-500 block">Lộ trình:</span>
                <p>{details.booking.pickup_location_text} → {details.booking.destination_text}</p>
              </div>

              <div>
                <span className="font-semibold text-slate-500 block">Mục đích:</span>
                <p>{details.booking.purpose}</p>
              </div>

              <div>
                <span className="font-semibold text-slate-500 block">Số người đi:</span>
                <p>{details.booking.passenger_count} người</p>
              </div>

              <div>
                <span className="font-semibold text-slate-500 block">Người đi cùng:</span>
                {details.participants?.length ? (
                  <ul className="list-disc pl-5">
                    {details.participants.map((participant: any) => (
                      <li key={participant.id}>{participant.participant_name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Không khai báo</p>
                )}
              </div>
            </div>

            {details.booking.status === 'ASSIGNED' && activeAssignment?.fulfillment_type === 'EXTERNAL_TRANSPORT' && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setExternalCompletionBooking({ id: details.booking.id, code: details.booking.booking_code })}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  <Receipt className="h-4 w-4" />
                  <span>Xác nhận hoàn tất chuyến xe ngoài</span>
                </button>
              </div>
            )}

            {details.booking.status === 'COMPLETED' && details.feedback?.status === 'PENDING' && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setFeedbackBooking({ id: details.booking.id, code: details.booking.booking_code })}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-xs font-semibold text-white hover:bg-amber-600"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>Xác nhận & đánh giá chuyến xe</span>
                </button>
              </div>
            )}

            {/* ACTION CANCEL */}
            {['DRAFT', 'PENDING_APPROVAL', 'WAITING_DISPATCH', 'ASSIGNED'].includes(details.booking.status) && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setCancellingBookingId(details.booking.id)}
                  className="w-full py-2.5 rounded-xl bg-rose-500 text-white font-semibold text-xs hover:bg-rose-600 transition"
                >
                  Hủy Đơn Đặt Xe Này
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CANCEL CONFIRM MODAL */}
      {cancellingBookingId && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold">Xác Nhận Hủy Đơn Đặt Xe</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Vui lòng chọn lý do hủy đơn. Lưu ý nếu hủy sát giờ xuất phát (&lt;2 tiếng), hệ thống sẽ ghi nhận lịch sử hủy muộn.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Lý do hủy:</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value as BookingCloseReason)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                >
                  <option value="CANCELLED_BY_REQUESTER">Thay đổi kế hoạch cá nhân / Hủy cuộc họp</option>
                  <option value="LATE_CANCELLED">Hủy sát giờ do sự cố đột xuất</option>
                  <option value="OTHER">Lý do khác</option>
                </select>
              </div>

              <div>
                <label className="block font-medium mb-1">Ghi chú thêm:</label>
                <textarea
                  rows={2}
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder="Ghi rõ chi tiết lý do..."
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3">
              <button
                disabled={cancelling}
                onClick={() => setCancellingBookingId(null)}
                className="px-4 py-2 rounded-xl border text-xs font-semibold"
              >
                Đóng
              </button>
              <button
                disabled={cancelling}
                onClick={handleExecuteCancel}
                className="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                {cancelling ? 'Đang hủy...' : 'Xác Nhận Hủy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {externalCompletionBooking && (
        <ExternalTransportCompleteModal
          bookingId={externalCompletionBooking.id}
          bookingCode={externalCompletionBooking.code}
          onClose={() => setExternalCompletionBooking(null)}
          onSuccess={refreshSelectedBooking}
        />
      )}

      {feedbackBooking && (
        <VehicleFeedbackModal
          bookingId={feedbackBooking.id}
          bookingCode={feedbackBooking.code}
          onClose={() => setFeedbackBooking(null)}
          onSuccess={refreshSelectedBooking}
        />
      )}
    </div>
  );
};

export default MyVehicleBookingsPage;
