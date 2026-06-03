import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, X } from 'lucide-react';
import { ProjectStaff, ProjectSubmissionTarget } from '../../types';
import { PROJECT_PERMISSION_LABELS, ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';

interface DetailRow {
  label: string;
  value?: React.ReactNode;
}

interface Props {
  title: string;
  actionLabel?: string;
  documentLabel: string;
  documentName: string;
  documentSubtitle?: string;
  details?: DetailRow[];
  projectId?: string;
  constructionSiteId?: string | null;
  recipientPermissionCodes: ProjectPermissionCode[];
  recipientHint?: string;
  onCancel: () => void;
  onConfirm: (target: ProjectSubmissionTarget) => Promise<void> | void;
}

const permissionLabel = (code: string) =>
  PROJECT_PERMISSION_LABELS[code as ProjectPermissionCode] || code;

const staffPermissionText = (staff: ProjectStaff) =>
  (staff.permissions || [])
    .filter(permission => permission.isActive && permission.permissionCode)
    .map(permission => permission.permissionName || permissionLabel(permission.permissionCode!))
    .join(', ');

const ProjectSubmissionDialog: React.FC<Props> = ({
  title,
  actionLabel = 'Gửi',
  documentLabel,
  documentName,
  documentSubtitle,
  details = [],
  projectId,
  constructionSiteId,
  recipientPermissionCodes,
  recipientHint,
  onCancel,
  onConfirm,
}) => {
  const [recipients, setRecipients] = useState<ProjectStaff[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    projectStaffService
      .listProjectStaffWithPermissions(projectId, constructionSiteId, recipientPermissionCodes)
      .then(rows => {
        if (!alive) return;
        setRecipients(rows);
        setSelectedUserIds(rows[0]?.userId ? [rows[0].userId] : []);
      })
      .catch(err => {
        if (!alive) return;
        setError(err?.message || 'Không tải được danh sách người nhận.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [projectId, constructionSiteId, recipientPermissionCodes.join('|')]);

  const selectedRecipients = useMemo(
    () => selectedUserIds
      .map(userId => recipients.find(staff => staff.userId === userId))
      .filter(Boolean) as ProjectStaff[],
    [recipients, selectedUserIds],
  );

  const toggleRecipient = (userId: string) => {
    setSelectedUserIds(prev => prev.includes(userId)
      ? prev.filter(id => id !== userId)
      : [...prev, userId]);
  };

  const submit = async () => {
    if (selectedRecipients.length === 0) {
      setError('Cần chọn ít nhất một người nhận trước khi gửi.');
      return;
    }
    const firstRecipient = selectedRecipients[0];
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({
        userId: firstRecipient.userId,
        userIds: selectedRecipients.map(staff => staff.userId),
        name: firstRecipient.userName || firstRecipient.userId,
        names: selectedRecipients.map(staff => staff.userName || staff.userId),
        permissionCode: recipientPermissionCodes[0],
        note: note.trim() || undefined,
      });
    } catch (err: any) {
      setError(err?.message || 'Không gửi được phiếu.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[10px] font-black uppercase text-amber-600">{documentLabel}</div>
            <h3 className="mt-1 text-base font-black text-slate-800">{title}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{documentName}</p>
            {documentSubtitle && <p className="mt-0.5 text-[11px] text-slate-400">{documentSubtitle}</p>}
          </div>
          <button onClick={onCancel} disabled={submitting} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5 space-y-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Thông tin phiếu gửi</div>
            <div className="grid gap-2 md:grid-cols-2">
              {details.map((row, idx) => (
                <div key={idx} className="rounded-lg bg-white px-3 py-2">
                  <div className="text-[9px] font-black uppercase text-slate-400">{row.label}</div>
                  <div className="mt-0.5 text-xs font-bold text-slate-700">{row.value || '-'}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400">Người nhận xử lý</div>
                <div className="text-[11px] font-medium text-slate-500">
                  {recipientHint || `Chỉ hiển thị nhân sự có quyền ${recipientPermissionCodes.map(permissionLabel).join(' / ')}.`}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                {selectedUserIds.length}/{recipients.length} người
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[2.5rem_1.4fr_1fr_1.4fr] bg-slate-50 px-3 py-2 text-[9px] font-black uppercase text-slate-400">
                <div />
                <div>Người nhận</div>
                <div>Vai trò</div>
                <div>Quyền</div>
              </div>
              <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                {loading && <div className="px-3 py-4 text-center text-xs font-bold text-slate-400">Đang tải người nhận...</div>}
                {!loading && recipients.map(staff => {
                  const checked = selectedUserIds.includes(staff.userId);
                  return (
                    <button
                      key={staff.id}
                      onClick={() => toggleRecipient(staff.userId)}
                      className={`grid w-full grid-cols-[2.5rem_1.4fr_1fr_1.4fr] items-center px-3 py-2 text-left text-xs transition-colors ${checked ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 text-transparent'}`}>
                        <CheckCircle2 size={13} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-black text-slate-700">{staff.userName || staff.userId}</span>
                        <span className="block truncate text-[10px] text-slate-400">{staff.userId}</span>
                      </span>
                      <span className="truncate font-bold text-slate-500">{staff.positionName || '-'}</span>
                      <span className="truncate text-[10px] font-semibold text-slate-500">{staffPermissionText(staff) || '-'}</span>
                    </button>
                  );
                })}
                {!loading && recipients.length === 0 && (
                  <div className="flex items-start gap-2 px-3 py-4 text-xs font-bold text-amber-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>Chưa có nhân sự phù hợp. Cần phân quyền người duyệt/xác nhận trong Tổ chức dự án trước khi gửi.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">Ghi chú gửi</label>
            <textarea
              rows={3}
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Nội dung cần người nhận kiểm tra/duyệt..."
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onCancel} disabled={submitting} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Hủy
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading || recipients.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50"
          >
            <Send size={13} /> {submitting ? 'Đang gửi...' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSubmissionDialog;
