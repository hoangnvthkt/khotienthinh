import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useApp } from './AppContext';
import { ChatConversation, ChatMember, ChatMessage } from '../types';

interface ChatContextType {
    conversations: ChatConversation[];
    messages: Record<string, ChatMessage[]>;
    activeConversationId: string | null;
    setActiveConversationId: (id: string | null) => void;
    onlineUsers: Set<string>;
    typingUsers: Record<string, string[]>;
    sendMessage: (
        conversationId: string,
        content: string,
        type?: ChatMessage['type'],
        attachments?: ChatMessage['attachments'],
        replyToId?: string,
        replyToPreview?: ChatMessage['replyToPreview'],
        fileUrls?: string[]
    ) => Promise<void>;
    createDirectConversation: (targetUserId: string) => Promise<string>;
    createGroupConversation: (name: string, memberIds: string[]) => Promise<string>;
    addMember: (conversationId: string, userId: string) => Promise<void>;
    removeMember: (conversationId: string, userId: string) => Promise<void>;
    updateGroupName: (conversationId: string, name: string) => Promise<void>;
    deleteConversation: (conversationId: string) => Promise<void>;
    leaveGroup: (conversationId: string) => Promise<void>;
    markAsRead: (conversationId: string) => Promise<void>;
    loadMessages: (conversationId: string) => Promise<void>;
    setTyping: (conversationId: string, isTyping: boolean) => void;
    toggleReaction: (messageId: string, conversationId: string, emoji: string) => Promise<void>;
    pinnedMessages: Record<string, ChatMessage>;
    pinMessage: (conversationId: string, messageId: string) => Promise<void>;
    unpinMessage: (conversationId: string) => Promise<void>;
    startCallSession: (conversationId: string, mode: 'audio' | 'video') => Promise<string>;
    endCallSession: (sessionId: string, conversationId: string, durationSeconds: number) => Promise<void>;
    totalUnread: number;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error('useChat must be used within ChatProvider');
    return ctx;
};

const mapMessage = (m: any): ChatMessage => ({
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    content: m.content || '',
    type: m.type,
    attachments: m.attachments || [],
    reactions: m.reactions || {},
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    deletedAt: m.deleted_at || null,
    replyToId: m.reply_to_id,
    replyToPreview: m.reply_to_preview,
    fileUrls: m.file_urls || [],
});

const mapMember = (m: any): ChatMember => ({
    id: m.id,
    conversationId: m.conversation_id,
    userId: m.user_id,
    role: m.role,
    lastReadAt: m.last_read_at,
    joinedAt: m.joined_at,
    leftAt: m.left_at || null,
});

const errorMessage = (error: any, fallback: string) => {
    if (!error) return fallback;
    return error.message || error.details || fallback;
};

