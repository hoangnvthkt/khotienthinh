import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { escapeHtml } from '../lib/safeHtml';
import {
  Bot, Send, MessageCircle, Sparkles, Trash2, Plus, ChevronLeft,
  Database, Clock, Loader2, X, Code2, FileText, BookOpen, Menu, ArrowRight,
  ThumbsUp, ThumbsDown, Zap
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

type AiMode = 'data' | 'knowledge';

interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sqlQuery?: string;
  mode?: 'sql' | 'rag' | 'general';
  sources?: { title: string; fileName: string; similarity: number; fileUrl?: string }[];
  suggestions?: string[];
  hasMemory?: boolean;
  fromCache?: boolean;
  createdAt: string;
  feedback?: 1 | -1;
}

interface AiConversation {
  id: string;
  title: string;
  mode?: string;
  createdAt: string;
}

const MODE_CONFIG = {
  data: {
    icon: Database,
    label: 'Dữ liệu',
    description: 'Truy vấn dữ liệu thời gian thực',
    gradient: 'from-violet-500 to-fuchsia-600',
    shadow: 'shadow-violet-500/20',
    ring: 'ring-violet-400',
    bgLight: 'from-violet-50 to-fuchsia-50',
    bgDark: 'dark:from-violet-950/40 dark:to-fuchsia-950/40',
    welcomeTitle: 'Trợ lý Dữ liệu 📊',
    welcomeDesc: 'Hỏi về dữ liệu kho, nhân sự, tài sản, dự án, chấm công, lương...',
    placeholder: 'Hỏi về dữ liệu công ty...',
    loadingText: 'Đang truy vấn database...',
    footerText: 'Truy vấn dữ liệu thực tế từ hệ thống',
    chipBg: 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/40',
    chipText: 'text-violet-700 dark:text-violet-300',
    chipIcon: 'text-violet-400',
    suggestedQuestions: [
      { icon: '📦', text: 'Tổng tồn kho hiện tại bao nhiêu mặt hàng?' },
      { icon: '👥', text: 'Có bao nhiêu nhân viên đang hoạt động?' },
      { icon: '📊', text: 'Tháng này chi phí dự án bao nhiêu?' },
      { icon: '📋', text: 'Có bao nhiêu yêu cầu đang chờ xử lý?' },
      { icon: '🏗️', text: 'Danh sách các công trường đang hoạt động?' },
      { icon: '💰', text: 'Tổng hợp ngân sách và chi phí thực tế' },
    ],
  },
  knowledge: {
    icon: BookOpen,
    label: 'Kiến thức',
    description: 'Tìm kiếm trong tài liệu nội bộ',
    gradient: 'from-amber-500 to-orange-600',
    shadow: 'shadow-amber-500/20',
    ring: 'ring-amber-400',
    bgLight: 'from-amber-50 to-orange-50',
    bgDark: 'dark:from-amber-950/40 dark:to-orange-950/40',
    welcomeTitle: 'Trợ lý Kiến thức 📚',
    welcomeDesc: 'Hỏi về quy định, chính sách, nội quy, tài liệu đã upload lên Kho Kiến Thức...',
    placeholder: 'Hỏi về quy định, chính sách, tài liệu...',
    loadingText: 'Đang tìm kiếm trong tài liệu...',
    footerText: 'Tìm kiếm trong tài liệu Kho Kiến Thức',
    chipBg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40',
    chipText: 'text-amber-700 dark:text-amber-300',
    chipIcon: 'text-amber-400',
    suggestedQuestions: [
      { icon: '📜', text: 'Quy trình xin nghỉ phép theo nội quy công ty?' },
      { icon: '🔒', text: 'Quy định bảo mật thông tin nội bộ là gì?' },
      { icon: '🏗️', text: 'Tiêu chuẩn an toàn lao động trên công trường?' },
      { icon: '📑', text: 'Các điều khoản hợp đồng lao động quan trọng?' },
      { icon: '💼', text: 'Chế độ phúc lợi cho nhân viên chính thức?' },
      { icon: '⚖️', text: 'Quy trình xử lý kỷ luật nhân viên?' },
    ],
  },
} as const;

