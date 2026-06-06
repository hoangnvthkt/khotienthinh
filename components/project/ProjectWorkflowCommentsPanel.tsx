import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  Smile,
  UserRound,
  X,
} from 'lucide-react';
import { ProjectWorkflowComment, ProjectWorkflowCommentAttachment, ProjectWorkflowSubject, User } from '../../types';
import { projectWorkflowCommentService } from '../../lib/projectWorkflowCommentService';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';

interface Props {
  subject: ProjectWorkflowSubject;
  users: User[];
  currentUserId: string;
  documentName: string;
  disabled?: boolean;
}

type DraftAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  kind: 'image' | 'file';
};

const EMOJI_OPTIONS = ['👍', '🙏', '✅', '📌', '🔥', '😊', '👌', '❤️', '🚚', '📎', '❗', '💬'];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatBytes = (value?: number) => {
  const size = Number(value || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
};

const getInitials = (name?: string) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(-2).map(part => part[0]).join('').toUpperCase();
};

const mapRealtimeComment = (row: any): ProjectWorkflowComment => ({
  id: row.id,
  workflowSubjectId: row.workflow_subject_id,
  workflowInstanceId: row.workflow_instance_id,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  projectId: row.project_id,
  constructionSiteId: row.construction_site_id,
  authorUserId: row.author_user_id,
  body: row.body || '',
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  metadata: row.metadata || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const UserAvatar: React.FC<{ user?: User; mine?: boolean }> = ({ user, mine = false }) => {
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name}
        className={`mt-1 h-8 w-8 shrink-0 rounded-full border object-cover ${mine ? 'border-indigo-200' : 'border-slate-200'}`}
      />
    );
  }

  return (
    <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
      mine ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {user?.name ? getInitials(user.name) : <UserRound size={14} />}
    </div>
  );
};

