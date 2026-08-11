import React, { useState } from 'react';
import { Receipt, Loader2 } from 'lucide-react';
import {
  completeExternalTransport,
  fetchFleetSystemSettings,
  uploadEvidenceImage,
} from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

interface ExternalTransportCompleteModalProps {
  bookingId: string;
  bookingCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ExternalTransportCompleteModal: React.FC<ExternalTransportCompleteModalProps> = ({
  bookingId,
  bookingCode,
  onClose,
  onSuccess,
}) => {
  const toast = useToast();
  const [actualCost, setActualCost] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedCost = Number(actualCost);
    if (!actualCost.trim() || !Number.isFinite(parsedCost) || parsedCost < 0) {
      toast.error('Vui lòng nhập chi phí thực tế hợp lệ.');
      return;
    }

    try {
      setSaving(true);
      let receiptPath: string | undefined;
      if (receiptFile) {
        const settings = await fetchFleetSystemSettings();
        receiptPath = await uploadEvidenceImage(
          receiptFile,
          `${bookingId}/external`,
          settings.max_evidence_image_mb,
        );
      }
      await completeExternalTransport({
        booking_id: bookingId,
        external_actual_cost: parsedCost,
        external_receipt_path: receiptPath,
        completion_note: completionNote.trim() || undefined,
      });
      toast.success('Đã xác nhận hoàn tất chuyến xe ngoài.');
      await onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Không thể hoàn tất chuyến xe ngoài.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-amber-500" />
          <div>
            <h3 className="text-base font-bold">Hoàn tất chuyến xe ngoài</h3>
            <p className="text-xs text-slate-500">Mã đơn: {bookingCode}</p>
          </div>
        </div>

        <div className="space-y-1 text-xs">
          <label className="font-medium">Chi phí thực tế (VNĐ) *</label>
          <input
            type="number"
            min="0"
            step="1000"
            value={actualCost}
            onChange={(event) => setActualCost(event.target.value)}
            className="w-full rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
            required
          />
        </div>

        <div className="space-y-1 text-xs">
          <label className="font-medium">Ảnh hóa đơn/biên nhận</label>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
            className="w-full rounded-xl border bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        <div className="space-y-1 text-xs">
          <label className="font-medium">Ghi chú hoàn tất</label>
          <textarea
            rows={3}
            value={completionNote}
            onChange={(event) => setCompletionNote(event.target.value)}
            className="w-full rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border px-4 py-2 text-xs font-semibold">
            Đóng
          </button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{saving ? 'Đang xử lý...' : 'Xác nhận hoàn tất'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExternalTransportCompleteModal;
