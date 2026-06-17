import React, { useEffect, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { SafetyAttachment, SafetyComment, SafetyIssue, SafetyIssueStatus, SafetyStatusLog, User } from '../../../types';
import { safetyService } from '../../../lib/safetyService';
import { StatusBadge } from '../../erp';
import {
  SAFETY_ISSUE_STATUS_LABELS,
  SAFETY_ISSUE_TYPE_LABELS,
  SAFETY_SEVERITY_LABELS,
  getSafetyIssueStatusTone,
  getSafetyNextAction,
  getSafetySeverityTone,
} from '../../../lib/safetyWorkflow';
import SafetyAttachmentUploader from './SafetyAttachmentUploader';
import SafetyStatusTimeline from './SafetyStatusTimeline';
import SafetyImageGalleryModal from './SafetyImageGalleryModal';

interface Props {
  issue: SafetyIssue;
  currentUser: User;
  canManage?: boolean;
  onClose: () => void;
  onStatusChange: (status: SafetyIssueStatus) => Promise<void>;
  onChanged?: () => void;
}

const statusFlow: SafetyIssueStatus[] = ['assigned', 'in_progress', 'waiting_verification', 'resolved', 'closed', 'rejected'];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN');
};

const SafetyIssueDetailModal: React.FC<Props> = ({ issue, currentUser, canManage, onClose, onStatusChange, onChanged }) => {
  const [comments, setComments] = useState<SafetyComment[]>([]);
  const [logs, setLogs] = useState<SafetyStatusLog[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentAttachments, setCommentAttachments] = useState<SafetyAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingComment, setSavingComment] = useState(false);
  const [changingStatus, setChangingStatus] = useState<SafetyIssueStatus | null>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const [commentRows, logRows] = await Promise.all([
        safetyService.listComments(issue.id),
        safetyService.listStatusLogs(issue.id),
      ]);
      setComments(commentRows);
      setLogs(logRows as SafetyStatusLog[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [issue.id]);

  const submitComment = async () => {
    if (!commentBody.trim() && commentAttachments.length === 0) return;
    setSavingComment(true);
    try {
      const created = await safetyService.addComment({
        projectId: issue.projectId,
        constructionSiteId: issue.constructionSiteId,
        issueId: issue.id,
        body: commentBody.trim() || 'Đính kèm bằng chứng',
        attachments: commentAttachments,
        createdBy: currentUser.id,
        createdByName: currentUser.name || currentUser.username,
      });
      setComments(prev => [...prev, created]);
      setCommentBody('');
      setCommentAttachments([]);
      onChanged?.();
    } finally {
      setSavingComment(false);
    }
  };

  const changeStatus = async (status: SafetyIssueStatus) => {
    setChangingStatus(status);
    try {
      await onStatusChange(status);
      await loadDetail();
      onChanged?.();
    } finally {
      setChangingStatus(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-6">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black uppercase text-orange-600">{issue.code}</div>
            <h3 className="mt-1 text-base font-black text-slate-800">{issue.title}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">{getSafetyNextAction(issue.status, issue.assignedToName)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5 overflow-y-auto p-5">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={issue.status} label={SAFETY_ISSUE_STATUS_LABELS[issue.status]} tone={getSafetyIssueStatusTone(issue.status)} size="md" />
              <StatusBadge status={issue.severity} label={SAFETY_SEVERITY_LABELS[issue.severity]} tone={getSafetySeverityTone(issue.severity)} size="md" />
              <StatusBadge status={issue.type} label={SAFETY_ISSUE_TYPE_LABELS[issue.type]} tone="neutral" size="md" />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="text-[10px] font-black uppercase text-slate-400">Khu vực</div>
                <div className="mt-1 text-sm font-bold text-slate-700">{issue.area || '-'}</div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="text-[10px] font-black uppercase text-slate-400">Người xử lý / hạn</div>
                <div className="mt-1 text-sm font-bold text-slate-700">{issue.assignedToName || '-'} • {formatDateTime(issue.dueAt)}</div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase text-slate-400">Mô tả</div>
              <p className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-100 bg-white p-3 text-sm leading-6 text-slate-600">{issue.description || 'Chưa có mô tả.'}</p>
            </div>

            {issue.beforePhotos.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Ảnh hiện trường</div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {issue.beforePhotos.map((photo, index) => (
                    <img key={`${photo.url}-${index}`} src={photo.previewUrl || photo.url} alt={photo.name} className="h-32 w-full cursor-pointer rounded-lg border border-slate-100 object-cover transition hover:opacity-90" onClick={() => setGalleryIndex(index)} />
                  ))}
                </div>
              </div>
            )}

            {canManage && (
              <div>
                <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Cập nhật trạng thái</div>
                <div className="flex flex-wrap gap-2">
                  {statusFlow.map(status => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => changeStatus(status)}
                      disabled={changingStatus === status || issue.status === status}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {changingStatus === status ? 'Đang cập nhật...' : SAFETY_ISSUE_STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-5 overflow-y-auto border-t border-slate-100 bg-slate-50/70 p-5 lg:border-l lg:border-t-0">
            <section>
              <h4 className="mb-3 text-sm font-black text-slate-800">Bình luận / bằng chứng</h4>
              <div className="space-y-3">
                {loading ? (
                  <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
                ) : comments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-xs font-bold text-slate-400">Chưa có bình luận.</div>
                ) : comments.map(comment => (
                  <div key={comment.id} className="rounded-lg border border-slate-100 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-700">{comment.createdByName || comment.createdBy || 'Người dùng'}</span>
                      <span className="text-[10px] font-bold text-slate-400">{formatDateTime(comment.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{comment.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                <textarea value={commentBody} onChange={event => setCommentBody(event.target.value)} rows={3} placeholder="Nhập cập nhật xử lý..." className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-orange-300" />
                <SafetyAttachmentUploader projectId={issue.projectId || ''} recordType="issue-comments" recordId={issue.id} attachments={commentAttachments} onChange={setCommentAttachments} uploadedBy={currentUser.name || currentUser.username} label="Bằng chứng" />
                <button type="button" onClick={submitComment} disabled={savingComment} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50">
                  {savingComment ? <MessageSquare size={14} /> : <Send size={14} />} {savingComment ? 'Đang gửi...' : 'Gửi cập nhật'}
                </button>
              </div>
            </section>

            <section>
              <h4 className="mb-3 text-sm font-black text-slate-800">Lịch sử trạng thái</h4>
              <SafetyStatusTimeline logs={logs} />
            </section>
          </aside>
        </div>
      </div>
      {galleryIndex !== null && (
        <SafetyImageGalleryModal
          attachments={issue.beforePhotos}
          currentIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
          onIndexChange={setGalleryIndex}
        />
      )}
    </div>
  );
};

export default SafetyIssueDetailModal;
