import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useApp } from './AppContext';
import { ChatConversation, ChatMember, ChatMessage } from '../types';

interface ChatContextType {
    conversations: ChatConversation[];
    messages: Record<string, ChatMessage[]>; // conversationId -> messages
    activeConversationId: string | null;
    setActiveConversationId: (id: string | null) => void;
    onlineUsers: Set<string>;
    typingUsers: Record<string, string[]>; // conversationId -> userIds
    sendMessage: (conversationId: string, content: string, type?: ChatMessage['type'], attachments?: ChatMessage['attachments']) => Promise<void>;
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
    totalUnread: number;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
    const ctx = useContext(ChatContext);
    if (!ctx) throw new Error('useChat must be used within ChatProvider');
    return ctx;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, users } = useApp();
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
    const channelRef = useRef<any>(null);
    const presenceRef = useRef<any>(null);
    const processedMsgIds = useRef<Set<string>>(new Set());

    // === LOAD CONVERSATIONS ===
    const loadConversations = useCallback(async () => {
        if (!isSupabaseConfigured || !user?.id) return;

        // Load conversations where user is a member
        const { data: memberData } = await supabase
            .from('chat_members')
            .select('conversation_id, last_read_at, role')
            .eq('user_id', user.id);

        if (!memberData || memberData.length === 0) return;

        const convIds = memberData.map(m => m.conversation_id);

        const { data: convData } = await supabase
            .from('chat_conversations')
            .select('*')
            .in('id', convIds)
            .order('created_at', { ascending: false });

        if (!convData) return;

        // Load all members for these conversations
        const { data: allMembers } = await supabase
            .from('chat_members')
            .select('*')
            .in('conversation_id', convIds);

        // Load last message for each conversation
        const { data: lastMessages } = await supabase
            .from('chat_messages')
            .select('*')
            .in('conversation_id', convIds)
            .order('created_at', { ascending: false });

        // Build conversation objects with computed fields
        const conversationsWithMeta: ChatConversation[] = convData.map(c => {
            const myMembership = memberData.find(m => m.conversation_id === c.id);
            const members: ChatMember[] = (allMembers || [])
                .filter(m => m.conversation_id === c.id)
                .map(m => ({
                    id: m.id,
                    conversationId: m.conversation_id,
                    userId: m.user_id,
                    role: m.role,
                    lastReadAt: m.last_read_at,
                    joinedAt: m.joined_at,
                }));

            // Find last message for this conversation
            const convMsgs = (lastMessages || []).filter(m => m.conversation_id === c.id);
            const lastMsg = convMsgs[0];

            // Count unread
            const myLastRead = myMembership?.last_read_at || '1970-01-01';
            const unreadCount = convMsgs.filter(m =>
                m.created_at > myLastRead && m.sender_id !== user.id
            ).length;

            return {
                id: c.id,
                type: c.type,
                name: c.name || undefined,
                avatarUrl: c.avatar_url || undefined,
                createdBy: c.created_by || undefined,
                createdAt: c.created_at,
                members,
                lastMessage: lastMsg ? {
                    id: lastMsg.id,
                    conversationId: lastMsg.conversation_id,
                    senderId: lastMsg.sender_id,
                    content: lastMsg.content,
                    type: lastMsg.type,
                    attachments: lastMsg.attachments,
                    createdAt: lastMsg.created_at,
                } : undefined,
                unreadCount,
            };
        });

        // Sort by last message time
        conversationsWithMeta.sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return bTime.localeCompare(aTime);
        });

        setConversations(conversationsWithMeta);
    }, [user?.id]);

    // === LOAD MESSAGES FOR A CONVERSATION ===
    const loadMessages = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured) return;

        const { data } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(200);

        if (data) {
            setMessages(prev => ({
                ...prev,
                [conversationId]: data.map(m => ({
                    id: m.id,
                    conversationId: m.conversation_id,
                    senderId: m.sender_id,
                    content: m.content,
                    type: m.type,
                    attachments: m.attachments,
                    reactions: m.reactions || {},
                    createdAt: m.created_at,
                })),
            }));
        }
    }, []);

    // === SEND MESSAGE ===
    const sendMessage = useCallback(async (
        conversationId: string,
        content: string,
        type: ChatMessage['type'] = 'text',
        attachments?: ChatMessage['attachments']
    ) => {
        if (!isSupabaseConfigured || !user?.id) return;

        const msg = {
            conversation_id: conversationId,
            sender_id: user.id,
            content: content.trim(),
            type,
            attachments: attachments || [],
        };

        const { data, error } = await supabase.from('chat_messages').insert(msg).select().single();
        if (error) { console.error('Error sending message:', error); return; }

        // Mark as processed BEFORE state update (synchronous guard)
        processedMsgIds.current.add(data.id);

        const newMsg: ChatMessage = {
            id: data.id,
            conversationId: data.conversation_id,
            senderId: data.sender_id,
            content: data.content,
            type: data.type,
            attachments: data.attachments,
            reactions: data.reactions || {},
            createdAt: data.created_at,
        };

        setMessages(prev => ({
            ...prev,
            [conversationId]: [...(prev[conversationId] || []), newMsg],
        }));

        // Update conversation last message
        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, lastMessage: newMsg } : c
        ).sort((a, b) => {
            const aTime = a.lastMessage?.createdAt || a.createdAt;
            const bTime = b.lastMessage?.createdAt || b.createdAt;
            return bTime.localeCompare(aTime);
        }));
    }, [user?.id]);

    // === CREATE DIRECT CONVERSATION ===
    const createDirectConversation = useCallback(async (targetUserId: string): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Not configured');

        // Check if direct conversation already exists
        const existing = conversations.find(c =>
            c.type === 'direct' &&
            c.members?.some(m => m.userId === targetUserId) &&
            c.members?.some(m => m.userId === user.id)
        );
        if (existing) return existing.id;

        // Create new conversation
        const { data: conv, error: convError } = await supabase
            .from('chat_conversations')
            .insert({ type: 'direct', created_by: user.id })
            .select()
            .single();

        if (convError || !conv) throw convError;

        // Add both members
        await supabase.from('chat_members').insert([
            { conversation_id: conv.id, user_id: user.id, role: 'admin' },
            { conversation_id: conv.id, user_id: targetUserId, role: 'member' },
        ]);

        // Send system message
        await supabase.from('chat_messages').insert({
            conversation_id: conv.id,
            sender_id: user.id,
            content: 'Cuộc trò chuyện đã được tạo',
            type: 'system',
        });

        await loadConversations();
        return conv.id;
    }, [user?.id, conversations, loadConversations]);

    // === CREATE GROUP CONVERSATION ===
    const createGroupConversation = useCallback(async (name: string, memberIds: string[]): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Not configured');

        const { data: conv, error: convError } = await supabase
            .from('chat_conversations')
            .insert({ type: 'group', name, created_by: user.id })
            .select()
            .single();

        if (convError || !conv) throw convError;

        const allMembers = [user.id, ...memberIds.filter(id => id !== user.id)];
        await supabase.from('chat_members').insert(
            allMembers.map((uid, i) => ({
                conversation_id: conv.id,
                user_id: uid,
                role: i === 0 ? 'admin' : 'member',
            }))
        );

        await supabase.from('chat_messages').insert({
            conversation_id: conv.id,
            sender_id: user.id,
            content: `Nhóm "${name}" đã được tạo với ${allMembers.length} thành viên`,
            type: 'system',
        });

        await loadConversations();
        return conv.id;
    }, [user?.id, loadConversations]);

    // === ADD MEMBER TO GROUP ===
    const addMember = useCallback(async (conversationId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        await supabase.from('chat_members').insert({
            conversation_id: conversationId,
            user_id: userId,
            role: 'member',
        });

        const addedUser = users.find(u => u.id === userId);
        await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: `${addedUser?.name || 'Người dùng'} đã được thêm vào nhóm`,
            type: 'system',
        });

        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [user?.id, users, loadConversations, loadMessages, activeConversationId]);

    // === REMOVE MEMBER FROM GROUP ===
    const removeMember = useCallback(async (conversationId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        await supabase.from('chat_members')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('user_id', userId);

        const removedUser = users.find(u => u.id === userId);
        await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: `${removedUser?.name || 'Người dùng'} đã bị xóa khỏi nhóm`,
            type: 'system',
        });

        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [user?.id, users, loadConversations, loadMessages, activeConversationId]);

    // === UPDATE GROUP NAME ===
    const updateGroupName = useCallback(async (conversationId: string, name: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        await supabase.from('chat_conversations')
            .update({ name })
            .eq('id', conversationId);

        await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: `Tên nhóm đã được đổi thành "${name}"`,
            type: 'system',
        });

        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [user?.id, loadConversations, loadMessages, activeConversationId]);

    // === DELETE CONVERSATION ===
    const deleteConversation = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        // Delete messages, members, then conversation
        await supabase.from('chat_messages').delete().eq('conversation_id', conversationId);
        await supabase.from('chat_members').delete().eq('conversation_id', conversationId);
        await supabase.from('chat_conversations').delete().eq('id', conversationId);

        if (activeConversationId === conversationId) setActiveConversationId(null);
        await loadConversations();
    }, [user?.id, activeConversationId, loadConversations]);

    // === LEAVE GROUP ===
    const leaveGroup = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        await supabase.from('chat_members')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id);

        await supabase.from('chat_messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            content: `${user.name || 'Người dùng'} đã rời nhóm`,
            type: 'system',
        });

        if (activeConversationId === conversationId) setActiveConversationId(null);
        await loadConversations();
    }, [user?.id, user?.name, activeConversationId, loadConversations]);

    // === MARK AS READ ===
    const markAsRead = useCallback(async (conversationId: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        await supabase
            .from('chat_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('user_id', user.id);

        setConversations(prev => prev.map(c =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
        ));
    }, [user?.id]);

    // === TYPING INDICATOR (via broadcast) ===
    const setTyping = useCallback((conversationId: string, isTyping: boolean) => {
        if (!presenceRef.current || !user?.id) return;
        presenceRef.current.send({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: user.id, conversationId, isTyping },
        });
    }, [user?.id]);

    // === TOGGLE REACTION ===
    const toggleReaction = useCallback(async (messageId: string, conversationId: string, emoji: string) => {
        if (!isSupabaseConfigured || !user?.id) return;

        // Get current reactions from state
        const convMessages = messages[conversationId] || [];
        const msg = convMessages.find(m => m.id === messageId);
        const currentReactions = { ...(msg?.reactions || {}) };

        // Toggle user in this emoji
        const usersForEmoji = currentReactions[emoji] || [];
        if (usersForEmoji.includes(user.id)) {
            currentReactions[emoji] = usersForEmoji.filter(uid => uid !== user.id);
            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
        } else {
            currentReactions[emoji] = [...usersForEmoji, user.id];
        }

        // Optimistic update
        setMessages(prev => ({
            ...prev,
            [conversationId]: (prev[conversationId] || []).map(m =>
                m.id === messageId ? { ...m, reactions: currentReactions } : m
            ),
        }));

        // Update in DB
        await supabase
            .from('chat_messages')
            .update({ reactions: currentReactions })
            .eq('id', messageId);
    }, [user?.id, messages]);

    // === REALTIME SUBSCRIPTIONS ===
    useEffect(() => {
        if (!isSupabaseConfigured || !user?.id) return;

        loadConversations();

        // Subscribe to new messages (unique channel name to avoid StrictMode conflicts)
        const channelName = `chat-realtime-${Date.now()}`;
        channelRef.current = supabase
            .channel(channelName)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages',
            }, (payload: any) => {
                const m = payload.new;

                // Synchronous dedup: skip if already processed
                if (processedMsgIds.current.has(m.id)) return;
                processedMsgIds.current.add(m.id);

                const newMsg: ChatMessage = {
                    id: m.id,
                    conversationId: m.conversation_id,
                    senderId: m.sender_id,
                    content: m.content,
                    type: m.type,
                    attachments: m.attachments,
                    reactions: m.reactions || {},
                    createdAt: m.created_at,
                };

                setMessages(prev => ({
                    ...prev,
                    [m.conversation_id]: [...(prev[m.conversation_id] || []), newMsg],
                }));

                setConversations(prev => {
                    const exists = prev.some(c => c.id === m.conversation_id);
                    if (!exists) {
                        // New conversation we aren't tracking yet - reload
                        loadConversations();
                        return prev;
                    }
                    return prev.map(c =>
                        c.id === m.conversation_id
                            ? { ...c, lastMessage: newMsg, unreadCount: (c.unreadCount || 0) + 1 }
                            : c
                    ).sort((a, b) => {
                        const aTime = a.lastMessage?.createdAt || a.createdAt;
                        const bTime = b.lastMessage?.createdAt || b.createdAt;
                        return bTime.localeCompare(aTime);
                    });
                });
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_messages',
            }, (payload: any) => {
                const m = payload.new;
                // Update reactions in state
                setMessages(prev => {
                    const convMsgs = prev[m.conversation_id];
                    if (!convMsgs) return prev;
                    return {
                        ...prev,
                        [m.conversation_id]: convMsgs.map(msg =>
                            msg.id === m.id ? { ...msg, reactions: m.reactions || {} } : msg
                        ),
                    };
                });
            })
            .subscribe();

        // Presence channel for online status + typing
        presenceRef.current = supabase.channel('chat-presence');
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
                    } else if (!isTyping) {
                        return { ...prev, [conversationId]: current.filter(id => id !== userId) };
                    }
                    return prev;
                });
                // Auto-clear typing after 5s
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

        return () => {
            if (channelRef.current) supabase.removeChannel(channelRef.current);
            if (presenceRef.current) supabase.removeChannel(presenceRef.current);
        };
    }, [user?.id, loadConversations]);

    // === TOTAL UNREAD ===
    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    return (
        <ChatContext.Provider value={{
            conversations, messages, activeConversationId, setActiveConversationId,
            onlineUsers, typingUsers, sendMessage, createDirectConversation,
            createGroupConversation, addMember, removeMember, updateGroupName,
            deleteConversation, leaveGroup, markAsRead, loadMessages, setTyping, toggleReaction, totalUnread,
        }}>
            {children}
        </ChatContext.Provider>
    );
};
