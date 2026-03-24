import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import {
  Bot, Send, MessageCircle, Sparkles, Trash2, Plus, ChevronLeft,
  Database, Clock, Loader2, X, Code2
} from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sqlQuery?: string;
  createdAt: string;
}

interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
}

const SUGGESTED_QUESTIONS = [
  { icon: '📦', text: 'Tổng tồn kho hiện tại bao nhiêu mặt hàng?' },
  { icon: '👥', text: 'Có bao nhiêu nhân viên đang hoạt động?' },
  { icon: '📊', text: 'Tháng này chi phí dự án bao nhiêu?' },
  { icon: '📋', text: 'Có bao nhiêu yêu cầu đang chờ xử lý?' },
  { icon: '🏗️', text: 'Danh sách các công trường đang hoạt động?' },
  { icon: '💰', text: 'Tổng hợp ngân sách và chi phí thực tế' },
];

const AiAssistant: React.FC = () => {
  const { user } = useApp();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedSql, setExpandedSql] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setConversations(data.map(c => ({ id: c.id, title: c.title, createdAt: c.created_at })));
  };

  const loadMessages = async (convId: string) => {
    const { data } = await supabase
      .from('ai_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data.map(m => ({
      id: m.id, role: m.role, content: m.content, sqlQuery: m.sql_query, createdAt: m.created_at,
    })));
  };

  const selectConversation = (convId: string) => {
    setActiveConvId(convId);
    loadMessages(convId);
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    inputRef.current?.focus();
  };

  const deleteConversation = async (convId: string) => {
    await supabase.from('ai_conversations').delete().eq('id', convId);
    if (activeConvId === convId) startNewChat();
    loadConversations();
  };

  const sendMessage = async (text?: string) => {
    const question = (text || input).trim();
    if (!question || loading) return;
    setInput('');
    setLoading(true);

    // Add user message immediately
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
    // Simple markdown: bold, tables, lists, code
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-mono text-pink-600 dark:text-pink-400">$1</code>');

    // Tables
    if (html.includes('|')) {
      const lines = text.split('\n');
      let tableHtml = '<div class="overflow-x-auto my-2"><table class="w-full text-xs border-collapse">';
      let inTable = false;
      let isHeader = true;

      const processed: string[] = [];
      for (const line of lines) {
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
          if (line.trim().match(/^\|[\s\-:|]+\|$/)) continue; // separator
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
      html = processed.join('<br/>');
    }

    // Lists
    html = html.replace(/(^|\<br\/\>)- (.*?)(?=\<br\/\>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 mt-0.5">•</span><span>$2</span></span>');
    html = html.replace(/(^|\<br\/\>)(\d+)\. (.*?)(?=\<br\/\>|$)/g, '$1<span class="flex items-start gap-1.5 my-0.5"><span class="text-indigo-500 font-bold mt-0.5 w-4 text-right shrink-0">$2.</span><span>$3</span></span>');

    return html;
  };

  return (
    <div className="h-[calc(100vh-65px)] flex bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-[280px] border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                  <Bot size={14} className="text-white" />
                </div>
                Trợ lý AI
              </h2>
              <button onClick={startNewChat}
                className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-violet-50 dark:hover:bg-slate-800 text-violet-500 transition"
                title="Cuộc trò chuyện mới">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <Sparkles size={32} className="text-slate-200 dark:text-slate-700 mb-3" />
                <p className="text-xs text-slate-400">Chưa có cuộc trò chuyện</p>
              </div>
            ) : (
              conversations.map(conv => (
                <div key={conv.id}
                  className={`group flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-slate-50 dark:border-slate-800/50 transition-all ${
                    activeConvId === conv.id
                      ? 'bg-violet-50 dark:bg-violet-950/30 border-l-4 border-l-violet-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-4 border-l-transparent'
                  }`}
                  onClick={() => selectConversation(conv.id)}>
                  <MessageCircle size={14} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{conv.title}</p>
                    <p className="text-[10px] text-slate-400">{new Date(conv.createdAt).toLocaleDateString('vi-VN')}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                    title="Xóa">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 shrink-0">
          <button onClick={() => setShowSidebar(!showSidebar)}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition">
            <ChevronLeft size={18} className={`transition-transform ${showSidebar ? '' : 'rotate-180'}`} />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Bot size={18} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800 dark:text-white">Trợ lý AI KhoTienThinh</h3>
            <p className="text-[10px] text-slate-400 flex items-center gap-1">
              <Database size={9} />
              Truy vấn dữ liệu thời gian thực · Powered by Gemini
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ background: 'linear-gradient(180deg, #faf5ff 0%, #f8fafc 50%, #f1f5f9 100%)' }}>
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center animate-[fadeIn_0.5s_ease-out]">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center mb-6 shadow-2xl shadow-violet-500/30">
                <Sparkles size={36} className="text-white" />
              </div>
              <h3 className="text-lg font-black text-slate-700 dark:text-white mb-2">Xin chào! Tôi là Trợ lý AI 🤖</h3>
              <p className="text-sm text-slate-400 max-w-md mb-8">
                Hãy hỏi tôi bất cứ điều gì về dữ liệu kho, nhân sự, dự án, tài sản, chi phí...
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button key={i} onClick={() => sendMessage(q.text)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left hover:border-violet-300 dark:hover:border-violet-600 hover:shadow-md transition-all text-xs font-medium text-slate-600 dark:text-slate-300 group">
                    <span className="text-lg group-hover:scale-125 transition-transform">{q.icon}</span>
                    <span>{q.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shrink-0 self-start shadow-md">
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[75%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                <div className={`px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white rounded-2xl rounded-br-md'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-md border border-slate-100 dark:border-slate-700'
                }`}>
                  {msg.role === 'user' ? (
                    <p>{msg.content}</p>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
                  )}
                </div>
                {msg.sqlQuery && (
                  <div className="mt-1.5">
                    <button onClick={() => setExpandedSql(expandedSql === msg.id ? null : msg.id)}
                      className="flex items-center gap-1.5 text-[10px] text-violet-500 hover:text-violet-700 font-bold transition">
                      <Code2 size={10} />
                      {expandedSql === msg.id ? 'Ẩn SQL' : 'Xem SQL query'}
                    </button>
                    {expandedSql === msg.id && (
                      <pre className="mt-1 p-2.5 rounded-xl bg-slate-900 text-emerald-400 text-[10px] font-mono overflow-x-auto border border-slate-700 leading-relaxed">
                        {msg.sqlQuery}
                      </pre>
                    )}
                  </div>
                )}
                <p className={`text-[9px] text-slate-300 mt-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shrink-0 shadow-md">
                <Bot size={14} />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={14} className="animate-spin text-violet-500" />
                  <span className="animate-pulse">Đang phân tích dữ liệu...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Hỏi bất cứ điều gì về dữ liệu công ty..."
                rows={1}
                className="w-full bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none resize-none max-h-[120px]"
                style={{ minHeight: '24px' }}
              />
            </div>
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/30 disabled:opacity-40 disabled:shadow-none hover:shadow-xl transition-all active:scale-95 shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-[10px] text-slate-300 mt-1.5 text-center">
            Trợ lý AI truy vấn dữ liệu thực tế từ hệ thống • Nhấn Enter để gửi
          </p>
        </div>
      </div>
    </div>
  );
};

export default AiAssistant;
