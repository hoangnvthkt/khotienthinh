import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useChat } from '../context/ChatContext';
import { useApp } from '../context/AppContext';
import { useModuleData } from '../hooks/useModuleData';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
    MessageCircle, Search, Plus, Send, Paperclip, Users, X, Check, CheckCheck,
    Hash, User as UserIcon, Smile, MoreVertical, ArrowLeft, Image as ImageIcon, File,
    Edit3, Trash2, LogOut, UserPlus, UserMinus, Crown, Shield, Volume2, Mic, MicOff,
    Headphones, VolumeX, Pin, Phone, Video, ChevronDown, ChevronRight, Compass,
    Sparkles, Settings, Info, Share2, HelpCircle, CheckCircle, FileText, CornerUpLeft,
    Palette, RotateCcw
} from 'lucide-react';
import { matchesSearchQueryMultiple } from '../lib/searchUtils';

// ===================== CONSTANTS & THEMES =====================
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '👏'];
const QUICK_EMOJIS = ['😀', '😂', '🤣', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤔', '🤗', '😏', '😈', '👻', '💀', '🤖', '👽', '🎃', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '🔥', '⭐', '✨', '💫', '🎉', '🎊', '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '💪', '🙏', '☕', '🍕', '🍺', '🎵', '📌', '✅', '❌', '⚡', '💡'];

type ThemeName = 'discord' | 'light' | 'rose' | 'cyberpunk';

interface ThemeConfig {
    serverBar: string;
    serverIconActive: string;
    serverIconInactive: string;
    serverPillActive: string;
    sidebar: string;
    sidebarHeader: string;
    sidebarSearch: string;
    sidebarSearchBg: string;
    sidebarItemActive: string;
    sidebarItemInactive: string;
    userCard: string;
    chatArea: string;
    chatHeader: string;
    messageMe: string;
    messageOther: string;
    inputPanel: string;
    inputField: string;
    rightPanel: string;
    rightPanelHeader: string;
    rightPanelProfile: string;
    rightPanelProfileName: string;
    systemMessage: string;
    dateBadge: string;
    replyQuoteMe: string;
    replyQuoteOther: string;
    reactionsBadgeMe: string;
    reactionsBadgeOther: string;
    activeIndicator: string;
    mainText: string;
    subText: string;
    inputFieldBg: string;
    categoryText: string;
}

const THEME_PRESETS: Record<ThemeName, ThemeConfig> = {
    discord: {
        serverBar: 'bg-[#1e1f22] border-[#111214]/60 text-slate-100',
        serverIconActive: 'bg-indigo-500 text-white rounded-2xl',
        serverIconInactive: 'bg-[#313338] text-slate-200 hover:rounded-2xl hover:bg-indigo-500 hover:text-white',
        serverPillActive: 'bg-white',
        sidebar: 'bg-[#2b2d31] text-slate-300 border-[#1f2023]/60',
        sidebarHeader: 'border-[#1f2023] text-white bg-[#2b2d31]',
        sidebarSearch: 'bg-[#1e1f22] text-slate-200 placeholder-slate-500 border-transparent',
        sidebarSearchBg: 'bg-[#2b2d31] border-[#1f2023]/60',
        sidebarItemActive: 'bg-[#35373c] text-white',
        sidebarItemInactive: 'text-slate-400 hover:bg-[#2e3035] hover:text-slate-200',
        userCard: 'bg-[#232428] text-slate-200 border-[#1f2023]/60',
        chatArea: 'bg-[#313338] text-slate-200',
        chatHeader: 'bg-[#313338] border-[#1f2023] text-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
        messageMe: 'bg-indigo-600 text-white rounded-tr-sm shadow-sm',
        messageOther: 'bg-[#2b2d31] text-slate-200 rounded-tl-sm border border-[#1f2023]',
        inputPanel: 'bg-[#313338] border-t border-[#1f2023]/60',
        inputField: 'text-slate-200 placeholder-slate-500',
        inputFieldBg: 'bg-[#383a40] border-transparent focus-within:border-indigo-500/30',
        rightPanel: 'bg-[#2b2d31] border-[#1f2023] text-slate-300',
        rightPanelHeader: 'border-[#1f2023] text-slate-100',
        rightPanelProfile: 'bg-[#232428]/40 border-b border-[#1f2023]',
        rightPanelProfileName: 'text-white',
        systemMessage: 'text-slate-500 bg-[#2b2d31]/40 border-[#1f2023]/40',
        dateBadge: 'text-slate-400 bg-[#2b2d31] border-[#1f2023]',
        replyQuoteMe: 'border-white/40 bg-white/10 text-white/90',
        replyQuoteOther: 'border-indigo-500 bg-indigo-500/10 text-indigo-300',
        reactionsBadgeMe: 'bg-indigo-500/10 border-indigo-500/60 text-indigo-400',
        reactionsBadgeOther: 'bg-[#2b2d31] border-[#1f2023] text-slate-400 hover:border-slate-500',
        activeIndicator: 'bg-emerald-500',
        mainText: 'text-slate-100',
        subText: 'text-slate-400',
        categoryText: 'text-slate-500 hover:text-slate-300'
    },
    light: {
        serverBar: 'bg-[#f0f2f5] border-slate-200 text-slate-800',
        serverIconActive: 'bg-blue-500 text-white rounded-2xl',
        serverIconInactive: 'bg-slate-300 text-slate-700 hover:rounded-2xl hover:bg-blue-500 hover:text-white',
        serverPillActive: 'bg-blue-500',
        sidebar: 'bg-white text-slate-700 border-slate-200/80 border-r',
        sidebarHeader: 'border-slate-200 text-slate-900 bg-white shadow-[0_1px_1px_rgba(0,0,0,0.03)]',
        sidebarSearch: 'bg-slate-100 text-slate-800 placeholder-slate-400 border-transparent',
        sidebarSearchBg: 'bg-white border-slate-200',
        sidebarItemActive: 'bg-blue-50 text-blue-600 font-bold',
        sidebarItemInactive: 'text-slate-500 hover:bg-slate-50 hover:text-slate-850',
        userCard: 'bg-slate-50 text-slate-800 border-slate-200',
        chatArea: 'bg-[#f4f6fa] text-slate-800',
        chatHeader: 'bg-white border-slate-200 text-slate-800 shadow-sm',
        messageMe: 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-tr-sm shadow-md shadow-blue-500/10',
        messageOther: 'bg-white text-slate-800 rounded-tl-sm border border-slate-200/60 shadow-sm',
        inputPanel: 'bg-white border-t border-slate-200',
        inputField: 'text-slate-800 placeholder-slate-400',
        inputFieldBg: 'bg-slate-100 border-transparent focus-within:border-blue-500/20',
        rightPanel: 'bg-white border-slate-200 text-slate-700',
        rightPanelHeader: 'border-slate-200 text-slate-900',
        rightPanelProfile: 'bg-slate-50 border-b border-slate-200',
        rightPanelProfileName: 'text-slate-900',
        systemMessage: 'text-slate-500 bg-slate-200/60 border-slate-200/40',
        dateBadge: 'text-slate-550 bg-white border-slate-200 shadow-sm',
        replyQuoteMe: 'border-white/50 bg-white/10 text-white/90',
        replyQuoteOther: 'border-blue-500 bg-blue-50 text-blue-600',
        reactionsBadgeMe: 'bg-blue-50 border-blue-200 text-blue-600',
        reactionsBadgeOther: 'bg-white border-slate-200 text-slate-500 hover:border-slate-350',
        activeIndicator: 'bg-emerald-500',
        mainText: 'text-slate-800',
        subText: 'text-slate-500',
        categoryText: 'text-slate-400 hover:text-slate-600'
    },
    rose: {
        serverBar: 'bg-[#edf5f0] border-[#d8eae0] text-slate-700',
        serverIconActive: 'bg-[#4ca873] text-white rounded-2xl',
        serverIconInactive: 'bg-[#e1ede5] text-slate-600 hover:rounded-2xl hover:bg-[#4ca873] hover:text-white',
        serverPillActive: 'bg-[#4ca873]',
        sidebar: 'bg-[#fdf6f7] text-[#8c6d70] border-[#fae2e4] border-r',
        sidebarHeader: 'border-[#fae2e4] text-[#6d4c50] bg-[#fdf6f7] shadow-[0_1px_1px_rgba(0,0,0,0.02)]',
        sidebarSearch: 'bg-[#f8e6e8] text-slate-800 placeholder-[#caa4a7] border-transparent',
        sidebarSearchBg: 'bg-[#fdf6f7] border-[#fae2e4]',
        sidebarItemActive: 'bg-[#fbdad5]/40 text-[#a84c57] font-bold border-l-2 border-[#a84c57]',
        sidebarItemInactive: 'text-[#8c6d70]/80 hover:bg-[#f6e1e3]/40 hover:text-[#6d4c50]',
        userCard: 'bg-[#fbebeb] text-slate-850 border-[#fae2e4]',
        chatArea: 'bg-[#f4fbf7] text-[#3c5245]',
        chatHeader: 'bg-white border-[#e6f2eb] text-[#3c5245] shadow-sm',
        messageMe: 'bg-gradient-to-r from-[#4ca873] to-[#3a895a] text-white rounded-tr-sm shadow-md shadow-[#4ca873]/10',
        messageOther: 'bg-[#fff0f2] text-[#6d4c50] rounded-tl-sm border border-[#fbd4d8] shadow-sm',
        inputPanel: 'bg-white border-t border-[#fae2e4]',
        inputField: 'text-[#3c5245] placeholder-[#caa4a7]',
        inputFieldBg: 'bg-[#f3f9f5] border-transparent focus-within:border-[#4ca873]/20',
        rightPanel: 'bg-[#fdf6f7] border-[#fae2e4] text-[#8c6d70]',
        rightPanelHeader: 'border-[#fae2e4] text-[#6d4c50]',
        rightPanelProfile: 'bg-[#fbebeb] border-b border-[#fae2e4]',
        rightPanelProfileName: 'text-[#6d4c50]',
        systemMessage: 'text-[#8c6d70] bg-[#fff0f2] border-[#fbd4d8]',
        dateBadge: 'text-[#3c5245] bg-white border-[#e6f2eb] shadow-sm',
        replyQuoteMe: 'border-white/50 bg-white/10 text-white/90',
        replyQuoteOther: 'border-[#4ca873] bg-[#f4fbf7] text-[#3c5245]',
        reactionsBadgeMe: 'bg-[#eef8f2] border-[#d4eedc] text-[#3a895a]',
        reactionsBadgeOther: 'bg-[#fff0f2] border-[#fbd4d8] text-[#6d4c50] hover:border-[#a84c57]',
        activeIndicator: 'bg-[#4ca873]',
        mainText: 'text-slate-800',
        subText: 'text-[#8c6d70]',
        categoryText: 'text-[#caa4a7] hover:text-[#6d4c50]'
    },
    cyberpunk: {
        serverBar: 'bg-[#08090f] border-purple-950/80 text-purple-400',
        serverIconActive: 'bg-fuchsia-600 text-white rounded-2xl shadow-[0_0_10px_rgba(217,70,239,0.5)]',
        serverIconInactive: 'bg-[#141526] text-[#8d8ea6] hover:rounded-2xl hover:bg-fuchsia-600 hover:text-white',
        serverPillActive: 'bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.8)]',
        sidebar: 'bg-[#0f101a] text-[#8d8ea6] border-purple-900/30 border-r',
        sidebarHeader: 'border-purple-900/30 text-purple-400 bg-[#0f101a] shadow-[0_1px_3px_rgba(147,51,234,0.05)]',
        sidebarSearch: 'bg-[#18192d] text-[#cdd1f0] placeholder-[#57597d] border-transparent',
        sidebarSearchBg: 'bg-[#0f101a] border-purple-900/30',
        sidebarItemActive: 'bg-purple-950/40 text-fuchsia-400 font-bold border-l-2 border-fuchsia-500 shadow-[inset_0_0_10px_rgba(217,70,239,0.15)]',
        sidebarItemInactive: 'text-[#8d8ea6]/80 hover:bg-[#18192e] hover:text-[#cdd1f0]',
        userCard: 'bg-[#090a10] text-[#a9aacf] border-purple-950',
        chatArea: 'bg-[#131422] text-[#cdd1f0]',
        chatHeader: 'bg-[#0f101b] border-purple-900/30 text-purple-400 shadow-[0_1px_10px_rgba(147,51,234,0.15)]',
        messageMe: 'bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white rounded-tr-sm shadow-md shadow-fuchsia-600/30 border border-fuchsia-500/30',
        messageOther: 'bg-[#1c1d30] text-[#cdd1f0] rounded-tl-sm border border-purple-950 shadow-inner',
        inputPanel: 'bg-[#0f101b] border-t border-purple-900/30',
        inputField: 'text-[#cdd1f0] placeholder-[#57597d]',
        inputFieldBg: 'bg-[#1a1b2e] border-transparent focus-within:border-fuchsia-500/20',
        rightPanel: 'bg-[#0f101a] border-purple-900/40 text-[#8d8ea6]',
        rightPanelHeader: 'border-purple-900/30 text-purple-400',
        rightPanelProfile: 'bg-[#090a10] border-b border-purple-950',
        rightPanelProfileName: 'text-purple-300',
        systemMessage: 'text-[#8d8ea6] bg-[#1a1b2e]/60 border-purple-950/40',
        dateBadge: 'text-purple-400 bg-[#161726] border-purple-900/30 shadow-[0_0_5px_rgba(168,85,247,0.15)]',
        replyQuoteMe: 'border-white/50 bg-white/10 text-white/90',
        replyQuoteOther: 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-300',
        reactionsBadgeMe: 'bg-fuchsia-500/10 border-fuchsia-500/40 text-fuchsia-400 shadow-[0_0_5px_rgba(217,70,239,0.1)]',
        reactionsBadgeOther: 'bg-[#1c1d30] border-purple-950 text-[#8d8ea6] hover:border-purple-500',
        activeIndicator: 'bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)]',
        mainText: 'text-[#cdd1f0]',
        subText: 'text-[#8d8ea6]',
        categoryText: 'text-[#57597d] hover:text-purple-400'
    }
};

const THEME_LABELS = {
    discord: { name: 'Discord Dark', desc: 'Sơn đá / Tông trầm nguyên bản', colors: ['bg-[#1e1f22]', 'bg-[#2b2d31]', 'bg-indigo-500'] },
    light: { name: 'Telegram Light', desc: 'Bầu trời xuân / Sáng sủa, dịu mắt', colors: ['bg-slate-100', 'bg-white', 'bg-blue-500'] },
    rose: { name: 'Rose Mint Pastel', desc: 'Bạc hà anh đào / Ngọt ngào, ấm cúng', colors: ['bg-[#edf5f0]', 'bg-[#fdf6f7]', 'bg-[#4ca873]'] },
    cyberpunk: { name: 'Cyberpunk Neon', desc: 'Tương lai viễn tưởng / Nhấp nháy dạ quang', colors: ['bg-[#08090f]', 'bg-[#0f101a]', 'bg-fuchsia-600'] },
};

// ===================== HELPERS =====================
const timeAgo = (dateStr: string) => {
    const now = new Date();
    const d = new Date(dateStr);
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
    return d.toLocaleDateString('vi-VN');
};

const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Hôm nay';
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
};

const getErrorMessage = (err: unknown, fallback: string) => {
    return err instanceof Error && err.message ? err.message : fallback;
};

const buildWorkspaceIcon = (name: string) => name
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

