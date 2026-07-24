import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Loader2,
  AlertCircle,
  ChevronUp,
  CornerUpLeft,
  Crown,
  Download,
  Edit3,
  FileText,
  Heart,
  Image as ImageIcon,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  Search,
  Send,
  Shield,
  Smile,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
  Phone,
  Video,
  Star,
  FolderOpen,
  MessageSquare,
  Link as LinkIcon,
  HelpCircle
} from 'lucide-react';
import type { User } from '../../types';
import { useChatV2, useChatV2UnreadCount } from '../../hooks/useChatV2';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  CHAT_V2_REACTION_EMOJIS,
  ChatV2Attachment,
  ChatV2ChecklistItem,
  ChatV2Conversation,
  ChatV2Message,
  ChatV2MessageKind,
  formatFileSize,
  getChatV2ConversationTitle,
  getUserInitials,
  isImageAttachment,
} from '../../lib/chatV2Service';

const CHAT_V2_ATTACHMENT_BUCKET = 'chat-attachments';

interface ChatShellProps {
  currentUser: User;
  users: User[];
}

interface ReplyDraft {
  messageId: string;
  senderId: string;
  senderName: string;
  bodyPreview: string;
  kind: ChatV2MessageKind;
}

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const canManageConversation = (conversation: ChatV2Conversation | null | undefined, currentUser: User): boolean => {
  if (!conversation) return false;
  if (String(currentUser.role) === 'ADMIN') return true;
  return conversation.currentParticipant?.role === 'owner' || conversation.currentParticipant?.role === 'admin';
};

const ReplyQuote: React.FC<{ preview: ReplyDraft; onClear: () => void }> = ({ preview, onClear }) => {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border-l-4 border-indigo-500 bg-slate-100 dark:bg-slate-900/40 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300">
      <div className="min-w-0 flex-1">
        <span className="font-black text-indigo-650 dark:text-indigo-400">Trả lời {preview.senderName}: </span>
        <span className="truncate italic">{preview.bodyPreview}</span>
      </div>
      <button
        type="button"
        onClick={onClear}
        title="Bỏ trích dẫn"
        aria-label="Bỏ trích dẫn"
        className="flex h-5 w-5 items-center justify-center rounded-md text-current opacity-70 hover:bg-slate-200 dark:hover:bg-white/10 hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
};

