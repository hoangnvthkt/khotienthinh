import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  applyRealtimeInboxEvent,
  applyRealtimeMessageEvent,
  buildChatV2MessagePreview,
  CHAT_V2_PAGE_SIZE,
  chatV2Service,
  ChatV2ChecklistItem,
  ChatV2Conversation,
  ChatV2Mention,
  ChatV2Message,
  ChatV2MessageCursor,
  ChatV2ReplyPreview,
  ChatV2RealtimeEvent,
  ChatV2SendMessageInput,
} from '../lib/chatV2Service';
import type { User } from '../types';

interface TypingUser {
  userId: string;
  name: string;
  at: number;
}

const TYPING_TTL_MS = 3500;

const sortConversations = (items: ChatV2Conversation[]) => [...items].sort((a, b) => {
  const pinnedDelta = Number(b.currentParticipant?.isPinned || false) - Number(a.currentParticipant?.isPinned || false);
  if (pinnedDelta) return pinnedDelta;
  const aTime = a.lastMessageAt || a.updatedAt || a.createdAt;
  const bTime = b.lastMessageAt || b.updatedAt || b.createdAt;
  return new Date(bTime).getTime() - new Date(aTime).getTime();
});

export const useChatV2UnreadCount = (userId?: string) => {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      const next = await chatV2Service.countTotalUnread(userId);
      setCount(next);
    } catch (error) {
      console.warn('Chat v2 unread count failed:', error);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const channel = chatV2Service.subscribeToInbox(userId, refresh, 'badge');
    return () => chatV2Service.unsubscribe(channel);
  }, [refresh, userId]);

  return count;
};

