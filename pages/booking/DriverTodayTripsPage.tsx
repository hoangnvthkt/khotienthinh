import React, { useState, useEffect } from 'react';
import { Calendar, Play, CheckSquare, MapPin, Clock, RefreshCw } from 'lucide-react';
import { fetchDriverTodayAssignments, respondToVehicleAssignment, formatVietnamDateTime, isDriverTripOverdue } from '../../lib/vehicleBookingService';
import TripExecutionModal from './TripExecutionModal';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { getAssignedVehicleLabel, getStartOdometerLabel } from '../../lib/vehicleBookingPresentation';

const DriverTodayTripsPage: React.FC = () => {
  const toast = useToast();
  const { user } = useApp();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<any[]>([]);

  // Modal Execution State
  const [activeModal, setActiveModal] = useState<{
    bookingId: string;
    bookingCode: string;
    mode: 'START' | 'CHECKPOINT' | 'FINISH';
  } | null>(null);

  const [responding, setResponding] = useState(false);
  const [declineBooking, setDeclineBooking] = useState<{ id: string; code: string } | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchDriverTodayAssignments(user.id);
      setTrips(data);
    } catch (err: any) {
      toast.error('Không thể tải các chuyến xe được phân công!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRespondAssignment = async (bookingId: string, confirmed: boolean, reason?: string) => {
    if (!confirmed && !reason?.trim()) {
      toast.error('Vui lòng nhập lý do từ chối chuyến.');
      return;
    }
    try {
      setResponding(true);
      await respondToVehicleAssignment(bookingId, confirmed ? 'CONFIRMED' : 'DECLINED', confirmed ? undefined : reason?.trim());
      toast.success(confirmed ? 'Đã xác nhận nhận chuyến!' : 'Đã từ chối nhận chuyến!');
      if (!confirmed) {
        setDeclineBooking(null);
        setDeclineReason('');
      }
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Xác nhận thất bại!');
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* MOBILE HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-amber-500" />
            <span>Chuyến Của Tôi</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dành cho Tài xế chuyên trách & Nhân viên tự lái xe công ty
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
          <p className="text-xs text-slate-500">Đang tải danh sách chuyến cần thực hiện...</p>
        </div>
      ) : trips.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <Calendar className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Bạn không có chuyến nào cần thực hiện</p>
          <p className="text-xs text-slate-500">Chuyến hôm nay và mọi chuyến đang chạy chưa kết thúc sẽ xuất hiện tại đây.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {trips.map(({ assignment, booking, tripLog, assignmentDisplay, requester }) => {
            const overdue = isDriverTripOverdue(booking);
            const startOdometerLabel = getStartOdometerLabel(tripLog?.start_odometer);
            return (
            <div
              key={assignment.id}
              className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4"
            >
              {/* HEADER BADGE */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {booking.booking_code}
                </span>

                <div className="flex flex-wrap justify-end gap-2">
                  {overdue && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">Quá thời gian dự kiến</span>}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    assignment.operator_confirmation_status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : assignment.operator_confirmation_status === 'DECLINED'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  }`}>
                    {assignment.operator_confirmation_status === 'CONFIRMED'
                      ? 'Đã xác nhận nhận chuyến'
                      : assignment.operator_confirmation_status === 'DECLINED'
                      ? 'Đã từ chối chuyến'
                      : 'Chờ tài xế xác nhận'}
                  </span>
                </div>
              </div>

              {/* TRIP INFO */}
              <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <div className="flex items-center space-x-2 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{formatVietnamDateTime(booking.requested_pickup_at)}</span>
                  <span>→</span>
                  <span>{formatVietnamDateTime(booking.expected_return_at)}</span>
                </div>

                <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="font-semibold">{booking.pickup_location_text} → {booking.destination_text}</span>
                </div>

                <div className="flex gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                  {assignmentDisplay?.vehicle_image_url && (
                    <img
                      src={assignmentDisplay.vehicle_image_url}
                      alt={getAssignedVehicleLabel(assignmentDisplay)}
                      className="h-16 w-20 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                    />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="font-bold text-slate-900 dark:text-white">● Xe phân công: {getAssignedVehicleLabel(assignmentDisplay)}</p>
                    <p>● Người đặt: {requester?.name || 'Chưa có thông tin'} | Số khách: {booking.passenger_count} người</p>
                    <p>● Mục đích: {booking.purpose}</p>
                    {startOdometerLabel && <p className="font-semibold text-indigo-700 dark:text-indigo-300">● {startOdometerLabel}</p>}
                  </div>
                </div>
              </div>

              {/* OPERATOR CONFIRMATION ACTION */}
              {assignment.operator_confirmation_status === 'PENDING' && (
                <div className="flex items-center space-x-3 pt-2">
                  <button
                    disabled={responding}
                    onClick={() => {
                      setDeclineBooking({ id: booking.id, code: booking.booking_code });
                      setDeclineReason('');
                    }}
                    className="flex-1 min-h-[48px] rounded-xl border border-rose-200 text-rose-600 text-xs font-bold hover:bg-rose-50"
                  >
                    Từ Chối
                  </button>
                  <button
                    disabled={responding}
                    onClick={() => handleRespondAssignment(booking.id, true)}
                    className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-md shadow-emerald-600/20"
                  >
                    Xác Nhận Nhận Chuyến
                  </button>
                </div>
              )}

              {/* EXECUTION ACTION BUTTONS (MOBILE FIRST MIN 48PX HIGH) */}
              {assignment.operator_confirmation_status === 'CONFIRMED' && (
                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                  {booking.status !== 'IN_PROGRESS' && booking.status !== 'COMPLETED' && (
                    <button
                      onClick={() => setActiveModal({
                        bookingId: booking.id,
                        bookingCode: booking.booking_code,
                        mode: 'START',
                      })}
                      className="min-h-[48px] flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md shadow-emerald-600/20"
                    >
                      <Play className="w-4 h-4" />
                      <span>Bắt Đầu Chuyến Đi</span>
                    </button>
                  )}

                  {booking.status === 'IN_PROGRESS' && (
                    <>
                      {!tripLog?.actual_pickup_at ? (
                        <button
                          onClick={() => setActiveModal({
                            bookingId: booking.id,
                            bookingCode: booking.booking_code,
                            mode: 'CHECKPOINT',
                          })}
                          className="min-h-[48px] flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md shadow-amber-500/20"
                        >
                          <MapPin className="w-4 h-4" />
                          <span>Xác nhận đã đón khách</span>
                        </button>
                      ) : (
                        <div className="min-h-[48px] flex-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 flex items-center justify-center">
                          Đã đón khách lúc {formatVietnamDateTime(tripLog.actual_pickup_at)}
                        </div>
                      )}

                      <button
                        onClick={() => setActiveModal({
                          bookingId: booking.id,
                          bookingCode: booking.booking_code,
                          mode: 'FINISH',
                        })}
                        className="min-h-[48px] flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md shadow-indigo-600/20"
                      >
                        <CheckSquare className="w-4 h-4" />
                        <span>Kết Thúc Chuyến</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* EXECUTION MODAL */}
      {activeModal && (
        <TripExecutionModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          bookingId={activeModal.bookingId}
          bookingCode={activeModal.bookingCode}
          mode={activeModal.mode}
          onSuccess={loadData}
        />
      )}

      {declineBooking && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Từ chối chuyến {declineBooking.code}</h3>
              <p className="mt-1 text-xs text-slate-500">Lý do sẽ được lưu để điều phối viên sắp xếp tài xế khác.</p>
            </div>
            <textarea
              autoFocus
              rows={3}
              value={declineReason}
              onChange={(event) => setDeclineReason(event.target.value)}
              placeholder="Nhập lý do từ chối chuyến..."
              className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={responding}
                onClick={() => setDeclineBooking(null)}
                className="rounded-xl border px-4 py-2 text-xs font-semibold"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={responding || !declineReason.trim()}
                onClick={() => handleRespondAssignment(declineBooking.id, false, declineReason)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {responding ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverTodayTripsPage;