const MessageText: React.FC<{ body: string; mentions: { displayName: string }[] }> = ({ body, mentions }) => {
  if (!body) return null;
  const names = mentions
    .map(mention => mention.displayName.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) {
    return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{body}</div>;
  }
  const pattern = new RegExp(`@(${names.map(escapeRegExp).join('|')})`, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    parts.push(
      <span key={`${match[0]}-${match.index}`} className="rounded bg-indigo-500/20 px-1 font-bold text-indigo-300">
        {match[0]}
      </span>
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{parts}</div>;
};

const Avatar: React.FC<{ user?: User; label?: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({
  user,
  label,
  online = false,
  size = 'md',
}) => {
  const dims = size === 'lg' ? 'h-12 w-12 text-sm' : size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs';
  const name = user?.name || label || 'Tin nhắn';
  return (
    <div className={`relative ${dims} shrink-0 overflow-hidden rounded-full bg-slate-700 text-white shadow-sm`}>
      {user?.avatar ? (
        <img src={user.avatar} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-black bg-emerald-600">{getUserInitials(name)}</div>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-[#23a55a]" />
      )}
    </div>
  );
};

const AttachmentView: React.FC<{ attachment: ChatV2Attachment; messageCreatedAt?: string; messageMetadata?: Record<string, any> }> = ({
  attachment,
  messageCreatedAt,
  messageMetadata,
}) => {
  const href = attachment.signedUrl || '#';
  const downloadHref = attachment.downloadUrl || attachment.signedUrl || '#';
  if (isImageAttachment(attachment) && attachment.signedUrl) {
    const dateStr = messageCreatedAt ? new Date(messageCreatedAt).toLocaleString('vi-VN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) : '';
    const location = messageMetadata?.location || 'KhoTienThinh GPS Verified';
    return (
      <div className="relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-[#2b2d31] group max-w-lg">
        <a href={href} target="_blank" rel="noreferrer" className="block">
          <img src={attachment.signedUrl} alt={attachment.fileName} className="max-h-[350px] w-full object-cover" loading="lazy" />
        </a>
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 text-white text-[10px] font-medium pointer-events-none select-none flex flex-col justify-end leading-tight">
          <div className="opacity-90">{dateStr}</div>
          <div className="font-bold text-amber-300 mt-0.5">{location}</div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={downloadHref}
      download={attachment.fileName}
      rel="noreferrer"
      className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-[#2b2d31] dark:text-[#dbdee1] transition hover:border-emerald-600 dark:hover:text-white max-w-md"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold">{attachment.fileName}</div>
        <div className="text-[10px] text-slate-550 dark:text-slate-400 font-medium">{formatFileSize(attachment.sizeBytes)}</div>
      </div>
      <Download size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
    </a>
  );
};

const TextMessage: React.FC<{ message: ChatV2Message }> = ({ message }) => (
  <>
    {message.body && <MessageText body={message.body} mentions={message.mentions} />}
    {message.attachments.length > 0 && (
      <div className={`mt-2 grid gap-2 ${message.attachments.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {message.attachments.map(attachment => (
          <AttachmentView
            key={attachment.id}
            attachment={attachment}
            messageCreatedAt={message.createdAt}
            messageMetadata={message.metadata}
          />
        ))}
      </div>
    )}
  </>
);

const ImageMessage: React.FC<{ message: ChatV2Message }> = ({ message }) => <TextMessage message={message} />;

const FileMessage: React.FC<{ message: ChatV2Message }> = ({ message }) => <TextMessage message={message} />;

const PollMessage: React.FC<{
  message: ChatV2Message;
  currentUser: User;
  isMine: boolean;
  onVote: (message: ChatV2Message, optionId: string) => void;
}> = ({ message, currentUser, isMine, onVote }) => {
  const options = Array.isArray(message.payload.options) ? message.payload.options : [];
  const totalVotes = message.pollVotes.length;
  const myVotes = new Set(message.pollVotes.filter(vote => vote.userId === currentUser.id).map(vote => vote.optionId));
  const question = message.payload.question || message.payload.title || message.body || 'Bình chọn';

  return (
    <div className="min-w-[240px] space-y-2 text-slate-800 dark:text-[#dbdee1]">
      <div className="text-sm font-bold text-slate-900 dark:text-white">{question}</div>
      <div className="space-y-1.5">
        {options.map((option: { id: string; text: string }) => {
          const count = message.pollVotes.filter(vote => vote.optionId === option.id).length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = myVotes.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onVote(message, option.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                selected
                  ? 'border-indigo-500 bg-indigo-500/25 text-indigo-650 dark:text-white'
                  : 'border-slate-200 bg-slate-100 hover:border-slate-350 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500'
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-xs font-bold">
                <span className="min-w-0 break-words">{option.text}</span>
                <span className="shrink-0">{count} · {pct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-900">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      {message.payload.multiple && <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Cho phép chọn nhiều đáp án</div>}
    </div>
  );
};

const ChecklistMessage: React.FC<{
  message: ChatV2Message;
  users: User[];
  isMine: boolean;
  onToggle: (item: ChatV2ChecklistItem, nextDone: boolean) => void;
}> = ({ message, users, isMine, onToggle }) => {
  const title = message.payload.title || message.body || 'Checklist';
  return (
    <div className="min-w-[240px] space-y-2 text-slate-800 dark:text-[#dbdee1]">
      <div className="text-sm font-bold text-slate-900 dark:text-white">{title}</div>
      <div className="space-y-1.5">
        {message.checklistItems.map(item => {
          const doneBy = users.find(user => user.id === item.doneBy);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item, !item.isDone)}
              className="grid w-full grid-cols-[auto_1fr] gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-left transition hover:border-slate-350 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500"
            >
              <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${item.isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-650'}`}>
                {item.isDone && <Check size={12} />}
              </span>
              <span className="min-w-0">
                <span className={`block break-words text-xs font-bold ${item.isDone ? 'line-through opacity-60' : ''}`}>{item.content}</span>
                {item.isDone && (
                  <span className="mt-0.5 block text-[10px] text-slate-550 dark:text-slate-400 font-medium">
                    {doneBy?.name || 'Đã tick'} {item.doneAt ? `· ${formatTime(item.doneAt)}` : ''}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const QuickConfirmMessage: React.FC<{
  message: ChatV2Message;
  currentUser: User;
  isMine: boolean;
  onRespond: (message: ChatV2Message, optionId: string) => void;
}> = ({ message, currentUser, isMine, onRespond }) => {
  const options = Array.isArray(message.payload.options) ? message.payload.options : [];
  const title = message.payload.title || message.body || 'Xác nhận nhanh';
  const myResponse = message.quickConfirmResponses.find(response => response.userId === currentUser.id);
  return (
    <div className="min-w-[240px] space-y-2 text-slate-800 dark:text-[#dbdee1]">
      <div className="text-sm font-bold text-slate-900 dark:text-white">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option: { id: string; text: string }) => {
          const count = message.quickConfirmResponses.filter(response => response.optionId === option.id).length;
          const selected = myResponse?.optionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onRespond(message, option.id)}
              className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                selected
                  ? 'border-emerald-500 bg-emerald-500/25 text-emerald-600 dark:text-white'
                  : 'border-slate-200 bg-slate-100 hover:border-slate-350 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500'
              }`}
            >
              {option.text} · {count}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const MessageRenderer: React.FC<{
  message: ChatV2Message;
  currentUser: User;
  users: User[];
  isMine: boolean;
  onPollVote: (message: ChatV2Message, optionId: string) => void;
  onChecklistToggle: (item: ChatV2ChecklistItem, nextDone: boolean) => void;
  onQuickConfirm: (message: ChatV2Message, optionId: string) => void;
}> = ({ message, currentUser, users, isMine, onPollVote, onChecklistToggle, onQuickConfirm }) => {
  if (message.kind === 'poll') return <PollMessage message={message} currentUser={currentUser} isMine={isMine} onVote={onPollVote} />;
  if (message.kind === 'checklist') return <ChecklistMessage message={message} users={users} isMine={isMine} onToggle={onChecklistToggle} />;
  if (message.kind === 'quick_confirm') return <QuickConfirmMessage message={message} currentUser={currentUser} isMine={isMine} onRespond={onQuickConfirm} />;
  if (message.kind === 'image') return <ImageMessage message={message} />;
  if (message.kind === 'file') return <FileMessage message={message} />;
  return <TextMessage message={message} />;
};

const MessageRow: React.FC<{
  message: ChatV2Message;
  currentUser: User;
  users: User[];
  employees: any[];
  conversation: ChatV2Conversation;
  canDelete: boolean;
  onEdit: (message: ChatV2Message, body: string) => Promise<void>;
  onReaction: (message: ChatV2Message, emoji: string) => void;
  onRecall: (message: ChatV2Message) => void;
  onPollVote: (message: ChatV2Message, optionId: string) => void;
  onChecklistToggle: (item: ChatV2ChecklistItem, nextDone: boolean) => void;
  onQuickConfirm: (message: ChatV2Message, optionId: string) => void;
  onReply: (message: ChatV2Message) => void;
}> = ({
  message,
  currentUser,
  users,
  employees,
  conversation,
  canDelete,
  onEdit,
  onReaction,
  onRecall,
  onPollVote,
  onChecklistToggle,
  onQuickConfirm,
  onReply,
}) => {
  const sender = users.find(user => user.id === message.senderId);
  const isMine = message.senderId === currentUser.id;
  const [showTools, setShowTools] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const toolsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEditBody = message.kind === 'text' || message.kind === 'image' || message.kind === 'file';

  // Get username handle from sender's email or username
  const handle = sender?.username || sender?.email?.split('@')[0] || 'user';

  useEffect(() => {
    return () => {
      if (toolsHideTimerRef.current) clearTimeout(toolsHideTimerRef.current);
    };
  }, []);

  const showInlineTools = () => {
    if (toolsHideTimerRef.current) {
      clearTimeout(toolsHideTimerRef.current);
      toolsHideTimerRef.current = null;
    }
    setShowTools(true);
  };

  const scheduleHideInlineTools = () => {
    if (toolsHideTimerRef.current) clearTimeout(toolsHideTimerRef.current);
    toolsHideTimerRef.current = setTimeout(() => {
      setShowTools(false);
      toolsHideTimerRef.current = null;
    }, 240);
  };

  // Get readers for this message
  const readers = useMemo(() => {
    return conversation.participants
      .filter(p => p.lastReadMessageId === message.id && p.userId !== message.senderId)
      .map(p => users.find(u => u.id === p.userId))
      .filter(Boolean) as User[];
  }, [conversation.participants, message.id, message.senderId, users]);

  const submitEdit = async () => {
    const nextBody = editDraft.trim();
    if (!nextBody || savingEdit) return;
    setSavingEdit(true);
    try {
      await onEdit(message, nextBody);
      setIsEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  if (message.kind === 'system') {
    return (
      <div className="my-3 flex justify-center">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-bold text-slate-400 border border-slate-700/50">
          {message.body}
        </span>
      </div>
    );
  }

  if (message.deletedAt) {
    const deleterId = message.deletedBy || message.senderId;
    const deleterName = employees.find(e => e.userId === deleterId)?.fullName || sender?.name || 'Người dùng';
    return (
      <div className={`flex gap-3 my-2 px-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
        {!isMine && <Avatar user={sender} label={sender?.name} size="sm" />}
        <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} self-center`}>
          <span className="text-[11px] italic text-slate-500">
            {deleterName} đã xóa tin nhắn
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex gap-3 relative my-3 ${isMine ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={showInlineTools}
      onMouseLeave={scheduleHideInlineTools}
    >
      {!isMine && <Avatar user={sender} label={sender?.name} size="sm" />}
      <div className={`flex max-w-[85%] flex-col ${isMine ? 'items-end' : 'items-start'} sm:max-w-[75%]`}>
        {/* User Name & Handle */}
        {!isMine && (
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <span className="text-xs font-black text-slate-800 dark:text-white">{sender?.name || 'Người dùng'}</span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">@{handle}</span>
          </div>
        )}

        {/* Reply Preview Card inside Thread */}
        {message.replyPreview && (
          <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-900/40 px-2.5 py-1 text-[10px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 max-w-full">
            <span className="font-bold text-indigo-650 dark:text-indigo-400">@{message.replyPreview.senderName}:</span>
            <span className="truncate italic">{message.replyPreview.bodyPreview}</span>
          </div>
        )}

        <div className={`flex max-w-full items-center gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className="relative max-w-full">
            {/* Message bubble */}
            <div className={`relative min-w-0 rounded-2xl px-4 py-2.5 shadow-sm border transition-all ${
              isMine
                ? 'rounded-br-xs bg-gradient-to-r from-teal-700 to-teal-800 text-white border-teal-700/80 shadow-teal-900/10'
                : 'rounded-bl-xs border-zinc-200 dark:border-zinc-700/60 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-zinc-900/5'
            }`}>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editDraft}
                    onChange={event => setEditDraft(event.target.value)}
                    rows={2}
                    className={`w-full min-w-[220px] resize-none rounded-lg border px-3 py-2 text-sm font-semibold outline-none ${
                      isMine
                        ? 'border-white/30 bg-white/10 text-white placeholder:text-white/60'
                        : 'border-zinc-200 bg-white text-zinc-850 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500'
                    }`}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditDraft(message.body);
                        setIsEditing(false);
                      }}
                      title="Hủy sửa"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-current hover:bg-white/25"
                    >
                      <X size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={submitEdit}
                      title="Lưu"
                      disabled={savingEdit || !editDraft.trim()}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-current hover:bg-white/35 disabled:opacity-50"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <MessageRenderer
                  message={message}
                  currentUser={currentUser}
                  users={users}
                  isMine={isMine}
                  onPollVote={onPollVote}
                  onChecklistToggle={onChecklistToggle}
                  onQuickConfirm={onQuickConfirm}
                />
              )}

              {/* Timestamp & Status indicator inside bubble */}
              <div className={`mt-1 flex items-center justify-end gap-1 text-[9px] font-bold ${isMine ? 'text-teal-100/90' : 'text-zinc-500 dark:text-zinc-400'}`}>
                <span>{formatTime(message.createdAt)}</span>
                {message.editedAt && <span>· đã sửa</span>}
                {isMine && (
                  <span className="ml-0.5 inline-flex items-center">
                    {message.isOptimistic ? (
                      <span title="Đang gửi..."><Loader2 size={11} className="animate-spin text-teal-200" /></span>
                    ) : message.isFailed ? (
                      <span title="Gửi thất bại"><AlertCircle size={11} className="text-red-300" /></span>
                    ) : readers.length > 0 ? (
                      <span title={`Đã xem bởi ${readers.map(u => u.name).join(', ')}`}><CheckCheck size={12} className="text-emerald-300" /></span>
                    ) : (
                      <span title="Đã gửi đến máy chủ"><Check size={12} className="text-teal-200" /></span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Hover tools (absolute positioned) */}
            {showTools && !isEditing && (
              <div className={`absolute z-20 -top-3.5 ${isMine ? 'left-2' : 'right-2'} flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e1f22] p-0.5 shadow-lg`}>
                <div className="group/reaction relative flex">
                  <button
                    type="button"
                    title="Bày tỏ cảm xúc"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-550 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                  >
                    <Smile size={14} />
                  </button>
                  <div className={`pointer-events-none absolute bottom-full z-30 mb-1 flex gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e1f22] p-1 opacity-0 shadow-xl transition group-hover/reaction:pointer-events-auto group-hover/reaction:opacity-100 group-focus-within/reaction:pointer-events-auto group-focus-within/reaction:opacity-100 ${isMine ? 'left-0' : 'right-0'}`}>
                    {CHAT_V2_REACTION_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onReaction(message, emoji)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onReply(message)}
                  title="Trả lời"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-550 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                >
                  <CornerUpLeft size={14} />
                </button>
                {isMine && canEditBody && !isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(message.body);
                      setIsEditing(true);
                    }}
                    title="Sửa"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-550 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
                  >
                    <Edit3 size={14} />
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onRecall(message)}
                    title="Thu hồi"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-550 hover:bg-slate-100 hover:text-red-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {message.reactionSummary.length > 0 && (
          <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
            {message.reactionSummary.map(reaction => (
              <button
                key={reaction.emoji}
                type="button"
                onClick={() => onReaction(message, reaction.emoji)}
                className={`h-6 rounded-full border px-2 text-[10px] font-bold transition flex items-center gap-1 ${
                  reaction.reactedByMe
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-350 hover:text-slate-800 dark:border-slate-700 dark:bg-[#2b2d31] dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200'
                }`}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Read receipts list */}
        {readers.length > 0 && (
          <div className="flex -space-x-1 overflow-hidden mt-1 justify-end select-none">
            {readers.map(reader => (
              <div
                key={reader.id}
                title={`Đã đọc bởi ${reader.name}`}
                className="inline-block h-4 w-4 rounded-full ring-1 ring-[#313338] bg-slate-700 overflow-hidden"
              >
                {reader.avatar ? (
                  <img src={reader.avatar} alt={reader.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[7px] font-black bg-emerald-700 text-white">
                    {getUserInitials(reader.name)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const StructuredMessageModal: React.FC<{
  mode: Extract<ChatV2MessageKind, 'poll' | 'checklist' | 'quick_confirm'>;
  onClose: () => void;
  onSubmit: (input: { kind: ChatV2MessageKind; payload: Record<string, any>; checklistItems?: string[] }) => Promise<void>;
}> = ({ mode, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [optionsText, setOptionsText] = useState(mode === 'quick_confirm' ? 'Đã nhận\nĐồng ý\nTừ chối\nCần kiểm tra lại' : '');
  const [itemsText, setItemsText] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [saving, setSaving] = useState(false);

  const label = mode === 'poll' ? 'Bình chọn' : mode === 'checklist' ? 'Checklist' : 'Xác nhận nhanh';
  const submit = async () => {
    if (saving) return;
    const lines = (mode === 'checklist' ? itemsText : optionsText)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    if (!title.trim() || (mode === 'checklist' ? lines.length < 1 : lines.length < 2)) return;
    setSaving(true);
    try {
      if (mode === 'checklist') {
        await onSubmit({
          kind: 'checklist',
          payload: { title: title.trim() },
          checklistItems: lines,
        });
      } else {
        await onSubmit({
          kind: mode,
          payload: {
            title: title.trim(),
            question: mode === 'poll' ? title.trim() : undefined,
            multiple: mode === 'poll' ? multiple : false,
            anonymous: false,
            deadline: null,
            options: lines.map((text, index) => ({ id: `opt_${index + 1}`, text })),
          },
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#2b2d31] shadow-2xl">
        <div className="flex h-14 items-center justify-between border-b border-slate-700 px-4">
          <div className="text-sm font-black text-white">{label}</div>
          <button type="button" onClick={onClose} title="Đóng" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder={mode === 'poll' ? 'Câu hỏi' : 'Tiêu đề'}
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-white outline-none focus:border-indigo-500"
          />
          {mode === 'checklist' ? (
            <textarea
              value={itemsText}
              onChange={event => setItemsText(event.target.value)}
              rows={6}
              placeholder="Danh sách mục (mỗi dòng một mục)"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-indigo-500"
            />
          ) : (
            <textarea
              value={optionsText}
              onChange={event => setOptionsText(event.target.value)}
              rows={6}
              placeholder="Danh sách lựa chọn (mỗi dòng một lựa chọn)"
              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-indigo-500"
            />
          )}
          {mode === 'poll' && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-350 cursor-pointer">
              <input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} className="h-4 w-4 rounded border-slate-650 bg-slate-800 text-indigo-600 focus:ring-0" />
              Chọn nhiều đáp án
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-700 p-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-700 px-4 text-xs font-bold text-slate-300 transition hover:bg-slate-800">
            Hủy
          </button>
          <button type="button" onClick={submit} disabled={saving} className="h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
            Gửi
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageComposer: React.FC<{
  disabled: boolean;
  replyTo: ReplyDraft | null;
  onCancelReply: () => void;
  onSend: (body: string, files: File[]) => Promise<void>;
  onSendStructured: (input: { kind: ChatV2MessageKind; payload: Record<string, any>; checklistItems?: string[] }) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
}> = ({ disabled, replyTo, onCancelReply, onSend, onSendStructured, onTyping }) => {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [structuredMode, setStructuredMode] = useState<Extract<ChatV2MessageKind, 'poll' | 'checklist' | 'quick_confirm'> | null>(null);
  const [showStructuredMenu, setShowStructuredMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);

  const insertEmoji = (emoji: string) => {
    const start = selectionStart ?? body.length;
    const nextBody = body.slice(0, start) + emoji + body.slice(start);
    setBody(nextBody);
    setShowEmoji(false);
    onTyping(true);
    const caret = start + emoji.length;
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    }, 50);
  };

  const submit = async () => {
    if (sending || disabled) return;
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    try {
      await onSend(body, files);
      setBody('');
      setFiles([]);
      onCancelReply();
      onTyping(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-slate-200 dark:border-slate-850 bg-white dark:bg-[#313338] p-3">
      {replyTo && <ReplyQuote preview={replyTo} onClear={onCancelReply} />}
      {files.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 select-none">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex h-11 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-2">
              {file.type.startsWith('image/') ? <ImageIcon size={16} className="text-emerald-500" /> : <FileText size={16} className="text-slate-500" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{file.name}</div>
                <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{formatFileSize(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => setFiles(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
                title="Bỏ tệp"
                className="text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showEmoji && (
        <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 p-2 max-h-36 overflow-y-auto">
          {CHAT_V2_REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[auto_auto_auto_1fr_auto] items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={event => {
            const selected = Array.from(event.target.files || []);
            setFiles(prev => [...prev, ...selected].slice(0, 8));
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Đính kèm"
          disabled={disabled || sending}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-550 dark:hover:text-white disabled:opacity-50"
        >
          <Paperclip size={18} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowStructuredMenu(prev => !prev)}
            title="Tạo nội dung"
            disabled={disabled || sending}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-550 dark:hover:text-white disabled:opacity-50"
          >
            <Plus size={18} />
          </button>
          {showStructuredMenu && (
            <div className="absolute bottom-12 left-0 z-20 w-44 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 p-1 shadow-xl">
              {[
                { mode: 'poll' as const, label: 'Bình chọn', icon: BarChart3 },
                { mode: 'checklist' as const, label: 'Checklist', icon: ListChecks },
                { mode: 'quick_confirm' as const, label: 'Xác nhận nhanh', icon: BadgeCheck },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => {
                      setStructuredMode(item.mode);
                      setShowStructuredMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 transition hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <Icon size={15} /> {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowEmoji(prev => !prev)}
          title="Emoji"
          disabled={disabled || sending}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-550 dark:hover:text-white disabled:opacity-50"
        >
          <Smile size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={event => {
            setBody(event.target.value);
            setSelectionStart(event.target.selectionStart);
            onTyping(Boolean(event.target.value.trim()));
          }}
          onSelect={event => setSelectionStart(event.currentTarget.selectionStart)}
          onClick={event => setSelectionStart(event.currentTarget.selectionStart)}
          onKeyUp={event => setSelectionStart(event.currentTarget.selectionStart)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Gõ và nhấn Enter để gửi tin nhắn..."
          disabled={disabled || sending}
          className="max-h-32 min-h-11 resize-none rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 px-3.5 py-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          title="Gửi (Enter)"
          disabled={disabled || sending || (!body.trim() && files.length === 0)}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white shadow-md shadow-teal-600/20 active:scale-95 transition-all disabled:cursor-not-allowed disabled:bg-none disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
        >
          <Send size={18} />
        </button>
      </div>
      {structuredMode && (
        <StructuredMessageModal
          mode={structuredMode}
          onClose={() => setStructuredMode(null)}
          onSubmit={async input => {
            setSending(true);
            try {
              await onSendStructured(input);
            } finally {
              setSending(false);
            }
          }}
        />
      )}
    </div>
  );
};

const NewChatModal: React.FC<{
  currentUser: User;
  users: User[];
  onClose: () => void;
  onCreateDirect: (userId: string) => Promise<unknown>;
  onCreateGroup: (name: string, memberIds: string[]) => Promise<unknown>;
}> = ({ currentUser, users, onClose, onCreateDirect, onCreateGroup }) => {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);

  const availableUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return users
      .filter(user => user.id !== currentUser.id && user.isActive !== false)
      .filter(user => !keyword || `${user.name} ${user.email}`.toLowerCase().includes(keyword));
  }, [currentUser.id, search, users]);

  const submit = async () => {
    if (selectedIds.length === 0 || saving) return;
    setSaving(true);
    try {
      if (selectedIds.length === 1 && !groupName.trim()) {
        await onCreateDirect(selectedIds[0]);
      } else {
        await onCreateGroup(groupName || 'Nhóm mới', selectedIds);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#2b2d31] shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-700 px-4">
          <div className="text-sm font-black text-white">Tạo hội thoại</div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="shrink-0 space-y-3 border-b border-slate-700 p-4">
          <input
            value={groupName}
            onChange={event => setGroupName(event.target.value)}
            placeholder="Tên nhóm (bắt buộc nếu tạo nhóm)"
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-white outline-none focus:border-indigo-500"
          />
          <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-slate-400">
            <Search size={16} />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm người dùng"
              className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-500"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {availableUsers.map(user => {
            const checked = selectedIds.includes(user.id);
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  setSelectedIds(prev => checked ? prev.filter(id => id !== user.id) : [...prev, user.id]);
                }}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-800"
              >
                <Avatar user={user} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white">{user.name}</div>
                  <div className="truncate text-[10px] text-slate-400 font-medium">{user.email}</div>
                </div>
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-660 bg-slate-800'}`}>
                  {checked && <Check size={13} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-700 p-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-700 px-4 text-xs font-bold text-slate-300 transition hover:bg-slate-800"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={selectedIds.length === 0 || saving}
            className="h-10 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            Tạo
          </button>
        </div>
      </div>
    </div>
  );
};

const GroupSettingsModal: React.FC<{
  conversation: ChatV2Conversation;
  currentUser: User;
  users: User[];
  onClose: () => void;
  onUpdateName: (conversationId: string, name: string) => Promise<void>;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onAddMembers: (conversationId: string, memberIds: string[]) => Promise<void>;
  onRemoveMember: (conversationId: string, userId: string) => Promise<void>;
  onSetMemberRole: (conversationId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
}> = ({
  conversation,
  currentUser,
  users,
  onClose,
  onUpdateName,
  onDeleteConversation,
  onAddMembers,
  onRemoveMember,
  onSetMemberRole,
}) => {
  const [name, setName] = useState(conversation.name || '');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const canManage = canManageConversation(conversation, currentUser);
  const activeParticipantIds = new Set(conversation.participants.map(participant => participant.userId));
  const activeMembers = conversation.participants
    .map(participant => ({ participant, user: users.find(user => user.id === participant.userId) }))
    .sort((a, b) => {
      const roleRank = { owner: 0, admin: 1, member: 2 } as Record<string, number>;
      return (roleRank[a.participant.role] ?? 3) - (roleRank[b.participant.role] ?? 3);
    });
  const availableUsers = users
    .filter(user => user.isActive !== false && !activeParticipantIds.has(user.id))
    .filter(user => {
      const keyword = search.trim().toLowerCase();
      return !keyword || `${user.name} ${user.email}`.toLowerCase().includes(keyword);
    });

  const saveName = async () => {
    if (!canManage || conversation.type !== 'group' || saving) return;
    setSaving(true);
    try {
      await onUpdateName(conversation.id, name);
    } finally {
      setSaving(false);
    }
  };

  const addMembers = async () => {
    if (!canManage || selectedIds.length === 0 || saving) return;
    setSaving(true);
    try {
      await onAddMembers(conversation.id, selectedIds);
      setSelectedIds([]);
      setSearch('');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!canManage || conversation.type !== 'group') return;
    if (!window.confirm('Xóa nhóm này? Tin nhắn sẽ không còn hiển thị với thành viên.')) return;
    await onDeleteConversation(conversation.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#2b2d31] shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-700 px-4">
          <div className="text-sm font-black text-white">Quản lý hội thoại</div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          {conversation.type === 'group' && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/20 p-3">
              <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Tên nhóm</div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  disabled={!canManage}
                  className="h-10 min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-semibold text-white outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={saveName}
                  disabled={!canManage || saving || !name.trim() || name.trim() === (conversation.name || '').trim()}
                  className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500"
                >
                  <Check size={15} /> Lưu
                </button>
              </div>
            </div>
          )}

          {conversation.type === 'group' && canManage && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                <UserPlus size={14} /> Thêm thành viên
              </div>
              <div className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-slate-400">
                <Search size={16} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Tìm người dùng"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-550"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-700">
                {availableUsers.length === 0 ? (
                  <div className="p-3 text-xs font-bold text-slate-500">Không còn người dùng phù hợp</div>
                ) : (
                  availableUsers.map(user => {
                    const checked = selectedIds.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedIds(prev => checked ? prev.filter(id => id !== user.id) : [...prev, user.id])}
                        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-800"
                      >
                        <Avatar user={user} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-white">{user.name}</div>
                          <div className="truncate text-[10px] text-slate-400 font-medium">{user.email}</div>
                        </div>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-660 bg-slate-800'}`}>
                          {checked && <Check size={13} />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={addMembers}
                  disabled={selectedIds.length === 0 || saving}
                  className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500"
                >
                  <UserPlus size={15} /> Thêm
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-700">
            <div className="border-b border-slate-700 bg-slate-900/30 px-3 py-2 text-[10px] font-black uppercase text-slate-400">
              Thành viên ({activeMembers.length})
            </div>
            <div className="divide-y divide-slate-700 max-h-60 overflow-y-auto">
              {activeMembers.map(({ participant, user }) => {
                const isSelf = participant.userId === currentUser.id;
                const canChangeRole = canManage && conversation.type === 'group' && participant.role !== 'owner' && !isSelf;
                const canRemove = canManage && conversation.type === 'group' && participant.role !== 'owner' && !isSelf;
                return (
                  <div key={participant.userId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5">
                    <Avatar user={user} label={user?.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-bold text-white">{user?.name || 'Người dùng'}</span>
                        {participant.role === 'owner' && <Crown size={14} className="shrink-0 text-amber-500" />}
                        {participant.role === 'admin' && <Shield size={14} className="shrink-0 text-indigo-400" />}
                      </div>
                      <div className="truncate text-[10px] text-slate-400 font-medium">{user?.email || participant.userId}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canChangeRole && (
                        <button
                          type="button"
                          onClick={() => onSetMemberRole(conversation.id, participant.userId, participant.role === 'admin' ? 'member' : 'admin')}
                          className="flex h-8 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 text-[10px] font-bold text-slate-300 hover:border-slate-500 hover:text-white transition"
                        >
                          <Shield size={12} /> {participant.role === 'admin' ? 'Hạ quyền' : 'Quản trị'}
                        </button>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Loại ${user?.name || 'thành viên'} khỏi nhóm?`)) {
                              onRemoveMember(conversation.id, participant.userId);
                            }
                          }}
                          className="flex h-8 items-center gap-1 rounded-lg border border-red-900/50 bg-red-950/20 px-2 text-[10px] font-bold text-red-400 hover:bg-red-950/40 hover:text-red-300 transition"
                        >
                          <UserMinus size={12} /> Loại
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {conversation.type === 'group' && canManage && (
            <div className="mt-4 flex justify-end border-t border-slate-700 pt-4">
              <button
                type="button"
                onClick={deleteGroup}
                className="flex h-10 items-center gap-2 rounded-lg border border-red-900/50 bg-red-955/20 px-3 text-xs font-bold text-red-400 hover:bg-red-955/40 hover:text-red-300 transition"
              >
                <Trash2 size={15} /> Xóa nhóm
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ConversationList: React.FC<{
  conversations: ChatV2Conversation[];
  activeConversationId: string | null;
  currentUser: User;
  users: User[];
  employees: any[];
  onlineUserIds: Set<string>;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  loading: boolean;
  showGroupsOnly: boolean;
}> = ({
  conversations,
  activeConversationId,
  currentUser,
  users,
  employees,
  onlineUserIds,
  search,
  onSearch,
  onSelect,
  onNew,
  loading,
  showGroupsOnly,
}) => {
  const [collapsedPinned, setCollapsedPinned] = useState(false);
  const [collapsedRecent, setCollapsedRecent] = useState(false);

  // Helper to get display name
  const getUserDisplayName = (userId: string, fallbackName: string) => {
    const emp = employees.find(e => e.userId === userId);
    return emp?.fullName || fallbackName;
  };

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let result = conversations;

    if (showGroupsOnly) {
      result = result.filter(c => c.type === 'group');
    }

    if (!keyword) return result;

    return result.filter(conversation => {
      const title = getChatV2ConversationTitle(conversation, currentUser.id, users).toLowerCase();
      const memberNames = conversation.participants
        .map(participant => getUserDisplayName(participant.userId, users.find(user => user.id === participant.userId)?.name || ''))
        .join(' ')
        .toLowerCase();
      return title.includes(keyword) || memberNames.includes(keyword);
    });
  }, [conversations, currentUser.id, search, users, showGroupsOnly, employees]);

  // Split into Pinned (ĐÁNH DẤU) and Unpinned (GẦN ĐÂY)
  const pinnedConversations = useMemo(() => filtered.filter(c => c.currentParticipant?.isPinned), [filtered]);
  const recentConversations = useMemo(() => filtered.filter(c => !c.currentParticipant?.isPinned), [filtered]);

  // Logged in Employee Info
  const loggedEmployee = employees.find(e => e.userId === currentUser.id);
  const employeeName = loggedEmployee?.fullName || currentUser.name;
  const usernameHandle = currentUser.username || currentUser.email.split('@')[0];

  const renderConversationItem = (conversation: ChatV2Conversation) => {
    const rawTitle = getChatV2ConversationTitle(conversation, currentUser.id, users);
    // Resolve employee name for direct chat
    let title = rawTitle;
    if (conversation.type === 'direct') {
      const otherPart = conversation.participants.find(p => p.userId !== currentUser.id);
      if (otherPart) {
        title = getUserDisplayName(otherPart.userId, rawTitle);
      }
    }

    const otherParticipant = conversation.participants.find(participant => participant.userId !== currentUser.id);
    const otherUser = users.find(user => user.id === otherParticipant?.userId);
    const isOnline = conversation.type === 'direct' && Boolean(otherParticipant && onlineUserIds.has(otherParticipant.userId));
    const isActive = conversation.id === activeConversationId;

    // Last message sender resolved name
    let lastMsgPreview = conversation.lastMessagePreview;
    if (conversation.lastMessageSenderId && conversation.lastMessagePreview) {
      const senderName = conversation.lastMessageSenderId === currentUser.id
        ? 'Bạn'
        : getUserDisplayName(conversation.lastMessageSenderId, users.find(u => u.id === conversation.lastMessageSenderId)?.name || 'Ai đó');

      // If preview doesn't already start with the sender name, prefix it
      if (!conversation.lastMessagePreview.startsWith(senderName) && !conversation.lastMessagePreview.includes(':')) {
        lastMsgPreview = `${senderName}: ${conversation.lastMessagePreview}`;
      }
    }

    return (
      <button
        key={conversation.id}
        type="button"
        onClick={() => onSelect(conversation.id)}
        className={`grid w-full grid-cols-[auto_1fr_auto] gap-3 rounded-xl px-2.5 py-2.5 text-left transition-all select-none border-l-4 ${
          isActive
            ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200 font-bold border-teal-600 shadow-sm'
            : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
        }`}
      >
        {conversation.type === 'direct' ? (
          <Avatar user={otherUser} label={title} online={isOnline} size="sm" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white font-bold text-xs shadow-sm self-center">
            <Users size={14} />
          </div>
        )}
        <div className="min-w-0 self-center">
          <div className="flex min-w-0 items-center gap-1">
            {conversation.currentParticipant?.isPinned && <Pin size={11} className="shrink-0 text-teal-700 dark:text-teal-400" />}
            <span className="truncate text-xs font-extrabold">{title}</span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight">
            {lastMsgPreview || ' '}
          </div>
        </div>
        <div className="flex flex-col items-end justify-center gap-1 select-none">
          <span className="text-[9px] font-semibold text-zinc-400 dark:text-zinc-500">{formatTime(conversation.lastMessageAt || conversation.updatedAt)}</span>
          {conversation.unreadCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 text-white px-1.5 text-[8px] font-extrabold shadow-sm">
              {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <aside className="flex h-full w-full flex-col bg-slate-50 border-r border-slate-200 dark:bg-[#2b2d31] dark:border-[#1f2023]/60 w-[280px]">
      {/* Profile Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-[#1f2023]/60 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <Avatar size="sm" user={currentUser} label={employeeName} />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-slate-50 dark:border-[#2b2d31] bg-[#23a55a]" />
          </div>
          <div className="min-w-0 flex flex-col justify-center leading-tight">
            <div className="text-xs font-black text-slate-800 dark:text-white truncate max-w-[140px]">{employeeName}</div>
            <div className="text-[9px] font-semibold text-slate-500 dark:text-slate-400">@{usernameHandle}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onNew}
          title="Tạo cuộc hội thoại"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Search box */}
      <div className="p-3 shrink-0">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-slate-200/60 border border-slate-300/80 dark:bg-[#1e1f22] dark:border-none px-2.5 text-slate-500 dark:text-slate-400">
          <Search size={14} />
          <input
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Tìm kiếm (Ctrl + F)"
            className="h-full min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-850 dark:text-[#dbdee1] outline-none placeholder:text-slate-400 dark:placeholder:text-slate-550"
          />
        </div>
      </div>

      {/* Scrollable conversation Lists */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 space-y-4">
        {loading && conversations.length === 0 ? (
          <div className="space-y-2.5 pt-2">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-800/40 border border-slate-800/20" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center px-4 select-none">
            <MessageCircle size={28} className="mb-2 text-slate-650" />
            <div className="text-xs font-bold text-slate-550">Chưa có hội thoại</div>
          </div>
        ) : (
          <>
            {/* Pinned Bookmarked section */}
            {pinnedConversations.length > 0 && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setCollapsedPinned(!collapsedPinned)}
                  className="flex w-full items-center justify-between text-[10px] font-black uppercase text-slate-400 dark:text-slate-450 tracking-wider px-2 py-1 select-none hover:text-slate-900 dark:hover:text-white transition"
                >
                  <span>ĐÁNH DẤU ({pinnedConversations.length})</span>
                  <ChevronIcon direction={collapsedPinned ? 'right' : 'down'} size={11} />
                </button>
                {!collapsedPinned && (
                  <div className="space-y-0.5">
                    {pinnedConversations.map(renderConversationItem)}
                  </div>
                )}
              </div>
            )}

            {/* Recents section */}
            {recentConversations.length > 0 && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setCollapsedRecent(!collapsedRecent)}
                  className="flex w-full items-center justify-between text-[10px] font-black uppercase text-slate-400 dark:text-slate-450 tracking-wider px-2 py-1 select-none hover:text-slate-900 dark:hover:text-white transition"
                >
                  <span>GẦN ĐÂY ({recentConversations.length})</span>
                  <ChevronIcon direction={collapsedRecent ? 'right' : 'down'} size={11} />
                </button>
                {!collapsedRecent && (
                  <div className="space-y-0.5">
                    {recentConversations.map(renderConversationItem)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

const ChevronIcon: React.FC<{ direction: 'right' | 'down'; size?: number }> = ({ direction, size = 12 }) => {
  if (direction === 'right') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
};

const RightMediaSidebar: React.FC<{
  activeConversationId: string;
  activeTab: 'images' | 'docs' | 'links';
  setActiveTab: (tab: 'images' | 'docs' | 'links') => void;
  onClose: () => void;
  messages: ChatV2Message[];
}> = ({ activeConversationId, activeTab, setActiveTab, onClose, messages }) => {
  const [attachments, setAttachments] = useState<ChatV2Attachment[]>([]);
  const [links, setLinks] = useState<{ url: string; title: string; createdAt: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeConversationId) return;

    const loadAttachmentsAndLinks = async () => {
      setLoading(true);
      try {
        // Fetch attachments
        const { data: attRows, error: attError } = await supabase
          .from('chat_v2_attachments')
          .select('*')
          .eq('conversation_id', activeConversationId)
          .order('created_at', { ascending: false });

        if (attError) throw attError;

        // Sign URLs
        const signedAtts = await Promise.all((attRows || []).map(async (row) => {
          const attachment: ChatV2Attachment = {
            id: row.id,
            conversationId: row.conversation_id,
            messageId: row.message_id,
            uploadedBy: row.uploaded_by,
            storageBucket: row.storage_bucket,
            storagePath: row.storage_path,
            fileName: row.file_name,
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes),
            width: row.width,
            height: row.height,
            thumbnailPath: row.thumbnail_path,
          };
          const bucket = supabase.storage.from(attachment.storageBucket || CHAT_V2_ATTACHMENT_BUCKET);
          const { data: previewData } = await bucket.createSignedUrl(attachment.storagePath, 60 * 60);
          return { ...attachment, signedUrl: previewData?.signedUrl };
        }));

        setAttachments(signedAtts);

        // Fetch messages with links
        const { data: msgRows, error: msgError } = await supabase
          .from('chat_v2_messages')
          .select('body, created_at')
          .eq('conversation_id', activeConversationId)
          .is('deleted_at', null)
          .like('body', '%http%');

        if (msgError) throw msgError;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parsedLinks: typeof links = [];
        (msgRows || []).forEach(msg => {
          const urls = msg.body.match(urlRegex);
          if (urls) {
            urls.forEach((url: string) => {
              parsedLinks.push({
                url,
                title: new URL(url).hostname || 'Liên kết',
                createdAt: msg.created_at,
              });
            });
          }
        });
        setLinks(parsedLinks);
      } catch (err) {
        console.warn('Failed to load attachments or links:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAttachmentsAndLinks();
  }, [activeConversationId, messages.length]);

  // Filtering based on search query
  const filteredImages = useMemo(() => {
    return attachments
      .filter(isImageAttachment)
      .filter(att => !searchQuery || att.fileName.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [attachments, searchQuery]);

  const filteredDocs = useMemo(() => {
    return attachments
      .filter(att => !isImageAttachment(att))
      .filter(att => !searchQuery || att.fileName.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [attachments, searchQuery]);

  const filteredLinks = useMemo(() => {
    return links.filter(lnk => !searchQuery || lnk.url.toLowerCase().includes(searchQuery.toLowerCase()) || lnk.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [links, searchQuery]);

  return (
    <aside className="w-[300px] bg-slate-50 border-l border-slate-200 dark:bg-[#2b2d31] dark:border-[#1f2023] flex flex-col h-full shrink-0">
      {/* Tabs Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-[#1f2023]/60 px-3.5">
        <div className="flex items-center gap-1 w-full mr-2 bg-slate-200/50 dark:bg-[#1e1f22] p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('images')}
            className={`flex-1 py-1 text-[10px] font-black rounded-md tracking-wide select-none ${
              activeTab === 'images' ? 'bg-white text-slate-800 shadow dark:bg-[#35373c] dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Hình ảnh
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`flex-1 py-1 text-[10px] font-black rounded-md tracking-wide select-none ${
              activeTab === 'docs' ? 'bg-white text-slate-800 shadow dark:bg-[#35373c] dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tài liệu
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`flex-1 py-1 text-[10px] font-black rounded-md tracking-wide select-none ${
              activeTab === 'links' ? 'bg-white text-slate-800 shadow dark:bg-[#35373c] dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Liên kết
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Đóng sidebar"
          className="text-slate-500 hover:text-slate-800 flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-200 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-850 transition"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search Input inside sidebar */}
      <div className="p-3 shrink-0">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-slate-200/60 border border-slate-300 dark:bg-[#1e1f22] dark:border-none px-2 text-slate-550 dark:text-slate-400">
          <Search size={13} />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Nhập từ khóa và nhấn Enter"
            className="h-full min-w-0 flex-1 bg-transparent text-[11px] font-bold text-slate-850 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-550"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-3 pt-4 select-none">
            {[0, 1, 2].map(item => (
              <div key={item} className="h-20 animate-pulse rounded-lg bg-slate-800/40" />
            ))}
          </div>
        ) : activeTab === 'images' ? (
          filteredImages.length === 0 ? (
            <EmptyContent label="Không tìm thấy hình ảnh nào" />
          ) : (
            <div className="grid grid-cols-2 gap-2 select-none">
              {filteredImages.map(img => (
                <a
                  key={img.id}
                  href={img.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-850 group hover:border-slate-400 dark:hover:border-slate-500 transition"
                >
                  <img src={img.signedUrl} alt={img.fileName} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-end p-1.5 pointer-events-none">
                    <span className="text-[8px] text-white font-medium truncate w-full">{img.fileName}</span>
                  </div>
                </a>
              ))}
            </div>
          )
        ) : activeTab === 'docs' ? (
          filteredDocs.length === 0 ? (
            <EmptyContent label="Không tìm thấy tài liệu nào" />
          ) : (
            <div className="space-y-1.5">
              {filteredDocs.map(doc => (
                <a
                  key={doc.id}
                  href={doc.downloadUrl || doc.signedUrl}
                  download={doc.fileName}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 transition dark:hover:text-white"
                >
                  <FileText size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-bold">{doc.fileName}</div>
                    <div className="text-[9px] text-slate-500 font-medium">{formatFileSize(doc.sizeBytes)}</div>
                  </div>
                </a>
              ))}
            </div>
          )
        ) : (
          filteredLinks.length === 0 ? (
            <EmptyContent label="Không tìm thấy liên kết nào" />
          ) : (
            <div className="space-y-1.5">
              {filteredLinks.map((lnk, index) => (
                <a
                  key={index}
                  href={lnk.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-100 p-2 text-slate-700 hover:border-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 transition dark:hover:text-white"
                >
                  <LinkIcon size={14} className="shrink-0 text-slate-500 dark:text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{lnk.url}</div>
                    <div className="text-[9px] text-slate-500 font-medium truncate">{lnk.title}</div>
                  </div>
                </a>
              ))}
            </div>
          )
        )}
      </div>
    </aside>
  );
};

const EmptyContent: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex h-40 flex-col items-center justify-center text-center p-4">
    <FolderOpen size={24} className="mb-2 text-slate-600" />
    <span className="text-[10px] font-bold text-slate-550">{label}</span>
  </div>
);

const MessagePane: React.FC<{
  conversation: ChatV2Conversation | null;
  messages: ChatV2Message[];
  currentUser: User;
  users: User[];
  employees: any[];
  onlineUserIds: Set<string>;
  typingUsers: Array<{ userId: string; name: string; at: number }>;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  onBack: () => void;
  onSend: (body: string, files: File[], options?: { replyToMessageId?: string | null; replyPreview?: any | null; mentions?: any[] }) => Promise<void>;
  onSendStructured: (input: { kind: ChatV2MessageKind; payload: Record<string, any>; checklistItems?: string[] }) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onEditMessage: (message: ChatV2Message, body: string) => Promise<void>;
  onReaction: (message: ChatV2Message, emoji: string) => void;
  onPollVote: (message: ChatV2Message, optionId: string) => void;
  onChecklistToggle: (item: ChatV2ChecklistItem, nextDone: boolean) => void;
  onQuickConfirm: (message: ChatV2Message, optionId: string) => void;
  onRecall: (message: ChatV2Message) => void;
  onTogglePinned: (conversation: ChatV2Conversation) => void;
  onToggleMuted: (conversation: ChatV2Conversation) => void;
  onOpenSettings: () => void;
  // Side bar controls passed from shell
  showRightSidebar: boolean;
  setShowRightSidebar: (show: boolean) => void;
  setActiveRightTab: (tab: 'images' | 'docs' | 'links') => void;
}> = ({
  conversation,
  messages,
  currentUser,
  users,
  employees,
  onlineUserIds,
  typingUsers,
  loading,
  loadingOlder,
  hasMore,
  onBack,
  onSend,
  onSendStructured,
  onLoadOlder,
  onTyping,
  onEditMessage,
  onReaction,
  onPollVote,
  onChecklistToggle,
  onQuickConfirm,
  onRecall,
  onTogglePinned,
  onToggleMuted,
  onOpenSettings,
  showRightSidebar,
  setShowRightSidebar,
  setActiveRightTab,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousScrollRef = useRef<{ conversationId?: string; firstId?: string; length: number }>({ length: 0 });
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);
  const initialScrolledConversationRef = useRef<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyDraft | null>(null);

  // Dynamic statistics counts for message & files
  const [msgCount, setMsgCount] = useState(0);
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    if (!conversation?.id) return;
    const fetchCounts = async () => {
      try {
        const { count: mCount } = await supabase
          .from('chat_v2_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conversation.id)
          .is('deleted_at', null);

        setMsgCount(mCount || 0);

        const { count: fCount } = await supabase
          .from('chat_v2_attachments')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conversation.id);

        setFileCount(fCount || 0);
      } catch (e) {
        console.warn('Failed to query message/file counts:', e);
      }
    };
    fetchCounts();
  }, [conversation?.id, messages.length]);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const previous = previousScrollRef.current;
    const firstId = messages[0]?.id;
    const conversationChanged = previous.conversationId !== conversation?.id;
    const loadedFirstTime = previous.conversationId === conversation?.id && previous.length === 0 && messages.length > 0;
    const appendedAtBottom = previous.firstId === firstId && messages.length > previous.length;
    const olderSnapshot = olderScrollSnapshotRef.current;
    if (olderSnapshot && !conversationChanged) {
      scrollEl.scrollTop = scrollEl.scrollHeight - olderSnapshot.height + olderSnapshot.top;
      olderScrollSnapshotRef.current = null;
    } else if (conversationChanged || loadedFirstTime) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    } else if (appendedAtBottom) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    }
    previousScrollRef.current = { conversationId: conversation?.id, firstId, length: messages.length };
  }, [messages, conversation?.id]);

  useEffect(() => {
    setReplyingTo(null);
  }, [conversation?.id]);

  const loadOlderWithScrollLock = async () => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      olderScrollSnapshotRef.current = {
        height: scrollEl.scrollHeight,
        top: scrollEl.scrollTop,
      };
    }
    await onLoadOlder();
  };

  const handleReply = (message: ChatV2Message) => {
    const sender = users.find(user => user.id === message.senderId);
    // Resolve employee name
    const senderName = sender ? (employees.find(e => e.userId === sender.id)?.fullName || sender.name || sender.email) : 'Người dùng';
    setReplyingTo({
      messageId: message.id,
      senderId: message.senderId,
      senderName,
      bodyPreview: getMessageBodyPreview(message),
      kind: message.kind,
    });
  };

  const getMessageBodyPreview = (msg: ChatV2Message) => {
    if (msg.kind === 'image') return 'Đã chia sẻ 1 ảnh';
    if (msg.kind === 'file') return 'Đã đính kèm 1 tệp';
    if (msg.kind === 'poll') return `Bình chọn: ${msg.payload?.title || 'Câu hỏi'}`;
    if (msg.kind === 'checklist') return `Checklist: ${msg.payload?.title || 'Công việc'}`;
    if (msg.kind === 'quick_confirm') return `Xác nhận nhanh: ${msg.payload?.title || 'Tiêu đề'}`;
    return msg.body || 'Tin nhắn';
  };

  if (!conversation) {
    return (
      <section className="hidden h-full min-w-0 flex-1 items-center justify-center bg-[#313338] lg:flex border-r border-[#1f2023]/60">
        <div className="text-center select-none">
          <MessageCircle size={38} className="mx-auto mb-3 text-slate-650" />
          <div className="text-xs font-black text-slate-500">Chọn một cuộc trò chuyện để bắt đầu</div>
        </div>
      </section>
    );
  }

  // Resolve title
  const rawTitle = getChatV2ConversationTitle(conversation, currentUser.id, users);
  let title = rawTitle;
  if (conversation.type === 'direct') {
    const otherPart = conversation.participants.find(p => p.userId !== currentUser.id);
    if (otherPart) {
      const emp = employees.find(e => e.userId === otherPart.userId);
      title = emp?.fullName || rawTitle;
    }
  }

  const otherParticipant = conversation.participants.find(participant => participant.userId !== currentUser.id);
  const otherUser = users.find(user => user.id === otherParticipant?.userId);
  const isDirectOnline = conversation.type === 'direct' && Boolean(otherParticipant && onlineUserIds.has(otherParticipant.userId));
  const typingLabel = typingUsers.length > 0 ? `${typingUsers.map(user => user.name).join(', ')} đang nhập...` : '';
  const canManage = canManageConversation(conversation, currentUser);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#313338] border-r border-slate-200 dark:border-[#1f2023]/60">
      {/* Chat header */}
      <header className="flex h-16 shrink-0 flex-col justify-center border-b border-slate-200 dark:border-[#1f2023]/60 bg-white dark:bg-[#313338] px-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              title="Quay lại"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
            >
              <ArrowLeft size={18} />
            </button>
            {conversation.type === 'direct' ? (
              <Avatar user={otherUser} label={title} online={isDirectOnline} size="sm" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-550 dark:text-slate-350 self-center">
                <Users size={14} />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-xs font-black text-slate-850 dark:text-white">{title}</div>
                {conversation.type === 'direct' && (
                  <span className={`h-2 w-2 rounded-full ${isDirectOnline ? 'bg-[#23a55a]' : 'bg-slate-500'}`} />
                )}
              </div>
              <div className="truncate text-[9px] font-bold text-slate-500 dark:text-slate-400 leading-none mt-1">
                {typingLabel || (
                  <span className="flex items-center gap-2 select-none">
                    <span className="hover:text-slate-850 dark:hover:text-white cursor-pointer transition">💬 Trò chuyện</span>
                    <span>·</span>
                    <span className="hover:text-slate-850 dark:hover:text-white cursor-pointer transition">👥 {conversation.participants.length} thành viên</span>
                    <span>·</span>
                    <span className="hover:text-slate-850 dark:hover:text-white cursor-pointer transition">📩 {msgCount} tin nhắn</span>
                    <span>·</span>
                    <span className="hover:text-slate-850 dark:hover:text-white cursor-pointer transition" onClick={() => { setShowRightSidebar(true); setActiveRightTab('images'); }}>📁 {fileCount} file</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action triggers */}
          <div className="flex items-center gap-1.5 select-none">
            {/* Phone/Call shortcut */}
            <button
              type="button"
              title="Gọi điện"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition"
            >
              <Phone size={14} />
            </button>
            <button
              type="button"
              onClick={() => onTogglePinned(conversation)}
              title={conversation.currentParticipant?.isPinned ? 'Bỏ ghim' : 'Ghim'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {conversation.currentParticipant?.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button
              type="button"
              onClick={() => onToggleMuted(conversation)}
              title={conversation.currentParticipant?.isMuted ? 'Bật thông báo' : 'Tắt thông báo'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {conversation.currentParticipant?.isMuted ? <BellOff size={15} /> : <Bell size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setShowRightSidebar(!showRightSidebar)}
              title="Hình ảnh & Tệp đính kèm"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                showRightSidebar ? 'bg-slate-200 text-slate-800 dark:bg-[#35373c] dark:text-white' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
            >
              <FolderOpen size={15} />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              title="Cấu hình nhóm"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Messages scrolling */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {loading && messages.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className={`h-11 animate-pulse rounded-2xl bg-slate-800/40 border border-slate-800/20 ${item % 2 ? 'ml-auto w-1/2' : 'w-2/3'}`} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center select-none animate-fade-in">
            <div>
              <Heart size={30} className="mx-auto mb-2 text-slate-650" />
              <div className="text-xs font-bold text-slate-500">Bắt đầu cuộc trò chuyện ngày hôm nay</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {hasMore && (
              <div className="flex justify-center select-none pt-1">
                <button
                  type="button"
                  onClick={loadOlderWithScrollLock}
                  disabled={loadingOlder}
                  className="flex h-7 items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 text-[10px] font-bold text-slate-300 hover:border-slate-500 hover:bg-slate-750 disabled:opacity-50 transition"
                >
                  <ChevronUp size={13} /> {loadingOlder ? 'Đang tải...' : 'Tải tin nhắn cũ hơn'}
                </button>
              </div>
            )}
            {messages.map(message => (
              <MessageRow
                key={message.id}
                message={message}
                currentUser={currentUser}
                users={users}
                employees={employees}
                conversation={conversation}
                canDelete={message.senderId === currentUser.id || canManage}
                onEdit={onEditMessage}
                onReaction={onReaction}
                onPollVote={onPollVote}
                onChecklistToggle={onChecklistToggle}
                onQuickConfirm={onQuickConfirm}
                onRecall={onRecall}
                onReply={handleReply}
              />
            ))}
          </div>
        )}
      </div>

      <MessageComposer
        disabled={!conversation}
        replyTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSend={(body, fFiles) => onSend(body, fFiles, { replyToMessageId: replyingTo?.messageId || null, replyPreview: replyingTo })}
        onSendStructured={onSendStructured}
        onTyping={onTyping}
      />
    </section>
  );
};

const ChatShell: React.FC<ChatShellProps> = ({ currentUser, users }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showListOnMobile, setShowListOnMobile] = useState(true);

  // Layout Sidebars Custom States
  const [showGroupsOnly, setShowGroupsOnly] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<'images' | 'docs' | 'links'>('images');

  const { employees } = useApp();
  const chat = useChatV2(currentUser, users);
  const selectedFromUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const conversationId = searchParams.get('conversation');
    if (!conversationId || selectedFromUrlRef.current === conversationId || chat.activeConversationId === conversationId) return;
    selectedFromUrlRef.current = conversationId;
    chat.selectConversation(conversationId);
    setShowListOnMobile(false);
  }, [chat, searchParams]);

  const handleSelect = async (conversationId: string) => {
    await chat.selectConversation(conversationId);
    setSearchParams({ conversation: conversationId });
    setShowListOnMobile(false);
  };

  // Get total unread count
  const totalUnreadCount = useChatV2UnreadCount(currentUser?.id);

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-[#1e1f22] text-slate-800 dark:text-[#dbdee1] flex">
      {/* Column 1: Mini Sidebar (60px) */}
      <div className="w-[60px] bg-slate-100 dark:bg-[#1e1f22] flex flex-col items-center py-4 border-r border-slate-200 dark:border-[#111214]/65 justify-between shrink-0 select-none">
        <div className="flex flex-col items-center gap-5 w-full">
          {/* Logo */}
          <div className="w-10 h-10 rounded-2xl bg-indigo-650 flex items-center justify-center text-white font-black text-sm shadow-md shadow-indigo-500/10 cursor-pointer hover:rounded-xl transition-all">
            KT
          </div>

          {/* Unread badge message trigger */}
          <button
            type="button"
            onClick={() => setShowGroupsOnly(false)}
            title="Tất cả tin nhắn"
            className="w-10 h-10 rounded-full bg-slate-200 hover:bg-slate-300 dark:bg-[#313338] dark:hover:bg-[#35373c] flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition relative hover:rounded-xl group"
          >
            <MessageSquare size={18} />
            {totalUnreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-black text-white ring-1 ring-red-400">
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </span>
            )}
            <span className="absolute left-[66px] bg-slate-900 border border-slate-755 text-white text-[9px] font-bold py-1 px-2 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50">
              Tất cả tin nhắn
            </span>
          </button>

          {/* Group list toggle filter */}
          <button
            type="button"
            onClick={() => setShowGroupsOnly(!showGroupsOnly)}
            title="Nhóm chat"
            className={`w-10 h-10 rounded-full flex items-center justify-center transition relative hover:rounded-xl group ${
              showGroupsOnly ? 'bg-indigo-500 text-white rounded-xl' : 'bg-slate-200 hover:bg-slate-300 dark:bg-[#313338] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#35373c] dark:hover:text-white'
            }`}
          >
            <Users size={18} />
            <span className="absolute left-[66px] bg-slate-900 border border-slate-755 text-white text-[9px] font-bold py-1 px-2 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50">
              Chỉ hiện nhóm chat
            </span>
          </button>
        </div>

        {/* Column 1 bottom actions */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* New Chat Modal (+) */}
          <button
            type="button"
            onClick={() => setShowNewChat(true)}
            title="Tạo hội thoại mới"
            className="w-10 h-10 rounded-full bg-emerald-600/10 hover:bg-emerald-600 hover:text-white flex items-center justify-center text-emerald-400 transition hover:rounded-xl group"
          >
            <Plus size={18} />
            <span className="absolute left-[66px] bg-slate-900 border border-slate-700 text-white text-[9px] font-bold py-1 px-2 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50">
              Tạo hội thoại mới
            </span>
          </button>
        </div>
      </div>

      {/* Main columns container */}
      <div className="flex h-full min-w-0 flex-1">
        {/* Column 2: Conversation sidebar */}
        <div className={`${showListOnMobile ? 'block' : 'hidden'} h-full w-full lg:block lg:w-auto shrink-0`}>
          <ConversationList
            conversations={chat.conversations}
            activeConversationId={chat.activeConversationId}
            currentUser={currentUser}
            users={users}
            employees={employees}
            onlineUserIds={chat.onlineUserIds}
            search={search}
            onSearch={setSearch}
            onSelect={handleSelect}
            onNew={() => setShowNewChat(true)}
            loading={chat.isLoadingConversations}
            showGroupsOnly={showGroupsOnly}
          />
        </div>

        {/* Column 3: Message pane (Central view) */}
        <div className={`${showListOnMobile ? 'hidden' : 'block'} h-full min-w-0 flex-1 lg:block`}>
          <MessagePane
            conversation={chat.activeConversation}
            messages={chat.messages}
            currentUser={currentUser}
            users={users}
            employees={employees}
            onlineUserIds={chat.onlineUserIds}
            typingUsers={chat.typingUsers}
            loading={chat.isLoadingMessages}
            loadingOlder={chat.isLoadingOlderMessages}
            hasMore={chat.hasMoreMessages}
            onBack={() => setShowListOnMobile(true)}
            onSend={chat.sendMessage}
            onSendStructured={chat.sendStructuredMessage}
            onLoadOlder={chat.loadOlderMessages}
            onTyping={chat.setTyping}
            onEditMessage={chat.editMessage}
            onReaction={chat.toggleReaction}
            onPollVote={chat.votePoll}
            onChecklistToggle={chat.toggleChecklistItem}
            onQuickConfirm={chat.respondQuickConfirm}
            onRecall={chat.recallMessage}
            onTogglePinned={chat.togglePinned}
            onToggleMuted={chat.toggleMuted}
            onOpenSettings={() => setShowSettings(true)}
            showRightSidebar={showRightSidebar && chat.activeConversation !== null}
            setShowRightSidebar={setShowRightSidebar}
            setActiveRightTab={setActiveRightTab}
          />
        </div>

        {/* Column 4: Right Media Sidebar (Images/Docs/Links) */}
        {showRightSidebar && chat.activeConversation && (
          <div className="hidden lg:block h-full">
            <RightMediaSidebar
              activeConversationId={chat.activeConversationId || ''}
              activeTab={activeRightTab}
              setActiveTab={setActiveRightTab}
              onClose={() => setShowRightSidebar(false)}
              messages={chat.messages}
            />
          </div>
        )}
      </div>

      {chat.error && (
        <div className="fixed bottom-5 left-1/2 z-[130] -translate-x-1/2 rounded-lg border border-red-900 bg-red-950/90 px-4 py-2 text-xs font-bold text-red-200 shadow-xl backdrop-blur">
          {chat.error}
        </div>
      )}

      {showNewChat && (
        <NewChatModal
          currentUser={currentUser}
          users={users}
          onClose={() => setShowNewChat(false)}
          onCreateDirect={chat.createDirectConversation}
          onCreateGroup={chat.createGroupConversation}
        />
      )}

      {showSettings && chat.activeConversation && (
        <GroupSettingsModal
          conversation={chat.activeConversation}
          currentUser={currentUser}
          users={users}
          onClose={() => setShowSettings(false)}
          onUpdateName={chat.updateGroupName}
          onDeleteConversation={chat.deleteConversation}
          onAddMembers={chat.addGroupMembers}
          onRemoveMember={chat.removeGroupMember}
          onSetMemberRole={chat.setGroupMemberRole}
        />
      )}
    </div>
  );
};

export default ChatShell;