const formatDuration = (durationSeconds: number) => {
    const safe = Math.max(0, Math.floor(durationSeconds || 0));
    const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
    const seconds = (safe % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, users } = useApp();
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
    const [pinnedMessages, setPinnedMessages] = useState<Record<string, ChatMessage>>({});
    const channelRef = useRef<any>(null);
    const presenceRef = useRef<any>(null);
    const conversationsRef = useRef<ChatConversation[]>([]);
    const processedMsgIds = useRef<Set<string>>(new Set());

    const isAppAdmin = String(user?.role || '') === 'ADMIN';

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    const loadConversations = useCallback(async () => {
        if (!isSupabaseConfigured || !user?.id) {
            setConversations([]);
            setMessages({});
            setPinnedMessages({});
            return;
        }

        const { data: memberData, error: memberError } = await supabase
            .from('chat_members')
            .select('conversation_id, last_read_at, role, left_at')
            .eq('user_id', user.id)
            .is('left_at', null);

        if (memberError) {
            console.error('Error loading chat memberships:', memberError);
            setConversations([]);
            return;
        }

        if (!memberData || memberData.length === 0) {
            setConversations([]);
            setMessages({});
            setPinnedMessages({});
            return;
        }

        const convIds = Array.from(new Set(memberData.map(m => m.conversation_id)));

        const { data: convData, error: convError } = await supabase
            .from('chat_conversations')
            .select('*')
            .in('id', convIds)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        if (convError) {
            console.error('Error loading chat conversations:', convError);
            return;
        }

        if (!convData || convData.length === 0) {
            setConversations([]);
            return;
        }

        const visibleConvIds = convData.map(c => c.id);

        const [{ data: allMembers, error: membersError }, { data: lastMessages, error: messagesError }] = await Promise.all([
            supabase
                .from('chat_members')
                .select('*')
                .in('conversation_id', visibleConvIds)
                .is('left_at', null),
            supabase
                .from('chat_messages')
                .select('*')
                .in('conversation_id', visibleConvIds)
                .is('deleted_at', null)
                .order('created_at', { ascending: false }),
        ]);

        if (membersError) console.error('Error loading chat members:', membersError);
        if (messagesError) console.error('Error loading chat last messages:', messagesError);

        const conversationsWithMeta: ChatConversation[] = convData.map(c => {
            const myMembership = memberData.find(m => m.conversation_id === c.id);
            const members = (allMembers || []).filter(m => m.conversation_id === c.id).map(mapMember);
            const convMessages = (lastMessages || []).filter(m => m.conversation_id === c.id);
            const lastMsg = convMessages[0];
            const myLastRead = myMembership?.last_read_at || '1970-01-01T00:00:00.000Z';
            const unreadCount = convMessages.filter(m => m.created_at > myLastRead && m.sender_id !== user.id).length;

            return {
                id: c.id,
                type: c.type,
                name: c.name || undefined,
                avatarUrl: c.avatar_url || undefined,
                createdBy: c.created_by || undefined,
                createdAt: c.created_at,
                updatedAt: c.updated_at,
                deletedAt: c.deleted_at || null,
                members,
                lastMessage: lastMsg ? mapMessage(lastMsg) : undefined,
                unreadCount,
            };
        });

        conversationsWithMeta.sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return bTime.localeCompare(aTime);
        });

        setConversations(conversationsWithMeta);
    }, [user?.id]);

    const loadMessages = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !conversationId) return;

        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .limit(200);

        if (error) {
            console.error('Error loading chat messages:', error);
            return;
        }

        setMessages(prev => ({
            ...prev,
            [conversationId]: (data || []).map(mapMessage),
        }));
    }, []);

    const insertSystemMessage = useCallback(async (conversationId: string, content: string) => {
        if (!isSupabaseConfigured || !user?.id || !conversationId || !content.trim()) return;
        const { error } = await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: content.trim(),
            type: 'system',
        });
        if (error) console.error('Error inserting chat system message:', error);
    }, [user?.id]);

    const getActiveMembers = useCallback(async (conversationId: string): Promise<ChatMember[]> => {
        const cached = conversationsRef.current.find(c => c.id === conversationId)?.members?.filter(m => !m.leftAt);
        if (cached && cached.length > 0) return cached;

        const { data, error } = await supabase
            .from('chat_members')
            .select('*')
            .eq('conversation_id', conversationId)
            .is('left_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể tải danh sách thành viên nhóm.'));
        return (data || []).map(mapMember);
    }, []);

    const ensureGroupAdmin = useCallback(async (conversationId: string, actionLabel: string) => {
        if (!user?.id || isAppAdmin) return;
        const conv = conversationsRef.current.find(c => c.id === conversationId);
        if (conv && conv.type !== 'group') return;

        const members = await getActiveMembers(conversationId);
        const currentMember = members.find(m => m.userId === user.id);
        if (currentMember?.role !== 'admin') {
            throw new Error(`Chỉ trưởng nhóm mới được ${actionLabel}.`);
        }
    }, [getActiveMembers, isAppAdmin, user?.id]);

    const findExistingDirectConversation = useCallback(async (targetUserId: string) => {
        if (!user?.id) return null;

        const { data: myMemberships, error: membershipError } = await supabase
            .from('chat_members')
            .select('conversation_id')
            .eq('user_id', user.id)
            .is('left_at', null);

        if (membershipError) throw new Error(errorMessage(membershipError, 'Không thể kiểm tra chat đơn hiện có.'));
        const convIds = Array.from(new Set((myMemberships || []).map(m => m.conversation_id)));
        if (convIds.length === 0) return null;

        const { data: directConvs, error: directError } = await supabase
            .from('chat_conversations')
            .select('id')
            .in('id', convIds)
            .eq('type', 'direct')
            .is('deleted_at', null);

        if (directError) throw new Error(errorMessage(directError, 'Không thể kiểm tra chat đơn hiện có.'));
        const directIds = (directConvs || []).map(c => c.id);
        if (directIds.length === 0) return null;

        const { data: members, error: membersError } = await supabase
            .from('chat_members')
            .select('conversation_id, user_id')
            .in('conversation_id', directIds)
            .is('left_at', null);

        if (membersError) throw new Error(errorMessage(membersError, 'Không thể kiểm tra thành viên chat đơn.'));

        return directIds.find(conversationId => {
            const ids = (members || []).filter(m => m.conversation_id === conversationId).map(m => m.user_id);
            return ids.includes(user.id) && ids.includes(targetUserId);
        }) || null;
    }, [user?.id]);

    const sendMessage = useCallback(async (
        conversationId: string,
        content: string,
        type: ChatMessage['type'] = 'text',
        attachments?: ChatMessage['attachments'],
        replyToId?: string,
        replyToPreview?: ChatMessage['replyToPreview'],
        fileUrls?: string[]
    ) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        if (!conversationId) throw new Error('Chưa chọn cuộc trò chuyện.');
        if (!content.trim() && (!attachments || attachments.length === 0)) return;

        const payload = {
            conversation_id: conversationId,
            sender_id: user.id,
            content: content.trim(),
            type,
            attachments: attachments || [],
            reply_to_id: replyToId || null,
            reply_to_preview: replyToPreview || null,
            file_urls: fileUrls || [],
        };

        const { data, error } = await supabase.from('chat_messages').insert(payload).select().single();
        if (error || !data) throw new Error(errorMessage(error, 'Không thể gửi tin nhắn.'));

        processedMsgIds.current.add(data.id);
        const newMsg = mapMessage(data);

        setMessages(prev => {
            const existing = prev[conversationId] || [];
            if (existing.some(msg => msg.id === newMsg.id)) return prev;
            return { ...prev, [conversationId]: [...existing, newMsg] };
        });

        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, lastMessage: newMsg } : c
        ).sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return bTime.localeCompare(aTime);
        }));
    }, [user?.id]);

    const createDirectConversation = useCallback(async (targetUserId: string): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        if (!targetUserId || targetUserId === user.id) throw new Error('Người nhận không hợp lệ.');

        const cached = conversationsRef.current.find(c =>
            c.type === 'direct'
            && c.members?.some(m => m.userId === targetUserId && !m.leftAt)
            && c.members?.some(m => m.userId === user.id && !m.leftAt)
        );
        if (cached) return cached.id;

        const existingId = await findExistingDirectConversation(targetUserId);
        if (existingId) {
            await loadConversations();
            return existingId;
        }

        const { data: conv, error: convError } = await supabase
            .from('chat_conversations')
            .insert({ type: 'direct', created_by: user.id })
            .select()
            .single();

        if (convError || !conv) throw new Error(errorMessage(convError, 'Không thể tạo chat đơn.'));

        const { error: memberError } = await supabase.from('chat_members').insert([
            { conversation_id: conv.id, user_id: user.id, role: 'admin' },
            { conversation_id: conv.id, user_id: targetUserId, role: 'member' },
        ]);

        if (memberError) {
            await supabase.from('chat_conversations').update({
                deleted_at: new Date().toISOString(),
                deleted_by: user.id,
            }).eq('id', conv.id);
            throw new Error(errorMessage(memberError, 'Không thể thêm thành viên vào chat đơn.'));
        }

        await insertSystemMessage(conv.id, 'Cuộc trò chuyện đã được tạo');
        await loadConversations();
        return conv.id;
    }, [findExistingDirectConversation, insertSystemMessage, loadConversations, user?.id]);

    const createGroupConversation = useCallback(async (name: string, memberIds: string[]): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const cleanName = name.trim();
        const cleanMemberIds = Array.from(new Set(memberIds.filter(id => id && id !== user.id)));
        if (!cleanName) throw new Error('Tên nhóm không được để trống.');
        if (cleanMemberIds.length === 0) throw new Error('Nhóm cần ít nhất một thành viên ngoài bạn.');

        const { data: conv, error: convError } = await supabase
            .from('chat_conversations')
            .insert({ type: 'group', name: cleanName, created_by: user.id })
            .select()
            .single();

        if (convError || !conv) throw new Error(errorMessage(convError, 'Không thể tạo nhóm chat.'));

        const allMembers = [user.id, ...cleanMemberIds];
        const { error: memberError } = await supabase.from('chat_members').insert(
            allMembers.map((uid, index) => ({
                conversation_id: conv.id,
                user_id: uid,
                role: index === 0 ? 'admin' : 'member',
            }))
        );

        if (memberError) {
            await supabase.from('chat_conversations').update({
                deleted_at: new Date().toISOString(),
                deleted_by: user.id,
            }).eq('id', conv.id);
            throw new Error(errorMessage(memberError, 'Không thể thêm thành viên vào nhóm chat.'));
        }

        await insertSystemMessage(conv.id, `Nhóm "${cleanName}" đã được tạo với ${allMembers.length} thành viên`);
        await loadConversations();
        return conv.id;
    }, [insertSystemMessage, loadConversations, user?.id]);

    const addMember = useCallback(async (conversationId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        await ensureGroupAdmin(conversationId, 'thêm thành viên');

        const { data: existingRows, error: existingError } = await supabase
            .from('chat_members')
            .select('*')
            .eq('conversation_id', conversationId)
            .eq('user_id', userId)
            .order('joined_at', { ascending: false })
            .limit(1);

        if (existingError) throw new Error(errorMessage(existingError, 'Không thể kiểm tra thành viên hiện có.'));

        const existing = existingRows?.[0];
        if (existing && !existing.left_at) return;

        const now = new Date().toISOString();
        const result = existing
            ? await supabase.from('chat_members').update({
                role: 'member',
                left_at: null,
                removed_at: null,
                removed_by: null,
                joined_at: now,
                last_read_at: now,
            }).eq('id', existing.id)
            : await supabase.from('chat_members').insert({
                conversation_id: conversationId,
                user_id: userId,
                role: 'member',
            });

        if (result.error) throw new Error(errorMessage(result.error, 'Không thể thêm thành viên.'));

        const addedUser = users.find(u => u.id === userId);
        await insertSystemMessage(conversationId, `${addedUser?.name || 'Người dùng'} đã được thêm vào nhóm`);
        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [activeConversationId, ensureGroupAdmin, insertSystemMessage, loadConversations, loadMessages, user?.id, users]);

    const removeMember = useCallback(async (conversationId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        if (userId === user.id) throw new Error('Dùng chức năng rời nhóm để rời cuộc trò chuyện.');
        await ensureGroupAdmin(conversationId, 'xóa thành viên');

        const removedUser = users.find(u => u.id === userId);
        await insertSystemMessage(conversationId, `${removedUser?.name || 'Người dùng'} đã bị xóa khỏi nhóm`);

        const { error } = await supabase.from('chat_members')
            .update({
                left_at: new Date().toISOString(),
                removed_at: new Date().toISOString(),
                removed_by: user.id,
            })
            .eq('conversation_id', conversationId)
            .eq('user_id', userId)
            .is('left_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể xóa thành viên khỏi nhóm.'));
        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [activeConversationId, ensureGroupAdmin, insertSystemMessage, loadConversations, loadMessages, user?.id, users]);

    const updateGroupName = useCallback(async (conversationId: string, name: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Tên nhóm không được để trống.');
        await ensureGroupAdmin(conversationId, 'đổi tên nhóm');

        const { error } = await supabase.from('chat_conversations')
            .update({ name: cleanName })
            .eq('id', conversationId)
            .eq('type', 'group')
            .is('deleted_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể đổi tên nhóm.'));

        await insertSystemMessage(conversationId, `Tên nhóm đã được đổi thành "${cleanName}"`);
        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [activeConversationId, ensureGroupAdmin, insertSystemMessage, loadConversations, loadMessages, user?.id]);

    const deleteConversation = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const conv = conversationsRef.current.find(c => c.id === conversationId);

        if (conv?.type === 'group') {
            await ensureGroupAdmin(conversationId, 'xóa nhóm');
            await insertSystemMessage(conversationId, `${user.name || 'Quản trị viên'} đã xóa nhóm chat`);
            const { error } = await supabase.from('chat_conversations')
                .update({
                    deleted_at: new Date().toISOString(),
                    deleted_by: user.id,
                })
                .eq('id', conversationId)
                .eq('type', 'group');
            if (error) throw new Error(errorMessage(error, 'Không thể xóa nhóm chat.'));
        } else {
            const { error } = await supabase.from('chat_members')
                .update({
                    left_at: new Date().toISOString(),
                    removed_at: new Date().toISOString(),
                    removed_by: user.id,
                })
                .eq('conversation_id', conversationId)
                .eq('user_id', user.id)
                .is('left_at', null);
            if (error) throw new Error(errorMessage(error, 'Không thể ẩn cuộc trò chuyện.'));
        }

        if (activeConversationId === conversationId) setActiveConversationId(null);
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        setMessages(prev => {
            const copy = { ...prev };
            delete copy[conversationId];
            return copy;
        });
        await loadConversations();
    }, [activeConversationId, ensureGroupAdmin, insertSystemMessage, loadConversations, user?.id, user?.name]);

    const leaveGroup = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');

        const members = await getActiveMembers(conversationId);
        const currentMember = members.find(m => m.userId === user.id);
        if (!currentMember) return;

        const otherMembers = members.filter(m => m.userId !== user.id);
        const otherAdmins = otherMembers.filter(m => m.role === 'admin');

        if (currentMember.role === 'admin' && otherMembers.length > 0 && otherAdmins.length === 0) {
            const promoted = otherMembers[0];
            const { error: promoteError } = await supabase.from('chat_members')
                .update({ role: 'admin' })
                .eq('id', promoted.id);
            if (promoteError) throw new Error(errorMessage(promoteError, 'Không thể chuyển quyền trưởng nhóm trước khi rời nhóm.'));
            const promotedUser = users.find(u => u.id === promoted.userId);
            await insertSystemMessage(conversationId, `${promotedUser?.name || 'Một thành viên'} đã được chuyển quyền trưởng nhóm`);
        }

        await insertSystemMessage(conversationId, `${user.name || 'Người dùng'} đã rời nhóm`);

        const { error } = await supabase.from('chat_members')
            .update({
                left_at: new Date().toISOString(),
                removed_at: new Date().toISOString(),
                removed_by: user.id,
            })
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id)
            .is('left_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể rời nhóm.'));

        if (activeConversationId === conversationId) setActiveConversationId(null);
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        await loadConversations();
    }, [activeConversationId, getActiveMembers, insertSystemMessage, loadConversations, user?.id, user?.name, users]);

    const markAsRead = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;
        const { error } = await supabase
            .from('chat_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id)
            .is('left_at', null);

        if (error) {
            console.error('Error marking chat as read:', error);
            return;
        }

        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ));
    }, [user?.id]);

    const setTyping = useCallback((conversationId: string, isTyping: boolean) => {
        if (!presenceRef.current || !user?.id) return;
        presenceRef.current.send({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: user.id, conversationId, isTyping },
        });
    }, [user?.id]);

    const toggleReaction = useCallback(async (messageId: string, conversationId: string, emoji: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');

        const convMessages = messages[conversationId] || [];
        const msg = convMessages.find(m => m.id === messageId);
        const previousReactions = { ...(msg?.reactions || {}) };
        const nextReactions = { ...previousReactions };
        const usersForEmoji = nextReactions[emoji] || [];

        if (usersForEmoji.includes(user.id)) {
            nextReactions[emoji] = usersForEmoji.filter(uid => uid !== user.id);
            if (nextReactions[emoji].length === 0) delete nextReactions[emoji];
        } else {
            nextReactions[emoji] = [...usersForEmoji, user.id];
        }

        setMessages(prev => ({
            ...prev,
            [conversationId]: (prev[conversationId] || []).map(m =>
                m.id === messageId ? { ...m, reactions: nextReactions } : m
            ),
        }));

        const { error } = await supabase
            .from('chat_messages')
            .update({ reactions: nextReactions })
            .eq('id', messageId)
            .eq('conversation_id', conversationId)
            .is('deleted_at', null);

        if (error) {
            setMessages(prev => ({
                ...prev,
                [conversationId]: (prev[conversationId] || []).map(m =>
                    m.id === messageId ? { ...m, reactions: previousReactions } : m
                ),
            }));
            throw new Error(errorMessage(error, 'Không thể cập nhật cảm xúc.'));
        }
    }, [messages, user?.id]);

    const loadPinnedMessages = useCallback(async () => {
        if (!isSupabaseConfigured || !user?.id) return;

        let visibleConversationIds = conversationsRef.current.map(c => c.id);
        if (visibleConversationIds.length === 0) {
            const { data: memberships, error: membershipError } = await supabase
                .from('chat_members')
                .select('conversation_id')
                .eq('user_id', user.id)
                .is('left_at', null);

            if (membershipError) {
                console.error('Error loading pin memberships:', membershipError);
                return;
            }
            visibleConversationIds = Array.from(new Set((memberships || []).map(m => m.conversation_id)));
        }

        if (visibleConversationIds.length === 0) {
            setPinnedMessages({});
            return;
        }

        const { data, error } = await supabase
            .from('chat_pins')
            .select('conversation_id, message_id, chat_messages(*)')
            .in('conversation_id', visibleConversationIds);

        if (error) {
            console.error('Error loading pins:', error);
            return;
        }

        const visibleIdSet = new Set(visibleConversationIds);
        const pins: Record<string, ChatMessage> = {};
        (data || []).forEach((row: any) => {
            if (row.chat_messages && visibleIdSet.has(row.conversation_id)) {
                pins[row.conversation_id] = mapMessage(row.chat_messages);
            }
        });
        setPinnedMessages(pins);
    }, [user?.id]);

    const pinMessage = useCallback(async (conversationId: string, messageId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');

        const { error: deleteError } = await supabase.from('chat_pins').delete().eq('conversation_id', conversationId);
        if (deleteError) throw new Error(errorMessage(deleteError, 'Không thể bỏ ghim tin nhắn cũ.'));

        const { data, error } = await supabase
            .from('chat_pins')
            .insert({
                conversation_id: conversationId,
                message_id: messageId,
                pinned_by: user.id,
            })
            .select('*, chat_messages(*)')
            .single();

        if (error || !data) throw new Error(errorMessage(error, 'Không thể ghim tin nhắn.'));

        if (data.chat_messages) {
            setPinnedMessages(prev => ({ ...prev, [conversationId]: mapMessage(data.chat_messages) }));
        }
    }, [user?.id]);

    const unpinMessage = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');

        const { error } = await supabase
            .from('chat_pins')
            .delete()
            .eq('conversation_id', conversationId);

        if (error) throw new Error(errorMessage(error, 'Không thể bỏ ghim tin nhắn.'));

        setPinnedMessages(prev => {
            const copy = { ...prev };
            delete copy[conversationId];
            return copy;
        });
    }, [user?.id]);

    const startCallSession = useCallback(async (conversationId: string, mode: 'audio' | 'video') => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');

        const { data, error } = await supabase
            .from('chat_call_sessions')
            .insert({
                conversation_id: conversationId,
                started_by: user.id,
                mode,
                status: 'active',
            })
            .select('id')
            .single();

        if (error || !data) throw new Error(errorMessage(error, 'Không thể bắt đầu cuộc gọi.'));

        const { error: participantError } = await supabase.from('chat_call_participants').insert({
            call_session_id: data.id,
            user_id: user.id,
            status: 'joined',
            joined_at: new Date().toISOString(),
        });
        if (participantError) console.error('Error adding call participant:', participantError);

        await insertSystemMessage(conversationId, `${user.name || 'Người dùng'} đã bắt đầu cuộc gọi ${mode === 'audio' ? 'thoại' : 'video'}`);
        return data.id;
    }, [insertSystemMessage, user?.id, user?.name]);

    const endCallSession = useCallback(async (sessionId: string, conversationId: string, durationSeconds: number) => {
        if (!isSupabaseConfigured || !user?.id || !sessionId) return;

        const { error } = await supabase
            .from('chat_call_sessions')
            .update({
                status: 'ended',
                ended_at: new Date().toISOString(),
                ended_by: user.id,
                duration_seconds: Math.max(0, Math.floor(durationSeconds || 0)),
            })
            .eq('id', sessionId);

        if (error) throw new Error(errorMessage(error, 'Không thể kết thúc cuộc gọi.'));

        await supabase
            .from('chat_call_participants')
            .update({ status: 'left', left_at: new Date().toISOString() })
            .eq('call_session_id', sessionId)
            .eq('user_id', user.id);

        await insertSystemMessage(conversationId, `Cuộc gọi đã kết thúc (${formatDuration(durationSeconds)})`);
    }, [insertSystemMessage, user?.id]);

    useEffect(() => {
        if (!isSupabaseConfigured || !user?.id) return;

        loadConversations();
        loadPinnedMessages();

        const channelName = `chat-realtime-${user.id}`;
        channelRef.current = supabase
            .channel(channelName)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages',
            }, (payload: any) => {
                const m = payload.new;
                if (!m || m.deleted_at) return;
                if (processedMsgIds.current.has(m.id)) return;
                if (!conversationsRef.current.some(c => c.id === m.conversation_id)) {
                    loadConversations();
                    return;
                }

                processedMsgIds.current.add(m.id);
                const newMsg = mapMessage(m);

                setMessages(prev => {
                    const existing = prev[m.conversation_id] || [];
                    if (existing.some(msg => msg.id === m.id)) return prev;
                    return { ...prev, [m.conversation_id]: [...existing, newMsg] };
                });

                setConversations(prev => prev.map(c =>
                    c.id === m.conversation_id
                        ? { ...c, lastMessage: newMsg, unreadCount: m.sender_id === user.id ? c.unreadCount : (c.unreadCount || 0) + 1 }
                        : c
                ).sort((a, b) => {
                    const aTime = a.lastMessage?.createdAt || a.createdAt;
                    const bTime = b.lastMessage?.createdAt || b.createdAt;
                    return bTime.localeCompare(aTime);
                }));
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_messages',
            }, (payload: any) => {
                const m = payload.new;
                if (!m || !conversationsRef.current.some(c => c.id === m.conversation_id)) return;
                setMessages(prev => {
                    const convMsgs = prev[m.conversation_id];
                    if (!convMsgs) return prev;
                    if (m.deleted_at) {
                        return { ...prev, [m.conversation_id]: convMsgs.filter(msg => msg.id !== m.id) };
                    }
                    return {
                        ...prev,
                        [m.conversation_id]: convMsgs.map(msg => msg.id === m.id ? mapMessage(m) : msg),
                    };
                });
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_conversations',
            }, () => loadConversations())
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_members',
            }, () => loadConversations())
            .subscribe();

        presenceRef.current = supabase.channel(`chat-presence-${user.id}`);
        presenceRef.current
            .on('presence', { event: 'sync' }, () => {
                const state = presenceRef.current.presenceState();
                const onlineIds = new Set<string>();
                Object.values(state).forEach((presences: any) => {
                    presences.forEach((p: any) => { if (p.userId) onlineIds.add(p.userId); });
                });
                setOnlineUsers(onlineIds);
            })
            .on('broadcast', { event: 'typing' }, (payload: any) => {
                const { userId, conversationId, isTyping } = payload.payload || {};
                if (!userId || !conversationId || userId === user.id) return;
                setTypingUsers(prev => {
                    const current = prev[conversationId] || [];
                    if (isTyping && !current.includes(userId)) {
                        return { ...prev, [conversationId]: [...current, userId] };
                    }
                    if (!isTyping) {
                        return { ...prev, [conversationId]: current.filter(id => id !== userId) };
                    }
                    return prev;
                });
                if (isTyping) {
                    setTimeout(() => {
                        setTypingUsers(prev => ({
                            ...prev,
                            [conversationId]: (prev[conversationId] || []).filter(id => id !== userId),
                        }));
                    }, 5000);
                }
            })
            .subscribe(async (status: string) => {
                if (status === 'SUBSCRIBED') {
                    await presenceRef.current.track({ userId: user.id, online_at: new Date().toISOString() });
                }
            });

        const pinsChannel = supabase
            .channel(`chat-pins-realtime-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_pins',
            }, () => loadPinnedMessages())
            .subscribe();

        return () => {
            if (channelRef.current) supabase.removeChannel(channelRef.current);
            if (presenceRef.current) supabase.removeChannel(presenceRef.current);
            supabase.removeChannel(pinsChannel);
        };
    }, [loadConversations, loadPinnedMessages, user?.id]);

    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    return (
        <ChatContext.Provider value={{
            conversations,
            messages,
            activeConversationId,
            setActiveConversationId,
            onlineUsers,
            typingUsers,
            sendMessage,
            createDirectConversation,
            createGroupConversation,
            addMember,
            removeMember,
            updateGroupName,
            deleteConversation,
            leaveGroup,
            markAsRead,
            loadMessages,
            setTyping,
            toggleReaction,
            pinnedMessages,
            pinMessage,
            unpinMessage,
            startCallSession,
            endCallSession,
            totalUnread,
        }}>
            {children}
        </ChatContext.Provider>
    );
};
