import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useChat } from '../context/ChatContext';
import { useApp } from '../context/AppContext';
import {
    MessageCircle, Search, Plus, Send, Paperclip, Users, X, Check, CheckCheck,
    Hash, User as UserIcon, Smile, MoreVertical, ArrowLeft, Image as ImageIcon, File,
    Edit3, Trash2, LogOut, UserPlus, UserMinus, Crown, Shield
} from 'lucide-react';

// ===================== CONSTANTS =====================
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥', '👏'];
const QUICK_EMOJIS = ['😀', '😂', '🤣', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤔', '🤗', '😏', '😈', '👻', '💀', '🤖', '👽', '🎃', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '🔥', '⭐', '✨', '💫', '🎉', '🎊', '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '💪', '🙏', '☕', '🍕', '🍺', '🎵', '📌', '✅', '❌', '⚡', '💡'];

// ===================== HELPERS =====================
const timeAgo = (dateStr: string) => {
    const now = new Date();
    const d = new Date(dateStr);
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} ngày`;
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

// ===================== MAIN COMPONENT =====================
const Chat: React.FC = () => {
    const { user, users } = useApp();
    const {
        conversations, messages, activeConversationId, setActiveConversationId,
        onlineUsers, typingUsers, sendMessage, createDirectConversation,
        createGroupConversation, addMember, removeMember, updateGroupName,
        deleteConversation, leaveGroup, markAsRead, loadMessages, setTyping, toggleReaction, totalUnread,
    } = useChat();

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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const typingTimeoutRef = useRef<any>(null);
    const sendingRef = useRef(false);
    const justSentRef = useRef(false);

    const activeConv = conversations.find(c => c.id === activeConversationId);
    const activeMessages = activeConversationId ? (messages[activeConversationId] || []) : [];

    useEffect(() => {
        if (activeConversationId) {
            loadMessages(activeConversationId);
            markAsRead(activeConversationId);
        }
    }, [activeConversationId, loadMessages, markAsRead]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeMessages.length]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (!t.closest('.reaction-picker') && !t.closest('.reaction-trigger')) setReactionPickerMsgId(null);
            if (!t.closest('.emoji-picker') && !t.closest('.emoji-trigger')) setShowEmojiPicker(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Reset group panel when switching conversations
    useEffect(() => {
        setShowGroupPanel(false);
        setEditingGroupName(false);
        setShowAddMember(false);
        setConfirmDelete(false);
        setConfirmLeave(false);
    }, [activeConversationId]);

    const getConvName = (conv: typeof conversations[0]) => {
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
        if (conv.type === 'group') return conv.members?.some(m => m.userId !== user.id && onlineUsers.has(m.userId));
        const otherMember = conv.members?.find(m => m.userId !== user.id);
        return otherMember ? onlineUsers.has(otherMember.userId) : false;
    };

    const filteredConversations = conversations.filter(c => {
        if (!searchQuery) return true;
        return getConvName(c).toLowerCase().includes(searchQuery.toLowerCase());
    });

    const availableUsers = users.filter(u => u.id !== user.id);

    const handleSend = async () => {
        if (!msgInput.trim() || !activeConversationId) return;
        // Guard against concurrent sends (e.g. fast Enter key)
        if (sendingRef.current) return;
        sendingRef.current = true;

        const text = msgInput.trim();
        // Block onChange from IME compositionend that fires after Enter
        justSentRef.current = true;
        // Clear input IMMEDIATELY — both React state AND DOM element directly
        setMsgInput('');
        if (inputRef.current) inputRef.current.value = '';
        setTyping(activeConversationId, false);
        setShowEmojiPicker(false);

        // Allow onChange again after IME events settle
        setTimeout(() => { justSentRef.current = false; }, 150);

        try {
            await sendMessage(activeConversationId, text);
        } finally {
            sendingRef.current = false;
        }
        inputRef.current?.focus();
    };

    const handleInputChange = (value: string) => {
        // Ignore onChange events from IME composition after Enter-send
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
        const convId = await createDirectConversation(targetUserId);
        setActiveConversationId(convId);
        setShowNewChat(false);
        setMobileShowChat(true);
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim() || selectedMembers.length === 0) return;
        const convId = await createGroupConversation(groupName.trim(), selectedMembers);
        setActiveConversationId(convId);
        setShowNewGroup(false);
        setGroupName('');
        setSelectedMembers([]);
        setMobileShowChat(true);
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

    return (
        <div className="h-[calc(100vh-65px)] flex bg-slate-50 dark:bg-slate-950 overflow-hidden">
            {/* ============ SIDEBAR ============ */}
            <div className={`w-full md:w-[340px] lg:w-[370px] border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 ${mobileShowChat ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <MessageCircle size={20} className="text-indigo-500" />
                            Tin nhắn
                            {totalUnread > 0 && (
                                <span className="text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">{totalUnread}</span>
                            )}
                        </h2>
                        <div className="flex items-center gap-1">
                            <button onClick={() => { setShowNewChat(true); setShowNewGroup(false); }}
                                className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-slate-800 text-indigo-500 transition-colors"
                                title="Chat mới"><Plus size={18} /></button>
                            <button onClick={() => { setShowNewGroup(true); setShowNewChat(false); }}
                                className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-slate-800 text-indigo-500 transition-colors"
                                title="Nhóm mới"><Users size={18} /></button>
                        </div>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Tìm cuộc trò chuyện..."
                            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
                    </div>
                </div>

                {showNewChat && (
                    <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/50 dark:bg-indigo-950/30">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase">Chọn người nhắn</span>
                            <button onClick={() => setShowNewChat(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                        </div>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                            {availableUsers.map(u => (
                                <button key={u.id} onClick={() => handleStartDirect(u.id)}
                                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800 transition-colors text-left">
                                    <div className="relative">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                                            {u.avatar ? <img src={u.avatar} className="w-full h-full rounded-full object-cover" /> : u.name?.charAt(0)?.toUpperCase()}
                                        </div>
                                        {onlineUsers.has(u.id) && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />}
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{u.name}</div>
                                        <div className="text-[10px] text-slate-400">{u.role}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {showNewGroup && (
                    <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-purple-50/50 dark:bg-purple-950/30">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase">Tạo nhóm mới</span>
                            <button onClick={() => setShowNewGroup(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                        </div>
                        <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Tên nhóm..."
                            className="w-full px-3 py-2 mb-2 rounded-xl bg-white dark:bg-slate-800 text-sm border border-purple-200 dark:border-purple-800 outline-none focus:ring-2 focus:ring-purple-500" />
                        <div className="space-y-1 max-h-[150px] overflow-y-auto mb-2">
                            {availableUsers.map(u => (
                                <label key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800 cursor-pointer">
                                    <input type="checkbox" checked={selectedMembers.includes(u.id)}
                                        onChange={e => setSelectedMembers(prev => e.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                                        className="rounded accent-purple-500" />
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-[10px] font-bold">
                                        {u.name?.charAt(0)?.toUpperCase()}
                                    </div>
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{u.name}</span>
                                </label>
                            ))}
                        </div>
                        <button onClick={handleCreateGroup} disabled={!groupName.trim() || selectedMembers.length === 0}
                            className="w-full py-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-bold disabled:opacity-50 hover:shadow-lg transition-all">
                            Tạo nhóm ({selectedMembers.length} thành viên)
                        </button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center p-6">
                            <MessageCircle size={48} className="text-slate-200 dark:text-slate-700 mb-3" />
                            <p className="text-sm font-bold text-slate-400">Chưa có cuộc trò chuyện</p>
                            <p className="text-xs text-slate-300 mt-1">Nhấn + để bắt đầu nhắn tin</p>
                        </div>
                    ) : (
                        filteredConversations.map(conv => {
                            const isActive = conv.id === activeConversationId;
                            const name = getConvName(conv);
                            const avatar = getConvAvatar(conv);
                            const online = isConvOnline(conv);
                            const lastMsg = conv.lastMessage;
                            const lastMsgSender = lastMsg ? users.find(u => u.id === lastMsg.senderId) : null;
                            const unread = conv.unreadCount || 0;
                            return (
                                <button key={conv.id}
                                    onClick={() => { setActiveConversationId(conv.id); setMobileShowChat(true); }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-b border-slate-50 dark:border-slate-800/50 ${isActive
                                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-l-4 border-l-indigo-500'
                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-4 border-l-transparent'}`}>
                                    <div className="relative shrink-0">
                                        {conv.type === 'group' ? (
                                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm shadow-md"><Users size={18} /></div>
                                        ) : (
                                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-md overflow-hidden">
                                                {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        {online && <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className={`text-sm truncate ${unread > 0 ? 'font-black text-slate-800 dark:text-white' : 'font-bold text-slate-700 dark:text-slate-200'}`}>{name}</span>
                                            {lastMsg && <span className="text-[10px] text-slate-400 shrink-0 ml-2">{timeAgo(lastMsg.createdAt)}</span>}
                                        </div>
                                        <div className="flex items-center justify-between mt-0.5">
                                            <p className={`text-xs truncate max-w-[200px] ${unread > 0 ? 'font-bold text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}>
                                                {lastMsg ? (lastMsg.type === 'system' ? <span className="italic">{lastMsg.content}</span> : <>{lastMsg.senderId === user.id ? 'Bạn: ' : conv.type === 'group' ? `${lastMsgSender?.name?.split(' ').pop()}: ` : ''}{lastMsg.content || '📎 File'}</>) : 'Chưa có tin nhắn'}
                                            </p>
                                            {unread > 0 && <span className="text-[10px] font-bold bg-indigo-500 text-white w-5 h-5 rounded-full flex items-center justify-center shrink-0">{unread > 9 ? '9+' : unread}</span>}
                                        </div>
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            {/* ============ CHAT AREA ============ */}
            <div className={`flex-1 flex flex-col ${!mobileShowChat ? 'hidden md:flex' : 'flex'}`}>
                {!activeConv ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mb-6 shadow-2xl shadow-indigo-500/30">
                            <MessageCircle size={40} className="text-white" />
                        </div>
                        <h3 className="text-xl font-black text-slate-700 dark:text-white mb-2">Chào mừng đến Tin nhắn</h3>
                        <p className="text-sm text-slate-400 max-w-xs">Chọn một cuộc trò chuyện bên trái hoặc bắt đầu cuộc trò chuyện mới</p>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 shrink-0">
                            <button onClick={() => setMobileShowChat(false)} className="md:hidden w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                                <ArrowLeft size={18} />
                            </button>
                            <div className="relative">
                                {activeConv.type === 'group' ? (
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-md"><Users size={18} /></div>
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold shadow-md overflow-hidden">
                                        {getConvAvatar(activeConv) ? <img src={getConvAvatar(activeConv)!} className="w-full h-full object-cover" /> : getConvName(activeConv).charAt(0).toUpperCase()}
                                    </div>
                                )}
                                {isConvOnline(activeConv) && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-black text-slate-800 dark:text-white truncate">{getConvName(activeConv)}</h3>
                                <p className="text-[10px] text-slate-400">
                                    {typingNames.length > 0 ? (
                                        <span className="text-indigo-500 font-bold animate-pulse">{typingNames.join(', ')} đang gõ...</span>
                                    ) : isConvOnline(activeConv) ? (
                                        <span className="text-emerald-500 font-bold">Đang hoạt động</span>
                                    ) : activeConv.type === 'group' ? (
                                        `${activeConv.members?.length || 0} thành viên`
                                    ) : 'Ngoại tuyến'}
                                </p>
                            </div>
                            <button onClick={() => { setShowGroupPanel(!showGroupPanel); setEditingGroupName(false); setShowAddMember(false); setConfirmDelete(false); setConfirmLeave(false); }}
                                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${showGroupPanel ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}>
                                <MoreVertical size={18} />
                            </button>
                        </div>

                        {/* Main content with optional panel */}
                        <div className="flex-1 flex overflow-hidden">
                            {/* Messages + Input */}
                            <div className="flex-1 flex flex-col min-w-0">
                                <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
                                    {groupedMessages.map((group, gi) => (
                                        <div key={gi}>
                                            <div className="flex items-center justify-center my-4">
                                                <span className="text-[10px] font-bold text-slate-400 bg-white dark:bg-slate-800 px-3 py-1 rounded-full shadow-sm border border-slate-100 dark:border-slate-700">{formatDate(group.date)}</span>
                                            </div>
                                            {group.messages.map((msg, mi) => {
                                                const isMe = msg.senderId === user.id;
                                                const sender = users.find(u => u.id === msg.senderId);
                                                const isSystem = msg.type === 'system';
                                                const prevMsg = mi > 0 ? group.messages[mi - 1] : null;
                                                const showAvatar = !isMe && (!prevMsg || prevMsg.senderId !== msg.senderId);
                                                const showName = !isMe && activeConv.type === 'group' && showAvatar;
                                                const reactions = msg.reactions || {};
                                                const hasReactions = Object.keys(reactions).length > 0;
                                                const isHovered = hoveredMsgId === msg.id;
                                                const showReactionPicker = reactionPickerMsgId === msg.id;

                                                if (isSystem) return (
                                                    <div key={msg.id} className="flex justify-center my-2">
                                                        <span className="text-[10px] text-slate-400 italic bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">{msg.content}</span>
                                                    </div>
                                                );

                                                return (
                                                    <div key={msg.id}
                                                        className={`flex gap-2 mb-1 ${isMe ? 'justify-end' : 'justify-start'} ${hasReactions ? 'mb-5' : ''}`}
                                                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                                                        onMouseLeave={() => { if (!showReactionPicker) setHoveredMsgId(null); }}>
                                                        {!isMe && (
                                                            <div className="w-7 shrink-0 self-end">
                                                                {showAvatar && (
                                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[10px] font-bold overflow-hidden">
                                                                        {sender?.avatar ? <img src={sender.avatar} className="w-full h-full object-cover" /> : sender?.name?.charAt(0)?.toUpperCase() || '?'}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div className={`max-w-[70%] relative ${isMe ? 'items-end' : 'items-start'}`}>
                                                            {showName && <p className="text-[10px] font-bold text-slate-400 mb-0.5 ml-1">{sender?.name}</p>}
                                                            <div className="relative group">
                                                                <div className={`px-3.5 py-2 text-sm leading-relaxed shadow-sm ${isMe
                                                                    ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-2xl rounded-br-md'
                                                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-md border border-slate-100 dark:border-slate-700'}`}>
                                                                    {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                                        <div className="mt-1.5 space-y-1">
                                                                            {msg.attachments.map((att, ai) => (
                                                                                <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer"
                                                                                    className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg ${isMe ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300'}`}>
                                                                                    {att.type?.startsWith('image') ? <ImageIcon size={12} /> : <File size={12} />}
                                                                                    <span className="truncate max-w-[150px]">{att.name}</span>
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {isHovered && (
                                                                    <button className={`reaction-trigger absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center shadow-md hover:scale-110 transition-all ${isMe ? '-left-9' : '-right-9'}`}
                                                                        onClick={() => setReactionPickerMsgId(showReactionPicker ? null : msg.id)}>
                                                                        <Smile size={14} className="text-slate-400" />
                                                                    </button>
                                                                )}
                                                                {showReactionPicker && (
                                                                    <div className={`reaction-picker absolute z-50 ${isMe ? 'right-0' : 'left-0'} -top-12 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 px-2 py-1.5 flex items-center gap-0.5 animate-[fadeIn_0.15s_ease-out]`}>
                                                                        {REACTION_EMOJIS.map(emoji => {
                                                                            const myReacted = (reactions[emoji] as string[] | undefined)?.includes(user.id);
                                                                            return (
                                                                                <button key={emoji}
                                                                                    onClick={() => { toggleReaction(msg.id, msg.conversationId, emoji); setReactionPickerMsgId(null); setHoveredMsgId(null); }}
                                                                                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:scale-125 transition-all ${myReacted ? 'bg-indigo-100 dark:bg-indigo-900/50 ring-2 ring-indigo-400' : ''}`}>
                                                                                    {emoji}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {hasReactions && (
                                                                <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                                                                    {Object.entries(reactions).map(([emoji, userIds]) => {
                                                                        const ids = userIds as string[];
                                                                        const myReacted = ids.includes(user.id);
                                                                        const reactorNames = ids.map(uid => users.find(u => u.id === uid)?.name || '').filter(Boolean);
                                                                        return (
                                                                            <button key={emoji} onClick={() => toggleReaction(msg.id, msg.conversationId, emoji)} title={reactorNames.join(', ')}
                                                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-all hover:scale-105 ${myReacted
                                                                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-300'
                                                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 hover:border-indigo-300'}`}>
                                                                                <span className="text-sm">{emoji}</span>
                                                                                <span className="font-bold text-[10px]">{ids.length}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                            <p className={`text-[9px] text-slate-300 mt-0.5 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>{formatTime(msg.createdAt)}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                    {typingNames.length > 0 && (
                                        <div className="flex gap-2 items-end">
                                            <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                                                <div className="flex gap-0.5">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Input */}
                                <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 relative">
                                    {showEmojiPicker && (
                                        <div className="emoji-picker absolute bottom-16 left-3 right-3 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3 z-50">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-bold text-slate-500 uppercase">Biểu tượng cảm xúc</span>
                                                <button onClick={() => setShowEmojiPicker(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                                            </div>
                                            <div className="grid grid-cols-10 gap-1 max-h-[200px] overflow-y-auto">
                                                {QUICK_EMOJIS.map(emoji => (
                                                    <button key={emoji} onClick={() => insertEmoji(emoji)}
                                                        className="w-9 h-9 rounded-lg flex items-center justify-center text-xl hover:bg-slate-100 dark:hover:bg-slate-700 hover:scale-125 transition-all">{emoji}</button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                            className={`emoji-trigger w-10 h-10 rounded-xl flex items-center justify-center transition-all ${showEmojiPicker ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-500'}`}>
                                            <Smile size={20} />
                                        </button>
                                        <div className="flex-1 flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-2">
                                            <input ref={inputRef} value={msgInput}
                                                onChange={e => handleInputChange(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                                placeholder="Nhập tin nhắn..."
                                                className="flex-1 bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none" />
                                        </div>
                                        <button onClick={handleSend} disabled={!msgInput.trim()}
                                            className="w-10 h-10 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 disabled:opacity-40 disabled:shadow-none hover:shadow-xl transition-all active:scale-95">
                                            <Send size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* ============ GROUP / CONVERSATION INFO PANEL ============ */}
                            {showGroupPanel && (
                                <div className="w-[300px] border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 overflow-y-auto">
                                    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase">
                                                {activeConv.type === 'group' ? 'Thông tin nhóm' : 'Thông tin'}
                                            </h3>
                                            <button onClick={() => setShowGroupPanel(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={16} /></button>
                                        </div>
                                        <div className="flex flex-col items-center mb-3">
                                            {activeConv.type === 'group' ? (
                                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg mb-2"><Users size={28} /></div>
                                            ) : (
                                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white text-xl font-bold shadow-lg mb-2 overflow-hidden">
                                                    {getConvAvatar(activeConv) ? <img src={getConvAvatar(activeConv)!} className="w-full h-full object-cover" /> : getConvName(activeConv).charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            {activeConv.type === 'group' && editingGroupName ? (
                                                <div className="flex items-center gap-1 w-full">
                                                    <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                                                        className="flex-1 px-2 py-1 text-sm rounded-lg border border-indigo-300 dark:border-indigo-600 bg-slate-50 dark:bg-slate-800 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                                                        autoFocus onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) { updateGroupName(activeConv.id, newGroupName.trim()); setEditingGroupName(false); } }} />
                                                    <button onClick={() => { if (newGroupName.trim()) { updateGroupName(activeConv.id, newGroupName.trim()); setEditingGroupName(false); } }}
                                                        className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600"><Check size={14} /></button>
                                                    <button onClick={() => setEditingGroupName(false)}
                                                        className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-500 flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-600"><X size={14} /></button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-sm font-black text-slate-800 dark:text-white">{getConvName(activeConv)}</span>
                                                    {activeConv.type === 'group' && (
                                                        <button onClick={() => { setEditingGroupName(true); setNewGroupName(activeConv.name || ''); }}
                                                            className="text-slate-400 hover:text-indigo-500 transition-colors"><Edit3 size={13} /></button>
                                                    )}
                                                </div>
                                            )}
                                            <span className="text-[10px] text-slate-400 mt-0.5">
                                                {activeConv.type === 'group' ? `${activeConv.members?.length || 0} thành viên` : (isConvOnline(activeConv) ? 'Đang hoạt động' : 'Ngoại tuyến')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Members List */}
                                    {activeConv.type === 'group' && (
                                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-xs font-bold text-slate-500 uppercase">Thành viên ({activeConv.members?.length || 0})</span>
                                                <button onClick={() => setShowAddMember(!showAddMember)}
                                                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showAddMember ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}>
                                                    <UserPlus size={14} />
                                                </button>
                                            </div>

                                            {showAddMember && (() => {
                                                const memberIds = activeConv.members?.map(m => m.userId) || [];
                                                const addableUsers = users.filter(u => u.id !== user.id && !memberIds.includes(u.id));
                                                return addableUsers.length > 0 ? (
                                                    <div className="mb-3 p-2 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl space-y-1 max-h-[150px] overflow-y-auto">
                                                        {addableUsers.map(u => (
                                                            <button key={u.id} onClick={async () => { await addMember(activeConv.id, u.id); setShowAddMember(false); }}
                                                                className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors text-left">
                                                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white text-[9px] font-bold">
                                                                    {u.name?.charAt(0)?.toUpperCase()}
                                                                </div>
                                                                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 flex-1 truncate">{u.name}</span>
                                                                <UserPlus size={12} className="text-emerald-500 shrink-0" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-[10px] text-slate-400 text-center mb-3 italic">Tất cả người dùng đã trong nhóm</p>
                                                );
                                            })()}

                                            <div className="space-y-1">
                                                {(activeConv.members || []).map(member => {
                                                    const memberUser = users.find(u => u.id === member.userId);
                                                    const isAdmin = member.role === 'admin';
                                                    const isCurrentUser = member.userId === user.id;
                                                    const currentUserIsAdmin = activeConv.members?.some(m => m.userId === user.id && m.role === 'admin');
                                                    return (
                                                        <div key={member.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 group">
                                                            <div className="relative">
                                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[10px] font-bold overflow-hidden">
                                                                    {memberUser?.avatar ? <img src={memberUser.avatar} className="w-full h-full object-cover" /> : memberUser?.name?.charAt(0)?.toUpperCase() || '?'}
                                                                </div>
                                                                {onlineUsers.has(member.userId) && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                                                        {memberUser?.name || 'Người dùng'}{isCurrentUser ? ' (bạn)' : ''}
                                                                    </span>
                                                                    {isAdmin && (
                                                                        <span className="shrink-0 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                                                            <Crown size={8} /> Admin
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="text-[10px] text-slate-400">{memberUser?.role}</span>
                                                            </div>
                                                            {currentUserIsAdmin && !isCurrentUser && (
                                                                <button onClick={() => removeMember(activeConv.id, member.userId)}
                                                                    className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all"
                                                                    title="Xóa khỏi nhóm">
                                                                    <UserMinus size={13} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="p-4 space-y-2">
                                        {activeConv.type === 'group' && (
                                            confirmLeave ? (
                                                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-xl border border-orange-200 dark:border-orange-800">
                                                    <p className="text-xs font-bold text-orange-600 dark:text-orange-400 mb-2">Bạn chắc chắn muốn rời nhóm?</p>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { leaveGroup(activeConv.id); setShowGroupPanel(false); }}
                                                            className="flex-1 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-bold hover:bg-orange-600">Rời nhóm</button>
                                                        <button onClick={() => setConfirmLeave(false)}
                                                            className="flex-1 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">Hủy</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button onClick={() => setConfirmLeave(true)}
                                                    className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-orange-50 dark:hover:bg-orange-950/20 text-orange-500 transition-colors">
                                                    <LogOut size={16} /> <span className="text-xs font-bold">Rời nhóm</span>
                                                </button>
                                            )
                                        )}

                                        {confirmDelete ? (
                                            <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800">
                                                <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-2">Xóa {activeConv.type === 'group' ? 'nhóm' : 'cuộc trò chuyện'} và tất cả tin nhắn?</p>
                                                <div className="flex gap-2">
                                                    <button onClick={() => { deleteConversation(activeConv.id); setShowGroupPanel(false); }}
                                                        className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600">Xóa</button>
                                                    <button onClick={() => setConfirmDelete(false)}
                                                        className="flex-1 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">Hủy</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDelete(true)}
                                                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 transition-colors">
                                                <Trash2 size={16} /> <span className="text-xs font-bold">Xóa {activeConv.type === 'group' ? 'nhóm' : 'cuộc trò chuyện'}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Chat;
