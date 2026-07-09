import { supabase, isSupabaseConfigured } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { User } from '../types';

export const CHAT_V2_ATTACHMENT_BUCKET = 'chat-attachments';
export const CHAT_V2_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✅'];
export const CHAT_V2_PAGE_SIZE = 50;

export type ChatV2ConversationType = 'direct' | 'group';
export type ChatV2ParticipantRole = 'owner' | 'admin' | 'member';
export type ChatV2MessageKind = 'text' | 'image' | 'file' | 'poll' | 'checklist' | 'quick_confirm' | 'system';
export type ChatV2RealtimeTable =
  | 'chat_v2_messages'
  | 'chat_v2_attachments'
  | 'chat_v2_reactions'
  | 'chat_v2_poll_votes'
  | 'chat_v2_checklist_items'
  | 'chat_v2_quick_confirm_responses'
  | 'chat_v2_participants';

export interface ChatV2Participant {
  id: string;
  conversationId: string;
  userId: string;
  role: ChatV2ParticipantRole;
  isMuted: boolean;
  isPinned: boolean;
  lastReadMessageId?: string | null;
  lastReadAt?: string | null;
  lastMessageId?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  lastMessageSenderId?: string | null;
  unreadCount: number;
  joinedAt: string;
  leftAt?: string | null;
}

export interface ChatV2Conversation {
  id: string;
  type: ChatV2ConversationType;
  name?: string | null;
  avatarUrl?: string | null;
  createdBy?: string | null;
  lastMessageId?: string | null;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageSenderId?: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  participants: ChatV2Participant[];
  currentParticipant?: ChatV2Participant;
  unreadCount: number;
}

export interface ChatV2Attachment {
  id: string;
  conversationId: string;
  messageId: string;
  uploadedBy: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnailPath?: string | null;
  signedUrl?: string;
  downloadUrl?: string;
}

export interface ChatV2Reaction {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface ChatV2ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
  reactedByMe: boolean;
}

export interface ChatV2PollOption {
  id: string;
  text: string;
}

export interface ChatV2PollVote {
  id: string;
  conversationId: string;
  messageId: string;
  optionId: string;
  userId: string;
  createdAt: string;
}

