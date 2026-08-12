import React, { useState } from 'react';
import { MessageSquareWarning, Star, Loader2 } from 'lucide-react';
import { submitVehicleFeedback } from '../../lib/vehicleBookingService';
import {
  buildVehicleFeedbackPayload,
  VEHICLE_FEEDBACK_ISSUE_CATEGORIES,
  VEHICLE_FEEDBACK_POSITIVE_TAGS,
} from '../../lib/vehicleBookingFeedbackModel';
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
  const [positiveTags, setPositiveTags] = useState<string[]>(['ON_TIME', 'SAFE_DRIVING']);
  const [issueCategory, setIssueCategory] = useState('OTHER');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = buildVehicleFeedbackPayload({
      bookingId,
      rating,
      hasIssue: isIssue,
      positiveTags,
      issueCategory: issueCategory || null,
      comment,
    });
    if (payload.ok === false) {
      toast.error(payload.message);
      return;
    }
    try {
      setSaving(true);
      await submitVehicleFeedback(payload.value);
      toast.success(payload.value.is_issue ? 'Đã gửi phản ánh chuyến xe.' : 'Cảm ơn bạn đã xác nhận và đánh giá chuyến xe.');
      await onSuccess();
      onClose();
    } catch (error: any) {
      toast.error(error.message || 'Không thể gửi đánh giá chuyến xe.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveIssue = isIssue || rating <= 3;

  const togglePositiveTag = (tag: string) => {
    setPositiveTags(current => current.includes(tag)
      ? current.filter(value => value !== tag)
      : [...current, tag]);
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

        <div className="space-y-2 text-xs">
          <label className="font-medium">Mức độ hài lòng</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(value => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRating(value);
                  if (value <= 3) setIsIssue(true);
                }}
                aria-label={`${value} sao`}
                className="rounded-md p-0.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <Star className={`h-7 w-7 ${value <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
              </button>
            ))}
          </div>
        </div>

        <fieldset className="space-y-2 text-xs">
          <legend className="font-medium">Điểm tốt</legend>
          <div className="flex flex-wrap gap-2">
            {VEHICLE_FEEDBACK_POSITIVE_TAGS.map(tag => {
              const active = positiveTags.includes(tag.code);
              return (
                <button key={tag.code} type="button" onClick={() => togglePositiveTag(tag.code)} aria-pressed={active} className={`rounded-full border px-3 py-1.5 font-medium transition ${active ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                  {tag.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={effectiveIssue} disabled={rating <= 3} onChange={(event) => setIsIssue(event.target.checked)} />
          <span>Gửi phản ánh riêng</span>
        </label>

        {effectiveIssue && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="space-y-1 text-xs">
              <label htmlFor="vehicle-feedback-category" className="font-medium">Nhóm vấn đề</label>
              <select id="vehicle-feedback-category" value={issueCategory} onChange={(event) => setIssueCategory(event.target.value)} className="w-full rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                {VEHICLE_FEEDBACK_ISSUE_CATEGORIES.map(category => <option key={category.code} value={category.code}>{category.label}</option>)}
              </select>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="font-medium">Nội dung phản ánh</span>
              <textarea rows={4} maxLength={4000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Mô tả chi tiết vấn đề" className="w-full rounded-xl border bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900" required />
            </label>
            <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">Nội dung chỉ hiển thị cho người được cấp quyền xem và xử lý phản ánh nhạy cảm.</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border px-4 py-2 text-xs font-semibold">Đóng</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{saving ? 'Đang gửi...' : effectiveIssue ? 'Gửi phản ánh' : 'Xác nhận chuyến'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default VehicleFeedbackModal;