export const useChatV2 = (currentUser: User, users: User[]) => {
  const [conversations, setConversations] = useState<ChatV2Conversation[]>([]);
  const [messages, setMessages] = useState<ChatV2Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const activeConversationRef = useRef<string | null>(null);
  const conversationsRef = useRef<ChatV2Conversation[]>([]);
  const messagesRef = useRef<ChatV2Message[]>([]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const activeConversation = useMemo(
    () => conversations.find(conversation => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations],
  );

  const mergeMessage = useCallback((eventType: ChatV2RealtimeEvent['eventType'], message?: ChatV2Message | null, messageId?: string | null) => {
    setMessages(prev => applyRealtimeMessageEvent(prev, eventType, message, messageId));
  }, []);

  const updateConversationPreview = useCallback((message: ChatV2Message) => {
    setConversations(prev => sortConversations(prev.map(conversation => {
      if (conversation.id !== message.conversationId) return conversation;
      return {
        ...conversation,
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
        lastMessagePreview: buildChatV2MessagePreview(message.kind, message.body, message.payload),
        lastMessageSenderId: message.senderId,
        unreadCount: message.senderId === currentUser.id ? 0 : conversation.unreadCount,
      };
    })));
  }, [currentUser.id]);

  const loadConversations = useCallback(async () => {
    if (!currentUser?.id) return;
    setIsLoadingConversations(true);
    try {
      const next = await chatV2Service.listConversations(currentUser.id);
      setConversations(next);
      setError(null);
    } catch (err: any) {
      console.warn('Chat v2 conversations failed:', err);
      setError(err?.message || 'Không tải được hội thoại.');
    } finally {
      setIsLoadingConversations(false);
    }
  }, [currentUser?.id]);

  const markLoadedConversationRead = useCallback(async (conversationId: string, loadedMessages: ChatV2Message[]) => {
    const lastMessage = loadedMessages[loadedMessages.length - 1];
    const conversation = conversationsRef.current.find(item => item.id === conversationId);
    const alreadyRead = conversation?.currentParticipant?.lastReadMessageId === lastMessage?.id;
    if (!lastMessage || alreadyRead) return;
    await chatV2Service.markConversationRead(conversationId, lastMessage.id, currentUser.id);
    setConversations(prev => prev.map(item => item.id === conversationId ? {
      ...item,
      unreadCount: 0,
      currentParticipant: item.currentParticipant ? {
        ...item.currentParticipant,
        unreadCount: 0,
        lastReadMessageId: lastMessage.id,
        lastReadAt: new Date().toISOString(),
      } : item.currentParticipant,
    } : item));
  }, [currentUser.id]);

  const loadMessages = useCallback(async (conversationId: string, cursor?: ChatV2MessageCursor) => {
    if (!currentUser?.id || !conversationId) return;
    if (cursor) {
      setIsLoadingOlderMessages(true);
    } else {
      setIsLoadingMessages(true);
    }
    try {
      const next = await chatV2Service.getMessages(conversationId, currentUser.id, cursor);
      setMessages(prev => {
        if (!cursor) return next;
        const seen = new Set(prev.map(message => message.id));
        return [...next.filter(message => !seen.has(message.id)), ...prev];
      });
      setHasMoreMessages(next.length === CHAT_V2_PAGE_SIZE);
      if (!cursor) await markLoadedConversationRead(conversationId, next);
      setError(null);
    } catch (err: any) {
      console.warn('Chat v2 messages failed:', err);
      setError(err?.message || 'Không tải được tin nhắn.');
    } finally {
      setIsLoadingMessages(false);
      setIsLoadingOlderMessages(false);
    }
  }, [currentUser?.id, markLoadedConversationRead]);

  const loadOlderMessages = useCallback(async () => {
    if (!activeConversationId || isLoadingOlderMessages || messagesRef.current.length === 0) return;
    const oldest = messagesRef.current[0];
    await loadMessages(activeConversationId, { createdAt: oldest.createdAt, id: oldest.id });
  }, [activeConversationId, isLoadingOlderMessages, loadMessages]);

  const selectConversation = useCallback(async (conversationId: string | null) => {
    setActiveConversationId(conversationId);
    setTypingUsers([]);
    setHasMoreMessages(false);
    if (!conversationId) {
      setMessages([]);
      return;
    }
    await loadMessages(conversationId);
  }, [loadMessages]);

  const sendStructuredMessage = useCallback(async (input: Omit<ChatV2SendMessageInput, 'conversationId'>) => {
    if (!activeConversationId || !currentUser?.id) return;
    const messageId = await chatV2Service.sendStructuredMessage({ ...input, conversationId: activeConversationId }, currentUser.id);
    const message = await chatV2Service.getMessage(messageId, currentUser.id);
    if (message) {
      mergeMessage('INSERT', message);
      updateConversationPreview(message);
    }
  }, [activeConversationId, currentUser?.id, mergeMessage, updateConversationPreview]);

  const sendMessage = useCallback(async (
    body: string,
    attachments: File[] = [],
    options: {
      replyToMessageId?: string | null;
      replyPreview?: ChatV2ReplyPreview | null;
      mentions?: ChatV2Mention[];
    } = {},
  ) => {
    await sendStructuredMessage({ body, attachments, ...options });
  }, [sendStructuredMessage]);

  const createDirectConversation = useCallback(async (targetUserId: string) => {
    const conversationId = await chatV2Service.createDirectConversation(targetUserId);
    await loadConversations();
    await selectConversation(conversationId);
    return conversationId;
  }, [loadConversations, selectConversation]);

  const createGroupConversation = useCallback(async (name: string, memberIds: string[]) => {
    const conversationId = await chatV2Service.createGroupConversation({ name, memberIds }, currentUser.id);
    await loadConversations();
    await selectConversation(conversationId);
    return conversationId;
  }, [currentUser.id, loadConversations, selectConversation]);

  const refreshMessage = useCallback(async (messageId?: string | null, eventType: ChatV2RealtimeEvent['eventType'] = 'UPDATE') => {
    if (!messageId || !currentUser?.id) return;
    const message = await chatV2Service.getMessage(messageId, currentUser.id);
    mergeMessage(eventType, message, messageId);
    if (message) updateConversationPreview(message);
  }, [currentUser?.id, mergeMessage, updateConversationPreview]);

  const toggleReaction = useCallback(async (message: ChatV2Message, emoji: string) => {
    if (!currentUser?.id) return;
    await chatV2Service.toggleReaction(message, emoji, currentUser.id);
    await refreshMessage(message.id);
  }, [currentUser?.id, refreshMessage]);

  const votePoll = useCallback(async (message: ChatV2Message, optionId: string) => {
    if (!currentUser?.id) return;
    await chatV2Service.votePoll(message, optionId, currentUser.id);
    await refreshMessage(message.id);
  }, [currentUser?.id, refreshMessage]);

  const toggleChecklistItem = useCallback(async (item: ChatV2ChecklistItem, nextDone: boolean) => {
    if (!currentUser?.id) return;
    await chatV2Service.toggleChecklistItem(item, nextDone, currentUser.id);
    await refreshMessage(item.messageId);
  }, [currentUser?.id, refreshMessage]);

  const respondQuickConfirm = useCallback(async (message: ChatV2Message, optionId: string) => {
    if (!currentUser?.id) return;
    await chatV2Service.respondQuickConfirm(message, optionId, currentUser.id);
    await refreshMessage(message.id);
  }, [currentUser?.id, refreshMessage]);

  const editMessage = useCallback(async (message: ChatV2Message, body: string) => {
    await chatV2Service.editMessage(message, body);
    await refreshMessage(message.id);
  }, [refreshMessage]);

  const recallMessage = useCallback(async (message: ChatV2Message) => {
    if (!currentUser?.id) return;
    await chatV2Service.recallMessage(message, currentUser.id);
    mergeMessage('DELETE', null, message.id);
  }, [currentUser?.id, mergeMessage]);

  const updateGroupName = useCallback(async (conversationId: string, name: string) => {
    await chatV2Service.updateGroupName(conversationId, name);
    setConversations(prev => prev.map(item => item.id === conversationId ? { ...item, name } : item));
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    await chatV2Service.deleteConversation(conversationId, currentUser.id);
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      setMessages([]);
    }
    setConversations(prev => prev.filter(item => item.id !== conversationId));
  }, [activeConversationId, currentUser.id]);

  const addGroupMembers = useCallback(async (conversationId: string, memberIds: string[]) => {
    await chatV2Service.addGroupMembers(conversationId, memberIds);
    await loadConversations();
  }, [loadConversations]);

  const removeGroupMember = useCallback(async (conversationId: string, userId: string) => {
    await chatV2Service.removeGroupMember(conversationId, userId);
    await loadConversations();
  }, [loadConversations]);

  const setGroupMemberRole = useCallback(async (conversationId: string, userId: string, role: 'admin' | 'member') => {
    await chatV2Service.setGroupMemberRole(conversationId, userId, role);
    await loadConversations();
  }, [loadConversations]);

  const togglePinned = useCallback(async (conversation: ChatV2Conversation) => {
    const nextPinned = !conversation.currentParticipant?.isPinned;
    await chatV2Service.togglePinned(conversation.id, currentUser.id, nextPinned);
    setConversations(prev => sortConversations(prev.map(item => item.id === conversation.id ? {
      ...item,
      currentParticipant: item.currentParticipant ? { ...item.currentParticipant, isPinned: nextPinned } : item.currentParticipant,
    } : item)));
  }, [currentUser.id]);

  const toggleMuted = useCallback(async (conversation: ChatV2Conversation) => {
    const nextMuted = !conversation.currentParticipant?.isMuted;
    await chatV2Service.toggleMuted(conversation.id, currentUser.id, nextMuted);
    setConversations(prev => prev.map(item => item.id === conversation.id ? {
      ...item,
      currentParticipant: item.currentParticipant ? { ...item.currentParticipant, isMuted: nextMuted } : item.currentParticipant,
    } : item));
  }, [currentUser.id]);

  const sendTyping = useCallback((isTyping: boolean) => {
    const channel = typingChannelRef.current;
    if (!channel || !activeConversationId || !currentUser?.id) return;
    const now = Date.now();
    if (isTyping && now - lastTypingSentAtRef.current < 1200) return;
    lastTypingSentAtRef.current = now;
    channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        userId: currentUser.id,
        name: currentUser.name,
        isTyping,
        at: now,
      },
    });
  }, [activeConversationId, currentUser?.id, currentUser?.name]);

  const setTyping = useCallback((isTyping: boolean) => {
    sendTyping(isTyping);
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    if (isTyping) {
      typingStopTimerRef.current = setTimeout(() => sendTyping(false), 1800);
    }
  }, [sendTyping]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = chatV2Service.subscribeToInbox(currentUser.id, event => {
      const row = event.new || event.old;
      if (!row?.conversation_id) return;
      if (event.eventType === 'DELETE' || row.left_at) {
        setConversations(prev => prev.filter(item => item.id !== row.conversation_id));
        return;
      }
      const known = conversationsRef.current.some(item => item.id === row.conversation_id);
      if (!known) {
        loadConversations();
        return;
      }
      setConversations(prev => applyRealtimeInboxEvent(prev, row, currentUser.id));
    }, 'shell');
    return () => chatV2Service.unsubscribe(channel);
  }, [currentUser?.id, loadConversations]);

  useEffect(() => {
    if (!activeConversationId || !currentUser?.id) return;
    const channel = chatV2Service.subscribeToConversation(activeConversationId, event => {
      const row = event.new || event.old;
      const messageId = event.table === 'chat_v2_messages' ? row?.id : row?.message_id;
      if (event.table === 'chat_v2_messages' && (event.eventType === 'DELETE' || event.new?.deleted_at)) {
        mergeMessage('DELETE', null, messageId);
        return;
      }
      refreshMessage(messageId, event.eventType);
    });
    return () => chatV2Service.unsubscribe(channel);
  }, [activeConversationId, currentUser?.id, mergeMessage, refreshMessage]);

  useEffect(() => {
    if (!isSupabaseConfigured || !activeConversationId || !currentUser?.id) return;
    const channel = supabase
      .channel(`chat:v2:typing:${activeConversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.userId === currentUser.id) return;
        setTypingUsers(prev => {
          const withoutUser = prev.filter(user => user.userId !== payload.userId);
          if (!payload.isTyping) return withoutUser;
          return [...withoutUser, { userId: payload.userId, name: payload.name || 'Người dùng', at: payload.at || Date.now() }];
        });
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      typingChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeConversationId, currentUser?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers(prev => prev.filter(user => now - user.at < TYPING_TTL_MS));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentUser?.id) return;
    const channel = supabase
      .channel('chat:v2:presence')
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Record<string, any>>();
        const ids = new Set<string>();
        Object.values(state).flat().forEach((presence: any) => {
          if (presence?.userId) ids.add(presence.userId);
        });
        setOnlineUserIds(ids);
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: currentUser.id,
            name: currentUser.name,
            at: new Date().toISOString(),
          });
        }
      });
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, currentUser?.name]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [conversations],
  );

  return {
    activeConversation,
    activeConversationId,
    conversations,
    error,
    hasMoreMessages,
    isLoadingConversations,
    isLoadingMessages,
    isLoadingOlderMessages,
    messages,
    onlineUserIds,
    selectConversation,
    sendMessage,
    sendStructuredMessage,
    loadOlderMessages,
    createDirectConversation,
    createGroupConversation,
    editMessage,
    toggleReaction,
    votePoll,
    toggleChecklistItem,
    respondQuickConfirm,
    recallMessage,
    updateGroupName,
    deleteConversation,
    addGroupMembers,
    removeGroupMember,
    setGroupMemberRole,
    togglePinned,
    toggleMuted,
    typingUsers,
    setTyping,
    totalUnread,
    refresh: loadConversations,
    users,
  };
};