export interface ChatV2ChecklistItem {
  id: string;
  conversationId: string;
  messageId: string;
  content: string;
  sortOrder: number;
  isDone: boolean;
  doneBy?: string | null;
  doneAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface ChatV2QuickConfirmResponse {
  id: string;
  conversationId: string;
  messageId: string;
  optionId: string;
  userId: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface ChatV2ReplyPreview {
  messageId: string;
  senderId: string;
  senderName: string;
  bodyPreview: string;
  kind: ChatV2MessageKind;
}

export interface ChatV2Mention {
  userId: string;
  displayName: string;
}

export interface ChatV2NormalizedMessageMetadata {
  payload: Record<string, any>;
  replyPreview: ChatV2ReplyPreview | null;
  mentions: ChatV2Mention[];
}

export interface ChatV2Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  kind: ChatV2MessageKind;
  replyToMessageId?: string | null;
  metadata: Record<string, any>;
  payload: Record<string, any>;
  replyPreview: ChatV2ReplyPreview | null;
  mentions: ChatV2Mention[];
  editedAt?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ChatV2Attachment[];
  reactions: ChatV2Reaction[];
  reactionSummary: ChatV2ReactionSummary[];
  pollVotes: ChatV2PollVote[];
  checklistItems: ChatV2ChecklistItem[];
  quickConfirmResponses: ChatV2QuickConfirmResponse[];
}

export interface ChatV2MessageCursor {
  createdAt: string;
  id?: string;
}

export interface ChatV2PendingAttachment {
  file: File;
  id: string;
  storagePath: string;
  fileName: string;
  storageFileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatV2SendMessageInput {
  conversationId: string;
  body?: string;
  kind?: ChatV2MessageKind;
  payload?: Record<string, any>;
  metadata?: Record<string, any>;
  attachments?: File[];
  checklistItems?: string[];
  replyToMessageId?: string | null;
  replyPreview?: ChatV2ReplyPreview | null;
  mentions?: ChatV2Mention[];
}

export interface ChatV2RealtimeEvent {
  table: ChatV2RealtimeTable;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
  new: any;
  old: any;
}

export type ChatV2InboxSubscriptionScope = 'badge' | 'shell';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let chatV2RealtimeSubscriptionCounter = 0;

const CONVERSATION_COLUMNS = [
  'id',
  'type',
  'name',
  'avatar_url',
  'created_by',
  'last_message_id',
  'last_message_at',
  'last_message_preview',
  'last_message_sender_id',
  'metadata',
  'created_at',
  'updated_at',
].join(', ');

const PARTICIPANT_COLUMNS = [
  'id',
  'conversation_id',
  'user_id',
  'role',
  'is_muted',
  'is_pinned',
  'last_read_message_id',
  'last_read_at',
  'last_message_id',
  'last_message_preview',
  'last_message_at',
  'last_message_sender_id',
  'unread_count',
  'joined_at',
  'left_at',
].join(', ');

const MESSAGE_COLUMNS = [
  'id',
  'conversation_id',
  'sender_id',
  'body',
  'kind',
  'reply_to_message_id',
  'metadata',
  'edited_at',
  'deleted_at',
  'deleted_by',
  'created_at',
  'updated_at',
].join(', ');

const ATTACHMENT_COLUMNS = [
  'id',
  'conversation_id',
  'message_id',
  'uploaded_by',
  'storage_bucket',
  'storage_path',
  'file_name',
  'mime_type',
  'size_bytes',
  'width',
  'height',
  'thumbnail_path',
  'created_at',
].join(', ');

const REACTION_COLUMNS = 'id, conversation_id, message_id, user_id, emoji, created_at';
const POLL_VOTE_COLUMNS = 'id, conversation_id, message_id, option_id, user_id, created_at';
const CHECKLIST_ITEM_COLUMNS = 'id, conversation_id, message_id, content, sort_order, is_done, done_by, done_at, created_at, updated_at';
const QUICK_CONFIRM_COLUMNS = 'id, conversation_id, message_id, option_id, user_id, created_at, updated_at';

const assertReady = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase chưa được cấu hình.');
};

const asNumber = (value: unknown) => (typeof value === 'number' ? value : Number(value || 0));

const CHAT_V2_MESSAGE_KINDS: ChatV2MessageKind[] = ['text', 'image', 'file', 'poll', 'checklist', 'quick_confirm', 'system'];

const normalizeReplyPreview = (value: any): ChatV2ReplyPreview | null => {
  if (!value || typeof value !== 'object') return null;
  const messageId = String(value.messageId || '').trim();
  const senderId = String(value.senderId || '').trim();
  const senderName = String(value.senderName || '').trim();
  const bodyPreview = String(value.bodyPreview || '').trim();
  const kind = CHAT_V2_MESSAGE_KINDS.includes(value.kind) ? value.kind : 'text';
  if (!messageId || !senderId || !senderName) return null;
  return {
    messageId,
    senderId,
    senderName,
    bodyPreview: bodyPreview.slice(0, 240),
    kind,
  };
};

const normalizeMentions = (value: any): ChatV2Mention[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const mentions: ChatV2Mention[] = [];
  for (const item of value) {
    const userId = String(item?.userId || '').trim();
    const displayName = String(item?.displayName || '').trim();
    if (!userId || !displayName || seen.has(userId)) continue;
    seen.add(userId);
    mentions.push({ userId, displayName });
  }
  return mentions;
};

export const normalizeChatV2MessageMetadata = (
  metadata: Record<string, any> = {},
): ChatV2NormalizedMessageMetadata => {
  const payload = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const replyPreview = normalizeReplyPreview(payload.replyPreview);
  const mentions = normalizeMentions(payload.mentions);
  if (replyPreview) {
    payload.replyPreview = replyPreview;
  } else {
    delete payload.replyPreview;
  }
  if (mentions.length > 0) {
    payload.mentions = mentions;
  } else {
    delete payload.mentions;
  }
  return { payload, replyPreview, mentions };
};

export const getChatV2InboxChannelName = (
  currentUserId: string,
  scope: ChatV2InboxSubscriptionScope = 'shell',
  instanceId?: string,
): string => `chat:v2:inbox:${scope}:${currentUserId}${instanceId ? `:${instanceId}` : ''}`;

export const getChatV2ConversationChannelName = (
  conversationId: string,
  instanceId?: string,
): string => `chat:v2:conversation:${conversationId}${instanceId ? `:${instanceId}` : ''}`;

export const getChatV2RealtimeSubscriptionInstanceId = (): string => {
  chatV2RealtimeSubscriptionCounter += 1;
  return `sub-${Date.now().toString(36)}-${chatV2RealtimeSubscriptionCounter.toString(36)}`;
};

export const buildChatV2AttachmentUploadTarget = (input: {
  conversationId: string;
  messageId: string;
  attachmentId: string;
  originalFileName: string;
}) => {
  const fileName = input.originalFileName.trim() || 'attachment';
  const storageFileName = sanitizeChatFileName(fileName);
  return {
    fileName,
    storageFileName,
    storagePath: `${input.conversationId}/${input.messageId}/${input.attachmentId}-${storageFileName}`,
  };
};

export const insertChatV2Mention = (input: {
  body: string;
  selectionStart: number;
  selectionEnd?: number;
  displayName: string;
}) => {
  const body = input.body || '';
  const cursor = Math.max(0, Math.min(input.selectionStart, body.length));
  const atIndex = body.lastIndexOf('@', cursor);
  const tokenStart = atIndex >= 0 && !/\s/.test(body.slice(atIndex, cursor)) ? atIndex : cursor;
  let tokenEnd = cursor;
  while (tokenEnd < body.length && !/\s/.test(body[tokenEnd])) tokenEnd += 1;
  const mentionText = `@${input.displayName.trim()} `;
  const prefix = body.slice(0, tokenStart);
  const suffix = body.slice(tokenEnd).replace(/^\s+/, '');
  const nextBody = `${prefix}${mentionText}${suffix}`;
  return {
    body: nextBody,
    caretPosition: prefix.length + mentionText.length,
  };
};

const mapParticipant = (row: any): ChatV2Participant => ({
  id: row.id,
  conversationId: row.conversation_id,
  userId: row.user_id,
  role: row.role,
  isMuted: Boolean(row.is_muted),
  isPinned: Boolean(row.is_pinned),
  lastReadMessageId: row.last_read_message_id,
  lastReadAt: row.last_read_at,
  lastMessageId: row.last_message_id,
  lastMessagePreview: row.last_message_preview,
  lastMessageAt: row.last_message_at,
  lastMessageSenderId: row.last_message_sender_id,
  unreadCount: asNumber(row.unread_count),
  joinedAt: row.joined_at,
  leftAt: row.left_at,
});

const mapConversation = (
  row: any,
  participants: ChatV2Participant[],
  currentUserId: string,
): ChatV2Conversation => {
  const currentParticipant = participants.find(p => p.userId === currentUserId);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdBy: row.created_by,
    lastMessageId: currentParticipant?.lastMessageId ?? row.last_message_id,
    lastMessageAt: currentParticipant?.lastMessageAt ?? row.last_message_at,
    lastMessagePreview: currentParticipant?.lastMessagePreview ?? row.last_message_preview,
    lastMessageSenderId: currentParticipant?.lastMessageSenderId ?? row.last_message_sender_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants,
    currentParticipant,
    unreadCount: currentParticipant?.unreadCount || 0,
  };
};

