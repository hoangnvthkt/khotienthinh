import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Bell,
  BellOff,
  Check,
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
} from 'lucide-react';
import type { User } from '../../types';
import { useChatV2 } from '../../hooks/useChatV2';
import {
  CHAT_V2_REACTION_EMOJIS,
  buildChatV2MessagePreview,
  ChatV2Attachment,
  ChatV2ChecklistItem,
  ChatV2Conversation,
  ChatV2Mention,
  ChatV2Message,
  ChatV2MessageKind,
  ChatV2ReplyPreview,
  formatFileSize,
  getChatV2ConversationTitle,
  getUserInitials,
  insertChatV2Mention,
  isImageAttachment,
} from '../../lib/chatV2Service';
import { canAccessRoute } from '../../lib/routeAccess';

interface ChatShellProps {
  currentUser: User;
  users: User[];
}

type ChatV2SendOptions = {
  replyToMessageId?: string | null;
  replyPreview?: ChatV2ReplyPreview | null;
  mentions?: ChatV2Mention[];
};

type ReplyDraft = {
  messageId: string;
  senderId: string;
  senderName: string;
  bodyPreview: string;
  kind: ChatV2MessageKind;
};

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};

const canManageConversation = (conversation: ChatV2Conversation | null | undefined, currentUser: User): boolean => {
  if (!conversation) return false;
  if (String(currentUser.role) === 'ADMIN') return true;
  return conversation.currentParticipant?.role === 'owner' || conversation.currentParticipant?.role === 'admin';
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ReplyQuote: React.FC<{ preview: ChatV2ReplyPreview | ReplyDraft | null; isMine?: boolean; onClear?: () => void }> = ({
  preview,
  isMine = false,
  onClear,
}) => {
  if (!preview) return null;
  return (
    <div className={`mb-2 grid grid-cols-[1fr_auto] items-start gap-2 rounded-lg border-l-2 px-2 py-1.5 text-xs ${
      isMine
        ? 'border-white/60 bg-white/15 text-white/90'
        : 'border-emerald-400 bg-emerald-50 text-slate-700 dark:bg-emerald-950/40 dark:text-slate-200'
    }`}>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black">{preview.senderName}</div>
        <div className={`truncate text-[11px] font-semibold ${isMine ? 'text-white/75' : 'text-slate-500 dark:text-slate-400'}`}>
          {preview.bodyPreview || buildChatV2MessagePreview(preview.kind, '', {})}
        </div>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          title="Bỏ trích dẫn"
          aria-label="Bỏ trích dẫn"
          className="flex h-6 w-6 items-center justify-center rounded-md text-current opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};

const MessageText: React.FC<{ body: string; mentions: ChatV2Mention[] }> = ({ body, mentions }) => {
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
      <span key={`${match[0]}-${match.index}`} className="rounded bg-amber-200/80 px-1 font-black text-amber-900 dark:bg-amber-500/25 dark:text-amber-100">
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
    <div className={`relative ${dims} shrink-0 overflow-hidden rounded-full bg-emerald-600 text-white shadow-sm`}>
      {user?.avatar ? (
        <img src={user.avatar} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-black">{getUserInitials(name)}</div>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-950" />
      )}
    </div>
  );
};

const ConversationList: React.FC<{
  conversations: ChatV2Conversation[];
  activeConversationId: string | null;
  currentUser: User;
  users: User[];
  onlineUserIds: Set<string>;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  loading: boolean;
}> = ({
  conversations,
  activeConversationId,
  currentUser,
  users,
  onlineUserIds,
  search,
  onSearch,
  onSelect,
  onNew,
  loading,
}) => {
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter(conversation => {
      const title = getChatV2ConversationTitle(conversation, currentUser.id, users).toLowerCase();
      const memberNames = conversation.participants
        .map(participant => users.find(user => user.id === participant.userId)?.name || '')
        .join(' ')
        .toLowerCase();
      return title.includes(keyword) || memberNames.includes(keyword);
    });
  }, [conversations, currentUser.id, search, users]);

  return (
    <aside className="flex h-full w-full flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:w-[340px]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <MessageCircle size={20} className="text-emerald-600" />
          <div>
            <div className="text-sm font-black text-slate-900 dark:text-white">Tin nhắn</div>
            <div className="text-[11px] font-semibold text-slate-500">{conversations.length} hội thoại</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onNew}
          title="Tạo hội thoại"
          aria-label="Tạo hội thoại"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <Search size={16} />
          <input
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder="Tìm kiếm"
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <MessageCircle size={32} className="mb-3 text-slate-300" />
            <div className="text-sm font-black text-slate-700 dark:text-slate-200">Chưa có hội thoại</div>
          </div>
        ) : (
          <div className="p-2">
            {filtered.map(conversation => {
              const title = getChatV2ConversationTitle(conversation, currentUser.id, users);
              const otherParticipant = conversation.participants.find(participant => participant.userId !== currentUser.id);
              const otherUser = users.find(user => user.id === otherParticipant?.userId);
              const isOnline = conversation.type === 'direct' && Boolean(otherParticipant && onlineUserIds.has(otherParticipant.userId));
              const isActive = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`grid w-full grid-cols-[auto_1fr_auto] gap-3 rounded-lg px-3 py-3 text-left transition ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-white dark:ring-emerald-900'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
                >
                  {conversation.type === 'direct' ? (
                    <Avatar user={otherUser} label={title} online={isOnline} />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white dark:bg-slate-700">
                      <Users size={17} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {conversation.currentParticipant?.isPinned && <Pin size={12} className="shrink-0 text-amber-500" />}
                      <span className="truncate text-sm font-black">{title}</span>
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-500">
                      {conversation.lastMessagePreview || ' '}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-[10px] font-bold text-slate-400">{formatTime(conversation.lastMessageAt || conversation.updatedAt)}</span>
                    {conversation.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white">
                        {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};

const AttachmentView: React.FC<{ attachment: ChatV2Attachment }> = ({ attachment }) => {
  const href = attachment.signedUrl || '#';
  const downloadHref = attachment.downloadUrl || attachment.signedUrl || '#';
  if (isImageAttachment(attachment) && attachment.signedUrl) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
        <img src={attachment.signedUrl} alt={attachment.fileName} className="max-h-72 w-full object-cover" loading="lazy" />
      </a>
    );
  }

  return (
    <a
      href={downloadHref}
      download={attachment.fileName}
      rel="noreferrer"
      className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-900">
        <FileText size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-black">{attachment.fileName}</div>
        <div className="text-[10px] font-bold text-slate-400">{formatFileSize(attachment.sizeBytes)}</div>
      </div>
      <Download size={16} className="shrink-0" />
    </a>
  );
};

const TextMessage: React.FC<{ message: ChatV2Message }> = ({ message }) => (
  <>
    {message.body && <MessageText body={message.body} mentions={message.mentions} />}
    {message.attachments.length > 0 && (
      <div className={`mt-2 grid gap-2 ${message.attachments.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {message.attachments.map(attachment => <AttachmentView key={attachment.id} attachment={attachment} />)}
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
    <div className="min-w-[240px] space-y-2">
      <div className="text-sm font-black">{question}</div>
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
                  ? isMine ? 'border-white/50 bg-white/15' : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100'
                  : isMine ? 'border-white/20 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-slate-50 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-xs font-black">
                <span className="min-w-0 break-words">{option.text}</span>
                <span className="shrink-0">{count} · {pct}%</span>
              </div>
              <div className={`mt-1 h-1.5 overflow-hidden rounded-full ${isMine ? 'bg-white/15' : 'bg-slate-200 dark:bg-slate-800'}`}>
                <div className={`h-full rounded-full ${isMine ? 'bg-white/70' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      {message.payload.multiple && <div className={`text-[10px] font-bold ${isMine ? 'text-emerald-100' : 'text-slate-400'}`}>Cho phép chọn nhiều đáp án</div>}
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
    <div className="min-w-[240px] space-y-2">
      <div className="text-sm font-black">{title}</div>
      <div className="space-y-1.5">
        {message.checklistItems.map(item => {
          const doneBy = users.find(user => user.id === item.doneBy);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item, !item.isDone)}
              className={`grid w-full grid-cols-[auto_1fr] gap-2 rounded-lg border px-3 py-2 text-left transition ${
                isMine ? 'border-white/20 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-slate-50 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border ${item.isDone ? 'border-emerald-500 bg-emerald-500 text-white' : isMine ? 'border-white/50' : 'border-slate-300 dark:border-slate-700'}`}>
                {item.isDone && <Check size={12} />}
              </span>
              <span className="min-w-0">
                <span className={`block break-words text-xs font-black ${item.isDone ? 'line-through opacity-70' : ''}`}>{item.content}</span>
                {item.isDone && (
                  <span className={`mt-0.5 block text-[10px] font-bold ${isMine ? 'text-emerald-100' : 'text-slate-400'}`}>
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
    <div className="min-w-[240px] space-y-2">
      <div className="text-sm font-black">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option: { id: string; text: string }) => {
          const count = message.quickConfirmResponses.filter(response => response.optionId === option.id).length;
          const selected = myResponse?.optionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onRespond(message, option.id)}
              className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                selected
                  ? isMine ? 'border-white/60 bg-white/20' : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100'
                  : isMine ? 'border-white/20 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-slate-50 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900'
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
  canDelete: boolean;
  onEdit: (message: ChatV2Message, body: string) => Promise<void>;
  onReaction: (message: ChatV2Message, emoji: string) => void;
  onReply: (message: ChatV2Message) => void;
  onRecall: (message: ChatV2Message) => void;
  onPollVote: (message: ChatV2Message, optionId: string) => void;
  onChecklistToggle: (item: ChatV2ChecklistItem, nextDone: boolean) => void;
  onQuickConfirm: (message: ChatV2Message, optionId: string) => void;
}> = ({ message, currentUser, users, canDelete, onEdit, onReaction, onReply, onRecall, onPollVote, onChecklistToggle, onQuickConfirm }) => {
  const sender = users.find(user => user.id === message.senderId);
  const isMine = message.senderId === currentUser.id;
  const [showTools, setShowTools] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const canEditBody = message.kind === 'text' || message.kind === 'image' || message.kind === 'file';

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
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          {message.body}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`group flex gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowTools(true)}
      onMouseLeave={() => {
        setShowTools(false);
        setShowReactionPicker(false);
      }}
    >
      {!isMine && <Avatar user={sender} label={sender?.name} size="sm" />}
      <div className={`flex max-w-[82%] flex-col ${isMine ? 'items-end' : 'items-start'} sm:max-w-[70%]`}>
        {!isMine && <div className="mb-1 px-1 text-[11px] font-black text-slate-500">{sender?.name || 'Người dùng'}</div>}
        <div className={`relative rounded-2xl px-3 py-2 shadow-sm ${
          isMine
            ? 'rounded-br-md bg-emerald-600 text-white'
            : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100'
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
                    : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white'
                }`}
              />
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(message.body);
                    setIsEditing(false);
                  }}
                  title="Hủy sửa"
                  aria-label="Hủy sửa"
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-current hover:bg-white/20"
                >
                  <X size={14} />
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  title="Lưu"
                  aria-label="Lưu"
                  disabled={savingEdit || !editDraft.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-current hover:bg-white/30 disabled:opacity-50"
                >
                  <Check size={14} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <ReplyQuote preview={message.replyPreview} isMine={isMine} />
              <MessageRenderer
                message={message}
                currentUser={currentUser}
                users={users}
                isMine={isMine}
                onPollVote={onPollVote}
                onChecklistToggle={onChecklistToggle}
                onQuickConfirm={onQuickConfirm}
              />
            </>
          )}
          <div className={`mt-1 text-right text-[10px] font-bold ${isMine ? 'text-emerald-100' : 'text-slate-400'}`}>
            {formatTime(message.createdAt)} {message.editedAt ? '· đã sửa' : ''}
          </div>
        </div>

        <div className={`mt-1 flex flex-wrap items-center gap-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
          {message.reactionSummary.map(reaction => (
            <button
              key={reaction.emoji}
              type="button"
              onClick={() => onReaction(message, reaction.emoji)}
              className={`h-7 rounded-full border px-2 text-xs font-black transition ${
                reaction.reactedByMe
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
              }`}
            >
              {reaction.emoji} {reaction.count}
            </button>
          ))}
          {showTools && (
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReactionPicker(prev => !prev)}
                  title="Bày tỏ cảm xúc"
                  aria-label="Bày tỏ cảm xúc"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-900"
                >
                  <Smile size={13} />
                </button>
                {showReactionPicker && (
                  <div className={`absolute bottom-8 z-30 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-950 ${isMine ? 'right-0' : 'left-0'}`}>
                    {CHAT_V2_REACTION_EMOJIS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onReaction(message, emoji);
                          setShowReactionPicker(false);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-sm transition hover:bg-slate-100 dark:hover:bg-slate-900"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onReply(message)}
                title="Trả lời"
                aria-label="Trả lời"
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-900"
              >
                <CornerUpLeft size={13} />
              </button>
              {isMine && canEditBody && !isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(message.body);
                    setIsEditing(true);
                  }}
                  title="Sửa"
                  aria-label="Sửa"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-900"
                >
                  <Edit3 size={13} />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => onRecall(message)}
                  title="Xóa"
                  aria-label="Xóa"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
        </div>
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
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="text-sm font-black text-slate-900 dark:text-white">{label}</div>
          <button type="button" onClick={onClose} title="Đóng" aria-label="Đóng" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder={mode === 'poll' ? 'Câu hỏi' : 'Tiêu đề'}
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
          {mode === 'checklist' ? (
            <textarea
              value={itemsText}
              onChange={event => setItemsText(event.target.value)}
              rows={6}
              placeholder="Danh sách mục"
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          ) : (
            <textarea
              value={optionsText}
              onChange={event => setOptionsText(event.target.value)}
              rows={6}
              placeholder="Danh sách lựa chọn"
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          )}
          {mode === 'poll' && (
            <label className="flex items-center gap-2 text-xs font-black text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              Chọn nhiều đáp án
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-slate-200 px-4 text-xs font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900">
            Hủy
          </button>
          <button type="button" onClick={submit} disabled={saving} className="h-10 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white transition hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800">
            Gửi
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageComposer: React.FC<{
  disabled: boolean;
  currentUser: User;
  conversation: ChatV2Conversation | null;
  users: User[];
  replyTo: ReplyDraft | null;
  onCancelReply: () => void;
  onSend: (body: string, files: File[], options?: ChatV2SendOptions) => Promise<void>;
  onSendStructured: (input: { kind: ChatV2MessageKind; payload: Record<string, any>; checklistItems?: string[] }) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
}> = ({ disabled, currentUser, conversation, users, replyTo, onCancelReply, onSend, onSendStructured, onTyping }) => {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [mentions, setMentions] = useState<ChatV2Mention[]>([]);
  const [selectionStart, setSelectionStart] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [structuredMode, setStructuredMode] = useState<Extract<ChatV2MessageKind, 'poll' | 'checklist' | 'quick_confirm'> | null>(null);
  const [showStructuredMenu, setShowStructuredMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionableUsers = useMemo(() => {
    const participantIds = new Set((conversation?.participants || [])
      .map(participant => participant.userId)
      .filter(userId => userId !== currentUser.id));
    return users
      .filter(user => participantIds.has(user.id) && user.isActive !== false)
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', 'vi'));
  }, [conversation?.participants, currentUser.id, users]);

  const mentionContext = useMemo(() => {
    const cursor = Math.max(0, Math.min(selectionStart, body.length));
    const atIndex = body.lastIndexOf('@', cursor);
    if (atIndex < 0) return null;
    const token = body.slice(atIndex + 1, cursor);
    if (/\s/.test(token)) return null;
    return { atIndex, query: token.toLowerCase() };
  }, [body, selectionStart]);

  const mentionMatches = useMemo(() => {
    if (!mentionContext) return [];
    return mentionableUsers
      .filter(user => {
        const label = `${user.name || ''} ${user.email || ''} ${user.username || ''}`.toLowerCase();
        return !mentionContext.query || label.includes(mentionContext.query);
      })
      .slice(0, 6);
  }, [mentionContext, mentionableUsers]);

  const selectMention = (target: User) => {
    const displayName = target.name || target.email || 'Người dùng';
    const inserted = insertChatV2Mention({
      body,
      selectionStart,
      displayName,
    });
    setBody(inserted.body);
    setSelectionStart(inserted.caretPosition);
    setMentions(prev => {
      const withoutUser = prev.filter(item => item.userId !== target.id);
      return [...withoutUser, { userId: target.id, displayName }];
    });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(inserted.caretPosition, inserted.caretPosition);
    });
  };

  const submit = async () => {
    if (sending || disabled) return;
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    try {
      const activeMentions = mentions.filter(mention => body.includes(`@${mention.displayName}`));
      await onSend(body, files, {
        replyToMessageId: replyTo?.messageId || null,
        replyPreview: replyTo,
        mentions: activeMentions,
      });
      setBody('');
      setFiles([]);
      setMentions([]);
      onCancelReply();
      onTyping(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
      {replyTo && <ReplyQuote preview={replyTo} onClear={onCancelReply} />}
      {files.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex h-11 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 dark:border-slate-800 dark:bg-slate-900">
              {file.type.startsWith('image/') ? <ImageIcon size={16} className="text-emerald-600" /> : <FileText size={16} className="text-slate-500" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-slate-700 dark:text-slate-100">{file.name}</div>
                <div className="text-[10px] font-bold text-slate-400">{formatFileSize(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => setFiles(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
                title="Bỏ tệp"
                aria-label="Bỏ tệp"
                className="text-slate-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showEmoji && (
        <div className="mb-2 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
          {CHAT_V2_REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setBody(prev => `${prev}${emoji}`);
                setShowEmoji(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition hover:bg-white dark:hover:bg-slate-950"
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
          aria-label="Đính kèm"
          disabled={disabled || sending}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-800 dark:text-slate-400"
        >
          <Paperclip size={18} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowStructuredMenu(prev => !prev)}
            title="Tạo nội dung"
            aria-label="Tạo nội dung"
            disabled={disabled || sending}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-800 dark:text-slate-400"
          >
            <Plus size={18} />
          </button>
          {showStructuredMenu && (
            <div className="absolute bottom-12 left-0 z-20 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-950">
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
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
          aria-label="Emoji"
          disabled={disabled || sending}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-800 dark:text-slate-400"
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
          placeholder="Nhập tin nhắn"
          disabled={disabled || sending}
          className="max-h-32 min-h-11 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-400 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="button"
          onClick={submit}
          title="Gửi"
          aria-label="Gửi"
          disabled={disabled || sending || (!body.trim() && files.length === 0)}
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800"
        >
          <Send size={18} />
        </button>
      </div>
      {mentionMatches.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          {mentionMatches.map(target => (
            <button
              key={target.id}
              type="button"
              onClick={() => selectMention(target)}
              className="grid w-full grid-cols-[auto_1fr] items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <Avatar user={target} size="sm" />
              <span className="min-w-0 truncate">{target.name || target.email}</span>
            </button>
          ))}
        </div>
      )}
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

const MessagePane: React.FC<{
  conversation: ChatV2Conversation | null;
  messages: ChatV2Message[];
  currentUser: User;
  users: User[];
  onlineUserIds: Set<string>;
  typingUsers: Array<{ userId: string; name: string; at: number }>;
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  onBack: () => void;
  onSend: (body: string, files: File[], options?: ChatV2SendOptions) => Promise<void>;
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
}> = ({
  conversation,
  messages,
  currentUser,
  users,
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
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousScrollRef = useRef<{ conversationId?: string; firstId?: string; length: number }>({ length: 0 });
  const olderScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);
  const initialScrolledConversationRef = useRef<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyDraft | null>(null);

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const previous = previousScrollRef.current;
    const firstId = messages[0]?.id;
    const conversationChanged = previous.conversationId !== conversation?.id;
    const appendedAtBottom = previous.firstId === firstId && messages.length > previous.length;
    const olderSnapshot = olderScrollSnapshotRef.current;
    if (olderSnapshot && !conversationChanged) {
      scrollEl.scrollTop = scrollEl.scrollHeight - olderSnapshot.height + olderSnapshot.top;
      olderScrollSnapshotRef.current = null;
    } else if (conversation?.id && messages.length > 0 && initialScrolledConversationRef.current !== conversation.id) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'auto' });
      initialScrolledConversationRef.current = conversation.id;
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
    setReplyingTo({
      messageId: message.id,
      senderId: message.senderId,
      senderName: sender?.name || sender?.email || 'Người dùng',
      bodyPreview: buildChatV2MessagePreview(message.kind, message.body, message.payload),
      kind: message.kind,
    });
  };

  if (!conversation) {
    return (
      <section className="hidden h-full min-w-0 flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950 lg:flex">
        <div className="text-center">
          <MessageCircle size={42} className="mx-auto mb-3 text-slate-300" />
          <div className="text-sm font-black text-slate-700 dark:text-slate-200">Chọn một hội thoại</div>
        </div>
      </section>
    );
  }

  const title = getChatV2ConversationTitle(conversation, currentUser.id, users);
  const otherParticipant = conversation.participants.find(participant => participant.userId !== currentUser.id);
  const otherUser = users.find(user => user.id === otherParticipant?.userId);
  const isDirectOnline = conversation.type === 'direct' && Boolean(otherParticipant && onlineUserIds.has(otherParticipant.userId));
  const typingLabel = typingUsers.length > 0 ? `${typingUsers.map(user => user.name).join(', ')} đang nhập` : '';
  const canManage = canManageConversation(conversation, currentUser);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-950 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            title="Quay lại"
            aria-label="Quay lại"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 lg:hidden"
          >
            <ArrowLeft size={18} />
          </button>
          {conversation.type === 'direct' ? (
            <Avatar user={otherUser} label={title} online={isDirectOnline} />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white dark:bg-slate-700">
              <Users size={17} />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900 dark:text-white">{title}</div>
            <div className="truncate text-[11px] font-bold text-slate-500">
              {typingLabel || `${conversation.participants.length} thành viên`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTogglePinned(conversation)}
            title={conversation.currentParticipant?.isPinned ? 'Bỏ ghim' : 'Ghim'}
            aria-label={conversation.currentParticipant?.isPinned ? 'Bỏ ghim' : 'Ghim'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-emerald-700 dark:hover:bg-slate-900"
          >
            {conversation.currentParticipant?.isPinned ? <PinOff size={17} /> : <Pin size={17} />}
          </button>
          <button
            type="button"
            onClick={() => onToggleMuted(conversation)}
            title={conversation.currentParticipant?.isMuted ? 'Bật thông báo' : 'Tắt thông báo'}
            aria-label={conversation.currentParticipant?.isMuted ? 'Bật thông báo' : 'Tắt thông báo'}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-emerald-700 dark:hover:bg-slate-900"
          >
            {conversation.currentParticipant?.isMuted ? <BellOff size={17} /> : <Bell size={17} />}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Quản lý"
            aria-label="Quản lý"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {loading && messages.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className={`h-12 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-900 ${item % 2 ? 'ml-auto w-1/2' : 'w-2/3'}`} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Heart size={34} className="mx-auto mb-3 text-slate-300" />
              <div className="text-sm font-black text-slate-700 dark:text-slate-200">Bắt đầu cuộc trò chuyện</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadOlderWithScrollLock}
                  disabled={loadingOlder}
                  className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                >
                  <ChevronUp size={15} /> {loadingOlder ? 'Đang tải' : 'Tải tin cũ hơn'}
                </button>
              </div>
            )}
            {messages.map(message => (
              <MessageRow
                key={message.id}
                message={message}
                currentUser={currentUser}
                users={users}
                canDelete={message.senderId === currentUser.id || canManage}
                onEdit={onEditMessage}
                onReaction={onReaction}
                onReply={handleReply}
                onPollVote={onPollVote}
                onChecklistToggle={onChecklistToggle}
                onQuickConfirm={onQuickConfirm}
                onRecall={onRecall}
              />
            ))}
          </div>
        )}
      </div>

      <MessageComposer
        disabled={!conversation}
        currentUser={currentUser}
        conversation={conversation}
        users={users}
        replyTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSend={onSend}
        onSendStructured={onSendStructured}
        onTyping={onTyping}
      />
    </section>
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
      .filter(user => user.id !== currentUser.id && user.isActive !== false && canAccessRoute(user, '/chat'))
      .filter(user => !keyword || `${user.name} ${user.email}`.toLowerCase().includes(keyword));
  }, [currentUser.id, search, users]);

  const submit = async () => {
    if (selectedIds.length === 0 || saving) return;
    setSaving(true);
    try {
      if (selectedIds.length === 1 && !groupName.trim()) {
        await onCreateDirect(selectedIds[0]);
      } else {
        await onCreateGroup(groupName, selectedIds);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="text-sm font-black text-slate-900 dark:text-white">Tạo hội thoại</div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            aria-label="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <X size={18} />
          </button>
        </div>
        <div className="shrink-0 space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <input
            value={groupName}
            onChange={event => setGroupName(event.target.value)}
            placeholder="Tên nhóm"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
          />
          <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <Search size={16} />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm người dùng"
              className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
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
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <Avatar user={user} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{user.name}</div>
                  <div className="truncate text-[11px] font-semibold text-slate-500">{user.email}</div>
                </div>
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>
                  {checked && <Check size={13} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-200 px-4 text-xs font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={selectedIds.length === 0 || saving}
            className="h-10 rounded-lg bg-emerald-600 px-4 text-xs font-black text-white transition hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800"
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
    .filter(user => user.isActive !== false && canAccessRoute(user, '/chat') && !activeParticipantIds.has(user.id))
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="text-sm font-black text-slate-900 dark:text-white">Quản lý hội thoại</div>
          <button
            type="button"
            onClick={onClose}
            title="Đóng"
            aria-label="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {conversation.type === 'group' && (
            <div className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 text-xs font-black uppercase text-slate-400">Tên nhóm</div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  disabled={!canManage}
                  className="h-10 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={saveName}
                  disabled={!canManage || saving || !name.trim() || name.trim() === (conversation.name || '').trim()}
                  className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800"
                >
                  <Check size={15} /> Lưu
                </button>
              </div>
            </div>
          )}

          {conversation.type === 'group' && canManage && (
            <div className="mb-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-400">
                <UserPlus size={14} /> Thêm thành viên
              </div>
              <div className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                <Search size={16} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Tìm người dùng"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-900">
                {availableUsers.length === 0 ? (
                  <div className="p-3 text-xs font-semibold text-slate-400">Không còn người dùng phù hợp</div>
                ) : (
                  availableUsers.map(user => {
                    const checked = selectedIds.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedIds(prev => checked ? prev.filter(id => id !== user.id) : [...prev, user.id])}
                        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900"
                      >
                        <Avatar user={user} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{user.name}</div>
                          <div className="truncate text-[11px] font-semibold text-slate-500">{user.email}</div>
                        </div>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>
                          {checked && <Check size={13} />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={addMembers}
                  disabled={selectedIds.length === 0 || saving}
                  className="flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800"
                >
                  <UserPlus size={15} /> Thêm
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-black uppercase text-slate-400 dark:border-slate-800">
              Thành viên
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-900">
              {activeMembers.map(({ participant, user }) => {
                const isSelf = participant.userId === currentUser.id;
                const canChangeRole = canManage && conversation.type === 'group' && participant.role !== 'owner' && !isSelf;
                const canRemove = canManage && conversation.type === 'group' && participant.role !== 'owner' && !isSelf;
                return (
                  <div key={participant.userId} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3">
                    <Avatar user={user} label={user?.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-black text-slate-800 dark:text-slate-100">{user?.name || 'Người dùng'}</span>
                        {participant.role === 'owner' && <Crown size={14} className="shrink-0 text-amber-500" />}
                        {participant.role === 'admin' && <Shield size={14} className="shrink-0 text-emerald-600" />}
                      </div>
                      <div className="truncate text-[11px] font-semibold text-slate-500">{user?.email || participant.userId}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {canChangeRole && (
                        <button
                          type="button"
                          onClick={() => onSetMemberRole(conversation.id, participant.userId, participant.role === 'admin' ? 'member' : 'admin')}
                          className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-black text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-800 dark:text-slate-300"
                        >
                          <Shield size={13} /> {participant.role === 'admin' ? 'Hạ quyền' : 'Quản trị'}
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
                          className="flex h-8 items-center gap-1 rounded-lg border border-red-200 px-2 text-[11px] font-black text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/40"
                        >
                          <UserMinus size={13} /> Loại
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {conversation.type === 'group' && canManage && (
            <div className="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={deleteGroup}
                className="flex h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-black text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/40"
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

const ChatShell: React.FC<ChatShellProps> = ({ currentUser, users }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showListOnMobile, setShowListOnMobile] = useState(true);
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

  return (
    <div className="h-[calc(100dvh-5rem)] min-h-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 lg:h-[calc(100dvh-4rem)]">
      <div className="flex h-full min-w-0">
        <div className={`${showListOnMobile ? 'block' : 'hidden'} h-full w-full lg:block lg:w-auto`}>
          <ConversationList
            conversations={chat.conversations}
            activeConversationId={chat.activeConversationId}
            currentUser={currentUser}
            users={users}
            onlineUserIds={chat.onlineUserIds}
            search={search}
            onSearch={setSearch}
            onSelect={handleSelect}
            onNew={() => setShowNewChat(true)}
            loading={chat.isLoadingConversations}
          />
        </div>
        <div className={`${showListOnMobile ? 'hidden' : 'block'} h-full min-w-0 flex-1 lg:block`}>
          <MessagePane
            conversation={chat.activeConversation}
            messages={chat.messages}
            currentUser={currentUser}
            users={users}
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
          />
        </div>
      </div>

      {chat.error && (
        <div className="fixed bottom-5 left-1/2 z-[130] -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-200">
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