const ProjectWorkflowCommentsPanel: React.FC<Props> = ({
  subject,
  users,
  currentUserId,
  documentName,
  disabled = false,
}) => {
  const toast = useToast();
  const [comments, setComments] = useState<ProjectWorkflowComment[]>([]);
  const [draft, setDraft] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftAttachmentsRef = useRef<DraftAttachment[]>([]);
  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);

  useEffect(() => () => {
    draftAttachmentsRef.current.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setComments([]);
    setAttachmentUrls({});
    projectWorkflowCommentService.listBySubject(subject.id)
      .then(rows => {
        if (!alive) return;
        setComments(rows);
        setCollapsed(rows.length === 0);
      })
      .catch(err => {
        if (!alive) return;
        setError(err?.message || 'Không tải được trao đổi trong phiếu.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [subject.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`workflow-subject-comments:${subject.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_subject_comments',
          filter: `workflow_subject_id=eq.${subject.id}`,
        },
        payload => {
          const next = mapRealtimeComment(payload.new);
          setComments(prev => prev.some(comment => comment.id === next.id) ? prev : [...prev, next]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [subject.id]);

  const attachmentPathKey = useMemo(() => {
    const paths = comments.flatMap(comment => comment.attachments || []).map(item => item.storagePath).filter(Boolean);
    return Array.from(new Set(paths)).sort().join('|');
  }, [comments]);

  useEffect(() => {
    const paths = attachmentPathKey ? attachmentPathKey.split('|').filter(Boolean) : [];
    const missing = paths.filter(path => !attachmentUrls[path]);
    if (missing.length === 0) return;

    let alive = true;
    Promise.all(missing.map(async path => {
      try {
        const url = await projectWorkflowCommentService.getAttachmentUrl(path);
        return { path, url };
      } catch {
        return { path, url: '' };
      }
    })).then(results => {
      if (!alive) return;
      setAttachmentUrls(prev => {
        const next = { ...prev };
        results.forEach(item => { next[item.path] = item.url; });
        return next;
      });
    });

    return () => { alive = false; };
  }, [attachmentPathKey, attachmentUrls]);

  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [collapsed, comments.length]);

  const handleFiles = (files: FileList | null) => {
    if (!files || disabled || sending) return;
    const selected = Array.from(files);
    if (draftAttachments.length + selected.length > projectWorkflowCommentService.maxAttachmentsPerComment) {
      toast.warning('Quá số lượng file', 'Mỗi tin nhắn tối đa 5 file đính kèm.');
      return;
    }

    const oversized = selected.find(file => file.size > projectWorkflowCommentService.maxAttachmentBytes);
    if (oversized) {
      toast.warning('File quá lớn', `${oversized.name} vượt quá giới hạn 25MB.`);
      return;
    }

    const next = selected.map(file => ({
      id: crypto.randomUUID(),
      file,
      kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setDraftAttachments(prev => [...prev, ...next]);
  };

  const removeDraftAttachment = (id: string) => {
    setDraftAttachments(prev => {
      const item = prev.find(attachment => attachment.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(attachment => attachment.id !== id);
    });
  };

  const clearDraftAttachments = () => {
    draftAttachments.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setDraftAttachments([]);
  };

  const submit = async () => {
    const body = draft.trim();
    if ((!body && draftAttachments.length === 0) || sending || disabled) return;
    setSending(true);
    setError(null);
    const draftId = crypto.randomUUID();
    let uploaded: ProjectWorkflowCommentAttachment[] = [];
    try {
      uploaded = await Promise.all(draftAttachments.map(item =>
        projectWorkflowCommentService.uploadAttachment({
          subject,
          file: item.file,
          draftId,
        })
      ));
      const created = await projectWorkflowCommentService.create({
        subject,
        authorUserId: currentUserId,
        body,
        attachments: uploaded,
        metadata: { documentName },
      });
      setComments(prev => prev.some(comment => comment.id === created.id) ? prev : [...prev, created]);
      setDraft('');
      clearDraftAttachments();
      setShowEmojiPicker(false);
      setCollapsed(false);
    } catch (err: any) {
      if (uploaded.length > 0) {
        void projectWorkflowCommentService.removeAttachments(uploaded.map(item => item.storagePath));
      }
      setError(err?.message || 'Không gửi được trao đổi.');
    } finally {
      setSending(false);
    }
  };

  const latestComment = comments[comments.length - 1];
  const canSend = Boolean(draft.trim() || draftAttachments.length > 0);

  const renderAttachment = (attachment: ProjectWorkflowCommentAttachment, mine: boolean) => {
    const url = attachmentUrls[attachment.storagePath];
    if (attachment.kind === 'image') {
      return (
        <a
          key={attachment.id}
          href={url || undefined}
          target="_blank"
          rel="noreferrer"
          className={`block overflow-hidden rounded-xl border ${mine ? 'border-indigo-300 bg-indigo-500/20' : 'border-slate-200 bg-white'}`}
        >
          {url ? (
            <img src={url} alt={attachment.fileName} className="max-h-56 w-full object-cover" />
          ) : (
            <div className="flex h-28 items-center justify-center gap-2 text-[10px] font-bold opacity-70">
              <Loader2 size={13} className="animate-spin" /> Đang tải ảnh...
            </div>
          )}
          <div className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold ${mine ? 'text-indigo-50' : 'text-slate-500'}`}>
            <ImageIcon size={12} /> <span className="truncate">{attachment.fileName}</span>
          </div>
        </a>
      );
    }

    return (
      <a
        key={attachment.id}
        href={url || undefined}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left ${mine ? 'border-indigo-300 bg-indigo-500/20 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
      >
        <FileText size={16} className={mine ? 'text-indigo-100' : 'text-slate-400'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-black">{attachment.fileName}</span>
          <span className={`block text-[10px] font-bold ${mine ? 'text-indigo-100' : 'text-slate-400'}`}>{formatBytes(attachment.fileSize)}</span>
        </span>
        {url ? <Download size={14} /> : <Loader2 size={14} className="animate-spin" />}
      </a>
    );
  };

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed(prev => !prev)}
        className="flex w-full items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100/70"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black text-slate-700">
            <MessageSquareText size={15} className="text-indigo-500" /> Trao đổi trong phiếu
          </div>
          <p className="mt-0.5 text-[10px] font-bold text-slate-400">
            {latestComment
              ? `Tin mới nhất ${formatDateTime(latestComment.createdAt)}`
              : 'Người theo dõi, quản trị và người được giao trong workflow có thể trao đổi tại đây.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">{comments.length}</span>
          {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
        </div>
      </button>

      {!collapsed && (
        <>
          <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs font-bold text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Đang tải trao đổi...
              </div>
            )}
            {!loading && comments.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center">
                <MessageSquareText size={20} className="mx-auto text-slate-300" />
                <p className="mt-2 text-xs font-bold text-slate-400">Chưa có trao đổi nào trong phiếu này.</p>
              </div>
            )}
            {comments.map(comment => {
              const author = userById.get(comment.authorUserId);
              const mine = comment.authorUserId === currentUserId;
              const authorName = mine ? 'Bạn' : author?.name || comment.authorUserId;
              return (
                <div key={comment.id} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  {!mine && <UserAvatar user={author} />}
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 ${mine ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    <div className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-black ${mine ? 'text-indigo-100' : 'text-slate-400'}`}>
                      <span>{authorName}</span>
                      <span>{formatDateTime(comment.createdAt)}</span>
                    </div>
                    {comment.body && <div className="whitespace-pre-wrap break-words text-xs font-semibold leading-relaxed">{comment.body}</div>}
                    {(comment.attachments || []).length > 0 && (
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {(comment.attachments || []).map(attachment => renderAttachment(attachment, mine))}
                      </div>
                    )}
                  </div>
                  {mine && <UserAvatar user={author} mine />}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-100 bg-white px-4 py-3">
            {draftAttachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {draftAttachments.map(item => (
                  <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.file.name} className="h-16 w-20 object-cover" />
                    ) : (
                      <div className="flex h-16 w-40 items-center gap-2 px-2 text-[10px] font-bold text-slate-500">
                        <FileText size={14} /> <span className="truncate">{item.file.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeDraftAttachment(item.id)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex shrink-0 gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={event => {
                    handleFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || sending}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  title="Đính kèm file hoặc hình ảnh"
                >
                  <Paperclip size={16} />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(prev => !prev)}
                    disabled={disabled || sending}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    title="Chèn emoji"
                  >
                    <Smile size={16} />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-12 left-0 z-20 grid w-44 grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                      {EMOJI_OPTIONS.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setDraft(prev => `${prev}${emoji}`)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm hover:bg-slate-100"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                disabled={disabled || sending}
                rows={2}
                maxLength={4000}
                placeholder="Nhập trao đổi, ghi chú, câu hỏi... Ctrl/Command + Enter để gửi"
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={disabled || sending || !canSend}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
                title="Gửi trao đổi"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
            {error && <div className="mt-2 text-[10px] font-bold text-red-600">{error}</div>}
          </div>
        </>
      )}
    </div>
  );
};

export default ProjectWorkflowCommentsPanel;