const mapAttachment = (row: any): ChatV2Attachment => ({
  id: row.id,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  uploadedBy: row.uploaded_by,
  storageBucket: row.storage_bucket || CHAT_V2_ATTACHMENT_BUCKET,
  storagePath: row.storage_path,
  fileName: row.file_name,
  mimeType: row.mime_type,
  sizeBytes: asNumber(row.size_bytes),
  width: row.width,
  height: row.height,
  thumbnailPath: row.thumbnail_path,
});

const mapReaction = (row: any): ChatV2Reaction => ({
  id: row.id,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  userId: row.user_id,
  emoji: row.emoji,
  createdAt: row.created_at,
});

const mapPollVote = (row: any): ChatV2PollVote => ({
  id: row.id,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  optionId: row.option_id,
  userId: row.user_id,
  createdAt: row.created_at,
});

const mapChecklistItem = (row: any): ChatV2ChecklistItem => ({
  id: row.id,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  content: row.content,
  sortOrder: asNumber(row.sort_order),
  isDone: Boolean(row.is_done),
  doneBy: row.done_by,
  doneAt: row.done_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapQuickConfirmResponse = (row: any): ChatV2QuickConfirmResponse => ({
  id: row.id,
  conversationId: row.conversation_id,
  messageId: row.message_id,
  optionId: row.option_id,
  userId: row.user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMessage = (
  row: any,
  attachments: ChatV2Attachment[],
  reactions: ChatV2Reaction[],
  pollVotes: ChatV2PollVote[],
  checklistItems: ChatV2ChecklistItem[],
  quickConfirmResponses: ChatV2QuickConfirmResponse[],
  currentUserId: string,
): ChatV2Message => {
  const metadata = row.metadata || {};
  const normalizedMetadata = normalizeChatV2MessageMetadata(metadata);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body || '',
    kind: row.kind || 'text',
    replyToMessageId: row.reply_to_message_id,
    metadata,
    payload: normalizedMetadata.payload,
    replyPreview: normalizedMetadata.replyPreview,
    mentions: normalizedMetadata.mentions,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
    reactions,
    reactionSummary: summarizeReactions(reactions, currentUserId),
    pollVotes,
    checklistItems,
    quickConfirmResponses,
  };
};

export const summarizeReactions = (
  reactions: ChatV2Reaction[],
  currentUserId?: string,
): ChatV2ReactionSummary[] => {
  const grouped = new Map<string, Set<string>>();
  for (const reaction of reactions) {
    if (!grouped.has(reaction.emoji)) grouped.set(reaction.emoji, new Set());
    grouped.get(reaction.emoji)!.add(reaction.userId);
  }
  return Array.from(grouped.entries())
    .map(([emoji, userIds]) => ({
      emoji,
      count: userIds.size,
      userIds: Array.from(userIds),
      reactedByMe: Boolean(currentUserId && userIds.has(currentUserId)),
    }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
};

export const sanitizeChatFileName = (fileName: string): string => {
  const clean = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return clean || 'attachment';
};

export const isImageAttachment = (attachment: Pick<ChatV2Attachment, 'mimeType' | 'fileName'>): boolean => {
  const mime = attachment.mimeType || '';
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.fileName || '');
};

export const inferMessageKindFromAttachments = (attachments: File[] = []): ChatV2MessageKind => {
  if (attachments.length === 0) return 'text';
  return attachments.every(file => file.type.startsWith('image/')) ? 'image' : 'file';
};

export const formatFileSize = (size?: number | null): string => {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const buildChatV2MessagePreview = (
  kind: ChatV2MessageKind,
  body?: string | null,
  payload: Record<string, any> = {},
): string => {
  const trimmed = String(body || '').trim();
  if (trimmed) return trimmed.slice(0, 240);
  switch (kind) {
    case 'image':
      return 'Hình ảnh';
    case 'file':
      return 'Tệp đính kèm';
    case 'poll':
      return `Bình chọn: ${payload.question || payload.title || 'Chưa có tiêu đề'}`.slice(0, 240);
    case 'checklist':
      return `Checklist: ${payload.title || 'Chưa có tiêu đề'}`.slice(0, 240);
    case 'quick_confirm':
      return `Xác nhận: ${payload.title || 'Chưa có tiêu đề'}`.slice(0, 240);
    case 'system':
      return 'Cập nhật hệ thống';
    default:
      return 'Tin nhắn';
  }
};

export const getChatV2ConversationTitle = (
  conversation: ChatV2Conversation | undefined,
  currentUserId: string | undefined,
  users: User[],
): string => {
  if (!conversation) return 'Tin nhắn';
  if (conversation.type === 'group') return conversation.name || 'Nhóm chat';
  const other = conversation.participants.find(p => p.userId !== currentUserId);
  const user = users.find(u => u.id === other?.userId);
  return user?.name || user?.email || conversation.name || 'Người dùng';
};

export const getUserInitials = (name?: string | null): string => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TT';
  return parts.slice(-2).map(part => part[0]).join('').toUpperCase();
};

const compareMessagesAsc = (a: Pick<ChatV2Message, 'createdAt' | 'id'>, b: Pick<ChatV2Message, 'createdAt' | 'id'>) => {
  const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return byTime || a.id.localeCompare(b.id);
};

export const applyRealtimeMessageEvent = (
  messages: ChatV2Message[],
  eventType: ChatV2RealtimeEvent['eventType'],
  message?: ChatV2Message | null,
  messageId?: string | null,
): ChatV2Message[] => {
  const targetId = message?.id || messageId;
  if (!targetId) return messages;
  if (eventType === 'DELETE' || message?.deletedAt) {
    return messages.filter(item => item.id !== targetId);
  }
  if (!message) return messages;
  const exists = messages.some(item => item.id === message.id);
  const next = exists
    ? messages.map(item => item.id === message.id ? message : item)
    : [...messages, message];
  return next.sort(compareMessagesAsc);
};

export const applyRealtimeInboxEvent = (
  conversations: ChatV2Conversation[],
  participantRow: any,
  currentUserId: string,
): ChatV2Conversation[] => {
  const participant = mapParticipant(participantRow);
  return conversations.map(conversation => {
    if (conversation.id !== participant.conversationId) return conversation;
    const participants = conversation.participants.some(item => item.id === participant.id)
      ? conversation.participants.map(item => item.id === participant.id ? participant : item)
      : [...conversation.participants, participant];
    return {
      ...conversation,
      lastMessageId: participant.lastMessageId ?? conversation.lastMessageId,
      lastMessageAt: participant.lastMessageAt ?? conversation.lastMessageAt,
      lastMessagePreview: participant.lastMessagePreview ?? conversation.lastMessagePreview,
      lastMessageSenderId: participant.lastMessageSenderId ?? conversation.lastMessageSenderId,
      currentParticipant: participant.userId === currentUserId ? participant : conversation.currentParticipant,
      participants,
      unreadCount: participant.userId === currentUserId ? participant.unreadCount : conversation.unreadCount,
    };
  }).sort(sortConversations);
};

const sortConversations = (a: ChatV2Conversation, b: ChatV2Conversation) => {
  const pinnedDelta = Number(b.currentParticipant?.isPinned || false) - Number(a.currentParticipant?.isPinned || false);
  if (pinnedDelta) return pinnedDelta;
  const aTime = a.lastMessageAt || a.updatedAt || a.createdAt;
  const bTime = b.lastMessageAt || b.updatedAt || b.createdAt;
  return new Date(bTime).getTime() - new Date(aTime).getTime();
};

const signAttachment = async (attachment: ChatV2Attachment): Promise<ChatV2Attachment> => {
  if (!attachment.storagePath) return attachment;
  const bucket = supabase.storage.from(attachment.storageBucket || CHAT_V2_ATTACHMENT_BUCKET);
  const [
    { data: previewData, error: previewError },
    { data: downloadData, error: downloadError },
  ] = await Promise.all([
    bucket.createSignedUrl(attachment.storagePath, 60 * 60),
    bucket.createSignedUrl(attachment.storagePath, 60 * 60, { download: attachment.fileName || 'attachment' }),
  ]);
  if (previewError) {
    console.warn('Cannot sign chat attachment URL:', previewError);
    return attachment;
  }
  if (downloadError) console.warn('Cannot sign chat attachment download URL:', downloadError);
  return { ...attachment, signedUrl: previewData?.signedUrl, downloadUrl: downloadData?.signedUrl };
};

const groupByMessageId = <T extends { messageId: string }>(items: T[]): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    if (!grouped.has(item.messageId)) grouped.set(item.messageId, []);
    grouped.get(item.messageId)!.push(item);
  }
  return grouped;
};

const normalizeOptions = (options: Array<Partial<ChatV2PollOption>> = []) =>
  options
    .map((option, index) => ({
      id: String(option.id || `opt_${index + 1}`),
      text: String(option.text || '').trim(),
    }))
    .filter(option => option.text);

export const chatV2Service = {
  async listConversations(currentUserId: string): Promise<ChatV2Conversation[]> {
    if (!isSupabaseConfigured || !currentUserId) return [];

    const { data: membershipRows, error: membershipError } = await supabase
      .from('chat_v2_participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('user_id', currentUserId)
      .is('left_at', null)
      .order('is_pinned', { ascending: false })
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (membershipError) throw membershipError;

    const currentMemberships = (membershipRows || []).map(mapParticipant);
    const conversationIds = currentMemberships.map(p => p.conversationId);
    if (conversationIds.length === 0) return [];

    const { data: conversationRows, error: conversationError } = await supabase
      .from('chat_v2_conversations')
      .select(CONVERSATION_COLUMNS)
      .in('id', conversationIds)
      .is('deleted_at', null);
    if (conversationError) throw conversationError;

    const { data: participantRows, error: participantError } = await supabase
      .from('chat_v2_participants')
      .select(PARTICIPANT_COLUMNS)
      .in('conversation_id', conversationIds)
      .is('left_at', null);
    if (participantError) throw participantError;

    const participants = (participantRows || []).map(mapParticipant);
    const participantsByConversation = new Map<string, ChatV2Participant[]>();
    for (const participant of participants) {
      if (!participantsByConversation.has(participant.conversationId)) {
        participantsByConversation.set(participant.conversationId, []);
      }
      participantsByConversation.get(participant.conversationId)!.push(participant);
    }

    return ((conversationRows || []) as any[])
      .map(row => mapConversation(row, participantsByConversation.get(row.id) || [], currentUserId))
      .sort(sortConversations);
  },

  async countTotalUnread(currentUserId?: string): Promise<number> {
    if (!currentUserId) return 0;
    const { data, error } = await supabase
      .from('chat_v2_participants')
      .select('unread_count')
      .eq('user_id', currentUserId)
      .is('left_at', null);
    if (error) throw error;
    return (data || []).reduce((sum, row) => sum + asNumber(row.unread_count), 0);
  },

  async hydrateMessages(rows: any[], currentUserId: string): Promise<ChatV2Message[]> {
    const messageIds = rows.map(row => row.id);
    if (messageIds.length === 0) return [];

    const [
      { data: attachmentRows, error: attachmentError },
      { data: reactionRows, error: reactionError },
      { data: pollVoteRows, error: pollVoteError },
      { data: checklistRows, error: checklistError },
      { data: quickConfirmRows, error: quickConfirmError },
    ] = await Promise.all([
      supabase.from('chat_v2_attachments').select(ATTACHMENT_COLUMNS).in('message_id', messageIds).order('created_at', { ascending: true }),
      supabase.from('chat_v2_reactions').select(REACTION_COLUMNS).in('message_id', messageIds).order('created_at', { ascending: true }),
      supabase.from('chat_v2_poll_votes').select(POLL_VOTE_COLUMNS).in('message_id', messageIds).order('created_at', { ascending: true }),
      supabase.from('chat_v2_checklist_items').select(CHECKLIST_ITEM_COLUMNS).in('message_id', messageIds).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('chat_v2_quick_confirm_responses').select(QUICK_CONFIRM_COLUMNS).in('message_id', messageIds).order('created_at', { ascending: true }),
    ]);
    if (attachmentError) throw attachmentError;
    if (reactionError) throw reactionError;
    if (pollVoteError) throw pollVoteError;
    if (checklistError) throw checklistError;
    if (quickConfirmError) throw quickConfirmError;

    const signedAttachments = await Promise.all((attachmentRows || []).map(row => signAttachment(mapAttachment(row))));
    const attachmentsByMessage = groupByMessageId(signedAttachments);
    const reactionsByMessage = groupByMessageId((reactionRows || []).map(mapReaction));
    const pollVotesByMessage = groupByMessageId((pollVoteRows || []).map(mapPollVote));
    const checklistByMessage = groupByMessageId((checklistRows || []).map(mapChecklistItem));
    const quickConfirmByMessage = groupByMessageId((quickConfirmRows || []).map(mapQuickConfirmResponse));

    return rows.map(row => mapMessage(
      row,
      attachmentsByMessage.get(row.id) || [],
      reactionsByMessage.get(row.id) || [],
      pollVotesByMessage.get(row.id) || [],
      checklistByMessage.get(row.id) || [],
      quickConfirmByMessage.get(row.id) || [],
      currentUserId,
    )).sort(compareMessagesAsc);
  },

  async getMessages(
    conversationId: string,
    currentUserId: string,
    cursor?: ChatV2MessageCursor,
    limit = CHAT_V2_PAGE_SIZE,
  ): Promise<ChatV2Message[]> {
    if (!isSupabaseConfigured || !conversationId || !currentUserId) return [];

    let query = supabase
      .from('chat_v2_messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (cursor?.createdAt && cursor.id) {
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      query = query.lt('created_at', cursor.createdAt);
    }

    const { data: messageRows, error: messageError } = await query;
    if (messageError) throw messageError;
    return this.hydrateMessages([...(messageRows || [])].reverse(), currentUserId);
  },

  async loadOlderMessages(
    conversationId: string,
    currentUserId: string,
    cursor: ChatV2MessageCursor,
    limit = CHAT_V2_PAGE_SIZE,
  ): Promise<ChatV2Message[]> {
    return this.getMessages(conversationId, currentUserId, cursor, limit);
  },

  async getMessage(messageId: string, currentUserId: string): Promise<ChatV2Message | null> {
    if (!messageId || !currentUserId) return null;
    const { data, error } = await supabase
      .from('chat_v2_messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', messageId)
      .maybeSingle();
    if (error) throw error;
    const row = data as any;
    if (!row || row.deleted_at) return null;
    const [message] = await this.hydrateMessages([row], currentUserId);
    return message || null;
  },

  async uploadChatAttachment(file: File, conversationId: string, messageId: string): Promise<ChatV2PendingAttachment> {
    assertReady();
    if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId)) {
      throw new Error('Đường dẫn tệp chat không hợp lệ.');
    }

    const id = crypto.randomUUID();
    const target = buildChatV2AttachmentUploadTarget({
      conversationId,
      messageId,
      attachmentId: id,
      originalFileName: file.name,
    });
    const { error } = await supabase
      .storage
      .from(CHAT_V2_ATTACHMENT_BUCKET)
      .upload(target.storagePath, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (error) throw error;

    return {
      file,
      id,
      storagePath: target.storagePath,
      fileName: target.fileName,
      storageFileName: target.storageFileName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    };
  },

  async sendMessage(input: ChatV2SendMessageInput, currentUserId: string): Promise<string> {
    const files = input.attachments || [];
    return this.sendStructuredMessage({
      ...input,
      kind: input.kind || inferMessageKindFromAttachments(files),
    }, currentUserId);
  },

  async sendStructuredMessage(input: ChatV2SendMessageInput, currentUserId: string): Promise<string> {
    assertReady();
    const body = (input.body || '').trim();
    const files = input.attachments || [];
    const kind = input.kind || inferMessageKindFromAttachments(files);
    const payload = input.payload || input.metadata || {};
    const checklistItems = (input.checklistItems || [])
      .map(item => item.trim())
      .filter(Boolean);

    if (!body && files.length === 0 && !['poll', 'checklist', 'quick_confirm', 'system'].includes(kind)) {
      throw new Error('Tin nhắn đang trống.');
    }

    const normalizedPayload = { ...payload };
    const replyPreview = normalizeReplyPreview(input.replyPreview);
    const mentions = normalizeMentions(input.mentions);
    if (input.replyToMessageId && replyPreview) {
      normalizedPayload.replyPreview = replyPreview;
    } else {
      delete normalizedPayload.replyPreview;
    }
    if (mentions.length > 0) {
      normalizedPayload.mentions = mentions;
    } else if (input.mentions) {
      delete normalizedPayload.mentions;
    }
    if (kind === 'poll' || kind === 'quick_confirm') {
      normalizedPayload.options = normalizeOptions(payload.options);
      if (normalizedPayload.options.length < 2) throw new Error('Cần ít nhất 2 lựa chọn.');
    }
    if (kind === 'checklist' && checklistItems.length === 0) {
      throw new Error('Checklist cần ít nhất 1 mục.');
    }

    const messageId = crypto.randomUUID();
    const uploaded: ChatV2PendingAttachment[] = [];
    try {
      for (const file of files) {
        uploaded.push(await this.uploadChatAttachment(file, input.conversationId, messageId));
      }

      const { error: messageError } = await supabase
        .from('chat_v2_messages')
        .insert({
          id: messageId,
          conversation_id: input.conversationId,
          sender_id: currentUserId,
          body,
          kind,
          reply_to_message_id: input.replyToMessageId || null,
          metadata: normalizedPayload,
        });
      if (messageError) throw messageError;

      if (uploaded.length > 0) {
        const { error: attachmentError } = await supabase
          .from('chat_v2_attachments')
          .insert(uploaded.map(file => ({
            id: file.id,
            conversation_id: input.conversationId,
            message_id: messageId,
            uploaded_by: currentUserId,
            storage_bucket: CHAT_V2_ATTACHMENT_BUCKET,
            storage_path: file.storagePath,
            file_name: file.fileName,
            mime_type: file.mimeType,
            size_bytes: file.sizeBytes,
          })));
        if (attachmentError) throw attachmentError;
      }

      if (kind === 'checklist' && checklistItems.length > 0) {
        const { error: checklistError } = await supabase
          .from('chat_v2_checklist_items')
          .insert(checklistItems.map((content, index) => ({
            conversation_id: input.conversationId,
            message_id: messageId,
            content,
            sort_order: index,
          })));
        if (checklistError) throw checklistError;
      }

      return messageId;
    } catch (error) {
      if (uploaded.length > 0) {
        await supabase
          .storage
          .from(CHAT_V2_ATTACHMENT_BUCKET)
          .remove(uploaded.map(file => file.storagePath));
      }
      throw error;
    }
  },

  async createDirectConversation(targetUserId: string): Promise<string> {
    assertReady();
    const { data, error } = await supabase.rpc('chat_v2_get_or_create_direct_conversation', {
      p_target_user_id: targetUserId,
    });
    if (error) throw error;
    return data as string;
  },

  async createGroupConversation(input: { name?: string; memberIds: string[] }, currentUserId: string): Promise<string> {
    assertReady();
    const memberIds = Array.from(new Set([currentUserId, ...input.memberIds].filter(Boolean)));
    if (memberIds.length < 2) throw new Error('Nhóm cần ít nhất 2 thành viên.');

    const groupName = (input.name || '').trim() || `Nhóm ${memberIds.length} thành viên`;
    const { data, error } = await supabase.rpc('chat_v2_create_group_conversation', {
      p_name: groupName,
      p_member_ids: memberIds.filter(userId => userId !== currentUserId),
    });
    if (error) throw error;
    return data as string;
  },

  async markConversationRead(conversationId: string, messageId: string | null | undefined, currentUserId: string): Promise<void> {
    if (!conversationId || !currentUserId) return;
    const { error } = await supabase
      .from('chat_v2_participants')
      .update({
        last_read_message_id: messageId || null,
        last_read_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);
    if (error) throw error;
  },

  async togglePinned(conversationId: string, currentUserId: string, nextPinned: boolean): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_participants')
      .update({ is_pinned: nextPinned })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);
    if (error) throw error;
  },

  async toggleMuted(conversationId: string, currentUserId: string, nextMuted: boolean): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_participants')
      .update({ is_muted: nextMuted })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);
    if (error) throw error;
  },

  async toggleReaction(message: Pick<ChatV2Message, 'id' | 'conversationId'>, emoji: string, currentUserId: string): Promise<void> {
    const { data: existing, error: readError } = await supabase
      .from('chat_v2_reactions')
      .select('id')
      .eq('message_id', message.id)
      .eq('user_id', currentUserId)
      .eq('emoji', emoji)
      .maybeSingle();
    if (readError) throw readError;

    if (existing?.id) {
      const { error } = await supabase.from('chat_v2_reactions').delete().eq('id', existing.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase
      .from('chat_v2_reactions')
      .insert({
        conversation_id: message.conversationId,
        message_id: message.id,
        user_id: currentUserId,
        emoji,
      });
    if (error) throw error;
  },

  async votePoll(message: ChatV2Message, optionId: string, currentUserId: string): Promise<void> {
    const multiple = Boolean(message.payload?.multiple);
    const existing = message.pollVotes.find(vote => vote.userId === currentUserId && vote.optionId === optionId);
    if (existing) {
      const { error } = await supabase.from('chat_v2_poll_votes').delete().eq('id', existing.id);
      if (error) throw error;
      return;
    }
    if (!multiple) {
      const { error: deleteError } = await supabase
        .from('chat_v2_poll_votes')
        .delete()
        .eq('message_id', message.id)
        .eq('user_id', currentUserId);
      if (deleteError) throw deleteError;
    }
    const { error } = await supabase
      .from('chat_v2_poll_votes')
      .insert({
        conversation_id: message.conversationId,
        message_id: message.id,
        option_id: optionId,
        user_id: currentUserId,
      });
    if (error) throw error;
  },

  async toggleChecklistItem(item: ChatV2ChecklistItem, nextDone: boolean, currentUserId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_checklist_items')
      .update({
        is_done: nextDone,
        done_by: nextDone ? currentUserId : null,
        done_at: nextDone ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
    if (error) throw error;
  },

  async respondQuickConfirm(message: ChatV2Message, optionId: string, currentUserId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_quick_confirm_responses')
      .upsert({
        conversation_id: message.conversationId,
        message_id: message.id,
        option_id: optionId,
        user_id: currentUserId,
      }, { onConflict: 'message_id,user_id' });
    if (error) throw error;
  },

  async editMessage(message: Pick<ChatV2Message, 'id'>, body: string): Promise<void> {
    const nextBody = body.trim();
    if (!nextBody) throw new Error('Nội dung tin nhắn không được để trống.');
    const { error } = await supabase
      .from('chat_v2_messages')
      .update({
        body: nextBody,
        edited_at: new Date().toISOString(),
      })
      .eq('id', message.id);
    if (error) throw error;
  },

  async recallMessage(message: Pick<ChatV2Message, 'id'>, currentUserId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_messages')
      .update({
        body: '',
        deleted_at: new Date().toISOString(),
        deleted_by: currentUserId,
      })
      .eq('id', message.id);
    if (error) throw error;
  },

  async updateGroupName(conversationId: string, name: string): Promise<void> {
    const nextName = name.trim();
    if (!nextName) throw new Error('Tên nhóm không được để trống.');
    const { error } = await supabase
      .from('chat_v2_conversations')
      .update({ name: nextName })
      .eq('id', conversationId)
      .eq('type', 'group');
    if (error) throw error;
  },

  async deleteConversation(conversationId: string, currentUserId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_conversations')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: currentUserId,
      })
      .eq('id', conversationId)
      .eq('type', 'group');
    if (error) throw error;
  },

  async addGroupMembers(conversationId: string, memberIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const { error } = await supabase
      .from('chat_v2_participants')
      .upsert(uniqueIds.map(userId => ({
        conversation_id: conversationId,
        user_id: userId,
        role: 'member',
        left_at: null,
      })), {
        onConflict: 'conversation_id,user_id',
      });
    if (error) throw error;
  },

  async removeGroupMember(conversationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async setGroupMemberRole(conversationId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    const { error } = await supabase
      .from('chat_v2_participants')
      .update({ role })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  subscribeToConversation(conversationId: string, onChange: (event: ChatV2RealtimeEvent) => void): RealtimeChannel | null {
    if (!isSupabaseConfigured || !conversationId) return null;
    const instanceId = getChatV2RealtimeSubscriptionInstanceId();
    const forward = (table: ChatV2RealtimeTable) => (payload: any) => onChange({
      table,
      eventType: payload.eventType,
      new: payload.new,
      old: payload.old,
    });
    return supabase
      .channel(getChatV2ConversationChannelName(conversationId, instanceId))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_messages'))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_attachments',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_attachments'))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_reactions',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_reactions'))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_poll_votes',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_poll_votes'))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_checklist_items',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_checklist_items'))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_quick_confirm_responses',
        filter: `conversation_id=eq.${conversationId}`,
      }, forward('chat_v2_quick_confirm_responses'))
      .subscribe();
  },

  subscribeToInbox(
    currentUserId: string,
    onChange: (event: ChatV2RealtimeEvent) => void,
    scope: ChatV2InboxSubscriptionScope = 'shell',
  ): RealtimeChannel | null {
    if (!isSupabaseConfigured || !currentUserId) return null;
    const instanceId = getChatV2RealtimeSubscriptionInstanceId();
    return supabase
      .channel(getChatV2InboxChannelName(currentUserId, scope, instanceId))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_v2_participants',
        filter: `user_id=eq.${currentUserId}`,
      }, (payload: any) => onChange({
        table: 'chat_v2_participants',
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      }))
      .subscribe();
  },

  unsubscribe(channel?: RealtimeChannel | null) {
    if (channel) supabase.removeChannel(channel);
  },
};