const AiAssistant: React.FC = () => {
  const { user } = useApp();
  const [aiMode, setAiMode] = useState<AiMode>('data');
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [expandedSql, setExpandedSql] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const cfg = MODE_CONFIG[aiMode];
  const ModeIcon = cfg.icon;

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowDrawer(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadConversations = async () => {
    let query = supabase
      .from('ai_conversations')
      .select('*')
      .order('created_at', { ascending: false });
    // Admin sees all, regular users only see their own
    if (user.role !== 'ADMIN') {
      query = query.eq('user_id', user.id);
    }
    const { data } = await query;
    if (data) setConversations(data.map(c => ({ id: c.id, title: c.title, mode: c.mode, createdAt: c.created_at })));
  };

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data.map(m => ({
      id: m.id, role: m.role, content: m.content, sqlQuery: m.sql_query, mode: m.mode, sources: m.sources, createdAt: m.created_at,
    })));
  };

  const selectConversation = (conv: AiConversation) => {
    setActiveConvId(conv.id);
    // Restore mode from conversation
    if (conv.mode === 'knowledge' || conv.mode === 'data') {
      setAiMode(conv.mode);
    }
    loadMessages(conv.id);
    setShowDrawer(false);
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setShowDrawer(false);
    inputRef.current?.focus();
  };

  const deleteConversation = async (convId: string) => {
    await supabase.from('ai_conversations').delete().eq('id', convId);
    if (activeConvId === convId) startNewChat();
    loadConversations();
  };

  const sendFeedback = async (msg: AiMessage, rating: 1 | -1) => {
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, feedback: rating } : m));
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feedback',
          messageId: msg.id,
          conversationId: activeConvId,
          userId: user.id,
          rating,
          question: messages.find(m => m.role === 'user' && m.createdAt < msg.createdAt)?.content,
          answer: msg.content,
          sqlQuery: msg.sqlQuery,
        }),
      });
    } catch (err) {
      console.error('Feedback error:', err);
    }
  };

  const sendMessage = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: AiMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId: activeConvId,
          userId: user.id,
          mode: aiMode,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await resp.json();

      if (data.error) {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${data.error}`,
          createdAt: new Date().toISOString(),
        }]);
      } else {
        if (!activeConvId && data.conversationId) {
          setActiveConvId(data.conversationId);
          loadConversations();
        }

        setMessages(prev => [...prev, {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.answer,
          sqlQuery: data.sqlQuery,
          mode: data.mode,
          sources: data.sources,
          suggestions: data.suggestions,
          hasMemory: data.hasMemory,
          fromCache: data.fromCache,
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Lỗi kết nối: ${err.message}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const formatMarkdown = (text: string) => {
    let html = escapeHtml(text);

    // Headers: ### -> h3, ## -> h2
    html = html.replace(/^### (.*?)$/gm, '<h4 class="text-sm font-black text-slate-800 dark:text-white mt-3 mb-1">$1</h4>');
    html = html.replace(/^## (.*?)$/gm, '<h3 class="text-base font-black text-slate-800 dark:text-white mt-3 mb-1.5">$1</h3>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-pink-600 dark:text-pink-400">$1</code>');

    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="mt-2 mb-2 p-3 rounded-xl bg-slate-900 text-emerald-400 text-[11px] font-mono overflow-x-auto border border-slate-700 leading-relaxed">${code.trim()}</pre>`;
    });

    // Tables
    if (html.includes('|')) {
      const lines = html.split('\n');
      let tableHtml = '';
      let inTable = false;
      let isHeader = true;

      const processed: string[] = [];
      for (const line of lines) {
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
          if (line.trim().match(/^\|[\s\-:|]+\|$/)) continue;
          if (!inTable) { tableHtml = '<div class="overflow-x-auto my-2"><table class="w-full text-xs border-collapse">'; inTable = true; isHeader = true; }
          const cells = line.split('|').filter(c => c.trim());
          const tag = isHeader ? 'th' : 'td';
          const cls = isHeader
            ? 'px-3 py-2 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-700 dark:text-indigo-300 font-bold text-left border-b border-indigo-200 dark:border-indigo-800'
            : 'px-3 py-2 border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300';
          tableHtml += `<tr>${cells.map(c => `<${tag} class="${cls}">${c.trim().replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</${tag}>`).join('')}</tr>`;
          isHeader = false;
        } else {
          if (inTable) { tableHtml += '</table></div>'; processed.push(tableHtml); inTable = false; }
          processed.push(line);
        }
      }
      if (inTable) { tableHtml += '</table></div>'; processed.push(tableHtml); }
      html = processed.join('\n');
    }

    // Line breaks
    html = html.replace(/\n/g, '<br/>');

    // Bullet lists
    html = html.replace(/(^|<br\/>)- (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 mt-0.5">•</span><span>$2</span></span>');
    // Numbered lists
    html = html.replace(/(^|<br\/>)(\d+)\. (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 font-bold mt-0.5 w-4 text-right shrink-0">$2.</span><span>$3</span></span>');

    return html;
  };

  // ======================== RENDER ========================
  return (
    <div className="ai-chat-container h-[calc(100vh-65px)] flex bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
      {/* ===== DRAWER OVERLAY ===== */}
      {showDrawer && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] ai-drawer-backdrop"
          onClick={() => setShowDrawer(false)}
        />
      )}

      {/* Drawer Panel */}
      <div className={`
        fixed lg:relative inset-y-0 left-0 z-[65] lg:z-auto
        w-[300px] lg:w-[280px]
        bg-white dark:bg-slate-900
        border-r border-slate-200 dark:border-slate-800
        flex flex-col shrink-0
        transform transition-transform duration-300 ease-out
        ${showDrawer ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:transform-none
        shadow-2xl lg:shadow-none
      `}>
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-md ${cfg.shadow}`}>
                <Bot size={15} className="text-white" />
              </div>
              Lịch sử chat
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={startNewChat}
                className="w-8 h-8 rounded-xl flex items-center justify-center bg-violet-50 dark:bg-violet-900/30 text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-all active:scale-90"
                title="Cuộc trò chuyện mới">
                <Plus size={16} strokeWidth={2.5} />
              </button>
              <button onClick={() => setShowDrawer(false)}
                className="lg:hidden w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <Sparkles size={24} className="text-slate-300 dark:text-slate-600" />
              </div>
              <p className="text-xs text-slate-400 font-medium">Chưa có cuộc trò chuyện nào</p>
              <p className="text-[10px] text-slate-300 mt-1">Bắt đầu bằng cách đặt câu hỏi</p>
            </div>
          ) : (
            conversations.map(conv => (
              <div key={conv.id}
                className={`group flex items-center gap-3 px-4 py-3.5 cursor-pointer border-b border-slate-50 dark:border-slate-800/50 transition-all ${
                  activeConvId === conv.id
                    ? 'bg-violet-50 dark:bg-violet-950/30 border-l-[3px] border-l-violet-500'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-[3px] border-l-transparent'
                }`}
                onClick={() => selectConversation(conv)}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  activeConvId === conv.id
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-500'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                }`}>
                  {conv.mode === 'knowledge' ? <BookOpen size={14} /> : <Database size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 truncate leading-tight">{conv.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      conv.mode === 'knowledge'
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                        : 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
                    }`}>
                      {conv.mode === 'knowledge' ? '📚' : '📊'}
                    </span>
                    <span className="text-[10px] text-slate-400">{new Date(conv.createdAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                  title="Xóa">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ===== CHAT AREA ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header with Mode Toggle */}
        <div className="px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowDrawer(true)}
              className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-90"
              title="Lịch sử chat">
              <Menu size={17} />
            </button>
            <button onClick={() => setShowDrawer(!showDrawer)}
              className="hidden lg:flex w-8 h-8 rounded-xl items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
              <ChevronLeft size={18} className={`transition-transform ${showDrawer ? 'rotate-180' : ''}`} />
            </button>

            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-lg ${cfg.shadow} shrink-0 transition-all duration-500`}>
              <Bot size={17} className="text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black text-slate-800 dark:text-white truncate">Trợ lý AI Vioo</h3>
              <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
                <ModeIcon size={9} />
                {cfg.description} · Powered by Gemini
              </p>
            </div>

            {/* ===== MODE TOGGLE SWITCH ===== */}
            <div className="relative flex items-center bg-slate-100 dark:bg-slate-800 rounded-2xl p-1 shrink-0">
              <div
                className={`absolute top-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-xl transition-all duration-500 ease-out shadow-md ${
                  aiMode === 'data'
                    ? 'left-1 bg-gradient-to-r from-violet-500 to-fuchsia-600 shadow-violet-500/30'
                    : 'left-[calc(50%+2px)] bg-gradient-to-r from-amber-500 to-orange-600 shadow-amber-500/30'
                }`}
              />
              <button
                onClick={() => { setAiMode('data'); startNewChat(); }}
                className={`relative z-10 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black transition-all duration-300 ${
                  aiMode === 'data' ? 'text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Database size={12} />
                <span className="hidden sm:inline">Dữ liệu</span>
              </button>
              <button
                onClick={() => { setAiMode('knowledge'); startNewChat(); }}
                className={`relative z-10 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-black transition-all duration-300 ${
                  aiMode === 'knowledge' ? 'text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <BookOpen size={12} />
                <span className="hidden sm:inline">Kiến thức</span>
              </button>
            </div>

            <button onClick={startNewChat}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 shrink-0 ${
                aiMode === 'data'
                  ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/50'
                  : 'bg-amber-50 dark:bg-amber-900/30 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/50'
              }`}
              title="Cuộc trò chuyện mới">
              <Plus size={17} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className={`flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-5 ai-chat-messages transition-all duration-700`}
          style={{
            background: aiMode === 'data'
              ? 'linear-gradient(180deg, #f5f3ff 0%, #faf5ff 50%, #f8fafc 100%)'
              : 'linear-gradient(180deg, #fffbeb 0%, #fff7ed 50%, #f8fafc 100%)',
          }}>

          {/* Welcome */}
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 ai-msg-animate">
              <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-2xl ${cfg.shadow} mb-6 transition-all duration-500`}>
                <ModeIcon size={36} className="text-white" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white mb-2">{cfg.welcomeTitle}</h2>
              <p className="text-sm text-slate-500 mb-8 max-w-md leading-relaxed">{cfg.welcomeDesc}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
                {cfg.suggestedQuestions.map((q, i) => (
                  <button key={i} onClick={() => sendMessage(q.text)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white dark:bg-slate-800 border text-left hover:shadow-lg hover:-translate-y-0.5 transition-all text-[13px] font-medium text-slate-600 dark:text-slate-300 group ${
                      aiMode === 'data'
                        ? 'border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-600'
                        : 'border-amber-100 dark:border-amber-800/30 hover:border-amber-300 dark:hover:border-amber-600'
                    }`}>
                    <span className="text-lg group-hover:scale-125 transition-transform shrink-0">{q.icon}</span>
                    <span className="leading-snug">{q.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          {messages.map((msg, msgIdx) => (
            <div key={msg.id} className={`flex gap-2.5 sm:gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ai-msg-animate`}>
              {msg.role === 'assistant' && (
                <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-white shrink-0 self-start shadow-md`}>
                  <Bot size={15} />
                </div>
              )}
              <div className={`max-w-[85%] sm:max-w-[75%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                <div className={`px-4 py-3 text-[14px] sm:text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? `bg-gradient-to-br ${cfg.gradient} text-white rounded-2xl rounded-br-md ${cfg.shadow}`
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-md border border-slate-100 dark:border-slate-700'
                }`}>
                  {msg.role === 'user' ? (
                    <p>{msg.content}</p>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                  )}
                </div>
                {msg.sqlQuery && (
                  <div className="mt-2">
                    <button onClick={() => setExpandedSql(expandedSql === msg.id ? null : msg.id)}
                      className="flex items-center gap-1.5 text-[11px] text-violet-500 hover:text-violet-700 font-bold transition py-1">
                      <Code2 size={11} />
                      {expandedSql === msg.id ? 'Ẩn SQL' : 'Xem SQL query'}
                    </button>
                    {expandedSql === msg.id && (
                      <pre className="mt-1 p-3 rounded-xl bg-slate-900 text-emerald-400 text-[11px] font-mono overflow-x-auto border border-slate-700 leading-relaxed">
                        {msg.sqlQuery}
                      </pre>
                    )}
                  </div>
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                      <BookOpen size={11} /> Nguồn tham khảo:
                    </span>
                    {msg.sources.map((src, i) => (
                      src.fileUrl ? (
                        <a key={i} href={src.fileUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-medium hover:bg-amber-500/20 hover:underline cursor-pointer transition-colors">
                          <FileText size={10} /> {src.title || src.fileName}
                        </a>
                      ) : (
                        <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                          <FileText size={10} /> {src.title || src.fileName}
                        </span>
                      )
                    ))}
                  </div>
                )}
                {/* Cache + Memory badges */}
                {msg.role === 'assistant' && (msg.fromCache || msg.hasMemory) && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {msg.fromCache && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold opacity-80">
                        <Zap size={10} /> Trả lời nhanh từ cache
                      </span>
                    )}
                    {msg.hasMemory && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 font-bold opacity-70">
                        🧠 Sử dụng bộ nhớ
                      </span>
                    )}
                  </div>
                )}
                {msg.mode && msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                      msg.mode === 'rag' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                      msg.mode === 'sql' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' :
                      'bg-slate-500/10 text-slate-500'
                    }`}>
                      {msg.mode === 'rag' ? <><BookOpen size={10} /> Từ tài liệu</> :
                       msg.mode === 'sql' ? <><Database size={10} /> Từ database</> :
                       <><Sparkles size={10} /> Chung</>}
                    </span>
                    {/* 👍👎 Feedback */}
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        onClick={() => sendFeedback(msg, 1)}
                        className={`p-1 rounded-lg transition-all ${msg.feedback === 1 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 'text-slate-300 dark:text-slate-600 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                        title="Câu trả lời tốt"
                      >
                        <ThumbsUp size={12} />
                      </button>
                      <button
                        onClick={() => sendFeedback(msg, -1)}
                        className={`p-1 rounded-lg transition-all ${msg.feedback === -1 ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                        title="Câu trả lời chưa tốt"
                      >
                        <ThumbsDown size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {/* ===== FOLLOW-UP SUGGESTION CHIPS ===== */}
                {msg.suggestions && msg.suggestions.length > 0 && msg.role === 'assistant' && msgIdx === messages.length - 1 && !loading && (
                  <div className="mt-3 flex flex-col gap-1.5 ai-suggestions-animate">
                    <span className={`text-[10px] font-bold ${cfg.chipText} opacity-70 flex items-center gap-1`}>
                      <Sparkles size={9} /> Câu hỏi gợi ý
                    </span>
                    {msg.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(suggestion)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left text-[12px] font-medium transition-all hover:shadow-md hover:-translate-y-px active:scale-[0.98] ${cfg.chipBg} ${cfg.chipText}`}
                      >
                        <ArrowRight size={11} className={`shrink-0 ${cfg.chipIcon}`} />
                        <span className="leading-snug">{suggestion}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className={`text-[10px] text-slate-300 mt-1.5 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex gap-2.5 sm:gap-3">
              <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-white shrink-0 shadow-md`}>
                <Bot size={15} />
              </div>
              <div className="px-4 py-3.5 rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-2.5 text-sm text-slate-400">
                  <Loader2 size={15} className={`animate-spin ${aiMode === 'data' ? 'text-violet-500' : 'text-amber-500'}`} />
                  <span className="animate-pulse font-medium">{cfg.loadingText}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ===== INPUT AREA ===== */}
        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-end gap-2.5">
            <div className={`flex-1 bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-2.5 border-2 border-transparent transition-all shadow-sm focus-within:shadow-md ${
              aiMode === 'data'
                ? 'focus-within:border-violet-400 focus-within:bg-white dark:focus-within:bg-slate-750'
                : 'focus-within:border-amber-400 focus-within:bg-white dark:focus-within:bg-slate-750'
            }`}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={cfg.placeholder}
                rows={1}
                className="w-full bg-transparent text-[15px] sm:text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none resize-none max-h-[120px] leading-relaxed"
                style={{ minHeight: '28px' }}
              />
            </div>
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className={`w-11 h-11 rounded-xl bg-gradient-to-r ${cfg.gradient} flex items-center justify-center text-white shadow-lg ${cfg.shadow} disabled:opacity-40 disabled:shadow-none hover:shadow-xl hover:scale-105 transition-all active:scale-95 shrink-0`}
            >
              <Send size={17} />
            </button>
          </div>
          <p className="text-[10px] text-slate-300 mt-2 text-center flex items-center justify-center gap-1">
            <ModeIcon size={9} />
            {cfg.footerText} • Nhấn Enter để gửi
          </p>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ai-msg-animate {
          animation: fadeIn 0.3s ease-out;
        }
        .ai-drawer-backdrop {
          animation: fadeIn 0.2s ease-out;
        }
        .ai-suggestions-animate {
          animation: slideUp 0.4s ease-out;
        }
        .ai-suggestions-animate button {
          animation: slideUp 0.4s ease-out both;
        }
        .ai-suggestions-animate button:nth-child(2) { animation-delay: 0.05s; }
        .ai-suggestions-animate button:nth-child(3) { animation-delay: 0.1s; }
        .ai-suggestions-animate button:nth-child(4) { animation-delay: 0.15s; }
        .dark .ai-chat-messages {
          background: ${aiMode === 'data'
            ? 'linear-gradient(180deg, #0f0a1e 0%, #0f172a 50%, #020617 100%)'
            : 'linear-gradient(180deg, #1c1408 0%, #1a1614 50%, #0c0a04 100%)'
          } !important;
        }
      `}</style>
    </div>
  );
};

export default AiAssistant;
