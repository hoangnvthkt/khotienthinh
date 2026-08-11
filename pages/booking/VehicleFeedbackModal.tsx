import React, { useState } from 'react';
import { MessageSquareWarning, Star, Loader2 } from 'lucide-react';
import { submitVehicleFeedback } from '../../lib/vehicleBookingService';
import { useToast } from '../../context/ToastContext';

interface VehicleFeedbackModalProps {
  bookingId: string;
  bookingCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

const VehicleFeedbackModal: React.FC<VehicleFeedbackModalProps> = ({ bookingId, bookingCode, onClose, onSuccess }) => {
  const toast = useToast();
  const [isIssue, setIsIssue] = useState(false);
  const [rating, setRating] = useState(5);
  const [positiveTags, setPositiveTags] = useState('Đúng giờ, An toàn');
  const [issueCategory, setIssueCategory] = useState('OTHER');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isIssue && !comment.trim()) {
      toast.error('Vui lòng mô tả vấn đề cần phản ánh.');
      return;
    }
    try {
      setSaving(true);
      await submitVehicleFeedback({
        booking_id: bookingId,
        is_issue: isIssue,
        rating: isIssue ? undefined : rating,
        positive_tags: isIssue
          ? []
          : positiveTags.split(',').map(tag => tag.trim()).filter(Boolean),
        issue_category: isIssue ? issueCategory : undefined,
        comment: isIssue ? comment.trim() : undefined,
      });
      toast.success(isIssue ? 'Đã gửi phản ánh chuyến xe.' : 'Cảm ơn bạn đã xác nhận và đánh giá chuyến xe.');
      await onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Không thể gửi đánh giá chuyến xe.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <MessageSquareWarning className="h-6 w-6 text-amber-500" />
          <div>
            <h3 className="text-base font-bold">Xác nhận & đánh giá chuyến xe</h3>
            <p className="text-xs text-slate-500">Mã đơn: {bookingCode}</p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={isIssue} onChange={(event) => setIsIssue(event.target.checked)} />
          <span>Tôi cần phản ánh một vấn đề</span>
        </label>

        {isIssue ? (
          <>
            <div className="space-y-1 text-xs">
              <label className="font-medium">Nhóm vấn đề</label>
              <select value={issueCategory} onChange={(event) => setIssueCategory(event.target.value)} className="w-full rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                <option value="SAFETY">An toàn</option>
                <option value="VEHICLE_CONDITION">Tình trạng xe</option>
                <option value="DRIVER_SERVICE">Dịch vụ tài xế</option>
                <option value="COST">Chi phí</option>
                <option value="OTHER">Khác</option>
              </select>
            </div>
            <textarea
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Mô tả chi tiết vấn đề..."
              className="w-full rounded-xl border bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900"
              required
            />
          </>
        ) : (
          <>
            <div className="space-y-2 text-xs">
              <label className="font-medium">Mức độ hài lòng</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(value => (
                  <button key={value} type="button" onClick={() => setRating(value)} aria-label={`${value} sao`}>
                    <Star className={`h-7 w-7 ${value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 text-xs">
              <label className="font-medium">Điểm tốt (phân cách bằng dấu phẩy)</label>
              <input value={positiveTags} onChange={(event) => setPositiveTags(event.target.value)} className="w-full rounded-xl border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900" />
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border px-4 py-2 text-xs font-semibold">Đóng</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{saving ? 'Đang gửi...' : isIssue ? 'Gửi phản ánh' : 'Xác nhận chuyến'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default VehicleFeedbackModal;
