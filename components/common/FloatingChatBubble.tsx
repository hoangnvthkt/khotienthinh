import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  X,
  Send,
  Maximize2,
  ChevronLeft,
  Users,
  User as UserIcon,
  Loader2,
  Search,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  AtSign,
} from 'lucide-react';
import { User } from '../../types';
import { useApp } from '../../context/AppContext';
import {
  chatV2Service,
  ChatV2Conversation,
  ChatV2Message,
  ChatV2Attachment,
  formatFileSize,
  getChatV2ConversationTitle,
  getUserInitials,
  isImageAttachment,
} from '../../lib/chatV2Service';

interface FloatingChatBubbleProps {
  user?: User | null;
}

export const FloatingChatBubble: React.FC<FloatingChatBubbleProps> = ({ user }) => {
  const navigate = useNavigate();
  const { users, employees } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ChatV2Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ChatV2Conversation | null>(null);
  const [messages, setMessages] = useState<ChatV2Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Mention State
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<number>(-1);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track initial scroll status per conversation ID (cleared on page reload)
  const initialScrollDoneRef = useRef<Record<string, boolean>>({});

  // Helper to resolve Sender Name, Avatar & Initials
  const getSenderInfo = (senderId: string) => {
    if (senderId === user?.id) {
      return {
        name: user.name || 'Tôi',
        avatar: user.avatar,
        initials: getUserInitials(user.name),
      };
    }
    const targetUser = users.find(u => u.id === senderId);
    const emp = employees.find(e => e.userId === senderId || (targetUser && e.email === targetUser.email));
    const name = targetUser?.name || emp?.fullName || targetUser?.email || 'Đồng nghiệp';
    const avatar = targetUser?.avatar || emp?.avatarUrl;
    return {
      name,
      avatar,
      initials: getUserInitials(name),
    };
  };

  // Helper to resolve Conversation Title & Partner Avatar
  const getConversationDetails = (c: ChatV2Conversation) => {
    const title = getChatV2ConversationTitle(c, user?.id, users);
    let avatar: string | null | undefined = c.avatarUrl;
    let initials = getUserInitials(title);

    if (c.type === 'direct' && user?.id) {
      const partner = c.participants.find(p => p.userId !== user.id);
      if (partner) {
        const partnerInfo = getSenderInfo(partner.userId);
        if (!avatar) avatar = partnerInfo.avatar;
        initials = partnerInfo.initials;
      }
    }
    return { title, avatar, initials };
  };

  // Load conversations on mount or when user changes
  const loadConversations = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const list = await chatV2Service.listConversations(user.id);
      setConversations(list);
    } catch (err) {
      console.warn('Failed to load chat conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    loadConversations();
  }, [user?.id]);

  // Load messages when selecting a conversation
  useEffect(() => {
    if (!selectedConversation || !user?.id) return;

    let channel: ReturnType<typeof chatV2Service.subscribeToConversation> = null;

    const loadConversationMessages = async () => {
      try {
        const msgs = await chatV2Service.getMessages(selectedConversation.id, user.id);
        setMessages(msgs);

        // Mark as read
        const lastMsgId = msgs.length > 0 ? msgs[msgs.length - 1].id : selectedConversation.lastMessageId;
        await chatV2Service.markConversationRead(selectedConversation.id, user.id, lastMsgId || undefined);

        // Subscribe to realtime messages in this conversation
        channel = chatV2Service.subscribeToConversation(selectedConversation.id, async (event) => {
          if (event.table === 'chat_v2_messages' && event.new && event.new.id) {
            const fetchedMsg = await chatV2Service.getMessage(event.new.id, user.id);
            if (fetchedMsg) {
              setMessages(prev => {
                if (prev.some(m => m.id === fetchedMsg.id)) return prev;
                return [...prev, fetchedMsg];
              });
            }
          }
        });
      } catch (err) {
        console.warn('Failed to fetch conversation messages:', err);
      }
    };

    loadConversationMessages();

    return () => {
      if (channel) chatV2Service.unsubscribe(channel);
    };
  }, [selectedConversation?.id, user?.id]);

  // Auto Scroll to bottom (Latest Messages) ONLY on initial conversation load or reload
  useLayoutEffect(() => {
    if (selectedConversation && messages.length > 0 && messagesContainerRef.current) {
      const convId = selectedConversation.id;
      if (!initialScrollDoneRef.current[convId]) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        initialScrollDoneRef.current[convId] = true;
      }
    }
  }, [selectedConversation?.id, messages]);

  // Total unread count across all conversations
  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }, [conversations]);

  // Filtered conversations list
  const filteredConversations = useMemo(() => {
    if (!searchTerm.trim()) return conversations;
    return conversations.filter(c => {
      const details = getConversationDetails(c);
      return details.title.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [conversations, searchTerm, users, employees]);

  // Handle Input text changes & @mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    const cursor = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');

    if (lastAtIdx !== -1 && (lastAtIdx === 0 || textBeforeCursor[lastAtIdx - 1] === ' ')) {
      const query = textBeforeCursor.slice(lastAtIdx + 1);
      setMentionQuery(query);
      setMentionIndex(lastAtIdx);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSelectMention = (empName: string) => {
    if (mentionIndex === -1) return;
    const before = inputText.slice(0, mentionIndex);
    const after = inputText.slice(mentionIndex + (mentionQuery?.length || 0) + 1);
    const newText = `${before}@${empName} ${after}`;
    setInputText(newText);
    setMentionQuery(null);
  };

  // Matching employees/users for @mention list
  const mentionEmployees = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return employees
      .filter(e => e.fullName.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
      .slice(0, 5);
  }, [employees, mentionQuery]);

  // Handle File Selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    setPendingFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && pendingFiles.length === 0) || !selectedConversation || !user?.id || sending) return;

    const content = inputText.trim();
    const filesToUpload = [...pendingFiles];
    setInputText('');
    setPendingFiles([]);
    setSending(true);

    try {
      // 1. Upload attachments if any
      const uploadedAttachments: any[] = [];
      const tempMsgId = crypto.randomUUID();

      for (const file of filesToUpload) {
        const att = await chatV2Service.uploadChatAttachment(file, selectedConversation.id, tempMsgId);
        uploadedAttachments.push(att);
      }

      // 2. Send message
      await chatV2Service.sendMessage(
        {
          conversationId: selectedConversation.id,
          body: content,
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
          kind: uploadedAttachments.length > 0 ? (isImageAttachment(uploadedAttachments[0]) ? 'image' : 'file') : 'text',
        },
        user.id
      );

      // Refresh messages list & scroll to bottom after sending
      const updatedMsgs = await chatV2Service.getMessages(selectedConversation.id, user.id);
      setMessages(updatedMsgs);
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 60);
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <>
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        multiple
        className="hidden"
      />

      {/* FLOATING CHAT BUBBLE BUTTON - BOTTOM LEFT CORNER */}
      <div className="fixed left-3 sm:left-5 bottom-[56px] lg:bottom-5 z-[80] flex flex-col items-start gap-2 select-none">
        <button
          onClick={() => {
            const next = !isOpen;
            setIsOpen(next);
            if (next) loadConversations();
          }}
          className={`group relative flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-gradient-to-tr from-pink-600 via-rose-600 to-indigo-600 text-white shadow-[0_10px_30px_rgba(225,29,72,0.45)] transition-all duration-300 hover:scale-110 active:scale-95 ring-4 ring-rose-500/30 ${
            isOpen ? 'rotate-90 scale-95' : ''
          }`}
          title="Mở ứng dụng Tin nhắn nội bộ VIOO"
        >
          {/* Active online pulse aura */}
          <span className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping opacity-75" />

          {isOpen ? (
            <X size={22} className="relative z-10 sm:w-6 sm:h-6" />
          ) : (
            <MessageSquare size={22} className="relative z-10 group-hover:rotate-6 transition-transform sm:w-6 sm:h-6" />
          )}

          {/* Unread Message Counter Badge */}
          {!isOpen && totalUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-900 bg-rose-500 px-1 text-[10px] font-black text-white shadow-md animate-bounce">
              {totalUnreadCount}
            </span>
          )}
        </button>
      </div>

      {/* CHAT POPOVER DRAWER - PRESERVES DOM & SCROLL POSITION ON CLOSE/OPEN */}
      <div
        style={{ display: isOpen ? 'flex' : 'none' }}
        className="fixed left-3 sm:left-5 bottom-[116px] lg:bottom-22 z-[85] h-[520px] max-h-[calc(100vh-140px)] w-[calc(100vw-1.5rem)] sm:w-[440px] max-w-[440px] flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/95 shadow-[0_25px_60px_rgba(0,0,0,0.75)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-rose-950 to-indigo-950 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {selectedConversation ? (
              <button
                onClick={() => setSelectedConversation(null)}
                className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                title="Quay lại danh sách hội thoại"
              >
                <ChevronLeft size={20} />
              </button>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-rose-500 to-indigo-600 text-white shadow-md">
                <MessageSquare size={18} />
              </div>
            )}

            <div>
              <h3 className="text-xs font-black tracking-tight text-white flex items-center gap-2">
                {selectedConversation
                  ? getConversationDetails(selectedConversation).title
                  : 'Tin Nhắn Nội Bộ'}
                {totalUnreadCount > 0 && !selectedConversation && (
                  <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-rose-400 border border-rose-500/30">
                    {totalUnreadCount} tin chưa đọc
                  </span>
                )}
              </h3>
              <p className="text-[10px] font-medium text-slate-400">
                {selectedConversation
                  ? (selectedConversation.type === 'group' ? 'Nhóm thảo luận' : 'Trò chuyện 1-1')
                  : 'Kênh giao tiếp & thảo luận công việc'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Link
              to="/chat"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Mở toàn màn hình ứng dụng Tin nhắn"
            >
              <Maximize2 size={15} />
            </Link>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Đóng cửa sổ tin nhắn"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* VIEW 1: CONVERSATIONS LIST */}
        {!selectedConversation && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Search Bar */}
            <div className="p-3 border-b border-slate-800/60 bg-slate-900/40">
              <div className="relative flex items-center">
                <Search size={14} className="absolute left-3 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Tìm cuộc trò chuyện, đồng nghiệp..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-rose-500 transition-colors"
                />
              </div>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
                  <Loader2 size={24} className="animate-spin text-rose-500" />
                  <span className="text-xs font-medium">Đang tải cuộc trò chuyện...</span>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-center p-4 text-slate-400">
                  <MessageSquare size={28} className="text-slate-600" />
                  <span className="text-xs font-bold text-slate-300">Chưa có cuộc trò chuyện</span>
                  <p className="text-[10px]">Mở ứng dụng Chat đầy đủ để tạo nhóm hoặc nhắn tin cho đồng nghiệp.</p>
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      navigate('/chat');
                    }}
                    className="mt-2 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-md hover:scale-105 transition-all"
                  >
                    Mở ứng dụng Chat
                  </button>
                </div>
              ) : (
                filteredConversations.map(c => {
                  const details = getConversationDetails(c);
                  const hasUnread = (c.unreadCount || 0) > 0;

                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConversation(c)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all duration-200 border ${
                        hasUnread
                          ? 'border-rose-500/40 bg-rose-950/30 text-white'
                          : 'border-transparent hover:bg-slate-900/80 text-slate-200'
                      }`}
                    >
                      {/* Conversation Avatar */}
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-white border border-slate-700/60 shadow-sm overflow-hidden text-xs font-black">
                        {details.avatar ? (
                          <img src={details.avatar} alt={details.title} className="h-full w-full object-cover" />
                        ) : c.type === 'group' ? (
                          <Users size={18} className="text-rose-400" />
                        ) : (
                          details.initials
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className={`text-xs font-black truncate ${hasUnread ? 'text-white' : 'text-slate-200'}`}>
                            {details.title}
                          </h4>
                          {c.lastMessageAt && (
                            <span className="text-[9px] font-bold text-slate-400 shrink-0">
                              {new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-medium text-slate-400 truncate mt-0.5">
                          {c.lastMessagePreview || 'Chưa có tin nhắn'}
                        </p>
                      </div>

                      {hasUnread && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white shadow-sm">
                          {c.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: ACTIVE CONVERSATION CHAT MESSAGES */}
        {selectedConversation && (
          <div className="flex flex-1 flex-col overflow-hidden relative">
            {/* Messages Area - Preserves exact Scroll Position on bubble toggle */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar bg-slate-950/60"
            >
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs font-medium text-slate-500">
                  Bắt đầu cuộc trò chuyện...
                </div>
              ) : (
                messages.map(m => {
                  const isSelf = m.senderId === user.id;
                  const sender = getSenderInfo(m.senderId);

                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {/* Sender Avatar for incoming messages */}
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-indigo-900 border border-slate-700 text-[10px] font-black text-white overflow-hidden shadow-sm mt-0.5">
                        {sender.avatar ? (
                          <img src={sender.avatar} alt={sender.name} className="h-full w-full object-cover" />
                        ) : (
                          sender.initials
                        )}
                      </div>

                      <div className={`flex flex-col max-w-[78%] ${isSelf ? 'items-end' : 'items-start'}`}>
                        {/* Sender Name */}
                        <span className="text-[10px] font-extrabold text-slate-300 mb-1 px-1 flex items-center gap-1">
                          {sender.name}
                        </span>

                        {/* Message Bubble Card */}
                        <div
                          className={`rounded-2xl px-3.5 py-2.5 text-xs font-medium leading-5 shadow-md ${
                            isSelf
                              ? 'bg-gradient-to-r from-rose-600 to-indigo-600 text-white rounded-br-xs'
                              : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-xs'
                          }`}
                        >
                          {/* Attachments rendering */}
                          {m.attachments && m.attachments.length > 0 && (
                            <div className="mb-2 space-y-2">
                              {m.attachments.map(att => {
                                const url = att.downloadUrl || att.signedUrl;
                                const isImg = isImageAttachment(att);

                                if (isImg && url) {
                                  return (
                                    <div key={att.id} className="overflow-hidden rounded-xl border border-white/20">
                                      <img src={url} alt={att.fileName} className="max-h-48 w-full object-cover" />
                                    </div>
                                  );
                                }

                                return (
                                  <a
                                    key={att.id}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 rounded-xl bg-black/25 p-2 text-[11px] font-bold text-white hover:bg-black/40 transition-colors"
                                  >
                                    <FileText size={16} className="text-rose-300 shrink-0" />
                                    <div className="min-w-0 flex-1 truncate">
                                      <div className="truncate">{att.fileName}</div>
                                      <div className="text-[9px] opacity-70">{formatFileSize(att.sizeBytes)}</div>
                                    </div>
                                    <Download size={14} className="shrink-0" />
                                  </a>
                                );
                              })}
                            </div>
                          )}

                          {/* Text Body */}
                          {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
                        </div>

                        <span className="text-[9px] font-bold text-slate-400 mt-1 px-1">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* @Mention Selection Popup */}
            {mentionQuery !== null && mentionEmployees.length > 0 && (
              <div className="absolute bottom-16 left-3 right-3 z-50 rounded-2xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2 pb-1 border-b border-slate-800">
                  Nhắc tới thành viên (@)
                </div>
                <div className="mt-1 space-y-1">
                  {mentionEmployees.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => handleSelectMention(emp.fullName)}
                      className="w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-bold text-white hover:bg-rose-600/30 transition-colors"
                    >
                      <AtSign size={13} className="text-rose-400" />
                      <span>{emp.fullName}</span>
                      <span className="text-[10px] text-slate-400 ml-auto">{emp.title || 'Nhân sự'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Attachments Bar */}
            {pendingFiles.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto p-2 border-t border-slate-800 bg-slate-900/80">
                {pendingFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 border border-slate-700">
                    <span className="max-w-[100px] truncate">{file.name}</span>
                    <button onClick={() => removePendingFile(idx)} className="text-slate-400 hover:text-white">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Chat Input Form */}
            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2 border-t border-slate-800/80 bg-slate-900/90 p-3"
            >
              {/* File Upload Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors shrink-0"
                title="Đính kèm tệp / hình ảnh"
              >
                <Paperclip size={16} />
              </button>

              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                placeholder="Nhập tin nhắn... (Gõ @ để nhắc tên)"
                className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-rose-500 transition-colors"
              />
              <button
                type="submit"
                disabled={(!inputText.trim() && pendingFiles.length === 0) || sending}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 text-white shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-40 shrink-0"
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
};

export default FloatingChatBubble;
