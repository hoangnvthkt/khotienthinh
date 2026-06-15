import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useApp } from './AppContext';
import { ChatChannelKind, ChatConversation, ChatMember, ChatMessage, ChatWorkspace, ChatWorkspaceMember } from '../types';
import { isChatEnabled } from '../lib/featureFlags';

interface ChatContextType {
    workspaces: ChatWorkspace[];
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
    createWorkspace: (name: string, description?: string) => Promise<string>;
    updateWorkspace: (workspaceId: string, updates: { name?: string; description?: string | null; iconText?: string | null; color?: string | null }) => Promise<void>;
    deleteWorkspace: (workspaceId: string) => Promise<void>;
    addWorkspaceMember: (workspaceId: string, userId: string) => Promise<void>;
    removeWorkspaceMember: (workspaceId: string, userId: string) => Promise<void>;
    createChannel: (workspaceId: string, name: string, kind: ChatChannelKind) => Promise<string>;
    updateChannel: (conversationId: string, name: string) => Promise<void>;
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
    loadChatData: (force?: boolean) => Promise<void>;
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

const mapWorkspaceMember = (m: any): ChatWorkspaceMember => ({
    id: m.id,
    workspaceId: m.workspace_id,
    userId: m.user_id,
    role: m.role,
    joinedAt: m.joined_at,
    leftAt: m.left_at || null,
});

const mapWorkspace = (w: any, members: ChatWorkspaceMember[] = []): ChatWorkspace => ({
    id: w.id,
    name: w.name,
    iconText: w.icon_text || null,
    color: w.color || 'indigo',
    description: w.description || null,
    isPublic: w.is_public ?? true,
    sortOrder: w.sort_order || 0,
    createdBy: w.created_by || null,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    deletedAt: w.deleted_at || null,
    members,
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
    const [workspaces, setWorkspaces] = useState<ChatWorkspace[]>([]);
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
    const [pinnedMessages, setPinnedMessages] = useState<Record<string, ChatMessage>>({});
    const channelRef = useRef<any>(null);
    const presenceRef = useRef<any>(null);
    const conversationsRef = useRef<ChatConversation[]>([]);
    const workspacesRef = useRef<ChatWorkspace[]>([]);
    const processedMsgIds = useRef<Set<string>>(new Set());
    const chatLoadedRef = useRef(false);
    const chatLoadingRef = useRef<Promise<void> | null>(null);

    const isAppAdmin = String(user?.role || '') === 'ADMIN';

    useEffect(() => {
        chatLoadedRef.current = false;
        chatLoadingRef.current = null;
    }, [user?.id]);

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    useEffect(() => {
        workspacesRef.current = workspaces;
    }, [workspaces]);

    const loadWorkspaces = useCallback(async () => {
        if (!isSupabaseConfigured || !user?.id) {
            setWorkspaces([]);
            return;
        }

        let workspaceIds: string[] | null = null;
        if (!isAppAdmin) {
            const { data: memberRows, error: memberError } = await supabase
                .from('chat_workspace_members')
                .select('workspace_id')
                .eq('user_id', user.id)
                .is('left_at', null);

            if (memberError) {
                console.error('Error loading chat workspace memberships:', memberError);
                setWorkspaces([]);
                return;
            }

            workspaceIds = Array.from(new Set((memberRows || []).map(row => row.workspace_id)));
            if (workspaceIds.length === 0) {
                setWorkspaces([]);
                return;
            }
        }

        let workspaceQuery = supabase
            .from('chat_workspaces')
            .select('*')
            .is('deleted_at', null)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        if (workspaceIds) workspaceQuery = workspaceQuery.in('id', workspaceIds);

        const { data: workspaceRows, error: workspaceError } = await workspaceQuery;
        if (workspaceError) {
            console.error('Error loading chat workspaces:', workspaceError);
            setWorkspaces([]);
            return;
        }

        const visibleIds = (workspaceRows || []).map(row => row.id);
        if (visibleIds.length === 0) {
            setWorkspaces([]);
            return;
        }

        const { data: memberRows, error: membersError } = await supabase
            .from('chat_workspace_members')
            .select('*')
            .in('workspace_id', visibleIds)
            .is('left_at', null);

        if (membersError) console.error('Error loading chat workspace members:', membersError);

        const members = (memberRows || []).map(mapWorkspaceMember);
        setWorkspaces((workspaceRows || []).map(row => (
            mapWorkspace(row, members.filter(member => member.workspaceId === row.id))
        )));
    }, [isAppAdmin, user?.id]);

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
            const unreadCount = c.type === 'channel_voice' ? 0 : convMessages.filter(m => m.created_at > myLastRead && m.sender_id !== user.id).length;

            return {
                id: c.id,
                type: c.type,
                name: c.name || undefined,
                workspaceId: c.workspace_id || null,
                channelKind: c.channel_kind || null,
                description: c.description || null,
                sortOrder: c.sort_order || 0,
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
        if (conv?.type === 'direct') return;
        if (conv?.createdBy === user.id) return;

        const members = await getActiveMembers(conversationId);
        const currentMember = members.find(m => m.userId === user.id);
        if (currentMember?.role !== 'admin') {
            throw new Error(`Chỉ quản trị viên kênh/nhóm mới được ${actionLabel}.`);
        }
    }, [getActiveMembers, isAppAdmin, user?.id]);

    const getActiveWorkspaceMembers = useCallback(async (workspaceId: string): Promise<ChatWorkspaceMember[]> => {
        const cached = workspacesRef.current.find(w => w.id === workspaceId)?.members?.filter(m => !m.leftAt);
        if (cached && cached.length > 0) return cached;

        const { data, error } = await supabase
            .from('chat_workspace_members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .is('left_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể tải thành viên kênh chat.'));
        return (data || []).map(mapWorkspaceMember);
    }, []);

    const ensureWorkspaceAdmin = useCallback(async (workspaceId: string, actionLabel: string) => {
        if (!user?.id || isAppAdmin) return;
        const workspace = workspacesRef.current.find(w => w.id === workspaceId);
        if (workspace?.createdBy === user.id) return;

        const members = await getActiveWorkspaceMembers(workspaceId);
        const currentMember = members.find(m => m.userId === user.id);
        if (!currentMember || !['owner', 'admin'].includes(currentMember.role)) {
            throw new Error(`Chỉ quản trị viên kênh chat mới được ${actionLabel}.`);
        }
    }, [getActiveWorkspaceMembers, isAppAdmin, user?.id]);

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

    const createChannel = useCallback(async (workspaceId: string, name: string, kind: ChatChannelKind): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const cleanWorkspaceId = workspaceId.trim();
        const cleanName = name.trim();
        if (!cleanWorkspaceId || cleanWorkspaceId === 'dm') throw new Error('Workspace tạo kênh không hợp lệ.');
        if (!cleanName) throw new Error('Tên kênh không được để trống.');
        await ensureWorkspaceAdmin(cleanWorkspaceId, 'tạo phòng trong kênh');

        const workspaceMembers = await getActiveWorkspaceMembers(cleanWorkspaceId);
        const memberIds = Array.from(new Set(
            (workspaceMembers.length > 0 ? workspaceMembers.map(member => member.userId) : users.filter(u => u.isActive !== false).map(u => u.id))
                .concat(user.id)
                .filter(Boolean)
        ));
        const type = kind === 'voice' ? 'channel_voice' : 'channel_text';

        const { data: conv, error: convError } = await supabase
            .from('chat_conversations')
            .insert({
                type,
                name: cleanName,
                workspace_id: cleanWorkspaceId,
                channel_kind: kind,
                created_by: user.id,
            })
            .select()
            .single();

        if (convError || !conv) throw new Error(errorMessage(convError, 'Không thể tạo kênh chat.'));

        const { error: memberError } = await supabase.from('chat_members').insert(
            memberIds.map(uid => ({
                conversation_id: conv.id,
                user_id: uid,
                role: uid === user.id ? 'admin' : 'member',
            }))
        );

        if (memberError) {
            await supabase.from('chat_conversations').update({
                deleted_at: new Date().toISOString(),
                deleted_by: user.id,
            }).eq('id', conv.id);
            throw new Error(errorMessage(memberError, 'Không thể cấp thành viên cho kênh chat.'));
        }

        await insertSystemMessage(conv.id, `Kênh ${kind === 'voice' ? 'âm thanh' : 'văn bản'} "${cleanName}" đã được tạo`);
        await loadConversations();
        return conv.id;
    }, [ensureWorkspaceAdmin, getActiveWorkspaceMembers, insertSystemMessage, loadConversations, user?.id, users]);

    const createWorkspace = useCallback(async (name: string, description?: string): Promise<string> => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Tên kênh chat không được để trống.');

        const memberIds = [user.id];
        const iconText = cleanName
            .split(/\s+/)
            .map(part => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

        const { data: workspace, error: workspaceError } = await supabase
            .from('chat_workspaces')
            .insert({
                name: cleanName,
                description: description?.trim() || null,
                icon_text: iconText || cleanName.slice(0, 2).toUpperCase(),
                created_by: user.id,
            })
            .select()
            .single();

        if (workspaceError || !workspace) throw new Error(errorMessage(workspaceError, 'Không thể tạo kênh chat.'));

        const { error: memberError } = await supabase.from('chat_workspace_members').insert(
            memberIds.map(uid => ({
                workspace_id: workspace.id,
                user_id: uid,
                role: uid === user.id ? 'owner' : 'member',
            }))
        );

        if (memberError) {
            await supabase
                .from('chat_workspaces')
                .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
                .eq('id', workspace.id);
            throw new Error(errorMessage(memberError, 'Không thể cấp thành viên cho kênh chat.'));
        }

        await loadWorkspaces();
        await loadConversations();
        return workspace.id;
    }, [loadConversations, loadWorkspaces, user?.id]);

    const updateWorkspace = useCallback(async (
        workspaceId: string,
        updates: { name?: string; description?: string | null; iconText?: string | null; color?: string | null }
    ) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        await ensureWorkspaceAdmin(workspaceId, 'cập nhật kênh chat');

        const payload: any = {};
        if (updates.name !== undefined) {
            const cleanName = updates.name.trim();
            if (!cleanName) throw new Error('Tên kênh chat không được để trống.');
            payload.name = cleanName;
        }
        if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
        if (updates.iconText !== undefined) payload.icon_text = updates.iconText?.trim().slice(0, 3).toUpperCase() || null;
        if (updates.color !== undefined) payload.color = updates.color || 'indigo';

        const { error } = await supabase
            .from('chat_workspaces')
            .update(payload)
            .eq('id', workspaceId)
            .is('deleted_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể cập nhật kênh chat.'));
        await loadWorkspaces();
    }, [ensureWorkspaceAdmin, loadWorkspaces, user?.id]);

    const deleteWorkspace = useCallback(async (workspaceId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        await ensureWorkspaceAdmin(workspaceId, 'xóa kênh chat');

        const now = new Date().toISOString();
        const { error } = await supabase
            .from('chat_workspaces')
            .update({ deleted_at: now, deleted_by: user.id })
            .eq('id', workspaceId);

        if (error) throw new Error(errorMessage(error, 'Không thể xóa kênh chat.'));

        await supabase
            .from('chat_conversations')
            .update({ deleted_at: now, deleted_by: user.id })
            .eq('workspace_id', workspaceId)
            .in('type', ['channel_text', 'channel_voice']);

        if (activeConversationId && conversationsRef.current.find(c => c.id === activeConversationId)?.workspaceId === workspaceId) {
            setActiveConversationId(null);
        }
        await loadWorkspaces();
        await loadConversations();
    }, [activeConversationId, ensureWorkspaceAdmin, loadConversations, loadWorkspaces, user?.id]);

    const addWorkspaceMember = useCallback(async (workspaceId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        await ensureWorkspaceAdmin(workspaceId, 'thêm thành viên kênh chat');

        const now = new Date().toISOString();
        const { data: existingRows, error: existingError } = await supabase
            .from('chat_workspace_members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .limit(1);

        if (existingError) throw new Error(errorMessage(existingError, 'Không thể kiểm tra thành viên kênh chat.'));
        const existing = existingRows?.[0];

        const result = existing
            ? await supabase.from('chat_workspace_members').update({
                role: 'member',
                left_at: null,
                removed_at: null,
                removed_by: null,
                joined_at: now,
            }).eq('id', existing.id)
            : await supabase.from('chat_workspace_members').insert({
                workspace_id: workspaceId,
                user_id: userId,
                role: 'member',
            });

        if (result.error) throw new Error(errorMessage(result.error, 'Không thể thêm thành viên kênh chat.'));

        const { data: roomRows } = await supabase
            .from('chat_conversations')
            .select('id')
            .eq('workspace_id', workspaceId)
            .in('type', ['channel_text', 'channel_voice'])
            .is('deleted_at', null);

        if (roomRows && roomRows.length > 0) {
            const roomIds = roomRows.map(room => room.id);
            const { data: existingChatMembers } = await supabase
                .from('chat_members')
                .select('id, conversation_id')
                .in('conversation_id', roomIds)
                .eq('user_id', userId);

            const existingRoomIds = new Set((existingChatMembers || []).map(row => row.conversation_id));
            if (existingChatMembers && existingChatMembers.length > 0) {
                await supabase
                    .from('chat_members')
                    .update({
                        role: 'member',
                        left_at: null,
                        removed_at: null,
                        removed_by: null,
                        joined_at: now,
                        last_read_at: now,
                    })
                    .in('id', existingChatMembers.map(row => row.id));
            }

            const missingRows = roomRows
                .filter(room => !existingRoomIds.has(room.id))
                .map(room => ({
                    conversation_id: room.id,
                    user_id: userId,
                    role: 'member',
                    last_read_at: now,
                    joined_at: now,
                }));

            if (missingRows.length > 0) await supabase.from('chat_members').insert(missingRows);
        }

        await loadWorkspaces();
        await loadConversations();
    }, [ensureWorkspaceAdmin, loadConversations, loadWorkspaces, user?.id]);

    const removeWorkspaceMember = useCallback(async (workspaceId: string, userId: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        if (userId === user.id) throw new Error('Không thể tự xóa mình khỏi kênh chat bằng thao tác này.');
        await ensureWorkspaceAdmin(workspaceId, 'xóa thành viên kênh chat');

        const now = new Date().toISOString();
        const { error } = await supabase
            .from('chat_workspace_members')
            .update({ left_at: now, removed_at: now, removed_by: user.id })
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .is('left_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể xóa thành viên kênh chat.'));

        const { data: roomRows } = await supabase
            .from('chat_conversations')
            .select('id')
            .eq('workspace_id', workspaceId)
            .in('type', ['channel_text', 'channel_voice'])
            .is('deleted_at', null);

        if (roomRows && roomRows.length > 0) {
            await supabase
                .from('chat_members')
                .update({ left_at: now, removed_at: now, removed_by: user.id })
                .in('conversation_id', roomRows.map(room => room.id))
                .eq('user_id', userId)
                .is('left_at', null);
        }

        await loadWorkspaces();
        await loadConversations();
    }, [ensureWorkspaceAdmin, loadConversations, loadWorkspaces, user?.id]);

    const updateChannel = useCallback(async (conversationId: string, name: string) => {
        if (!isSupabaseConfigured || !user?.id) throw new Error('Supabase chưa được cấu hình hoặc người dùng chưa đăng nhập.');
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Tên kênh không được để trống.');
        await ensureGroupAdmin(conversationId, 'đổi tên kênh');

        const { error } = await supabase.from('chat_conversations')
            .update({ name: cleanName })
            .eq('id', conversationId)
            .in('type', ['channel_text', 'channel_voice'])
            .is('deleted_at', null);

        if (error) throw new Error(errorMessage(error, 'Không thể đổi tên kênh.'));

        await insertSystemMessage(conversationId, `Tên kênh đã được đổi thành "${cleanName}"`);
        await loadConversations();
        if (activeConversationId === conversationId) await loadMessages(conversationId);
    }, [activeConversationId, ensureGroupAdmin, insertSystemMessage, loadConversations, loadMessages, user?.id]);

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

        if (conv?.type === 'group' || conv?.type === 'channel_text' || conv?.type === 'channel_voice') {
            const isChannel = conv.type === 'channel_text' || conv.type === 'channel_voice';
            await ensureGroupAdmin(conversationId, isChannel ? 'xóa kênh' : 'xóa nhóm');
            await insertSystemMessage(conversationId, `${user.name || 'Quản trị viên'} đã xóa ${isChannel ? 'kênh chat' : 'nhóm chat'}`);
            const { error } = await supabase.from('chat_conversations')
                .update({
                    deleted_at: new Date().toISOString(),
                    deleted_by: user.id,
                })
                .eq('id', conversationId)
                .in('type', isChannel ? ['channel_text', 'channel_voice'] : ['group']);
            if (error) throw new Error(errorMessage(error, isChannel ? 'Không thể xóa kênh chat.' : 'Không thể xóa nhóm chat.'));
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

    const loadChatData = useCallback(async (force = false) => {
        if (!isChatEnabled) return;
        if (!isSupabaseConfigured || !user?.id) return;
        if (!force && chatLoadedRef.current) return;
        if (chatLoadingRef.current) return chatLoadingRef.current;

        const task = (async () => {
            await Promise.all([
                loadWorkspaces(),
                loadConversations(),
            ]);
            await loadPinnedMessages();
            chatLoadedRef.current = true;
        })();

        chatLoadingRef.current = task;
        try {
            await task;
        } finally {
            chatLoadingRef.current = null;
        }
    }, [loadConversations, loadPinnedMessages, loadWorkspaces, user?.id]);

    useEffect(() => {
        if (!isChatEnabled) return;
        if (!isSupabaseConfigured || !user?.id) return;

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
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_workspaces',
            }, () => loadWorkspaces())
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_workspace_members',
            }, () => {
                loadWorkspaces();
                loadConversations();
            })
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
            }, () => {
                if (chatLoadedRef.current) loadPinnedMessages();
            })
            .subscribe();

        return () => {
            if (channelRef.current) supabase.removeChannel(channelRef.current);
            if (presenceRef.current) supabase.removeChannel(presenceRef.current);
            supabase.removeChannel(pinsChannel);
        };
    }, [loadConversations, loadPinnedMessages, user?.id]);

    const totalUnread = conversations.reduce((sum, c) => sum + (c.type === 'channel_voice' ? 0 : (c.unreadCount || 0)), 0);

    return (
        <ChatContext.Provider value={{
            workspaces,
            conversations,
            messages,
            activeConversationId,
            setActiveConversationId,
            onlineUsers,
            typingUsers,
            sendMessage,
            createDirectConversation,
            createGroupConversation,
            createWorkspace,
            updateWorkspace,
            deleteWorkspace,
            addWorkspaceMember,
            removeWorkspaceMember,
            createChannel,
            updateChannel,
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
            loadChatData,
        }}>
            {children}
        </ChatContext.Provider>
    );
};
