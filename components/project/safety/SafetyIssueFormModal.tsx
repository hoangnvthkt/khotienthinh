import React, { useMemo, useState } from 'react';
import { AlertTriangle, Save, X } from 'lucide-react';
import {
  SafetyAttachment,
  SafetyIssue,
  SafetyIssueType,
  SafetySeverity,
  User,
} from '../../../types';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import { SAFETY_ISSUE_TYPE_LABELS, SAFETY_SEVERITY_LABELS } from '../../../lib/safetyWorkflow';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  issue?: SafetyIssue | null;
  users: User[];
  currentUser: User;
  onClose: () => void;
  onSave: (input: Partial<SafetyIssue> & { title: string; projectId: string; actorName?: string }) => Promise<void>;
}

const severityOptions: SafetySeverity[] = ['low', 'medium', 'high', 'critical'];
const typeOptions: SafetyIssueType[] = ['hazard', 'violation', 'near_miss', 'minor_incident', 'serious_incident', 'corrective_action'];

const SafetyIssueFormModal: React.FC<Props> = ({
  projectId,
  constructionSiteId,
  issue,
  users,
  currentUser,
  onClose,
  onSave,
}) => {
  const tempRecordId = useMemo(() => issue?.id || `draft-${crypto.randomUUID()}`, [issue?.id]);
  const [title, setTitle] = useState(issue?.title || '');
  const [type, setType] = useState<SafetyIssueType>(issue?.type || 'hazard');
  const [severity, setSeverity] = useState<SafetySeverity>(issue?.severity || 'medium');
  const [area, setArea] = useState(issue?.area || '');
  const [description, setDescription] = useState(issue?.description || '');
  const [assignedToUserId, setAssignedToUserId] = useState(issue?.assignedToUserId || '');
  const [dueAt, setDueAt] = useState(issue?.dueAt ? issue.dueAt.slice(0, 16) : '');
  const [beforePhotos, setBeforePhotos] = useState<SafetyAttachment[]>(issue?.beforePhotos || []);
  const [attachments, setAttachments] = useState<SafetyAttachment[]>(issue?.attachments || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableUsers = users.length ? users : [currentUser];
  const selectedUser = availableUsers.find(user => user.id === assignedToUserId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Vui lòng nhập tiêu đề nguy cơ/sự cố.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...(issue || {}),
        projectId,
        constructionSiteId: constructionSiteId || null,
        title: title.trim(),
        type,
        severity,
        area: area.trim() || null,
        description: description.trim() || null,
        assignedToUserId: assignedToUserId || null,
        assignedToName: selectedUser?.name || selectedUser?.username || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        beforePhotos,
        attachments,
        createdBy: issue?.createdBy || currentUser.id,
        actorName: currentUser.name || currentUser.username,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Không lưu được ghi nhận an toàn.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-orange-600">An toàn công trường</div>
            <h3 className="mt-1 text-base font-black text-slate-800">{issue ? 'Cập nhật nguy cơ/sự cố' : 'Ghi nhận nguy cơ/sự cố'}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Ghi nhanh tại hiện trường, có ảnh và người phụ trách xử lý.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Tiêu đề</label>
              <input value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-300" placeholder="VD: Lan can tầng 4 thiếu thanh chắn" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Loại</label>
              <select value={type} onChange={event => setType(event.target.value as SafetyIssueType)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                {typeOptions.map(option => <option key={option} value={option}>{SAFETY_ISSUE_TYPE_LABELS[option]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mức độ</label>
              <select value={severity} onChange={event => setSeverity(event.target.value as SafetySeverity)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                {severityOptions.map(option => <option key={option} value={option}>{SAFETY_SEVERITY_LABELS[option]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Khu vực/tổ đội</label>
              <input value={area} onChange={event => setArea(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" placeholder="VD: Tháp A - tầng 4" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Hạn xử lý</label>
              <input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Người xử lý</label>
              <select value={assignedToUserId} onChange={event => setAssignedToUserId(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none">
                <option value="">Chưa phân công</option>
                {availableUsers.map(user => <option key={user.id} value={user.id}>{user.name || user.username || user.email}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase text-slate-400">Mô tả</label>
              <textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-300" placeholder="Mô tả hiện trạng, nguy cơ, yêu cầu khắc phục..." />
            </div>
          </div>

          <SafetyAttachmentUploader projectId={projectId} recordType="issues" recordId={tempRecordId} attachments={beforePhotos} onChange={setBeforePhotos} uploadedBy={currentUser.name || currentUser.username} imageOnly label="Ảnh hiện trường" />
          <SafetyAttachmentUploader projectId={projectId} recordType="issue-files" recordId={tempRecordId} attachments={attachments} onChange={setAttachments} uploadedBy={currentUser.name || currentUser.username} label="File đính kèm" />

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Hủy</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">
            <Save size={14} /> {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SafetyIssueFormModal;
