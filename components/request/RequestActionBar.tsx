import React, { useMemo, useState } from 'react';
import { Check, Loader2, RotateCcw, Send, UserRoundCog, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { getRequestActions } from '../../lib/requestActionAvailability';
import { mapRequestRpcError, requestRuntimeService, type RequestAction, type RequestDetail } from '../../lib/requestRuntimeService';
import UserSearchSelect from '../common/UserSearchSelect';

const labels: Record<RequestAction, string> = {
  APPROVE: 'Chấp thuận',
  REJECT: 'Từ chối',
  RETURN: 'Trả lại',
  RESUBMIT: 'Gửi lại',
  CANCEL: 'Hủy đề xuất',
  REASSIGN: 'Chuyển người duyệt',
};

const icons: Record<RequestAction, typeof Check> = {
  APPROVE: Check,
  REJECT: XCircle,
  RETURN: RotateCcw,
  RESUBMIT: Send,
  CANCEL: X,
  REASSIGN: UserRoundCog,
};

const buttonStyles: Record<RequestAction, string> = {
  APPROVE: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 active:scale-95',
  REJECT: 'bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 active:scale-95',
  RETURN: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 active:scale-95',
  RESUBMIT: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 active:scale-95',
  CANCEL: 'bg-slate-600 hover:bg-slate-700 text-white shadow-md shadow-slate-600/20 active:scale-95',
  REASSIGN: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 active:scale-95',
};

export const RequestActionBar: React.FC<{ detail: RequestDetail; onChanged: () => Promise<void> }> = ({ detail, onChanged }) => {
  const { user, users } = useApp();
  const toast = useToast();
  const [action, setAction] = useState<RequestAction | null>(null);
  const [comment, setComment] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const actions = useMemo(() => getRequestActions({ status: detail.status, canApprove: detail.capabilities.canApprove, canCancel: detail.capabilities.canCancel, canReassign: detail.capabilities.canReassign, isCreator: detail.creator.id === user.id }), [detail, user.id]);
  if (actions.length === 0) return null;
  const open = (next: RequestAction) => { setAction(next); setComment(''); setAssigneeUserId(''); setError(null); };
  const needsComment = action === 'REJECT' || action === 'RETURN' || action === 'REASSIGN';
  const execute = async () => {
    if (!action) return;
    if (needsComment && !comment.trim()) { setError('Vui lòng nhập lý do cho hành động này.'); return; }
    if (action === 'REASSIGN' && !assigneeUserId) { setError('Vui lòng chọn người duyệt mới.'); return; }
    setIsSubmitting(true); setError(null);
    try {
      await requestRuntimeService.act({ requestId: detail.id, action, comment: comment.trim() || undefined, formData: action === 'RESUBMIT' ? detail.formData : undefined, assigneeUserId: action === 'REASSIGN' ? assigneeUserId : undefined, idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, expectedUpdatedAt: detail.updatedAt });
      await onChanged();
      toast.success('Đã cập nhật đề xuất', labels[action]);
      setAction(null);
    } catch (cause) {
      const mapped = mapRequestRpcError(cause);
      setError(mapped.code === 'REQUEST_STALE_STATE' ? 'Phiếu đã thay đổi bởi người khác. Vui lòng tải lại trước khi thực hiện tiếp.' : mapped.message);
    } finally { setIsSubmitting(false); }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">Xử lý:</span>
        {actions.map(item => {
          const Icon = icons[item];
          return (
            <button
              type="button"
              key={item}
              onClick={() => open(item)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${buttonStyles[item]}`}
            >
              <Icon size={16} />
              {labels[item]}
            </button>
          );
        })}
      </div>

      {action && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{labels[action]}</h2>
            <p className="mt-1 text-xs text-slate-500 font-mono">{detail.code} · {detail.title}</p>

            {error && (
              <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200 border border-rose-200 dark:border-rose-800">
                {error}
              </p>
            )}

            {action === 'REASSIGN' && (
              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-bold uppercase text-slate-700 dark:text-slate-200">
                  Người duyệt mới <span className="text-rose-500">*</span>
                </label>
                <UserSearchSelect users={users} excludeUserIds={[user.id]} value={assigneeUserId} onChange={userId => setAssigneeUserId(userId || '')} placeholder="Gõ tên hoặc vị trí người duyệt mới..." />
              </div>
            )}

            <label className="mt-4 block text-xs font-bold uppercase text-slate-700 dark:text-slate-200">
              Ý kiến / Lý do {needsComment && <span className="text-rose-500">*</span>}
              <textarea
                value={comment}
                onChange={event => setComment(event.target.value)}
                rows={4}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-800 dark:text-white outline-none focus:border-emerald-500"
                placeholder={needsComment ? 'Nhập bắt buộc lý do...' : 'Nhập ý kiến xử lý (tuỳ chọn)'}
              />
            </label>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setAction(null)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void execute()}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold text-white transition ${buttonStyles[action]}`}
              >
                {isSubmitting && <Loader2 size={15} className="animate-spin" />}
                {labels[action]}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RequestActionBar;

