import React, { useState, useEffect } from 'react';
import { Repeat, Key, CheckCircle, AlertTriangle, ShieldAlert, RefreshCw } from 'lucide-react';
import {
  confirmVehicleHandover,
  confirmVehicleReturn,
  fetchVehicleHandoverQueue,
  formatVietnamDateTime,
  type VehicleHandoverQueueItem,
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

const VehicleHandoverPage: React.FC = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<VehicleHandoverQueueItem[]>([]);

  // Modal State
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [handoverType, setHandoverType] = useState<'OUTBOUND' | 'RETURN'>('OUTBOUND');
  const [overrideReason, setOverrideReason] = useState('');
  const [note, setNote] = useState('');
  const [actioning, setActioning] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchVehicleHandoverQueue();
      setItems(data);
    } catch (err: any) {
      toast.error('Không thể tải danh sách chuyến xe bàn giao!');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleExecuteHandover = async () => {
    if (!selectedBooking) return;
    try {
      setActioning(true);

      if (handoverType === 'OUTBOUND') {
        await confirmVehicleHandover(
          selectedBooking.id,
          'OUTBOUND_HANDOVER',
          overrideReason || undefined,
          note || undefined
        );
        toast.success('Đã xác nhận bàn giao chìa khóa thành công!');
      } else {
        await confirmVehicleReturn(
          selectedBooking.id,
          overrideReason || undefined,
          note || undefined
        );
        toast.success('Đã nhận lại chìa khóa và giải phóng xe rảnh trên bãi!');
      }

      setSelectedBooking(null);
      setOverrideReason('');
      setNote('');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Xác nhận bàn giao chìa khóa thất bại!');
    } finally {
      setActioning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Repeat className="w-5 h-5 text-amber-500" />
            <span>Bàn Giao & Nhận Lại Chìa Khóa XE Tự Lái</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Xác nhận giao chìa khóa và nhận lại chìa khóa xe tự lái để quản lý custody vật lý
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
          <p className="text-xs text-slate-500">Đang tải danh sách bàn giao chìa khóa...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
          <Key className="w-10 h-10 text-emerald-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Không có xe tự lái nào đang chờ bàn giao hoặc nhận lại chìa</p>
          <p className="text-xs text-slate-500">Mọi thủ tục bàn giao vật lý đã được hoàn tất</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => {
            const b = item.booking;
            return (
            <div
              key={item.assignment.id}
              className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3">
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {b.booking_code}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {b.status}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                <p><span className="font-semibold text-slate-500">Điểm đón - Điểm đến:</span> {b.pickup_location_text} → {b.destination_text}</p>
                <p><span className="font-semibold text-slate-500">Thời gian đi:</span> {formatVietnamDateTime(b.requested_pickup_at)}</p>
                <p><span className="font-semibold text-slate-500">Mục đích:</span> {b.purpose}</p>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <button
                  onClick={() => {
                    setSelectedBooking(b);
                    setHandoverType(item.action);
                  }}
                  className={`w-full py-2.5 rounded-xl text-white text-xs font-bold shadow-sm ${
                    item.action === 'OUTBOUND'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {item.action === 'OUTBOUND' ? 'Xác Nhận Giao Chìa Khóa' : 'Xác Nhận Nhận Lại Chìa'}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* CONFIRM HANDOVER MODAL */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-600 dark:text-amber-400">
              <Key className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold">
                {handoverType === 'OUTBOUND' ? 'Xác Nhận Bàn Giao Chìa Khóa Xe' : 'Xác Nhận Nhận Lại Chìa Khóa Xe'}
              </h3>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl space-y-1 text-xs text-slate-700 dark:text-slate-300">
              <p>● **Mã đơn:** {selectedBooking.booking_code}</p>
              <p>● **Lộ trình:** {selectedBooking.pickup_location_text} → {selectedBooking.destination_text}</p>
              <p>● **Thời gian:** {formatVietnamDateTime(selectedBooking.requested_pickup_at)}</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">
                  Lý do xác nhận thay (Nếu bạn không phải người giao được gán):
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Ghi rõ lý do giao/nhận thay..."
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block font-medium mb-1 text-slate-700 dark:text-slate-300">Ghi chú thêm:</label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú thêm về chìa khóa/xe..."
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-2.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                disabled={actioning}
                onClick={() => setSelectedBooking(null)}
                className="px-4 py-2 rounded-xl border text-xs font-semibold"
              >
                Đóng
              </button>
              <button
                disabled={actioning}
                onClick={handleExecuteHandover}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-md"
              >
                {actioning ? 'Đang xử lý...' : 'Xác Nhận Hoàn Tất'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleHandoverPage;