// ===================== MAIN COMPONENT =====================
const Chat: React.FC = () => {
    useModuleData('hrm');
    const { user, users, employees } = useApp();
    const {
        workspaces, conversations, messages, activeConversationId, setActiveConversationId,
        onlineUsers, typingUsers, sendMessage, createDirectConversation,
        createGroupConversation, createWorkspace, updateWorkspace, deleteWorkspace,
        addWorkspaceMember, removeWorkspaceMember,
        createChannel, updateChannel, addMember, removeMember, updateMemberRole, updateGroupName,
        deleteConversation, leaveGroup, markAsRead, loadMessages, setTyping, toggleReaction,
        recallMessage, pinnedMessages, pinMessage, unpinMessage, startCallSession, endCallSession, totalUnread,
    } = useChat();

    // Theme switching configurations
    const [activeTheme, setActiveTheme] = useState<ThemeName>(() => {
        const saved = localStorage.getItem('khotienthinh_chat_theme') as ThemeName;
        return (saved && THEME_PRESETS[saved]) ? saved : 'discord';
    });
    const [showThemeSelector, setShowThemeSelector] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [defaultMuted, setDefaultMuted] = useState(false);
    const [defaultDeafened, setDefaultDeafened] = useState(false);
    const [chatStatus, setChatStatus] = useState<'online' | 'busy' | 'away' | 'offline'>('online');
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    const currentTheme = THEME_PRESETS[activeTheme];

    // Custom advanced features states
    const [activeServer, setActiveServer] = useState<string>('dm'); // 'dm' or workspace id
    const [replyingTo, setReplyingTo] = useState<any | null>(null); // message object to reply to
    const [voiceConnected, setVoiceConnected] = useState<string | null>(null); // voice channel id
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [isDeafened, setIsDeafened] = useState<boolean>(false);
    const [showCallOverlay, setShowCallOverlay] = useState<'audio' | 'video' | null>(null);
    const [callDuration, setCallDuration] = useState<number>(0);
    const [activeCallSessionId, setActiveCallSessionId] = useState<string | null>(null);
    const [activeCallConversationId, setActiveCallConversationId] = useState<string | null>(null);
    const [callSessionStartedBy, setCallSessionStartedBy] = useState<string | null>(null);
    const [hasAcceptedCall, setHasAcceptedCall] = useState<boolean>(false);
    const [showCategoryText, setShowCategoryText] = useState(true);
    const [showCategoryVoice, setShowCategoryVoice] = useState(true);
    const [showNewWorkspace, setShowNewWorkspace] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');
    const [showWorkspaceEditor, setShowWorkspaceEditor] = useState(false);
    const [workspaceEditName, setWorkspaceEditName] = useState('');
    const [workspaceEditIcon, setWorkspaceEditIcon] = useState('');
    const [workspaceEditDescription, setWorkspaceEditDescription] = useState('');
    const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);
    const [workspaceMemberQuery, setWorkspaceMemberQuery] = useState('');
    const [workspaceMemberActionId, setWorkspaceMemberActionId] = useState<string | null>(null);
    const [showNewChannel, setShowNewChannel] = useState<'text' | 'voice' | null>(null);
    const [newChannelName, setNewChannelName] = useState('');
    const [selectedChannelMembers, setSelectedChannelMembers] = useState<string[]>([]);
    const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
    const [renameChannelName, setRenameChannelName] = useState('');
    const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null);

    const [msgInput, setMsgInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [showNewChat, setShowNewChat] = useState(false);
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [mobileShowChat, setMobileShowChat] = useState(false);
    const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showGroupPanel, setShowGroupPanel] = useState(false);
    const [editingGroupName, setEditingGroupName] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [showAddMember, setShowAddMember] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmLeave, setConfirmLeave] = useState(false);

    useEffect(() => {
        if (!isSupabaseConfigured || !user?.id) return;
        let mounted = true;

        supabase
            .from('chat_user_settings')
            .select('theme, sound_enabled, notifications_enabled, default_muted, default_deafened, status, last_workspace_id')
            .eq('user_id', user.id)
            .maybeSingle()
            .then(({ data, error }) => {
                if (!mounted) return;
                if (error) {
                    console.error('Error loading chat settings:', error);
                    return;
                }
                const theme = data?.theme as ThemeName | undefined;
                if (theme && THEME_PRESETS[theme]) {
                    setActiveTheme(theme);
                    localStorage.setItem('khotienthinh_chat_theme', theme);
                }
                if (typeof data?.sound_enabled === 'boolean') setSoundEnabled(data.sound_enabled);
                if (typeof data?.notifications_enabled === 'boolean') setNotificationsEnabled(data.notifications_enabled);
                if (typeof data?.default_muted === 'boolean') {
                    setDefaultMuted(data.default_muted);
                    setIsMuted(data.default_muted);
                }
                if (typeof data?.default_deafened === 'boolean') {
                    setDefaultDeafened(data.default_deafened);
                    setIsDeafened(data.default_deafened);
                }
                if (['online', 'busy', 'away', 'offline'].includes(data?.status)) setChatStatus(data.status);
                if (data?.last_workspace_id) setActiveServer(data.last_workspace_id);
            });

        return () => { mounted = false; };
    }, [user?.id]);

    // Realtime call listener
    useEffect(() => {
        if (!isSupabaseConfigured || !user?.id) return;

        const callsChannel = supabase
            .channel(`chat-calls-realtime-${user.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_call_sessions',
            }, async (payload: any) => {
                const session = payload.new;
                if (!session || session.status !== 'active' || session.started_by === user.id) return;

                // Kiểm tra xem user có phải là thành viên của cuộc hội thoại này hay không
                const belongsToMe = conversations.some(c => c.id === session.conversation_id);
                if (!belongsToMe) {
                    const { data: member } = await supabase
                        .from('chat_members')
                        .select('id')
                        .eq('conversation_id', session.conversation_id)
                        .eq('user_id', user.id)
                        .is('left_at', null)
                        .maybeSingle();

                    if (!member) return;
                }

                // Đây chính xác là cuộc gọi đến dành cho mình!
                setActiveCallSessionId(session.id);
                setActiveCallConversationId(session.conversation_id);
                setCallSessionStartedBy(session.started_by);
                setHasAcceptedCall(false); // Chưa chấp nhận cuộc gọi
                setShowCallOverlay(session.mode);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'chat_call_sessions',
            }, (payload: any) => {
                const session = payload.new;
                if (!session) return;
                // Nếu cuộc gọi đã kết thúc bởi đối phương
                if (session.status === 'ended' && activeCallSessionId === session.id) {
                    setShowCallOverlay(null);
                    setActiveCallSessionId(null);
                    setActiveCallConversationId(null);
                    setCallSessionStartedBy(null);
                    setHasAcceptedCall(false);
                    playSound('disconnect');
                }
            })
            .subscribe();

        return () => {
            void supabase.removeChannel(callsChannel);
        };
    }, [user?.id, activeCallSessionId, conversations]);

    // Ringtone generator for incoming calls
    useEffect(() => {
        if (showCallOverlay && !hasAcceptedCall) {
            const interval = setInterval(() => {
                playSound('ringtone');
            }, 1200);
            return () => clearInterval(interval);
        }
    }, [showCallOverlay, hasAcceptedCall]);

    // WebRTC connection logic
    useEffect(() => {
        if (!isSupabaseConfigured || !user?.id || !activeCallSessionId || !hasAcceptedCall) {
            // Cleanup streams and peer connection when call ends
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            if (remoteStreamRef.current) {
                remoteStreamRef.current.getTracks().forEach(track => track.stop());
                remoteStreamRef.current = null;
            }
            if (signalingChannelRef.current) {
                void supabase.removeChannel(signalingChannelRef.current);
                signalingChannelRef.current = null;
            }
            return;
        }

        let isMounted = true;

        const initWebRTC = async () => {
            try {
                // 1. Lấy Local Stream (Micro & Camera nếu gọi video)
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: showCallOverlay === 'video'
                });
                if (!isMounted) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                localStreamRef.current = stream;

                // Gán local video
                if (showCallOverlay === 'video') {
                    const localVideo = document.getElementById('local-video') as HTMLVideoElement;
                    if (localVideo) localVideo.srcObject = stream;
                }

                // 2. Khởi tạo Peer Connection với Google STUN servers
                const pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                    ]
                });
                peerConnectionRef.current = pc;

                // Add các tracks từ local stream
                stream.getTracks().forEach(track => {
                    pc.addTrack(track, stream);
                });

                // Nhận track từ đối phương
                pc.ontrack = (event) => {
                    const [remoteStream] = event.streams;
                    remoteStreamRef.current = remoteStream;

                    if (showCallOverlay === 'video') {
                        const remoteVideo = document.getElementById('remote-video') as HTMLVideoElement;
                        if (remoteVideo) remoteVideo.srcObject = remoteStream;
                    } else {
                        if (remoteAudioRef.current) {
                            remoteAudioRef.current.srcObject = remoteStream;
                        }
                    }
                };

                // Lắng nghe và gửi ICE Candidate
                pc.onicecandidate = (event) => {
                    if (event.candidate && signalingChannelRef.current) {
                        signalingChannelRef.current.send({
                            type: 'broadcast',
                            event: 'ice-candidate',
                            payload: {
                                candidate: event.candidate,
                                senderId: user.id
                            }
                        });
                    }
                };

                // 3. Đăng ký kênh Signaling trên Supabase Realtime Broadcast
                const channel = supabase.channel(`chat-signaling-${activeCallSessionId}`);
                signalingChannelRef.current = channel;

                channel
                    .on('broadcast', { event: 'sdp-offer' }, async (payload: any) => {
                        const { sdp, senderId } = payload.payload;
                        if (senderId === user.id) return;

                        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);

                        channel.send({
                            type: 'broadcast',
                            event: 'sdp-answer',
                            payload: {
                                sdp: answer,
                                senderId: user.id
                            }
                        });
                    })
                    .on('broadcast', { event: 'sdp-answer' }, async (payload: any) => {
                        const { sdp, senderId } = payload.payload;
                        if (senderId === user.id) return;

                        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                    })
                    .on('broadcast', { event: 'ice-candidate' }, async (payload: any) => {
                        const { candidate, senderId } = payload.payload;
                        if (senderId === user.id) return;

                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    })
                    .subscribe(async (status) => {
                        if (status === 'SUBSCRIBED') {
                            // Người gọi (người khởi tạo) sẽ gửi SDP Offer trước
                            if (callSessionStartedBy === user.id) {
                                const offer = await pc.createOffer();
                                await pc.setLocalDescription(offer);

                                channel.send({
                                    type: 'broadcast',
                                    event: 'sdp-offer',
                                    payload: {
                                        sdp: offer,
                                        senderId: user.id
                                    }
                                });
                            }
                        }
                    });

            } catch (err) {
                console.error('Lỗi thiết lập WebRTC đàm thoại:', err);
            }
        };

        void initWebRTC();

        return () => {
            isMounted = false;
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            if (remoteStreamRef.current) {
                remoteStreamRef.current.getTracks().forEach(track => track.stop());
                remoteStreamRef.current = null;
            }
            if (signalingChannelRef.current) {
                void supabase.removeChannel(signalingChannelRef.current);
                signalingChannelRef.current = null;
            }
        };
    }, [activeCallSessionId, hasAcceptedCall, showCallOverlay, callSessionStartedBy, user?.id]);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const typingTimeoutRef = useRef<any>(null);
    const sendingRef = useRef(false);
    const justSentRef = useRef(false);
    const callTimerRef = useRef<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // WebRTC connection refs
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const signalingChannelRef = useRef<any>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const [uploadingFiles, setUploadingFiles] = useState<boolean>(false);
    const [uploadProgress, setUploadProgress] = useState<string>('');

    const activeConv = conversations.find(c => c.id === activeConversationId);
    const activeMessages = activeConversationId ? (messages[activeConversationId] || []) : [];
    const activeWorkspace = activeServer === 'dm' ? null : workspaces.find(w => w.id === activeServer) || null;
    const companyEmployeeByUserId = useMemo(() => new Map(
        employees
            .filter(employee => employee.userId && employee.status === 'Đang làm việc')
            .map(employee => [employee.userId!, employee])
    ), [employees]);
    const activeWorkspaceMembers = (activeWorkspace?.members || []).filter(member => !member.leftAt);
    const activeWorkspaceMemberIds = new Set(activeWorkspaceMembers.map(member => member.userId));
    const channelMemberCandidates = activeWorkspaceMembers
        .filter(member => member.userId !== user.id)
        .map(member => users.find(candidate => candidate.id === member.userId))
        .filter((candidate): candidate is typeof users[number] => Boolean(candidate && candidate.isActive !== false));
    const activeWorkspaceChannels = activeWorkspace
        ? conversations.filter(conv => conv.workspaceId === activeWorkspace.id && (conv.type === 'channel_text' || conv.type === 'channel_voice'))
        : [];
    const workspaceMemberCandidates = users
        .filter(candidate => candidate.isActive !== false && companyEmployeeByUserId.has(candidate.id) && !activeWorkspaceMemberIds.has(candidate.id))
        .filter(candidate => {
            const employee = companyEmployeeByUserId.get(candidate.id);
            return matchesSearchQueryMultiple([
                employee?.fullName,
                employee?.employeeCode,
                employee?.title,
                candidate.name,
                candidate.email,
            ], workspaceMemberQuery);
        });
    const canManageActiveWorkspace = !!activeWorkspace && (
        String(user.role) === 'ADMIN' ||
        activeWorkspace.createdBy === user.id ||
        activeWorkspaceMembers.some(member => member.userId === user.id && ['owner', 'admin'].includes(member.role))
    );
    const statusMeta = {
        online: { label: 'Online', dot: 'bg-emerald-500' },
        busy: { label: 'Bận', dot: 'bg-red-500' },
        away: { label: 'Vắng mặt', dot: 'bg-amber-500' },
        offline: { label: 'Ẩn', dot: 'bg-slate-500' },
    }[chatStatus];

    useEffect(() => {
        if (activeConversationId) {
            loadMessages(activeConversationId);
            markAsRead(activeConversationId);
        }
    }, [activeConversationId, loadMessages, markAsRead]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeMessages.length, replyingTo]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (!t.closest('.reaction-picker') && !t.closest('.reaction-trigger')) setReactionPickerMsgId(null);
            if (!t.closest('.emoji-picker') && !t.closest('.emoji-trigger')) setShowEmojiPicker(false);
            if (!t.closest('.theme-selector') && !t.closest('.theme-trigger')) setShowThemeSelector(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Reset details panels when switching conversations
    useEffect(() => {
        setShowGroupPanel(false);
        setEditingGroupName(false);
        setShowAddMember(false);
        setConfirmDelete(false);
        setConfirmLeave(false);
        setReplyingTo(null);
    }, [activeConversationId]);

    useEffect(() => {
        setShowNewChannel(null);
        setNewChannelName('');
        setSelectedChannelMembers([]);
        setRenamingChannelId(null);
        setRenameChannelName('');
        setConfirmDeleteChannelId(null);
        setShowWorkspaceEditor(false);
        setConfirmDeleteWorkspace(false);
        setWorkspaceMemberQuery('');
        setWorkspaceMemberActionId(null);
    }, [activeServer]);

    useEffect(() => {
        if (activeServer !== 'dm' && workspaces.length > 0 && !workspaces.some(w => w.id === activeServer)) {
            setActiveServer('dm');
            setActiveConversationId(null);
        }
    }, [activeServer, setActiveConversationId, workspaces]);

    // VoIP Call duration simulation
    useEffect(() => {
        if (showCallOverlay) {
            setCallDuration(0);
            callTimerRef.current = setInterval(() => {
                setCallDuration(prev => prev + 1);
            }, 1000);
        } else {
            clearInterval(callTimerRef.current);
        }
        return () => clearInterval(callTimerRef.current);
    }, [showCallOverlay]);

    const formatCallTime = (secs: number) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const getConvName = (conv: typeof conversations[0]) => {
        if (conv.type === 'channel_text' || conv.type === 'channel_voice') return conv.name || 'Kênh';
        if (conv.type === 'group') return conv.name || 'Nhóm';
        const otherMember = conv.members?.find(m => m.userId !== user.id);
        const otherUser = users.find(u => u.id === otherMember?.userId);
        return otherUser?.name || 'Người dùng';
    };

    const getConvAvatar = (conv: typeof conversations[0]) => {
        if (conv.type === 'group') return null;
        const otherMember = conv.members?.find(m => m.userId !== user.id);
        return users.find(u => u.id === otherMember?.userId)?.avatar;
    };

    const isConvOnline = (conv: typeof conversations[0]) => {
        if (conv.type === 'group' || conv.type === 'channel_text' || conv.type === 'channel_voice') return conv.members?.some(m => m.userId !== user.id && onlineUsers.has(m.userId));
        const otherMember = conv.members?.find(m => m.userId !== user.id);
        return otherMember ? onlineUsers.has(otherMember.userId) : false;
    };

    const isChannelConversation = (conv?: typeof conversations[0] | null) => (
        conv?.type === 'channel_text' || conv?.type === 'channel_voice'
    );

    const canManageConversation = (conv?: typeof conversations[0] | null) => {
        if (!conv) return false;
        if (String(user.role) === 'ADMIN') return true;
        if (conv.createdBy === user.id) return true;
        return !!conv.members?.some(m => m.userId === user.id && ['owner', 'admin'].includes(m.role) && !m.leftAt);
    };

    const formatChannelName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');

    const getMessagePreview = (message?: typeof activeMessages[number] | null) => {
        if (!message) return 'Chưa có tin nhắn';
        if (message.recalledAt) return 'Tin nhắn đã được thu hồi';
        if (message.type === 'image') return 'Ảnh đính kèm';
        if (message.type === 'file') return 'Tệp đính kèm';
        return message.content || 'Tin nhắn';
    };

    // Filter conversations depending on active server workspace
    const filteredConversations = useMemo(() => {
        let list = conversations;
        
        if (activeServer === 'dm') {
            list = conversations.filter(c => c.type === 'direct' || c.type === 'group');
        } else {
            list = conversations.filter(c => c.workspaceId === activeServer && isChannelConversation(c));
        }

        if (searchQuery) {
            list = list.filter(c => matchesSearchQueryMultiple([getConvName(c)], searchQuery));
        }
        return list;
    }, [conversations, activeServer, searchQuery]);

    const workspaceTextChannels = useMemo(() => (
        filteredConversations
            .filter(c => c.type === 'channel_text')
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || getConvName(a).localeCompare(getConvName(b), 'vi'))
    ), [filteredConversations]);

    const workspaceVoiceChannels = useMemo(() => (
        filteredConversations
            .filter(c => c.type === 'channel_voice')
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || getConvName(a).localeCompare(getConvName(b), 'vi'))
    ), [filteredConversations]);

    const availableUsers = users.filter(u => u.id !== user.id);

    const handleSend = async () => {
        if (!msgInput.trim() || !activeConversationId) return;
        if (sendingRef.current) return;
        sendingRef.current = true;

        const text = msgInput.trim();
        justSentRef.current = true;
        setMsgInput('');
        if (inputRef.current) inputRef.current.value = '';
        setTyping(activeConversationId, false);
        setShowEmojiPicker(false);

        setTimeout(() => { justSentRef.current = false; }, 150);

        try {
            // Append reply data inside content if replying
            let finalContent = text;
            let rId: string | undefined = undefined;
            let rPreview: any = null;
            if (replyingTo) {
                finalContent = `[Re: ${replyingTo.senderName}] ${replyingTo.content}\n---\n${text}`;
                rId = replyingTo.id;
                rPreview = {
                    senderId: replyingTo.senderId || '',
                    senderName: replyingTo.senderName || '',
                    content: replyingTo.content || ''
                };
            }
            await sendMessage(activeConversationId, finalContent, 'text', undefined, rId, rPreview);
            setReplyingTo(null);
        } catch (err) {
            setMsgInput(text);
            alert(getErrorMessage(err, 'Không thể gửi tin nhắn.'));
        } finally {
            sendingRef.current = false;
        }
        inputRef.current?.focus();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0 || !activeConversationId) return;

        setUploadingFiles(true);
        setUploadProgress('Đang tải lên...');
        
        try {
            const uploadedAttachments: { url: string; name: string; type: string; size?: number }[] = [];
            const fileUrlsList: string[] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setUploadProgress(`Đang tải lên ${file.name} (${i + 1}/${files.length})...`);
                
                const timestamp = Date.now();
                const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                const path = `chat/${activeConversationId}/${timestamp}_${cleanFileName}`;

                // Upload to Supabase Storage
                const { error: uploadError } = await supabase.storage
                    .from('project-attachments')
                    .upload(path, file, { cacheControl: '3600', upsert: false });

                if (uploadError) {
                    console.error('Error uploading file to storage:', uploadError);
                    alert(`Không thể tải lên ${file.name}: ${uploadError.message}`);
                    continue;
                }

                // Get public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('project-attachments')
                    .getPublicUrl(path);

                uploadedAttachments.push({
                    url: publicUrl,
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size,
                });
                
                fileUrlsList.push(publicUrl);
            }

            if (uploadedAttachments.length > 0) {
                // Determine message type
                const hasImage = uploadedAttachments.some(att => att.type.startsWith('image/'));
                const messageType = hasImage ? 'image' : 'file';

                // Construct text preview
                const contentText = uploadedAttachments.map(att => `[Đính kèm: ${att.name}]`).join('\n');

                // Send the message via context
                await sendMessage(
                    activeConversationId,
                    contentText,
                    messageType,
                    uploadedAttachments,
                    undefined,
                    null,
                    fileUrlsList
                );

                playSound('connect');
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert(getErrorMessage(err, 'Không thể tải file hoặc gửi tin nhắn đính kèm.'));
        } finally {
            setUploadingFiles(false);
            setUploadProgress('');
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleInputChange = (value: string) => {
        if (justSentRef.current) return;
        setMsgInput(value);
        if (!activeConversationId) return;
        if (value.length > 0) {
            setTyping(activeConversationId, true);
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => setTyping(activeConversationId, false), 3000);
        } else {
            setTyping(activeConversationId, false);
        }
    };

    const insertEmoji = (emoji: string) => {
        setMsgInput(prev => prev + emoji);
        inputRef.current?.focus();
    };

    const handleStartDirect = async (targetUserId: string) => {
        try {
            const convId = await createDirectConversation(targetUserId);
            setActiveConversationId(convId);
            setShowNewChat(false);
            setMobileShowChat(true);
            setActiveServer('dm');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể tạo chat đơn.'));
        }
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim() || selectedMembers.length === 0) return;
        try {
            const convId = await createGroupConversation(groupName.trim(), selectedMembers);
            setActiveConversationId(convId);
            setShowNewGroup(false);
            setGroupName('');
            setSelectedMembers([]);
            setMobileShowChat(true);
            setActiveServer('dm');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể tạo nhóm chat.'));
        }
    };

    const handleCreateChannel = async () => {
        if (!showNewChannel || activeServer === 'dm' || !activeWorkspace || !newChannelName.trim()) return;
        try {
            const convId = await createChannel(activeServer, newChannelName.trim(), showNewChannel, selectedChannelMembers);
            setShowNewChannel(null);
            setNewChannelName('');
            setSelectedChannelMembers([]);
            setActiveConversationId(convId);
            if (showNewChannel === 'voice') setVoiceConnected(convId);
            setMobileShowChat(showNewChannel === 'text');
            playSound('connect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể tạo kênh chat.'));
        }
    };

    const handleCreateWorkspace = async () => {
        if (!newWorkspaceName.trim()) return;
        try {
            const workspaceId = await createWorkspace(newWorkspaceName.trim(), newWorkspaceDescription.trim());
            setActiveServer(workspaceId);
            setActiveConversationId(null);
            setShowNewWorkspace(false);
            setNewWorkspaceName('');
            setNewWorkspaceDescription('');
            setMobileShowChat(false);
            playSound('connect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể tạo kênh chat.'));
        }
    };

    const openWorkspaceEditor = () => {
        if (!activeWorkspace) return;
        setWorkspaceEditName(activeWorkspace.name || '');
        setWorkspaceEditIcon(activeWorkspace.iconText || buildWorkspaceIcon(activeWorkspace.name || ''));
        setWorkspaceEditDescription(activeWorkspace.description || '');
        setShowWorkspaceEditor(true);
        setConfirmDeleteWorkspace(false);
        setWorkspaceMemberQuery('');
        setWorkspaceMemberActionId(null);
    };

    const handleUpdateWorkspace = async () => {
        if (!activeWorkspace || !workspaceEditName.trim()) return;
        try {
            await updateWorkspace(activeWorkspace.id, {
                name: workspaceEditName.trim(),
                iconText: workspaceEditIcon.trim() || buildWorkspaceIcon(workspaceEditName),
                description: workspaceEditDescription.trim() || null,
            });
            setShowWorkspaceEditor(false);
            playSound('click');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể cập nhật kênh chat.'));
        }
    };

    const handleDeleteWorkspace = async () => {
        if (!activeWorkspace) return;
        try {
            await deleteWorkspace(activeWorkspace.id);
            setActiveServer('dm');
            setActiveConversationId(null);
            setShowWorkspaceEditor(false);
            setConfirmDeleteWorkspace(false);
            playSound('disconnect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể xóa kênh chat.'));
        }
    };

    const handleAddWorkspaceMember = async (targetUserId: string) => {
        if (!activeWorkspace) return;
        try {
            setWorkspaceMemberActionId(targetUserId);
            await addWorkspaceMember(activeWorkspace.id, targetUserId);
            setWorkspaceMemberQuery('');
            playSound('click');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể thêm thành viên vào kênh chat.'));
        } finally {
            setWorkspaceMemberActionId(null);
        }
    };

    const handleRemoveWorkspaceMember = async (targetUserId: string) => {
        if (!activeWorkspace) return;
        try {
            setWorkspaceMemberActionId(targetUserId);
            await removeWorkspaceMember(activeWorkspace.id, targetUserId);
            playSound('disconnect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể loại thành viên khỏi kênh chat.'));
        } finally {
            setWorkspaceMemberActionId(null);
        }
    };

    const handleRenameChannel = async (conversationId: string) => {
        if (!renameChannelName.trim()) return;
        try {
            await updateChannel(conversationId, renameChannelName.trim());
            setRenamingChannelId(null);
            setRenameChannelName('');
            playSound('click');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể đổi tên kênh.'));
        }
    };

    const handleDeleteChannel = async (conversationId: string) => {
        try {
            await deleteConversation(conversationId);
            if (voiceConnected === conversationId) setVoiceConnected(null);
            if (activeConversationId === conversationId) setActiveConversationId(null);
            setConfirmDeleteChannelId(null);
            playSound('disconnect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể xóa kênh chat.'));
        }
    };

    // Parsing reply quote from content
    const parseMessageContent = (message: any) => {
        const match = message.content?.match(/^\[Re:\s*([^\]]+)\]\s*([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
            return {
                isReply: true,
                replyToName: match[1],
                replyToText: match[2],
                actualText: match[3]
            };
        }
        return { isReply: false, actualText: message.content };
    };

    const groupedMessages = useMemo(() => {
        const groups: { date: string; messages: typeof activeMessages }[] = [];
        let currentDate = '';
        activeMessages.forEach(msg => {
            const date = new Date(msg.createdAt).toDateString();
            if (date !== currentDate) {
                currentDate = date;
                groups.push({ date: msg.createdAt, messages: [msg] });
            } else {
                groups[groups.length - 1].messages.push(msg);
            }
        });
        return groups;
    }, [activeMessages]);

    const activeTyping = activeConversationId ? (typingUsers[activeConversationId] || []) : [];
    const typingNames = activeTyping.map(uid => users.find(u => u.id === uid)?.name || '').filter(Boolean);

    // Audio click effect simulation
    const playSound = (type: 'connect' | 'disconnect' | 'click' | 'theme' | 'ringtone') => {
        if (!soundEnabled) return;
        try {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = context.createOscillator();
            const gain = context.createGain();
            osc.connect(gain);
            gain.connect(context.destination);

            if (type === 'connect') {
                osc.frequency.setValueAtTime(520, context.currentTime);
                osc.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.15);
                gain.gain.setValueAtTime(0.08, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.15);
                osc.start();
                osc.stop(context.currentTime + 0.15);
            } else if (type === 'disconnect') {
                osc.frequency.setValueAtTime(440, context.currentTime);
                osc.frequency.exponentialRampToValueAtTime(220, context.currentTime + 0.2);
                gain.gain.setValueAtTime(0.08, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.2);
                osc.start();
                osc.stop(context.currentTime + 0.2);
            } else if (type === 'ringtone') {
                osc.type = 'sine';
                // Tạo chuông reo kết hợp tần số kép 440Hz + 480Hz giả lập âm thanh điện thoại
                osc.frequency.setValueAtTime(440, context.currentTime);
                osc.frequency.setValueAtTime(480, context.currentTime + 0.15);
                osc.frequency.setValueAtTime(440, context.currentTime + 0.3);
                gain.gain.setValueAtTime(0.06, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.005, context.currentTime + 0.5);
                osc.start();
                osc.stop(context.currentTime + 0.5);
            } else if (type === 'theme') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(440, context.currentTime);
                osc.frequency.setValueAtTime(554.37, context.currentTime + 0.08);
                osc.frequency.setValueAtTime(659.25, context.currentTime + 0.16);
                gain.gain.setValueAtTime(0.06, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.005, context.currentTime + 0.35);
                osc.start();
                osc.stop(context.currentTime + 0.35);
            } else {
                osc.frequency.setValueAtTime(600, context.currentTime);
                gain.gain.setValueAtTime(0.03, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.05);
                osc.start();
                osc.stop(context.currentTime + 0.05);
            }
        } catch (e) {
            // AudioContext blocked or unsupported
        }
    };

    const handleThemeChange = async (name: ThemeName) => {
        setActiveTheme(name);
        localStorage.setItem('khotienthinh_chat_theme', name);
        playSound('theme');
        setShowThemeSelector(false);

        if (!isSupabaseConfigured || !user?.id) return;
        const { error } = await supabase
            .from('chat_user_settings')
            .upsert({ user_id: user.id, theme: name }, { onConflict: 'user_id' });

        if (error) {
            console.error('Error saving chat theme:', error);
            alert(`Giao diện đã đổi trên máy này nhưng chưa lưu được lên Supabase: ${error.message}`);
        }
    };

    const saveAccountSettings = async () => {
        if (notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        if (!isSupabaseConfigured || !user?.id) {
            setIsMuted(defaultMuted);
            setIsDeafened(defaultDeafened);
            setShowAccountSettings(false);
            return;
        }
        const { error } = await supabase
            .from('chat_user_settings')
            .upsert({
                user_id: user.id,
                theme: activeTheme,
                sound_enabled: soundEnabled,
                notifications_enabled: notificationsEnabled,
                default_muted: defaultMuted,
                default_deafened: defaultDeafened,
                status: chatStatus,
                last_workspace_id: activeServer === 'dm' ? null : activeServer,
            }, { onConflict: 'user_id' });

        if (error) {
            alert(`Không thể lưu cấu hình chat: ${error.message}`);
            return;
        }
        localStorage.setItem('khotienthinh_chat_theme', activeTheme);
        setIsMuted(defaultMuted);
        setIsDeafened(defaultDeafened);
        setShowAccountSettings(false);
    };

    const handleStartCall = async (mode: 'audio' | 'video') => {
        if (!activeConv) return;
        try {
            const sessionId = await startCallSession(activeConv.id, mode);
            setActiveCallSessionId(sessionId);
            setActiveCallConversationId(activeConv.id);
            setCallSessionStartedBy(user?.id || null);
            setHasAcceptedCall(true); // Tự động chấp nhận cuộc gọi đi
            setShowCallOverlay(mode);
            playSound('connect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể bắt đầu cuộc gọi.'));
        }
    };

    const handleAcceptCall = async () => {
        if (!activeCallSessionId || !user?.id) return;
        try {
            // Thêm participant hiện tại vào bảng chat_call_participants với status 'joined'
            const { error: participantError } = await supabase.from('chat_call_participants').insert({
                call_session_id: activeCallSessionId,
                user_id: user.id,
                status: 'joined',
                joined_at: new Date().toISOString(),
            });
            if (participantError) throw participantError;

            setHasAcceptedCall(true);
            playSound('connect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể chấp nhận cuộc gọi.'));
        }
    };

    const handleDeclineCall = async () => {
        if (!activeCallSessionId || !user?.id) {
            setShowCallOverlay(null);
            return;
        }
        try {
            // Đánh dấu participant từ chối cuộc gọi
            await supabase.from('chat_call_participants').insert({
                call_session_id: activeCallSessionId,
                user_id: user.id,
                status: 'declined',
                joined_at: new Date().toISOString(),
            });

            // Đồng thời kết thúc cuộc gọi
            await supabase
                .from('chat_call_sessions')
                .update({
                    status: 'ended',
                    ended_at: new Date().toISOString(),
                    ended_by: user.id,
                })
                .eq('id', activeCallSessionId);

            setShowCallOverlay(null);
            setActiveCallSessionId(null);
            setActiveCallConversationId(null);
            setCallSessionStartedBy(null);
            setHasAcceptedCall(false);
            playSound('disconnect');
        } catch (err) {
            console.error('Lỗi khi từ chối cuộc gọi:', err);
            setShowCallOverlay(null);
            setActiveCallSessionId(null);
            setActiveCallConversationId(null);
            setCallSessionStartedBy(null);
            setHasAcceptedCall(false);
        }
    };

    const handleEndCall = async () => {
        const sessionId = activeCallSessionId;
        const conversationId = activeCallConversationId || activeConv?.id || null;
        const duration = callDuration;
        setShowCallOverlay(null);
        setActiveCallSessionId(null);
        setActiveCallConversationId(null);
        setCallSessionStartedBy(null);
        setHasAcceptedCall(false);
        playSound('disconnect');

        if (!sessionId || !conversationId) return;
        try {
            await endCallSession(sessionId, conversationId, duration);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể kết thúc cuộc gọi.'));
        }
    };

    const handleRenameGroup = async () => {
        if (!activeConv || !newGroupName.trim()) return;
        try {
            if (isChannelConversation(activeConv)) {
                await updateChannel(activeConv.id, newGroupName.trim());
            } else {
                await updateGroupName(activeConv.id, newGroupName.trim());
            }
            setEditingGroupName(false);
        } catch (err) {
            alert(getErrorMessage(err, isChannelConversation(activeConv) ? 'Không thể đổi tên kênh.' : 'Không thể đổi tên nhóm.'));
        }
    };

    const handleAddMember = async (userId: string) => {
        if (!activeConv) return;
        try {
            await addMember(activeConv.id, userId);
            setShowAddMember(false);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể thêm thành viên.'));
        }
    };

    const handleRemoveMember = async (userId: string) => {
        if (!activeConv) return;
        try {
            await removeMember(activeConv.id, userId);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể xóa thành viên.'));
        }
    };

    const handleUpdateMemberRole = async (userId: string, role: 'admin' | 'member') => {
        if (!activeConv) return;
        try {
            await updateMemberRole(activeConv.id, userId, role);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể cập nhật quyền thành viên.'));
        }
    };

    const handleRecallMessage = async (messageId: string) => {
        if (!activeConv) return;
        try {
            await recallMessage(activeConv.id, messageId);
            setReactionPickerMsgId(null);
            setHoveredMsgId(null);
            playSound('disconnect');
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể thu hồi tin nhắn.'));
        }
    };

    const handleLeaveGroup = async () => {
        if (!activeConv) return;
        try {
            await leaveGroup(activeConv.id);
            setShowGroupPanel(false);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể rời nhóm.'));
        }
    };

    const handleDeleteConversation = async () => {
        if (!activeConv) return;
        try {
            await deleteConversation(activeConv.id);
            if (voiceConnected === activeConv.id) setVoiceConnected(null);
            setShowGroupPanel(false);
        } catch (err) {
            alert(getErrorMessage(err, 'Không thể xóa cuộc trò chuyện.'));
        }
    };

    return (
        <div className={`h-[calc(100vh-65px)] flex overflow-hidden select-none transition-all duration-300 font-sans ${currentTheme.chatArea}`}>
            
            {/* ============ DISCORD STYLE WORKSPACE BAR ============ */}
            <div className={`w-[72px] flex flex-col items-center py-3 gap-2 shrink-0 select-none transition-all duration-300 border-r ${currentTheme.serverBar}`}>
                
                {/* DM HOME ICON */}
                <div className="relative group flex items-center justify-center w-full">
                    <div className={`absolute left-0 w-1 rounded-r-md transition-all duration-355 ${
                        activeServer === 'dm' ? 'h-8 bg-current' : 'h-1.5 opacity-0 group-hover:opacity-100 group-hover:h-4 bg-current'
                    }`} />
                    <button onClick={() => { setActiveServer('dm'); setActiveConversationId(null); playSound('click'); }}
                        className={`w-12 h-12 flex items-center justify-center transition-all duration-300 shadow-sm relative ${
                            activeServer === 'dm' ? currentTheme.serverIconActive : currentTheme.serverIconInactive
                        }`}>
                        <MessageCircle size={20} />
                        {totalUnread > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center animate-pulse border-2 border-current">{totalUnread}</span>
                        )}
                    </button>
                    {/* Tooltip */}
                    <span className="absolute left-[80px] bg-slate-900 text-white font-bold text-xs py-1.5 px-3 rounded-lg shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">Tin nhắn trực tiếp</span>
                </div>

                <div className="w-8 h-[1px] bg-current opacity-10 rounded my-1" />

                {/* WORKSPACES LIST */}
                {workspaces.map(workspace => {
                    const isSelected = activeServer === workspace.id;
                    const iconText = workspace.iconText || buildWorkspaceIcon(workspace.name);
                    return (
                        <div key={workspace.id} className="relative group flex items-center justify-center w-full">
                            <div className={`absolute left-0 w-1 rounded-r-md transition-all duration-355 ${
                                isSelected ? 'h-8 bg-current' : 'h-1.5 opacity-0 group-hover:opacity-100 group-hover:h-4 bg-current'
                            }`} />
                            <button onClick={() => { setActiveServer(workspace.id); setActiveConversationId(null); playSound('click'); }}
                                className={`w-12 h-12 flex items-center justify-center text-xs font-black transition-all duration-300 shadow-sm ${
                                    isSelected ? currentTheme.serverIconActive : currentTheme.serverIconInactive
                                }`}>
                                {iconText || <Users size={16} />}
                            </button>
                            <span className="absolute left-[80px] bg-slate-900 text-white font-bold text-xs py-1.5 px-3 rounded-lg shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">{workspace.name}</span>
                        </div>
                    );
                })}

                {/* ADD SERVER BUTTON */}
                <div className="relative group flex items-center justify-center w-full mt-auto">
                    <button onClick={() => { setShowNewWorkspace(true); setShowNewGroup(false); playSound('click'); }}
                        className="w-12 h-12 rounded-3xl bg-current/5 flex items-center justify-center text-emerald-500 hover:text-white hover:bg-emerald-500 hover:rounded-2xl transition-all duration-300">
                        <Plus size={20} />
                    </button>
                    <span className="absolute left-[80px] bg-slate-900 text-white font-bold text-xs py-1.5 px-3 rounded-lg shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">Tạo kênh chat</span>
                </div>
            </div>

            {/* ============ SECONDARY SIDEBAR: CHANNELS & DIRECT CHATS ============ */}
            <div className={`w-full md:w-[240px] flex flex-col shrink-0 ${mobileShowChat ? 'hidden md:flex' : 'flex'} select-none relative transition-all duration-300 ${currentTheme.sidebar}`}>
                
                {/* Header depending on current view */}
                <div className={`h-[48px] border-b px-3.5 flex items-center justify-between font-bold text-xs shrink-0 transition-all duration-300 ${currentTheme.sidebarHeader}`}>
                    {activeServer === 'dm' ? (
                        <div className="flex items-center justify-between w-full">
                            <span className="font-extrabold truncate">Tin nhắn trực tiếp</span>
                            <button onClick={() => { setShowNewChat(true); playSound('click'); }}
                                className="text-current opacity-60 hover:opacity-100 transition-opacity" title="Bắt đầu Chat đơn">
                                <Plus size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between w-full p-1.5 rounded transition-all group hover:bg-current/5">
                            <span className="truncate font-extrabold">{activeWorkspace?.name || 'Kênh chat'}</span>
                            <div className="flex items-center gap-1 shrink-0">
                                {canManageActiveWorkspace && (
                                    <button onClick={(e) => { e.stopPropagation(); openWorkspaceEditor(); playSound('click'); }}
                                        className="w-6 h-6 rounded-md flex items-center justify-center text-current opacity-60 hover:opacity-100 hover:bg-current/10"
                                        title="Cấu hình kênh chat">
                                        <Settings size={13} />
                                    </button>
                                )}
                                {canManageActiveWorkspace && (
                                    <>
                                        <button onClick={(e) => { e.stopPropagation(); setShowNewChannel('text'); setNewChannelName(''); setSelectedChannelMembers([]); playSound('click'); }}
                                            className="w-6 h-6 rounded-md flex items-center justify-center text-current opacity-60 hover:opacity-100 hover:bg-current/10"
                                            title="Tạo kênh văn bản">
                                            <Hash size={13} />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); setShowNewChannel('voice'); setNewChannelName(''); setSelectedChannelMembers([]); playSound('click'); }}
                                            className="w-6 h-6 rounded-md flex items-center justify-center text-current opacity-60 hover:opacity-100 hover:bg-current/10"
                                            title="Tạo kênh âm thanh">
                                            <Volume2 size={13} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sub Search Container */}
                <div className={`p-3 border-b transition-all duration-300 ${currentTheme.sidebarSearchBg}`}>
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-current opacity-55" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Lọc nhanh..."
                            className={`w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all border border-transparent ${currentTheme.sidebarSearch}`} />
                    </div>
                </div>

                {showNewWorkspace && (
                    <div className="p-3 border-b bg-current/5 border-current/10 animate-in slide-in-from-top duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider">Tạo kênh chat lớn</span>
                            <button onClick={() => { setShowNewWorkspace(false); setNewWorkspaceName(''); setNewWorkspaceDescription(''); }} className="text-current opacity-60 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <input
                            value={newWorkspaceName}
                            onChange={e => setNewWorkspaceName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleCreateWorkspace(); }}
                            placeholder="Tên kênh chat..."
                            className={`w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all border border-transparent mb-2 ${currentTheme.sidebarSearch}`}
                            autoFocus
                        />
                        <textarea
                            value={newWorkspaceDescription}
                            onChange={e => setNewWorkspaceDescription(e.target.value)}
                            placeholder="Mô tả ngắn..."
                            rows={2}
                            className={`w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all border border-transparent resize-none mb-2 ${currentTheme.sidebarSearch}`}
                        />
                        <button onClick={() => { void handleCreateWorkspace(); }}
                            disabled={!newWorkspaceName.trim()}
                            className="w-full py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
                            <Plus size={12} className="inline mr-1.5" />Tạo kênh chat
                        </button>
                    </div>
                )}

                {showWorkspaceEditor && activeWorkspace && (
                    <div className="p-3 border-b bg-current/5 border-current/10 animate-in slide-in-from-top duration-200 max-h-[70vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Cấu hình kênh chat</span>
                            <button onClick={() => { setShowWorkspaceEditor(false); setConfirmDeleteWorkspace(false); }} className="text-current opacity-60 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <div className="grid grid-cols-[52px_1fr] gap-2 mb-2">
                            <input
                                value={workspaceEditIcon}
                                onChange={e => setWorkspaceEditIcon(e.target.value.toUpperCase().slice(0, 3))}
                                placeholder="IC"
                                className={`px-2 py-1.5 rounded-lg text-xs text-center font-black outline-none focus:ring-1 focus:ring-indigo-500/50 border border-transparent ${currentTheme.sidebarSearch}`}
                            />
                            <input
                                value={workspaceEditName}
                                onChange={e => setWorkspaceEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void handleUpdateWorkspace(); }}
                                placeholder="Tên kênh chat..."
                                className={`px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 border border-transparent ${currentTheme.sidebarSearch}`}
                            />
                        </div>
                        <textarea
                            value={workspaceEditDescription}
                            onChange={e => setWorkspaceEditDescription(e.target.value)}
                            rows={2}
                            placeholder="Mô tả..."
                            className={`w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 border border-transparent resize-none mb-2 ${currentTheme.sidebarSearch}`}
                        />

                        <div className="grid grid-cols-3 gap-1.5 mb-2">
                            <div className="rounded-lg bg-black/10 p-2 text-center">
                                <div className="text-xs font-black">{activeWorkspaceMembers.length}</div>
                                <div className="text-[8px] opacity-60 font-bold uppercase">Thành viên</div>
                            </div>
                            <div className="rounded-lg bg-black/10 p-2 text-center">
                                <div className="text-xs font-black">{activeWorkspaceChannels.filter(chan => chan.type === 'channel_text').length}</div>
                                <div className="text-[8px] opacity-60 font-bold uppercase">Văn bản</div>
                            </div>
                            <div className="rounded-lg bg-black/10 p-2 text-center">
                                <div className="text-xs font-black">{activeWorkspaceChannels.filter(chan => chan.type === 'channel_voice').length}</div>
                                <div className="text-[8px] opacity-60 font-bold uppercase">Âm thanh</div>
                            </div>
                        </div>

                        <div className="mb-2 rounded-xl border border-current/10 bg-black/5 p-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-wider opacity-65">Thành viên</span>
                                <span className="text-[9px] font-bold opacity-50">{activeWorkspaceMembers.length}</span>
                            </div>

                            <div className="space-y-1 max-h-[128px] overflow-y-auto pr-1 mb-2">
                                {activeWorkspaceMembers.map(member => {
                                    const memberUser = users.find(item => item.id === member.userId);
                                    const memberEmployee = companyEmployeeByUserId.get(member.userId);
                                    const isCurrent = member.userId === user.id;
                                    const isOwner = member.role === 'owner' || activeWorkspace.createdBy === member.userId;
                                    const memberMeta = [
                                        memberEmployee?.employeeCode,
                                        memberEmployee?.title,
                                        isOwner ? 'Owner' : member.role,
                                    ].filter(Boolean).join(' • ');
                                    const canRemove = canManageActiveWorkspace && !isCurrent && !isOwner;
                                    return (
                                        <div key={member.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-current/5 group/member">
                                            <div className="relative shrink-0">
                                                <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[9px] font-black overflow-hidden">
                                                    {memberEmployee?.avatarUrl || memberUser?.avatar ? <img src={memberEmployee?.avatarUrl || memberUser?.avatar} className="w-full h-full object-cover" /> : (memberEmployee?.fullName || memberUser?.name)?.charAt(0)?.toUpperCase() || '?'}
                                                </div>
                                                {onlineUsers.has(member.userId) && <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-current" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] font-bold truncate">{memberEmployee?.fullName || memberUser?.name || 'Nhân viên'}{isCurrent ? ' (Bạn)' : ''}</span>
                                                    {isOwner ? <Crown size={9} className="text-amber-500 shrink-0" /> : member.role === 'admin' ? <Shield size={9} className="text-indigo-400 shrink-0" /> : null}
                                                </div>
                                                <div className="text-[8px] opacity-50 uppercase font-bold truncate">{memberMeta}</div>
                                            </div>
                                            {canRemove && (
                                                <button
                                                    onClick={() => { void handleRemoveWorkspaceMember(member.userId); }}
                                                    disabled={workspaceMemberActionId === member.userId}
                                                    className="w-6 h-6 rounded-md flex items-center justify-center text-current opacity-0 group-hover/member:opacity-80 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-30 transition"
                                                    title="Loại khỏi kênh chat"
                                                >
                                                    <UserMinus size={12} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {canManageActiveWorkspace && (
                                <div className="border-t border-current/10 pt-2">
                                    <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 mb-1.5 ${currentTheme.sidebarSearch}`}>
                                        <Search size={11} className="opacity-55 shrink-0" />
                                        <input
                                            value={workspaceMemberQuery}
                                            onChange={e => setWorkspaceMemberQuery(e.target.value)}
                                            placeholder="Tìm người để thêm..."
                                            className="min-w-0 flex-1 bg-transparent text-[10px] outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1 max-h-[104px] overflow-y-auto pr-1">
                                        {workspaceMemberCandidates.slice(0, 8).map(candidate => (
                                            (() => {
                                                const employee = companyEmployeeByUserId.get(candidate.id);
                                                return (
                                                    <button key={candidate.id}
                                                        onClick={() => { void handleAddWorkspaceMember(candidate.id); }}
                                                        disabled={workspaceMemberActionId === candidate.id}
                                                        className="w-full flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-emerald-500/10 hover:text-emerald-500 disabled:opacity-40 transition">
                                                        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[8px] font-black overflow-hidden shrink-0">
                                                            {employee?.avatarUrl || candidate.avatar ? <img src={employee?.avatarUrl || candidate.avatar} className="w-full h-full object-cover" /> : (employee?.fullName || candidate.name)?.charAt(0)?.toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-[10px] font-bold truncate">{employee?.fullName || candidate.name}</div>
                                                            <div className="text-[8px] opacity-60 truncate">{employee?.employeeCode || 'Nhân viên'}{employee?.title ? ` • ${employee.title}` : ''}</div>
                                                        </div>
                                                        <UserPlus size={11} className="shrink-0" />
                                                    </button>
                                                );
                                            })()
                                        ))}
                                        {workspaceMemberCandidates.length === 0 && (
                                            <div className="text-center text-[9px] opacity-50 font-semibold py-1.5">Không còn nhân viên phù hợp</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-1.5">
                            <button onClick={() => { void handleUpdateWorkspace(); }}
                                disabled={!workspaceEditName.trim()}
                                className="flex-1 py-2 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 transition-all disabled:opacity-40">
                                Lưu
                            </button>
                            <button onClick={() => setConfirmDeleteWorkspace(prev => !prev)}
                                className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-xs font-bold hover:bg-red-500 hover:text-white transition-all">
                                <Trash2 size={13} />
                            </button>
                        </div>
                        {confirmDeleteWorkspace && (
                            <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                <p className="text-[10px] font-bold text-red-500 mb-2">Xóa kênh chat này và ẩn toàn bộ phòng bên trong?</p>
                                <div className="flex gap-1.5">
                                    <button onClick={() => { void handleDeleteWorkspace(); }} className="flex-1 py-1.5 rounded bg-red-500 text-white text-[10px] font-bold">Xóa</button>
                                    <button onClick={() => setConfirmDeleteWorkspace(false)} className="flex-1 py-1.5 rounded bg-black/20 text-[10px] font-bold">Hủy</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Direct users mapping panel */}
                {showNewChat && (
                    <div className="p-3 border-b bg-current/5 border-current/10 animate-in slide-in-from-top duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Bắt đầu Chat mới</span>
                            <button onClick={() => setShowNewChat(false)} className="text-current opacity-60 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1">
                            {availableUsers.map(u => (
                                <button key={u.id} onClick={() => handleStartDirect(u.id)}
                                    className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-current/5 transition-all text-left">
                                    <div className="relative shrink-0">
                                        <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-extrabold">
                                            {u.avatar ? <img src={u.avatar} className="w-full h-full rounded-full object-cover" /> : u.name?.charAt(0)?.toUpperCase()}
                                        </div>
                                        {onlineUsers.has(u.id) && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-current" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold truncate">{u.name}</div>
                                        <div className="text-[9px] opacity-60 truncate">{u.role}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Create Group Modal */}
                {showNewGroup && (
                    <div className="p-3 border-b bg-current/5 border-current/10 animate-in slide-in-from-top duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider">Tạo nhóm chat mới</span>
                            <button onClick={() => { setShowNewGroup(false); setGroupName(''); setSelectedMembers([]); }} className="text-current opacity-60 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <input
                            value={groupName}
                            onChange={e => setGroupName(e.target.value)}
                            placeholder="Tên nhóm..."
                            className={`w-full px-3 py-1.5 rounded-lg text-xs outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all border border-transparent mb-2 ${currentTheme.sidebarSearch}`}
                        />
                        <div className="text-[9px] font-bold text-current opacity-55 mb-1 uppercase tracking-wider">Chọn thành viên ({selectedMembers.length})</div>
                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
                            {availableUsers.map(u => {
                                const isSelected = selectedMembers.includes(u.id);
                                return (
                                    <button key={u.id} onClick={() => {
                                        setSelectedMembers(prev => isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]);
                                    }}
                                        className={`w-full flex items-center gap-2 p-1.5 rounded-lg transition-all text-left ${isSelected ? 'bg-emerald-500/10 ring-1 ring-emerald-500/40' : 'hover:bg-current/5'}`}>
                                        <div className="relative shrink-0">
                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold ${isSelected ? 'bg-emerald-500 text-white' : 'bg-indigo-500 text-white'}`}>
                                                {u.avatar ? <img src={u.avatar} className="w-full h-full rounded-full object-cover" /> : u.name?.charAt(0)?.toUpperCase()}
                                            </div>
                                            {isSelected && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center"><Check size={7} className="text-white" /></div>}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-bold truncate">{u.name}</div>
                                            <div className="text-[9px] opacity-60 truncate">{u.role}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={handleCreateGroup}
                            disabled={!groupName.trim() || selectedMembers.length === 0}
                            className="w-full mt-2 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
                            <Users size={12} className="inline mr-1.5" />Tạo nhóm ({selectedMembers.length} thành viên)
                        </button>
                    </div>
                )}

                {showNewChannel && activeServer !== 'dm' && canManageActiveWorkspace && (
                    <div className="p-3 border-b bg-current/5 border-current/10 animate-in slide-in-from-top duration-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider">
                                Tạo kênh {showNewChannel === 'voice' ? 'âm thanh' : 'văn bản'}
                            </span>
                            <button onClick={() => { setShowNewChannel(null); setNewChannelName(''); setSelectedChannelMembers([]); }} className="text-current opacity-60 hover:opacity-100"><X size={12} /></button>
                        </div>
                        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 border border-transparent mb-2 ${currentTheme.sidebarSearch}`}>
                            {showNewChannel === 'voice' ? <Volume2 size={13} className="opacity-60 shrink-0" /> : <Hash size={13} className="opacity-60 shrink-0" />}
                            <input
                                value={newChannelName}
                                onChange={e => setNewChannelName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { void handleCreateChannel(); } }}
                                placeholder="Tên kênh..."
                                className="w-full bg-transparent text-xs outline-none"
                                autoFocus
                            />
                        </div>
                        <div className="mb-2 rounded-xl border border-current/10 bg-black/5 p-2">
                            <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase tracking-wider opacity-60">Tag thành viên được xem kênh</span>
                                <span className="text-[9px] font-bold opacity-50">{selectedChannelMembers.length + 1} người</span>
                            </div>
                            <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[10px] font-bold text-emerald-500">
                                <Crown size={11} />
                                <span className="truncate">{user.name} là chủ kênh</span>
                            </div>
                            <div className="space-y-1 max-h-[132px] overflow-y-auto pr-1">
                                {channelMemberCandidates.map(candidate => {
                                    const employee = companyEmployeeByUserId.get(candidate.id);
                                    const selected = selectedChannelMembers.includes(candidate.id);
                                    return (
                                        <button
                                            key={candidate.id}
                                            onClick={() => {
                                                setSelectedChannelMembers(prev => selected
                                                    ? prev.filter(id => id !== candidate.id)
                                                    : [...prev, candidate.id]);
                                            }}
                                            className={`w-full flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                                                selected ? 'bg-emerald-500/10 ring-1 ring-emerald-500/35 text-emerald-500' : 'hover:bg-current/5'
                                            }`}
                                        >
                                            <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[8px] font-black overflow-hidden shrink-0">
                                                {employee?.avatarUrl || candidate.avatar ? <img src={employee?.avatarUrl || candidate.avatar} className="w-full h-full object-cover" /> : (employee?.fullName || candidate.name)?.charAt(0)?.toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[10px] font-bold truncate">{employee?.fullName || candidate.name}</div>
                                                <div className="text-[8px] opacity-60 truncate">{employee?.employeeCode || 'Nhân viên'}{employee?.title ? ` • ${employee.title}` : ''}</div>
                                            </div>
                                            {selected && <Check size={12} className="shrink-0" />}
                                        </button>
                                    );
                                })}
                                {channelMemberCandidates.length === 0 && (
                                    <div className="text-center text-[9px] opacity-50 font-semibold py-1.5">Workspace chưa có thành viên khác để tag</div>
                                )}
                            </div>
                        </div>
                        <button onClick={() => { void handleCreateChannel(); }}
                            disabled={!newChannelName.trim()}
                            className="w-full py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
                            <Plus size={12} className="inline mr-1.5" />Tạo kênh ({selectedChannelMembers.length + 1})
                        </button>
                    </div>
                )}

                {/* Direct or channels groups */}
                <div className="flex-1 overflow-y-auto py-3 space-y-4 px-2">
                    {activeServer === 'dm' ? (
                        /* DIRECT MESSAGES USERS LIST */
                        <div className="space-y-0.5">
                            {filteredConversations.length === 0 ? (
                                <div className="text-center py-6 px-3">
                                    <MessageCircle size={32} className="mx-auto text-current opacity-30 mb-2" />
                                    <p className="text-xs font-bold text-current opacity-65">Chưa có cuộc hội thoại nào</p>
                                    <button onClick={() => setShowNewChat(true)} className="text-[10px] text-indigo-500 font-bold hover:underline mt-1 inline-block">Bắt đầu chat đơn</button>
                                </div>
                            ) : (
                                filteredConversations.map(conv => {
                                    const isActive = conv.id === activeConversationId;
                                    const name = getConvName(conv);
                                    const avatar = getConvAvatar(conv);
                                    const online = isConvOnline(conv);
                                    const lastMsg = conv.lastMessage;
                                    const unread = conv.unreadCount || 0;
                                    
                                    return (
                                        <button key={conv.id}
                                            onClick={() => { setActiveConversationId(conv.id); setMobileShowChat(true); }}
                                            className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all text-left ${
                                                isActive ? currentTheme.sidebarItemActive : currentTheme.sidebarItemInactive
                                            }`}>
                                            <div className="relative shrink-0">
                                                <div className="w-8 h-8 rounded-full bg-slate-650 flex items-center justify-center text-white text-xs font-bold overflow-hidden shadow-sm">
                                                    {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
                                                </div>
                                                {online && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-current" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <span className={`text-xs truncate ${unread > 0 ? 'font-black text-current' : 'font-bold opacity-85'}`}>{name}</span>
                                                    {unread > 0 && (
                                                        <span className="text-[9px] font-black bg-red-500 text-white w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0">{unread}</span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] opacity-60 truncate mt-0.5">
                                                    {getMessagePreview(lastMsg)}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    ) : (
                        /* DISCORD COLLAPSIBLE CHANNELS */
                        <div className="space-y-3">
                            
                            {/* CATEGORY 1: TEXT CHANNELS */}
                            <div>
                                <div className={`w-full flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-1 mb-1 transition-all ${currentTheme.categoryText}`}>
                                    <button onClick={() => setShowCategoryText(!showCategoryText)}
                                        className="flex items-center gap-1 min-w-0 flex-1 text-left">
                                        {showCategoryText ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        <span>Kênh văn bản</span>
                                    </button>
                                    {canManageActiveWorkspace && (
                                        <button onClick={() => { setShowNewChannel('text'); setNewChannelName(''); setSelectedChannelMembers([]); }}
                                            className="w-5 h-5 rounded flex items-center justify-center hover:bg-current/10"
                                            title="Tạo kênh văn bản">
                                            <Plus size={11} />
                                        </button>
                                    )}
                                </div>
                                
                                {showCategoryText && (
                                    <div className="space-y-0.5 pl-1.5">
                                        {workspaceTextChannels.length === 0 && (
                                            <div className="px-2 py-2 text-[10px] opacity-55 font-semibold">Chưa có kênh văn bản</div>
                                        )}
                                        {workspaceTextChannels.map(conv => {
                                            const isActive = conv.id === activeConversationId;
                                            const name = getConvName(conv);
                                            const unread = conv.unreadCount || 0;
                                            const isRenaming = renamingChannelId === conv.id;
                                            const canManage = canManageConversation(conv);
                                            return (
                                                <div key={conv.id} className="group/channel relative">
                                                    {isRenaming ? (
                                                        <div className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs ${currentTheme.sidebarItemActive}`}>
                                                            <Hash size={14} className="opacity-50 shrink-0" />
                                                            <input
                                                                value={renameChannelName}
                                                                onChange={e => setRenameChannelName(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') void handleRenameChannel(conv.id);
                                                                    if (e.key === 'Escape') setRenamingChannelId(null);
                                                                }}
                                                                className="min-w-0 flex-1 bg-transparent outline-none font-semibold"
                                                                autoFocus
                                                            />
                                                            <button onClick={() => { void handleRenameChannel(conv.id); }} className="text-emerald-500"><Check size={12} /></button>
                                                            <button onClick={() => setRenamingChannelId(null)} className="opacity-70 hover:opacity-100"><X size={12} /></button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => { setActiveConversationId(conv.id); setMobileShowChat(true); }}
                                                            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-all text-left ${
                                                        isActive ? currentTheme.sidebarItemActive : currentTheme.sidebarItemInactive
                                                    }`}>
                                                            <Hash size={14} className="opacity-50 shrink-0" />
                                                            <span className={`truncate flex-1 ${unread > 0 ? 'font-black text-current' : 'font-semibold'}`}>
                                                                {formatChannelName(name)}
                                                            </span>
                                                            {unread > 0 && <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                                                        </button>
                                                    )}
                                                    {canManage && !isRenaming && (
                                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/channel:flex items-center gap-0.5 bg-inherit rounded">
                                                            <button onClick={(e) => { e.stopPropagation(); setRenamingChannelId(conv.id); setRenameChannelName(name); setConfirmDeleteChannelId(null); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-black/10 hover:bg-black/20"
                                                                title="Đổi tên kênh">
                                                                <Edit3 size={10} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannelId(confirmDeleteChannelId === conv.id ? null : conv.id); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-black/10 hover:bg-red-500/20 hover:text-red-500"
                                                                title="Xóa kênh">
                                                                <Trash2 size={10} />
                                                            </button>
                                                        </div>
                                                    )}
                                                    {confirmDeleteChannelId === conv.id && (
                                                        <div className="mx-1 mb-1 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                                            <p className="text-[10px] text-red-500 font-bold mb-1">Xóa kênh #{formatChannelName(name)}?</p>
                                                            <div className="flex gap-1">
                                                                <button onClick={() => { void handleDeleteChannel(conv.id); }} className="flex-1 py-1 rounded bg-red-500 text-white text-[10px] font-bold">Xóa</button>
                                                                <button onClick={() => setConfirmDeleteChannelId(null)} className="flex-1 py-1 rounded bg-black/20 text-[10px] font-bold">Hủy</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* CATEGORY 2: VOICE CHANNELS */}
                            <div>
                                <div className={`w-full flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-1 mb-1 transition-all ${currentTheme.categoryText}`}>
                                    <button onClick={() => setShowCategoryVoice(!showCategoryVoice)}
                                        className="flex items-center gap-1 min-w-0 flex-1 text-left">
                                        {showCategoryVoice ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        <span>Kênh âm thanh</span>
                                    </button>
                                    {canManageActiveWorkspace && (
                                        <button onClick={() => { setShowNewChannel('voice'); setNewChannelName(''); setSelectedChannelMembers([]); }}
                                            className="w-5 h-5 rounded flex items-center justify-center hover:bg-current/10"
                                            title="Tạo kênh âm thanh">
                                            <Plus size={11} />
                                        </button>
                                    )}
                                </div>
                                
                                {showCategoryVoice && (
                                    <div className="space-y-1 pl-1.5">
                                        {workspaceVoiceChannels.length === 0 && (
                                            <div className="px-2 py-2 text-[10px] opacity-55 font-semibold">Chưa có kênh âm thanh</div>
                                        )}
                                        {workspaceVoiceChannels.map(chan => {
                                            const isConnected = voiceConnected === chan.id;
                                            const canManage = canManageConversation(chan);
                                            const isRenaming = renamingChannelId === chan.id;
                                            const name = getConvName(chan);
                                            return (
                                                <div key={chan.id} className="space-y-0.5 group/channel relative">
                                                    {isRenaming ? (
                                                        <div className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs ${currentTheme.sidebarItemActive}`}>
                                                            <Volume2 size={14} className="opacity-60 shrink-0" />
                                                            <input
                                                                value={renameChannelName}
                                                                onChange={e => setRenameChannelName(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') void handleRenameChannel(chan.id);
                                                                    if (e.key === 'Escape') setRenamingChannelId(null);
                                                                }}
                                                                className="min-w-0 flex-1 bg-transparent outline-none font-semibold"
                                                                autoFocus
                                                            />
                                                            <button onClick={() => { void handleRenameChannel(chan.id); }} className="text-emerald-500"><Check size={12} /></button>
                                                            <button onClick={() => setRenamingChannelId(null)} className="opacity-70 hover:opacity-100"><X size={12} /></button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => {
                                                            setActiveConversationId(chan.id);
                                                            if (voiceConnected === chan.id) {
                                                                setVoiceConnected(null);
                                                                playSound('disconnect');
                                                            } else {
                                                                setVoiceConnected(chan.id);
                                                                playSound('connect');
                                                            }
                                                        }}
                                                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-all text-left ${
                                                            isConnected ? 'bg-emerald-500/10 text-emerald-500 font-bold' : currentTheme.sidebarItemInactive
                                                        }`}>
                                                            <span className="truncate flex items-center gap-1.5 min-w-0">
                                                                <Volume2 size={13} className="opacity-60 shrink-0" />
                                                                <span className="truncate">{name}</span>
                                                            </span>
                                                            {isConnected && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />}
                                                        </button>
                                                    )}
                                                    {canManage && !isRenaming && (
                                                        <div className="absolute right-1 top-1 hidden group-hover/channel:flex items-center gap-0.5 bg-inherit rounded">
                                                            <button onClick={(e) => { e.stopPropagation(); setRenamingChannelId(chan.id); setRenameChannelName(name); setConfirmDeleteChannelId(null); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-black/10 hover:bg-black/20"
                                                                title="Đổi tên kênh">
                                                                <Edit3 size={10} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannelId(confirmDeleteChannelId === chan.id ? null : chan.id); }}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-black/10 hover:bg-red-500/20 hover:text-red-500"
                                                                title="Xóa kênh">
                                                                <Trash2 size={10} />
                                                            </button>
                                                        </div>
                                                    )}
                                                    {confirmDeleteChannelId === chan.id && (
                                                        <div className="mx-1 mb-1 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                                            <p className="text-[10px] text-red-500 font-bold mb-1">Xóa kênh {name}?</p>
                                                            <div className="flex gap-1">
                                                                <button onClick={() => { void handleDeleteChannel(chan.id); }} className="flex-1 py-1 rounded bg-red-500 text-white text-[10px] font-bold">Xóa</button>
                                                                <button onClick={() => setConfirmDeleteChannelId(null)} className="flex-1 py-1 rounded bg-black/20 text-[10px] font-bold">Hủy</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Connected users list */}
                                                    {isConnected && (
                                                        <div className="pl-5 space-y-1 py-1">
                                                            <div className="flex items-center gap-1.5 py-0.5">
                                                                <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[8px] font-black overflow-hidden shrink-0">
                                                                    {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : user.name?.charAt(0)}
                                                                </div>
                                                                <span className="text-[10px] text-emerald-500 font-bold truncate">{user.name} (Bạn)</span>
                                                                <div className="ml-auto flex items-center gap-0.5 shrink-0">
                                                                    {isMuted && <MicOff size={8} className="text-red-500" />}
                                                                    {isDeafened && <VolumeX size={8} className="text-red-500" />}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* ============ DISCORD VOICE STATUS & CONTROL CARD ============ */}
                <div className={`mt-auto flex flex-col shrink-0 transition-all duration-300 border-t ${currentTheme.userCard}`}>
                    
                    {/* Active Voice call simulation banner */}
                    {voiceConnected && (
                        <div className="bg-black/10 px-3 py-2 flex items-center justify-between border-b border-black/20">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-[10px] font-black text-emerald-500 uppercase tracking-wider">
                                    <Sparkles size={10} className="animate-spin duration-1000" />
                                    <span>Đã kết nối giọng nói</span>
                                </div>
                                <div className="text-[9px] opacity-70 truncate mt-0.5">
                                    {(() => {
                                        const voiceConv = conversations.find(c => c.id === voiceConnected);
                                        return voiceConv ? getConvName(voiceConv) : 'Kênh âm thanh';
                                    })()}
                                </div>
                            </div>
                            <button onClick={() => { setVoiceConnected(null); playSound('disconnect'); }}
                                className="w-6 h-6 rounded-lg bg-red-550/20 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow"
                                title="Ngắt kết nối voice">
                                <Phone size={12} className="rotate-[135deg]" />
                            </button>
                        </div>
                    )}

                    {/* Discord style user status control */}
                    <div className="p-2 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="relative shrink-0">
                                <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-black overflow-hidden shadow">
                                    {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : user.name?.charAt(0)}
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${statusMeta.dot} border border-current`} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-extrabold truncate">{user.name}</div>
                                <div className="text-[9px] opacity-60 truncate font-semibold uppercase tracking-wide">{statusMeta.label} • {user.role}</div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => { setIsMuted(!isMuted); playSound('click'); }}
                                className={`w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-current/5 transition-colors ${isMuted ? 'text-red-500 bg-red-500/10' : ''}`}
                                title={isMuted ? 'Bật micro' : 'Tắt tiếng micro'}>
                                {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                            </button>
                            <button onClick={() => { setIsDeafened(!isDeafened); playSound('click'); }}
                                className={`w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-current/5 transition-colors ${isDeafened ? 'text-red-500 bg-red-500/10' : ''}`}
                                title={isDeafened ? 'Bật âm thanh' : 'Tắt âm thanh'}>
                                {isDeafened ? <VolumeX size={14} /> : <Headphones size={14} />}
                            </button>
                            <button onClick={() => setShowAccountSettings(true)}
                                className="w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-current/5 transition-colors"
                                title="Cấu hình tài khoản">
                                <Settings size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ============ TELEGRAM STYLE MAIN CHAT AREA ============ */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${!mobileShowChat ? 'hidden md:flex' : 'flex'} relative`}>
                
                {!activeConv ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
                        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center mb-6 shadow-xl shadow-indigo-500/10 animate-bounce">
                            <MessageCircle size={38} className="text-white" />
                        </div>
                        <h3 className="text-lg font-extrabold mb-1">Không gian giao tiếp KhoTienThinh</h3>
                        <p className="text-xs opacity-60 max-w-xs leading-relaxed">Chọn một kênh thảo luận ở bên trái hoặc nhắn tin trực tiếp với thành viên ban dự án để làm việc hiệu quả</p>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div className={`h-[48px] border-b px-4 flex items-center justify-between shrink-0 transition-all duration-300 ${currentTheme.chatHeader}`}>
                            <div className="flex items-center gap-3 min-w-0">
                                <button onClick={() => setMobileShowChat(false)} className="md:hidden w-8 h-8 rounded-xl flex items-center justify-center hover:bg-current/5 text-current opacity-70">
                                    <ArrowLeft size={16} />
                                </button>
                                <div className="relative shrink-0">
                                    {activeConv.type === 'channel_text' ? (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-extrabold shadow-sm"><Hash size={14} /></div>
                                    ) : activeConv.type === 'channel_voice' ? (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-extrabold shadow-sm"><Volume2 size={14} /></div>
                                    ) : activeConv.type === 'group' ? (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-extrabold shadow-sm"><Users size={14} /></div>
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-extrabold shadow-sm overflow-hidden">
                                            {getConvAvatar(activeConv) ? <img src={getConvAvatar(activeConv)!} className="w-full h-full object-cover" /> : getConvName(activeConv).charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    {isConvOnline(activeConv) && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-current" />}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs font-black truncate flex items-center gap-1">
                                        {activeConv.type === 'channel_text' && <Hash size={12} className="opacity-50" />}
                                        {activeConv.type === 'channel_voice' && <Volume2 size={12} className="opacity-50" />}
                                        {activeConv.type === 'channel_text' ? formatChannelName(getConvName(activeConv)) : getConvName(activeConv)}
                                    </h3>
                                    <p className="text-[9px] opacity-60 font-semibold truncate mt-0.5">
                                        {typingNames.length > 0 ? (
                                            <span className="text-indigo-500 font-bold animate-pulse">{typingNames.join(', ')} đang gõ...</span>
                                        ) : isConvOnline(activeConv) ? (
                                            <span className="text-emerald-500 font-bold">Đang online</span>
                                        ) : activeConv.type === 'group' || activeConv.type === 'channel_text' || activeConv.type === 'channel_voice' ? (
                                            `${activeConv.members?.length || 0} thành viên`
                                        ) : 'Offline'}
                                    </p>
                                </div>
                            </div>
                            
                            {/* Header Tools */}
                            <div className="flex items-center gap-1 text-current opacity-80">
                                
                                {/* PREMIUM THEME SWITCHER */}
                                <div className="relative theme-trigger">
                                    <button onClick={() => { setShowThemeSelector(!showThemeSelector); playSound('click'); }}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${showThemeSelector ? 'bg-indigo-550/20 text-indigo-500' : 'hover:bg-current/5'}`}
                                        title="Thay đổi màu nền tin nhắn">
                                        <Palette size={15} />
                                    </button>
                                    
                                    {/* Theme Switcher Popover */}
                                    {showThemeSelector && (
                                        <div className="theme-selector absolute right-0 top-10 w-64 rounded-2xl shadow-2xl p-4 z-50 border transition-all duration-300 animate-in fade-in slide-in-from-top-3 bg-[#232428] dark:bg-slate-900 border-[#1f2023]/70 text-slate-100">
                                            <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-[#1f2023]">
                                                <Palette size={14} className="text-indigo-400" />
                                                <h4 className="text-xs font-black uppercase tracking-wider">Cá nhân hóa Giao diện</h4>
                                            </div>
                                            <div className="space-y-1.5">
                                                {(Object.entries(THEME_PRESETS) as [ThemeName, ThemeConfig][]).map(([name, data]) => {
                                                    const info = THEME_LABELS[name];
                                                    const isSel = activeTheme === name;
                                                    return (
                                                        <button key={name} onClick={() => { void handleThemeChange(name); }}
                                                            className={`w-full flex items-start gap-3 p-2.5 rounded-xl border text-left transition-all ${
                                                                isSel 
                                                                    ? 'bg-indigo-600/15 border-indigo-500 shadow-md' 
                                                                    : 'border-transparent bg-[#2b2d31]/50 hover:bg-[#2b2d31] hover:border-[#383a40]'
                                                            }`}>
                                                            {/* Color previews circles */}
                                                            <div className="flex -space-x-1 shrink-0 mt-0.5">
                                                                {info.colors.map((c, ci) => (
                                                                    <div key={ci} className={`w-3.5 h-3.5 rounded-full border border-black/20 ${c}`} />
                                                                ))}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="text-xs font-extrabold flex items-center justify-between text-white">
                                                                    <span>{info.name}</span>
                                                                    {isSel && <CheckCircle size={10} className="text-indigo-400" />}
                                                                </div>
                                                                <div className="text-[9px] text-slate-400 truncate mt-0.5">{info.desc}</div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button onClick={() => { void handleStartCall('audio'); }}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-current/5 transition-colors"
                                    title="Cuộc gọi thoại">
                                    <Phone size={15} />
                                </button>
                                <button onClick={() => { void handleStartCall('video'); }}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-current/5 transition-colors"
                                    title="Cuộc gọi video">
                                    <Video size={15} />
                                </button>
                                {pinnedMessages[activeConv.id] && (
                                    <button className="w-8 h-8 rounded-lg flex items-center justify-center text-amber-500 hover:bg-current/5 transition-colors"
                                        title="Tin nhắn đã ghim">
                                        <Pin size={15} />
                                    </button>
                                )}
                                <div className="w-[1px] h-4 bg-current opacity-15 mx-1" />
                                <button onClick={() => { setShowGroupPanel(!showGroupPanel); setEditingGroupName(false); setShowAddMember(false); setConfirmDelete(false); setConfirmLeave(false); }}
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${showGroupPanel ? 'bg-indigo-500/10 text-indigo-500' : 'hover:bg-current/5'}`}>
                                    <Info size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Pinned Messages Header glassmorphic banner */}
                        {pinnedMessages[activeConv.id] && (
                            <div className="px-4 py-2 bg-black/5 backdrop-blur-md border-b border-black/10 flex items-center gap-3 text-xs z-10 animate-in slide-in-from-top duration-150">
                                <Pin size={12} className="text-amber-500 shrink-0" />
                                <div className="min-w-0 flex-1 text-current">
                                    <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Tin nhắn đã ghim</div>
                                    <div className="text-[11px] opacity-80 truncate mt-0.5">{getMessagePreview(pinnedMessages[activeConv.id])}</div>
                                </div>
                                <button onClick={() => {
                                    unpinMessage(activeConv.id)
                                        .then(() => playSound('click'))
                                        .catch(err => alert(getErrorMessage(err, 'Không thể bỏ ghim tin nhắn.')));
                                }}
                                    className="text-current opacity-50 hover:opacity-90">
                                    <X size={12} />
                                </button>
                            </div>
                        )}

                        {/* Main conversation section */}
                        <div className="flex-1 flex overflow-hidden">
                            
                            {/* Scrollable messages + Input container */}
                            <div className="flex-1 flex flex-col min-w-0 relative z-10">
                                
                                {/* Messages viewport */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {groupedMessages.map((group, gi) => (
                                        <div key={gi} className="space-y-2">
                                            <div className="flex items-center justify-center my-4">
                                                <span className={`text-[10px] font-extrabold px-3 py-1 rounded-full shadow-sm border transition-all duration-300 ${currentTheme.dateBadge}`}>{formatDate(group.date)}</span>
                                            </div>
                                            {group.messages.map((msg, mi) => {
                                                const isMe = msg.senderId === user.id;
                                                const sender = users.find(u => u.id === msg.senderId);
                                                const senderName = msg.senderName || sender?.name || (isMe ? user.name : 'Người dùng');
                                                const senderAvatar = msg.senderAvatarUrl || sender?.avatar || (isMe ? user.avatar : undefined);
                                                const isSystem = msg.type === 'system';
                                                const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                                                const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;
                                                const showName = showAvatar;
                                                const reactions = msg.reactions || {};
                                                const isRecalled = Boolean(msg.recalledAt);
                                                const hasReactions = !isRecalled && Object.keys(reactions).length > 0;
                                                const isHovered = hoveredMsgId === msg.id;
                                                const showReactionPicker = reactionPickerMsgId === msg.id;
                                                const canRecallMessage = !isRecalled && (isMe || canManageConversation(activeConv));
                                                
                                                const parsed = parseMessageContent(msg);

                                                if (isSystem) return (
                                                    <div key={msg.id} className="flex justify-center my-2">
                                                        <span className={`text-[10px] border px-3 py-1 rounded-full transition-all duration-300 ${currentTheme.systemMessage}`}>{msg.content}</span>
                                                    </div>
                                                );

                                                return (
                                                    <div key={msg.id}
                                                        className={`flex gap-2.5 ${isMe ? 'justify-end' : 'justify-start'} ${hasReactions ? 'mb-4' : 'mb-0.5'}`}
                                                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                                                        onMouseLeave={() => { if (!showReactionPicker) setHoveredMsgId(null); }}>
                                                        
                                                        {/* Avatar for other people (on the left) */}
                                                        {!isMe && (
                                                            <div className="w-8 shrink-0 self-start mt-0.5">
                                                                {showAvatar ? (
                                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-650 flex items-center justify-center text-white text-xs font-black overflow-hidden shadow animate-in fade-in zoom-in duration-200">
                                                                        {senderAvatar ? <img src={senderAvatar} className="w-full h-full object-cover" /> : senderName?.charAt(0)?.toUpperCase() || '?'}
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-8" />
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Avatar for me (on the right) */}
                                                        {isMe && (
                                                            <div className="w-8 shrink-0 self-start mt-0.5 order-last">
                                                                {showAvatar ? (
                                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-650 flex items-center justify-center text-white text-xs font-black overflow-hidden shadow animate-in fade-in zoom-in duration-200">
                                                                        {senderAvatar ? <img src={senderAvatar} className="w-full h-full object-cover" /> : senderName?.charAt(0)?.toUpperCase() || '?'}
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-8" />
                                                                )}
                                                            </div>
                                                        )}
                                                        
                                                        <div className={`max-w-[70%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                            {showName && (
                                                                <span className={`text-[10px] font-black opacity-60 mb-0.5 flex items-center gap-1.5 ${isMe ? 'mr-1' : 'ml-1'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
                                                                    {senderName}
                                                                    {((isMe ? user.role : sender?.role) as any) === 'admin' && <Shield size={10} className="text-amber-500" />}
                                                                </span>
                                                            )}
                                                            
                                                            <div className="relative group/msg">
                                                                {/* Custom reply preview quote inside bubble */}
                                                                <div className={`px-3 py-2 text-xs leading-relaxed shadow-sm rounded-2xl relative transition-all duration-300 ${
                                                                    isMe ? currentTheme.messageMe : currentTheme.messageOther
                                                                }`}>
                                                                    {isRecalled ? (
                                                                        <p className="italic opacity-70">Tin nhắn đã được thu hồi</p>
                                                                    ) : parsed.isReply && (
                                                                        <div className={`border-l-2 pl-2 py-0.5 pr-1 mb-1.5 rounded text-[10px] select-none max-w-full ${isMe ? currentTheme.replyQuoteMe : currentTheme.replyQuoteOther}`}>
                                                                            <div className="font-extrabold text-[9px]">{parsed.replyToName}</div>
                                                                            <div className="truncate text-[9px]">{parsed.replyToText}</div>
                                                                        </div>
                                                                    )}
                                                                    
                                                                    {!isRecalled && parsed.actualText && <p className="whitespace-pre-wrap break-words">{parsed.actualText}</p>}
                                                                    
                                                                    {/* File attachments */}
                                                                    {!isRecalled && msg.attachments && msg.attachments.length > 0 && (
                                                                        <div className="mt-1.5 space-y-1">
                                                                            {msg.attachments.map((att, ai) => (
                                                                                <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer"
                                                                                    className={`flex items-center gap-2 text-xs px-2.5 py-2 rounded-xl border ${
                                                                                        isMe ? 'bg-white/10 hover:bg-white/20 border-white/10 text-white' : 'bg-black/5 hover:bg-black/10 border-current/10 text-current'
                                                                                    }`}>
                                                                                    {att.type?.startsWith('image') ? <ImageIcon size={13} /> : <File size={13} />}
                                                                                    <span className="truncate max-w-[150px] font-bold">{att.name}</span>
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Hover tools bar popover */}
                                                                {isHovered && (
                                                                    <div className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 z-35 ${isMe ? '-left-20' : '-right-20'}`}>
                                                                        {/* Reaction smiles */}
                                                                        {!isRecalled && (
                                                                            <button onClick={() => setReactionPickerMsgId(showReactionPicker ? null : msg.id)}
                                                                                className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-lg hover:scale-105 hover:bg-slate-50 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                                                                title="Thêm cảm xúc">
                                                                                <Smile size={13} />
                                                                            </button>
                                                                        )}
                                                                        {/* Reply shortcut */}
                                                                        {!isRecalled && (
                                                                            <button onClick={() => { setReplyingTo({ id: msg.id, senderId: msg.senderId, senderName, content: parsed.actualText }); playSound('click'); }}
                                                                                className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-lg hover:scale-105 hover:bg-slate-50 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                                                                title="Trả lời tin nhắn">
                                                                                <CornerUpLeft size={13} />
                                                                            </button>
                                                                        )}
                                                                        {/* Pin shortcut */}
                                                                        {!isRecalled && (
                                                                            <button onClick={() => {
                                                                                pinMessage(activeConv.id, msg.id)
                                                                                    .then(() => playSound('connect'))
                                                                                    .catch(err => alert(getErrorMessage(err, 'Không thể ghim tin nhắn.')));
                                                                            }}
                                                                                className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-lg hover:scale-105 hover:bg-slate-50 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                                                                title="Ghim tin nhắn">
                                                                                <Pin size={13} />
                                                                            </button>
                                                                        )}
                                                                        {canRecallMessage && (
                                                                            <button onClick={() => { void handleRecallMessage(msg.id); }}
                                                                                className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/60 flex items-center justify-center shadow-lg hover:scale-105 hover:bg-red-50 text-red-500"
                                                                                title="Thu hồi tin nhắn">
                                                                                <RotateCcw size={13} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Emoji Reactions Picker */}
                                                                {!isRecalled && showReactionPicker && (
                                                                    <div className={`reaction-picker absolute z-50 ${isMe ? 'right-0' : 'left-0'} -top-12 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 px-2 py-1 flex items-center gap-0.5 animate-in zoom-in-95 duration-100 text-slate-800 dark:text-slate-100`}>
                                                                        {REACTION_EMOJIS.map(emoji => {
                                                                            const myReacted = (reactions[emoji] as string[] | undefined)?.includes(user.id);
                                                                            return (
                                                                                <button key={emoji}
                                                                                    onClick={() => {
                                                                                        toggleReaction(msg.id, msg.conversationId, emoji)
                                                                                            .catch(err => alert(getErrorMessage(err, 'Không thể cập nhật cảm xúc.')));
                                                                                        setReactionPickerMsgId(null);
                                                                                        setHoveredMsgId(null);
                                                                                    }}
                                                                                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm hover:bg-slate-100 dark:hover:bg-slate-700 hover:scale-120 transition-all ${myReacted ? 'bg-indigo-500/10 ring-1 ring-indigo-500/50' : ''}`}>
                                                                                    {emoji}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Grouped Reactions listed bottom of bubble */}
                                                            {hasReactions && (
                                                                <div className={`flex flex-wrap gap-1 mt-1 z-10 ${isMe ? 'justify-end' : 'justify-start'}`}>
                                                                    {Object.entries(reactions).map(([emoji, userIds]) => {
                                                                        const ids = userIds as string[];
                                                                        const myReacted = ids.includes(user.id);
                                                                        const reactorNames = ids.map(uid => users.find(u => u.id === uid)?.name || '').filter(Boolean);
                                                                        return (
                                                                            <button key={emoji} onClick={() => {
                                                                                toggleReaction(msg.id, msg.conversationId, emoji)
                                                                                    .catch(err => alert(getErrorMessage(err, 'Không thể cập nhật cảm xúc.')));
                                                                            }} title={reactorNames.join(', ')}
                                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-all border ${
                                                                                    myReacted ? currentTheme.reactionsBadgeMe : currentTheme.reactionsBadgeOther
                                                                                }`}>
                                                                                <span>{emoji}</span>
                                                                                <span className="font-black text-[8px]">{ids.length}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            
                                                            {/* Read/Sent Status Checkmarks */}
                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                <span className="text-[8px] opacity-50 select-none">{formatTime(msg.createdAt)}</span>
                                                                {isMe && (
                                                                    activeConv.type === 'direct' ? (
                                                                        onlineUsers.has(activeConv.members?.find(m => m.userId !== user.id)?.userId || '') ? (
                                                                            <CheckCheck size={11} className="text-emerald-500 shrink-0" />
                                                                        ) : (
                                                                            <Check size={11} className="text-slate-400 shrink-0" />
                                                                        )
                                                                    ) : (
                                                                        <CheckCheck size={11} className="text-emerald-500 shrink-0" />
                                                                    )
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                    {typingNames.length > 0 && (
                                        <div className="flex gap-2 items-end pl-10">
                                            <div className={`px-3 py-2 rounded-2xl rounded-bl-sm border flex items-center justify-center transition-all duration-300 ${currentTheme.messageOther}`}>
                                                <div className="flex gap-1">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-current/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <div className="w-1.5 h-1.5 rounded-full bg-current/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                    <div className="w-1.5 h-1.5 rounded-full bg-current/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Reply Preview Box */}
                                {replyingTo && (
                                    <div className="px-4 py-2 bg-black/5 border-t border-current/15 flex items-center gap-3 text-xs animate-in slide-in-from-bottom duration-150 text-current">
                                        <CornerUpLeft size={13} className="text-indigo-500 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[10px] font-black text-indigo-500">Đang trả lời {replyingTo.senderName}</div>
                                            <div className="text-[10px] opacity-70 truncate mt-0.5">{replyingTo.content}</div>
                                        </div>
                                        <button onClick={() => setReplyingTo(null)} className="opacity-55 hover:opacity-100">
                                            <X size={13} />
                                        </button>
                                    </div>
                                )}

                                {/* Uploading Files Preview Box */}
                                {uploadingFiles && (
                                    <div className="px-4 py-2 bg-indigo-500/10 border-t border-indigo-500/15 flex items-center gap-3 text-xs animate-in slide-in-from-bottom duration-150 text-indigo-500 dark:text-indigo-400">
                                        <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 tracking-wide uppercase">Tải lên tài liệu</div>
                                            <div className="text-[10px] opacity-85 truncate mt-0.5">{uploadProgress}</div>
                                        </div>
                                    </div>
                                )}

                                {activeConv.type === 'channel_voice' ? (
                                    <div className={`p-4 relative z-10 shrink-0 transition-all duration-300 ${currentTheme.inputPanel}`}>
                                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-current/10 bg-current/5 px-4 py-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-500">
                                                    <Volume2 size={14} />
                                                    <span>{voiceConnected === activeConv.id ? 'Đang kết nối kênh âm thanh' : 'Kênh âm thanh'}</span>
                                                </div>
                                                <div className="text-[10px] opacity-60 mt-0.5 truncate">{getConvName(activeConv)}</div>
                                            </div>
                                            <button onClick={() => {
                                                if (voiceConnected === activeConv.id) {
                                                    setVoiceConnected(null);
                                                    playSound('disconnect');
                                                } else {
                                                    setVoiceConnected(activeConv.id);
                                                    playSound('connect');
                                                }
                                            }}
                                                className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                                                    voiceConnected === activeConv.id
                                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                                        : 'bg-emerald-500 text-white hover:bg-emerald-600'
                                                }`}>
                                                {voiceConnected === activeConv.id ? 'Ngắt kết nối' : 'Kết nối'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                <div className={`p-3 relative z-10 shrink-0 transition-all duration-300 ${currentTheme.inputPanel}`}>
                                    
                                    {/* Quick Emoji panel */}
                                    {showEmojiPicker && (
                                        <div className="emoji-picker absolute bottom-18 left-3 right-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-3 z-50 animate-in slide-in-from-bottom duration-150 text-slate-800 dark:text-slate-100">
                                            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-700">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Cảm xúc nhanh</span>
                                                <button onClick={() => setShowEmojiPicker(false)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                                            </div>
                                            <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                                                {QUICK_EMOJIS.map(emoji => (
                                                    <button key={emoji} onClick={() => insertEmoji(emoji)}
                                                        className="w-8.5 h-8.5 rounded-lg flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:scale-120 transition-all">{emoji}</button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2">
                                        {/* Emoji Trigger */}
                                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                            className={`emoji-trigger w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                                                showEmojiPicker ? 'bg-indigo-500/10 text-indigo-500 animate-pulse' : 'text-current opacity-70 hover:opacity-100 hover:bg-current/5'
                                            }`}>
                                            <Smile size={18} />
                                        </button>
                                        
                                        {/* Paperclip upload trigger */}
                                        <input
                                            type="file"
                                            multiple
                                            ref={fileInputRef}
                                            onChange={handleFileUpload}
                                            className="hidden"
                                        />
                                        <button 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-10 h-10 rounded-xl flex items-center justify-center text-current opacity-70 hover:opacity-100 hover:bg-current/5 transition-colors"
                                            title="Đính kèm tài liệu/ảnh">
                                            <Paperclip size={16} />
                                        </button>
                                        
                                        {/* Message input */}
                                        <div className={`flex-1 flex items-center rounded-xl px-4 py-2 border transition-all ${currentTheme.inputFieldBg}`}>
                                            <input ref={inputRef} value={msgInput}
                                                onChange={e => handleInputChange(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                                placeholder={activeConv.type === 'group' || activeConv.type === 'channel_text' ? `Gửi tin nhắn vào #${formatChannelName(getConvName(activeConv))}` : `Nhắn tin cho ${getConvName(activeConv)}`}
                                                className={`flex-1 bg-transparent text-xs outline-none ${currentTheme.inputField}`} />
                                        </div>

                                        {/* Send Button */}
                                        <button onClick={handleSend} disabled={!msgInput.trim()}
                                            className="w-10 h-10 rounded-xl bg-indigo-550 flex items-center justify-center text-white shadow shadow-indigo-550/10 disabled:opacity-40 disabled:shadow-none hover:bg-indigo-650 transition-all active:scale-95 shrink-0">
                                            <Send size={15} />
                                        </button>
                                    </div>
                                </div>
                                )}
                            </div>

                            {/* ============ DETAILED RIGHT HAND PANEL (DISCORD STYLE) ============ */}
                            {showGroupPanel && (
                                <div className={`w-[280px] border-l flex flex-col shrink-0 overflow-y-auto animate-in slide-in-from-right duration-200 z-10 select-none transition-all duration-300 ${currentTheme.rightPanel}`}>
                                    
                                    {/* Panel Header */}
                                    <div className={`p-4 border-b flex items-center justify-between transition-all duration-300 ${currentTheme.rightPanelHeader}`}>
                                        <span className="text-xs font-black uppercase tracking-wider">
                                            {isChannelConversation(activeConv) ? 'Thông tin kênh' : activeConv.type === 'group' ? 'Hồ sơ nhóm' : 'Hồ sơ thành viên'}
                                        </span>
                                        <button onClick={() => setShowGroupPanel(false)} className="text-current opacity-60 hover:opacity-100"><X size={15} /></button>
                                    </div>

                                    {/* Profile detail */}
                                    <div className={`p-5 flex flex-col items-center text-center transition-all duration-300 ${currentTheme.rightPanelProfile}`}>
                                        {activeConv.type === 'channel_text' ? (
                                            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white shadow-xl mb-3"><Hash size={26} /></div>
                                        ) : activeConv.type === 'channel_voice' ? (
                                            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-xl mb-3"><Volume2 size={26} /></div>
                                        ) : activeConv.type === 'group' ? (
                                            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-xl mb-3"><Users size={26} /></div>
                                        ) : (
                                            <div className="w-16 h-16 rounded-3xl bg-indigo-550 flex items-center justify-center text-white text-xl font-extrabold shadow-xl mb-3 overflow-hidden">
                                                {getConvAvatar(activeConv) ? <img src={getConvAvatar(activeConv)!} className="w-full h-full object-cover" /> : getConvName(activeConv).charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        
                                        {(activeConv.type === 'group' || isChannelConversation(activeConv)) && editingGroupName ? (
                                            <div className="flex items-center gap-1 w-full">
                                                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                                                    className="flex-1 px-2 py-1 text-xs rounded-lg border border-indigo-500 bg-current/5 text-center font-bold outline-none focus:ring-1 focus:ring-indigo-500 text-current"
                                                    autoFocus onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) { void handleRenameGroup(); } }} />
                                                <button onClick={() => { void handleRenameGroup(); }}
                                                    className="w-6 h-6 rounded bg-emerald-505 text-white flex items-center justify-center hover:bg-emerald-600"><Check size={12} /></button>
                                                <button onClick={() => setEditingGroupName(false)}
                                                    className="w-6 h-6 rounded bg-slate-700 text-slate-400 flex items-center justify-center hover:bg-slate-600"><X size={12} /></button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                <span className={`text-sm font-extrabold ${currentTheme.rightPanelProfileName}`}>{activeConv.type === 'channel_text' ? `#${formatChannelName(getConvName(activeConv))}` : getConvName(activeConv)}</span>
                                                {(activeConv.type === 'group' || (isChannelConversation(activeConv) && canManageConversation(activeConv))) && (
                                                    <button onClick={() => { setEditingGroupName(true); setNewGroupName(activeConv.name || ''); }}
                                                        className="text-current opacity-60 hover:opacity-100 transition-opacity"><Edit3 size={12} /></button>
                                                )}
                                            </div>
                                        )}
                                        <span className="text-[10px] opacity-60 mt-1 font-semibold uppercase tracking-wide">
                                            {activeConv.type === 'group' || isChannelConversation(activeConv) ? `${activeConv.members?.length || 0} thành viên` : 'NHÂN VIÊN ERP'}
                                        </span>
                                    </div>

                                    {/* Action Shortcuts */}
                                    <div className="p-3 border-b border-current/10 grid grid-cols-3 gap-2 bg-current/5">
                                        <button className="flex flex-col items-center p-2 rounded-lg hover:bg-current/10 text-current opacity-70 hover:opacity-100 transition-all text-center">
                                            <Search size={15} />
                                            <span className="text-[9px] font-bold mt-1">Tìm kiếm</span>
                                        </button>
                                        <button className="flex flex-col items-center p-2 rounded-lg hover:bg-current/10 text-current opacity-70 hover:opacity-100 transition-all text-center">
                                            <Pin size={15} />
                                            <span className="text-[9px] font-bold mt-1">Ghim</span>
                                        </button>
                                        <button className="flex flex-col items-center p-2 rounded-lg hover:bg-current/10 text-current opacity-70 hover:opacity-100 transition-all text-center">
                                            <Share2 size={15} />
                                            <span className="text-[9px] font-bold mt-1">Chia sẻ</span>
                                        </button>
                                    </div>

                                    {/* Members list if group/channel */}
                                    {(activeConv.type === 'group' || isChannelConversation(activeConv)) && (
                                        <div className="p-4 border-b border-current/10">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-[10px] font-black opacity-60 uppercase tracking-wider">Thành viên ({activeConv.members?.length || 0})</span>
                                                {canManageConversation(activeConv) && (
                                                    <button onClick={() => setShowAddMember(!showAddMember)}
                                                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${showAddMember ? 'bg-indigo-500/10 text-indigo-500' : 'hover:bg-current/5 text-current opacity-70'}`}>
                                                        <UserPlus size={13} />
                                                    </button>
                                                )}
                                            </div>

                                            {showAddMember && (() => {
                                                const memberIds = activeConv.members?.map(m => m.userId) || [];
                                                const activeConvWorkspace = activeConv.workspaceId ? workspaces.find(item => item.id === activeConv.workspaceId) : null;
                                                const workspaceUserIds = activeConvWorkspace?.members?.filter(member => !member.leftAt).map(member => member.userId) || [];
                                                const sourceUsers = isChannelConversation(activeConv)
                                                    ? users.filter(u => workspaceUserIds.includes(u.id))
                                                    : users;
                                                const addableUsers = sourceUsers.filter(u => u.id !== user.id && u.isActive !== false && !memberIds.includes(u.id));
                                                return addableUsers.length > 0 ? (
                                                    <div className="mb-3 p-2 bg-black/10 rounded-xl space-y-1 max-h-[140px] overflow-y-auto">
                                                        {addableUsers.map(u => {
                                                            const employee = companyEmployeeByUserId.get(u.id);
                                                            return (
                                                                <button key={u.id} onClick={() => { void handleAddMember(u.id); }}
                                                                    className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-current/5 transition-all text-left">
                                                                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[8px] font-black overflow-hidden shrink-0">
                                                                        {employee?.avatarUrl || u.avatar ? (
                                                                            <img src={employee?.avatarUrl || u.avatar} className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            (employee?.fullName || u.name)?.charAt(0)?.toUpperCase()
                                                                        )}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-[10px] font-bold text-current truncate">{employee?.fullName || u.name}</div>
                                                                        <div className="text-[8px] opacity-60 truncate">{employee?.employeeCode || 'Nhân viên'}{employee?.title ? ` • ${employee.title}` : ''}</div>
                                                                    </div>
                                                                    <UserPlus size={11} className="text-emerald-500 shrink-0" />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <p className="text-[9px] opacity-55 text-center mb-3 italic">Không còn thành viên phù hợp để thêm</p>
                                                );
                                            })()}

                                            <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1">
                                                {(activeConv.members || []).map(member => {
                                                    const memberUser = users.find(u => u.id === member.userId);
                                                    const isOwner = member.role === 'owner' || activeConv.createdBy === member.userId;
                                                    const isAdmin = member.role === 'admin';
                                                    const isCurrentUser = member.userId === user.id;
                                                    const currentUserCanManage = canManageConversation(activeConv);
                                                    const currentUserIsOwner = String(user.role) === 'ADMIN' || activeConv.createdBy === user.id || activeConv.members?.some(m => m.userId === user.id && m.role === 'owner');
                                                    return (
                                                        <div key={member.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-current/5 group">
                                                            <div className="relative shrink-0">
                                                                <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-[10px] font-bold overflow-hidden">
                                                                    {memberUser?.avatar ? <img src={memberUser.avatar} className="w-full h-full object-cover" /> : memberUser?.name?.charAt(0)?.toUpperCase() || '?'}
                                                                </div>
                                                                {onlineUsers.has(member.userId) && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-current" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-[11px] font-bold opacity-85 truncate">
                                                                        {memberUser?.name || 'Người dùng'}{isCurrentUser ? ' (Bạn)' : ''}
                                                                    </span>
                                                                    {isOwner ? (
                                                                        <span title="Chủ kênh/nhóm"><Crown size={9} className="text-amber-500 shrink-0" /></span>
                                                                    ) : isAdmin ? (
                                                                        <span title="Quản trị viên"><Shield size={9} className="text-indigo-400 shrink-0" /></span>
                                                                    ) : null}
                                                                </div>
                                                                <div className="text-[8px] opacity-45 uppercase font-bold">{isOwner ? 'Chủ kênh' : isAdmin ? 'Quản trị' : 'Thành viên'}</div>
                                                            </div>
                                                            {currentUserIsOwner && !isCurrentUser && !isOwner && (
                                                                <button onClick={() => { void handleUpdateMemberRole(member.userId, isAdmin ? 'member' : 'admin'); }}
                                                                    className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-current opacity-0 group-hover:opacity-100 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all"
                                                                    title={isAdmin ? 'Hạ quyền thành viên' : 'Cấp quyền quản trị'}>
                                                                    <Shield size={11} />
                                                                </button>
                                                            )}
                                                            {currentUserCanManage && !isCurrentUser && !isOwner && (
                                                                <button onClick={() => { void handleRemoveMember(member.userId); }}
                                                                    className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-current opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all"
                                                                    title="Loại khỏi nhóm/kênh">
                                                                    <UserMinus size={11} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Action operations panels */}
                                    <div className="p-4 space-y-2 mt-auto bg-black/5">
                                        {activeConv.type === 'group' && (
                                            confirmLeave ? (
                                                <div className="p-2.5 bg-orange-500/5 rounded-lg border border-orange-500/30">
                                                    <p className="text-[10px] font-bold text-orange-500 mb-2 text-center">Bạn muốn rời nhóm này?</p>
                                                    <div className="flex gap-1.5">
                                                        <button onClick={() => { void handleLeaveGroup(); }}
                                                            className="flex-1 py-1 rounded bg-orange-500 text-white text-[10px] font-bold hover:bg-orange-600">Rời nhóm</button>
                                                        <button onClick={() => setConfirmLeave(false)}
                                                            className="flex-1 py-1 rounded bg-slate-700 text-slate-300 text-[10px] font-bold hover:bg-slate-650">Hủy</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button onClick={() => setConfirmLeave(true)}
                                                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-orange-500/10 text-orange-500 transition-colors">
                                                    <LogOut size={14} /> <span className="text-[11px] font-bold">Rời khỏi nhóm</span>
                                                </button>
                                            )
                                        )}

                                        {confirmDelete ? (
                                            <div className="p-2.5 bg-red-500/5 rounded-lg border border-red-500/30">
                                                <p className="text-[10px] font-bold text-red-500 mb-2 text-center">
                                                    {isChannelConversation(activeConv) ? 'Xóa kênh khỏi workspace?' : activeConv.type === 'group' ? 'Xóa nhóm khỏi danh sách hoạt động?' : 'Ẩn cuộc trò chuyện khỏi danh sách của bạn?'}
                                                </p>
                                                <div className="flex gap-1.5">
                                                    <button onClick={() => { void handleDeleteConversation(); }}
                                                        disabled={isChannelConversation(activeConv) && !canManageConversation(activeConv)}
                                                        className="flex-1 py-1 rounded bg-red-500 text-white text-[10px] font-bold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                                                        {isChannelConversation(activeConv) ? 'Xóa kênh' : 'Xóa cuộc chat'}
                                                    </button>
                                                    <button onClick={() => setConfirmDelete(false)}
                                                        className="flex-1 py-1 rounded bg-slate-700 text-slate-300 text-[10px] font-bold hover:bg-slate-650">Hủy</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDelete(true)}
                                                disabled={isChannelConversation(activeConv) && !canManageConversation(activeConv)}
                                                className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-red-500/10 text-red-500 transition-colors">
                                                <Trash2 size={14} /> <span className="text-[11px] font-bold">{isChannelConversation(activeConv) ? 'Xóa kênh' : 'Xóa cuộc trò chuyện'}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ============ ACCOUNT SETTINGS MODAL ============ */}
            {showAccountSettings && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4" onClick={() => setShowAccountSettings(false)}>
                    <div
                        className="w-full max-w-md rounded-2xl border border-[#1f2023] bg-[#232428] text-slate-100 shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="h-12 px-4 flex items-center justify-between border-b border-[#1f2023]">
                            <div className="flex items-center gap-2 min-w-0">
                                <Settings size={16} className="text-indigo-400 shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-xs font-black uppercase tracking-wider truncate">Cấu hình tài khoản chat</div>
                                    <div className="text-[10px] text-slate-400 truncate">{user.name}</div>
                                </div>
                            </div>
                            <button onClick={() => setShowAccountSettings(false)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-white/5 hover:text-white">
                                <X size={15} />
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Trạng thái</div>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {([
                                        ['online', 'Online', 'bg-emerald-500'],
                                        ['busy', 'Bận', 'bg-red-500'],
                                        ['away', 'Vắng', 'bg-amber-500'],
                                        ['offline', 'Ẩn', 'bg-slate-500'],
                                    ] as const).map(([status, label, dot]) => (
                                        <button key={status} onClick={() => setChatStatus(status)}
                                            className={`py-2 rounded-xl border text-[10px] font-bold flex items-center justify-center gap-1.5 transition ${
                                                chatStatus === status ? 'border-indigo-500 bg-indigo-500/15 text-white' : 'border-white/5 bg-white/5 text-slate-300 hover:bg-white/10'
                                            }`}>
                                            <span className={`w-2 h-2 rounded-full ${dot}`} />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Giao diện</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {(Object.entries(THEME_PRESETS) as [ThemeName, ThemeConfig][]).map(([name]) => {
                                        const info = THEME_LABELS[name];
                                        const selected = activeTheme === name;
                                        return (
                                            <button key={name} onClick={() => setActiveTheme(name)}
                                                className={`p-2.5 rounded-xl border text-left transition ${
                                                    selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-white/5 bg-white/5 hover:bg-white/10'
                                                }`}>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div className="flex -space-x-1">
                                                        {info.colors.map((c, idx) => (
                                                            <span key={idx} className={`w-3 h-3 rounded-full border border-black/20 ${c}`} />
                                                        ))}
                                                    </div>
                                                    {selected && <CheckCircle size={11} className="text-indigo-400 ml-auto" />}
                                                </div>
                                                <div className="text-[10px] font-extrabold text-white truncate">{info.name}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setSoundEnabled(prev => !prev)}
                                    className={`p-3 rounded-xl border text-left transition ${
                                        soundEnabled ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300' : 'border-white/5 bg-white/5 text-slate-300 hover:bg-white/10'
                                    }`}>
                                    <Volume2 size={15} className="mb-2" />
                                    <div className="text-xs font-bold">Âm thanh</div>
                                    <div className="text-[10px] opacity-70 mt-0.5">{soundEnabled ? 'Đang bật' : 'Đang tắt'}</div>
                                </button>
                                <button onClick={() => setNotificationsEnabled(prev => !prev)}
                                    className={`p-3 rounded-xl border text-left transition ${
                                        notificationsEnabled ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300' : 'border-white/5 bg-white/5 text-slate-300 hover:bg-white/10'
                                    }`}>
                                    <Info size={15} className="mb-2" />
                                    <div className="text-xs font-bold">Thông báo</div>
                                    <div className="text-[10px] opacity-70 mt-0.5">{notificationsEnabled ? 'Đang bật' : 'Đang tắt'}</div>
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setDefaultMuted(prev => !prev)}
                                    className={`p-3 rounded-xl border text-left transition ${
                                        defaultMuted ? 'border-red-500/60 bg-red-500/10 text-red-300' : 'border-white/5 bg-white/5 text-slate-300 hover:bg-white/10'
                                    }`}>
                                    <MicOff size={15} className="mb-2" />
                                    <div className="text-xs font-bold">Mặc định tắt mic</div>
                                    <div className="text-[10px] opacity-70 mt-0.5">{defaultMuted ? 'Có' : 'Không'}</div>
                                </button>
                                <button onClick={() => setDefaultDeafened(prev => !prev)}
                                    className={`p-3 rounded-xl border text-left transition ${
                                        defaultDeafened ? 'border-red-500/60 bg-red-500/10 text-red-300' : 'border-white/5 bg-white/5 text-slate-300 hover:bg-white/10'
                                    }`}>
                                    <VolumeX size={15} className="mb-2" />
                                    <div className="text-xs font-bold">Mặc định tắt âm</div>
                                    <div className="text-[10px] opacity-70 mt-0.5">{defaultDeafened ? 'Có' : 'Không'}</div>
                                </button>
                            </div>
                        </div>

                        <div className="px-4 py-3 border-t border-[#1f2023] flex items-center justify-end gap-2">
                            <button onClick={() => setShowAccountSettings(false)}
                                className="px-4 py-2 rounded-xl bg-white/5 text-xs font-bold text-slate-300 hover:bg-white/10">
                                Hủy
                            </button>
                            <button onClick={() => { void saveAccountSettings(); }}
                                className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500">
                                Lưu cấu hình
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ VOIP CALLING INTERACTION SIMULATOR OVERLAY ============ */}
            {showCallOverlay && (
                <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center z-50 animate-in fade-in duration-200">
                    {/* Audio element for WebRTC VoIP calling */}
                    <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

                    {!hasAcceptedCall ? (
                        /* ============ INBOUND CALL OVERLAY (CUỘC GỌI ĐẾN) ============ */
                        <div className="flex flex-col items-center animate-in zoom-in-95 duration-200">
                            <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center text-white text-3xl font-black shadow-2xl relative mb-6">
                                {callSessionStartedBy && users.find(u => u.id === callSessionStartedBy)?.avatar ? (
                                    <img 
                                        src={users.find(u => u.id === callSessionStartedBy)?.avatar} 
                                        alt={callSessionStartedBy ? users.find(u => u.id === callSessionStartedBy)?.name : ''} 
                                        className="w-full h-full rounded-full object-cover" 
                                    />
                                ) : (
                                    callSessionStartedBy ? (users.find(u => u.id === callSessionStartedBy)?.name || 'C').charAt(0).toUpperCase() : 'C'
                                )}
                                {/* Pulsing rings for incoming call */}
                                <div className="absolute inset-0 rounded-full bg-indigo-500/40 animate-ping duration-1000" />
                            </div>

                            <h2 className="text-xl font-extrabold text-white mb-2">
                                {callSessionStartedBy ? (users.find(u => u.id === callSessionStartedBy)?.name || 'Đồng nghiệp') : 'Đồng nghiệp'}
                            </h2>
                            <p className="text-sm text-indigo-400 mb-8 font-semibold animate-pulse tracking-wide uppercase">
                                Đang gọi {showCallOverlay === 'audio' ? 'thoại' : 'video'} cho bạn...
                            </p>

                            <div className="flex items-center gap-8">
                                {/* Decline Button */}
                                <button onClick={() => { void handleDeclineCall(); }}
                                    className="w-16 h-16 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-500 hover:scale-105 transition-all shadow-xl shadow-red-500/30 group">
                                    <Phone size={26} className="rotate-[135deg]" />
                                </button>

                                {/* Accept Button */}
                                <button onClick={() => { void handleAcceptCall(); }}
                                    className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-500 hover:scale-105 transition-all shadow-xl shadow-emerald-500/30 group">
                                    <Phone size={26} />
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* ============ ACTIVE CALL OVERLAY (ĐANG ĐÀM THOẠI) ============ */
                        <div className="flex flex-col items-center justify-center w-full max-w-md px-6">
                            {showCallOverlay === 'video' ? (
                                /* Video Call Window */
                                <div className="w-[340px] h-[220px] bg-slate-900 border border-[#3f4147] rounded-3xl flex items-center justify-center relative mb-8 overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                                    {/* Remote Stream Video */}
                                    <video id="remote-video" autoPlay playsInline className="w-full h-full object-cover rounded-3xl" />
                                    
                                    {/* Local Stream Video Preview */}
                                    <video id="local-video" autoPlay playsInline muted className="absolute bottom-3 right-3 w-24 h-16 bg-slate-800 border border-slate-700 rounded-xl object-cover shadow-lg" />
                                    
                                    {/* Fallback indicator if remote stream hasn't arrived */}
                                    {!remoteStreamRef.current && (
                                        <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-xs text-slate-400 gap-2">
                                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                                            Đang kết nối WebRTC...
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* Audio Call Profile */
                                <div className="w-24 h-24 rounded-full bg-indigo-500 flex items-center justify-center text-white text-3xl font-black shadow-2xl relative mb-6">
                                    {activeConv ? getConvName(activeConv).charAt(0).toUpperCase() : '?'}
                                    <div className="absolute inset-0 rounded-full bg-indigo-500/40 animate-ping duration-1000" />
                                </div>
                            )}

                            <h2 className="text-xl font-extrabold text-white mb-1">
                                {activeConv ? getConvName(activeConv) : 'Cuộc gọi đàm thoại'}
                            </h2>
                            <p className="text-xs text-slate-400 mb-8 uppercase tracking-wider flex items-center gap-1.5 font-bold">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                {showCallOverlay === 'audio' ? 'Đang gọi thoại' : 'Đang gọi video'} • {formatCallTime(callDuration)}
                            </p>

                            <div className="flex items-center gap-6">
                                <button onClick={() => { setIsMuted(!isMuted); playSound('click'); }}
                                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                                        isMuted ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}>
                                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                                </button>

                                <button onClick={() => { void handleEndCall(); }}
                                    className="w-16 h-16 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-500 hover:scale-105 transition-all shadow-xl shadow-red-500/20">
                                    <Phone size={26} className="rotate-[135deg]" />
                                </button>

                                <button onClick={() => { setIsDeafened(!isDeafened); playSound('click'); }}
                                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                                        isDeafened ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}>
                                    {isDeafened ? <VolumeX size={20} /> : <Headphones size={20} />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Chat;
