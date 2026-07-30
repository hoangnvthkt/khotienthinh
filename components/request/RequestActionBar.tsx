import React, { useMemo, useState } from 'react';
import { Check, Loader2, RotateCcw, Send, UserRoundCog, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { getRequestActions } from '../../lib/requestActionAvailability';
import { mapRequestRpcError, requestRuntimeService, type RequestAction, type RequestDetail } from '../../lib/requestRuntimeService';
import UserSearchSelect from '../common/UserSearchSelect';

const labels: Record<RequestAction, string> = { APPROVE: 'Chấp thuận', REJECT: 'Từ chối', RETURN: 'Trả lại', RESUBMIT: 'Gửi lại', CANCEL: 'Hủy đề xuất', REASSIGN: 'Chuyển người duyệt' };
const icons: Record<RequestAction, typeof Check> = { APPROVE: Check, REJECT: XCircle, RETURN: RotateCcw, RESUBMIT: Send, CANCEL: X, REASSIGN: UserRoundCog };

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
  return <><div className="flex flex-wrap gap-2 border-b border-slate-100 pb-5 dark:border-slate-800">{actions.map(item => { const Icon = icons[item]; return <button type="button" key={item} onClick={() => open(item)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${item === 'REJECT' || item === 'CANCEL' ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-200' : item === 'RETURN' ? 'bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}><Icon size={16} />{labels[item]}</button>; })}</div>{action && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"><h2 className="text-lg font-bold text-slate-900 dark:text-white">{labels[action]}</h2><p className="mt-1 text-sm text-slate-500">{detail.code} · {detail.title}</p>{error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}{action === 'REASSIGN' && <div className="mt-4"><label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Người duyệt mới <span className="text-rose-500">*</span></label><UserSearchSelect users={users} excludeUserIds={[user.id]} value={assigneeUserId} onChange={userId => setAssigneeUserId(userId || '')} placeholder="Gõ tên hoặc vị trí người duyệt mới..." /></div>}<label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">Ý kiến{needsComment && <span className="text-rose-500"> *</span>}<textarea value={comment} onChange={event => setComment(event.target.value)} rows={4} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder={needsComment ? 'Nhập lý do...' : 'Nhập ý kiến (tuỳ chọn)'} /></label><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={isSubmitting} onClick={() => setAction(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Hủy</button><button type="button" disabled={isSubmitting} onClick={() => void execute()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isSubmitting && <Loader2 size={15} className="animate-spin" />}{labels[action]}</button></div></div></div>}</>;
};

export default RequestActionBar;
