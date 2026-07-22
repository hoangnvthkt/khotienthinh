import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, X } from 'lucide-react';
import { ProjectStaff, ProjectSubmissionTarget } from '../../types';
import type { ProjectPermissionRoomCode, ProjectRoomActionCode } from '../../lib/permissions/projectPermissionRooms';
import { projectPermissionRoomService } from '../../lib/projectPermissionRoomService';

interface DetailRow { label: string; value?: React.ReactNode; }

interface Props {
  title: string;
  actionLabel?: string;
  documentLabel: string;
  documentName: string;
  documentSubtitle?: string;
  details?: DetailRow[];
  projectId: string;
  constructionSiteId?: string | null;
  recipientRoomCode: ProjectPermissionRoomCode;
  recipientAction: ProjectRoomActionCode;
  recipientHint?: string;
  onCancel: () => void;
  onConfirm: (target: ProjectSubmissionTarget) => Promise<void> | void;
}

const ACTION_LABELS: Record<ProjectRoomActionCode, string> = {
  view: 'xem', edit: 'sửa', delete: 'xóa', submit: 'gửi', verify: 'kiểm tra', confirm: 'xác nhận', approve: 'duyệt', view_available_stock: 'xem tồn khả dụng',
};

const ProjectRoomSubmissionDialog: React.FC<Props> = ({ title, actionLabel = 'Gửi', documentLabel, documentName, documentSubtitle, details = [], projectId, constructionSiteId, recipientRoomCode, recipientAction, recipientHint, onCancel, onConfirm }) => {
  const [recipients, setRecipients] = useState<ProjectStaff[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    projectPermissionRoomService.listRecipients(projectId, constructionSiteId, recipientRoomCode, recipientAction)
      .then(rows => { if (alive) { setRecipients(rows); setSelectedUserIds(rows[0]?.userId ? [rows[0].userId] : []); } })
      .catch(err => { if (alive) setError(err?.message || 'Không tải được danh sách người nhận.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [constructionSiteId, projectId, recipientAction, recipientRoomCode]);

  const selectedRecipients = useMemo(() => selectedUserIds.map(id => recipients.find(staff => staff.userId === id)).filter(Boolean) as ProjectStaff[], [recipients, selectedUserIds]);
  const toggleRecipient = (userId: string) => setSelectedUserIds(current => current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]);

  const submit = async () => {
    if (!selectedRecipients.length) { setError('Cần chọn ít nhất một người nhận trước khi gửi.'); return; }
    setSubmitting(true); setError(null);
    try {
      const first = selectedRecipients[0];
      await onConfirm({ userId: first.userId, userIds: selectedRecipients.map(item => item.userId), name: first.userName || first.userId, names: selectedRecipients.map(item => item.userName || item.userId), roomCode: recipientRoomCode, actionCode: recipientAction, note: note.trim() || undefined });
    } catch (err: any) { setError(err?.message || 'Không gửi được phiếu.'); setSubmitting(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6"><div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><div className="text-[10px] font-black uppercase text-indigo-600">{documentLabel}</div><h3 className="mt-1 text-base font-black text-slate-800">{title}</h3><p className="mt-1 text-xs font-medium text-slate-500">{documentName}</p>{documentSubtitle && <p className="mt-0.5 text-[11px] text-slate-400">{documentSubtitle}</p>}</div><button onClick={onCancel} disabled={submitting} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="max-h-[72vh] space-y-4 overflow-y-auto p-5"><div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="mb-2 text-[10px] font-black uppercase text-slate-400">Thông tin phiếu gửi</div><div className="grid gap-2 md:grid-cols-2">{details.map((row, index) => <div key={index} className="rounded-lg bg-white px-3 py-2"><div className="text-[9px] font-black uppercase text-slate-400">{row.label}</div><div className="mt-0.5 text-xs font-bold text-slate-700">{row.value || '-'}</div></div>)}</div></div><div><div className="mb-2 flex items-center justify-between"><div><div className="text-[10px] font-black uppercase text-slate-400">Người nhận xử lý</div><div className="text-[11px] font-medium text-slate-500">{recipientHint || `Chỉ hiển thị nhân sự thuộc Room này có quyền ${ACTION_LABELS[recipientAction]}.`}</div></div><span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700">{selectedUserIds.length}/{recipients.length} người</span></div><div className="overflow-hidden rounded-xl border border-slate-200"><div className="grid grid-cols-[2.5rem_1.4fr_1fr] bg-slate-50 px-3 py-2 text-[9px] font-black uppercase text-slate-400"><div /><div>Người nhận</div><div>Vai trò</div></div><div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">{loading && <div className="px-3 py-4 text-center text-xs font-bold text-slate-400">Đang tải người nhận...</div>}{!loading && recipients.map(staff => { const checked = selectedUserIds.includes(staff.userId); return <button key={staff.id} onClick={() => toggleRecipient(staff.userId)} className={`grid w-full grid-cols-[2.5rem_1.4fr_1fr] items-center px-3 py-2 text-left text-xs ${checked ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-200 text-transparent'}`}><CheckCircle2 size={13} /></span><span className="min-w-0"><span className="block truncate font-black text-slate-700">{staff.userName || staff.userId}</span><span className="block truncate text-[10px] text-slate-400">{staff.userId}</span></span><span className="truncate font-bold text-slate-500">{staff.positionName || '-'}</span></button>; })}{!loading && !recipients.length && <div className="flex items-start gap-2 px-3 py-4 text-xs font-bold text-amber-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />Chưa có người phù hợp trong Room này. Hãy thêm người xử lý tại tab Phân quyền.</div>}</div></div></div><div><label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Ghi chú gửi</label><textarea rows={3} value={note} onChange={event => setNote(event.target.value)} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-300" /></div>{error && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</div>}</div><div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button><button onClick={submit} disabled={submitting || loading || !recipients.length} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"><Send size={13} />{submitting ? 'Đang gửi...' : actionLabel}</button></div></div></div>;
};

export default ProjectRoomSubmissionDialog;
