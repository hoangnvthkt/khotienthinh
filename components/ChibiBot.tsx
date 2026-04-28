import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { X, Send, Loader2, ChevronDown, Bot, Sparkles, Trash2 } from 'lucide-react';
import { escapeHtml } from '../lib/safeHtml';

// ══════════════════════════════════════════
//  CHIBI BOT 🤖 — Virtual AI Assistant Mascot
//  Bottom-right corner with resizable chat popup
//  300s interval, max 3-4 bubbles then sleep 60min
// ══════════════════════════════════════════

interface ChibiBotProps {
  userName?: string;
  userId?: string;
}

interface ChatbotMessage {
  id: string;
  message: string;
  type: 'greeting' | 'reminder' | 'fun' | 'motivation';
  emoji: string;
  time_range: string | null;
  is_active: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

type BotState = 'idle' | 'wave' | 'talk' | 'sleep' | 'excited' | 'peek';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

// ─── Markdown formatter (matches AiAssistant) ────────────
const formatMarkdown = (text: string): string => {
  let html = escapeHtml(text);

  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h4 class="text-xs font-black text-slate-800 dark:text-white mt-2 mb-0.5">$1</h4>');
  html = html.replace(/^## (.*?)$/gm, '<h3 class="text-sm font-black text-slate-800 dark:text-white mt-2 mb-1">$1</h3>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[11px] font-mono text-pink-600 dark:text-pink-400">$1</code>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre class="mt-1.5 mb-1.5 p-2 rounded-lg bg-slate-900 text-emerald-400 text-[10px] font-mono overflow-x-auto border border-slate-700 leading-relaxed">${code.trim()}</pre>`;
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
        if (!inTable) { tableHtml = '<div class="overflow-x-auto my-1.5"><table class="w-full text-[11px] border-collapse">'; inTable = true; isHeader = true; }
        const cells = line.split('|').filter(c => c.trim());
        const tag = isHeader ? 'th' : 'td';
        const cls = isHeader
          ? 'px-2 py-1.5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-bold text-left border-b border-indigo-200 dark:border-indigo-800'
          : 'px-2 py-1.5 border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300';
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
  html = html.replace(/(^|<br\/>)- (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1 my-0.5"><span class="text-indigo-500 mt-0.5 shrink-0">•</span><span>$2</span></span>');
  // Numbered lists
  html = html.replace(/(^|<br\/>)(\d+)\. (.*?)(?=<br\/>|$)/g, '$1<span class="flex items-start gap-1 my-0.5"><span class="text-indigo-500 font-bold mt-0.5 w-3 text-right shrink-0">$2.</span><span>$3</span></span>');

  return html;
};

// ─── localStorage helpers for chat persistence ───────────
const getChatStorageKey = (userId?: string) => `chibibot_chat_${userId || 'anon'}`;
const getConvIdStorageKey = (userId?: string) => `chibibot_convid_${userId || 'anon'}`;
const getSizeStorageKey = () => 'chibibot_popup_size';

const loadChatHistory = (userId?: string): ChatMessage[] => {
  try {
    const raw = localStorage.getItem(getChatStorageKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const saveChatHistory = (userId: string | undefined, messages: ChatMessage[]) => {
  try {
    // Keep last 100 messages max
    const toSave = messages.slice(-100);
    localStorage.setItem(getChatStorageKey(userId), JSON.stringify(toSave));
  } catch { /* ignore quota errors */ }
};

const loadConvId = (userId?: string): string | null => {
  try {
    return localStorage.getItem(getConvIdStorageKey(userId));
  } catch { return null; }
};

const saveConvId = (userId: string | undefined, convId: string | null) => {
  try {
    if (convId) localStorage.setItem(getConvIdStorageKey(userId), convId);
    else localStorage.removeItem(getConvIdStorageKey(userId));
  } catch {}
};

const loadPopupSize = (): { width: number; height: number } => {
  try {
    const raw = localStorage.getItem(getSizeStorageKey());
    if (raw) {
      const s = JSON.parse(raw);
      return { width: Math.max(320, Math.min(s.width, 700)), height: Math.max(350, Math.min(s.height, 900)) };
    }
  } catch {}
  return { width: 400, height: 520 };
};

const savePopupSize = (size: { width: number; height: number }) => {
  try { localStorage.setItem(getSizeStorageKey(), JSON.stringify(size)); } catch {}
};

// ─── Chibi Robot SVG (with full body) ────────────────────
const ChibiSVG: React.FC<{ state: BotState; frame: number }> = ({ state, frame }) => {
  const eyeOpen = state !== 'sleep';
  const isTalking = state === 'talk' || state === 'excited';
  const isWaving = state === 'wave';
  const isSleeping = state === 'sleep';
  const blink = eyeOpen && frame % 12 === 0;

  const bodyBob = Math.sin(frame * 0.15) * 1.5;
  const armWave = isWaving ? Math.sin(frame * 0.5) * 15 : 0;

  return (
    <svg viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Antenna */}
      <g style={{ transformOrigin: '60px 18px' }}>
        <line x1="60" y1="18" x2="60" y2="6" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="60" cy="5" r="4" fill="#818cf8">
          <animate attributeName="r" values="3.5;5;3.5" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="60" cy="5" r="7" fill="#818cf8" opacity="0.15">
          <animate attributeName="r" values="5;9;5" dur="2s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Head */}
      <g transform={`translate(0, ${bodyBob * 0.5})`}>
        <rect x="28" y="18" width="64" height="48" rx="18" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1.5" />
        <rect x="35" y="25" width="50" height="34" rx="12" fill="#eef2ff" opacity="0.9" />

        {blink || !eyeOpen ? (
          <>
            <line x1="44" y1="40" x2="52" y2="40" stroke="#4338ca" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="68" y1="40" x2="76" y2="40" stroke="#4338ca" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="48" cy="39" r="6" fill="#4338ca" />
            <circle cx="72" cy="39" r="6" fill="#4338ca" />
            <circle cx="46" cy="37" r="2" fill="white" />
            <circle cx="70" cy="37" r="2" fill="white" />
            {state === 'excited' && (
              <>
                <circle cx="50" cy="35" r="1.5" fill="#fbbf24"><animate attributeName="opacity" values="0;1;0" dur="0.5s" repeatCount="indefinite" /></circle>
                <circle cx="74" cy="35" r="1.5" fill="#fbbf24"><animate attributeName="opacity" values="0;1;0" dur="0.5s" repeatCount="indefinite" /></circle>
              </>
            )}
          </>
        )}

        <circle cx="38" cy="46" r="5" fill="#fca5a5" opacity="0.4" />
        <circle cx="82" cy="46" r="5" fill="#fca5a5" opacity="0.4" />

        {isTalking ? (
          <ellipse cx="60" cy="50" rx="5" ry={3 + Math.sin(frame * 0.8) * 1.5} fill="#4338ca" />
        ) : isSleeping ? (
          <path d="M55 50 Q60 48 65 50" stroke="#6366f1" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M53 49 Q60 55 67 49" stroke="#4338ca" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}

        {isSleeping && (
          <g>
            <text x="78" y="28" fontSize="10" fontWeight="bold" fill="#a5b4fc" opacity="0.8">
              z<animate attributeName="y" values="28;22;28" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite" />
            </text>
            <text x="88" y="22" fontSize="8" fontWeight="bold" fill="#a5b4fc" opacity="0.6">
              Z<animate attributeName="y" values="22;16;22" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
            </text>
            <text x="96" y="16" fontSize="12" fontWeight="bold" fill="#a5b4fc" opacity="0.5">
              Z<animate attributeName="y" values="16;8;16" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3s" repeatCount="indefinite" />
            </text>
          </g>
        )}

        <rect x="18" y="30" width="12" height="20" rx="4" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        <rect x="90" y="30" width="12" height="20" rx="4" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        <rect x="20" y="34" width="8" height="12" rx="3" fill="#818cf8" opacity="0.3" />
        <rect x="92" y="34" width="8" height="12" rx="3" fill="#818cf8" opacity="0.3" />
      </g>

      {/* Body */}
      <g transform={`translate(0, ${bodyBob})`}>
        <rect x="50" y="66" width="20" height="8" rx="3" fill="#a5b4fc" />
        <rect x="32" y="72" width="56" height="38" rx="14" fill="url(#bodyGrad)" stroke="#6366f1" strokeWidth="1.5" />
        <rect x="46" y="80" width="28" height="18" rx="6" fill="#1e1b4b" opacity="0.8" />
        <text x="60" y="92" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#818cf8">VIOO</text>
        <rect x="48" y="82" width="24" height="14" rx="5" fill="none" stroke="#818cf8" strokeWidth="0.5" opacity="0.4">
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3s" repeatCount="indefinite" />
        </rect>
        <circle cx="60" cy="78" r="2.5" fill="#f472b6" opacity="0.7">
          <animate attributeName="r" values="2;3;2" dur="1.5s" repeatCount="indefinite" />
        </circle>

        <g transform={`rotate(${isWaving ? -20 : 5}, 32, 78)`}>
          <rect x="16" y="76" width="18" height="10" rx="5" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
          <circle cx="16" cy="81" r="6" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        </g>

        <g transform={`rotate(${armWave - 5}, 88, 78)`} style={{ transformOrigin: '88px 78px' }}>
          <rect x="86" y="76" width="18" height="10" rx="5" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
          <circle cx="104" cy="81" r="6" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
          {isWaving && (
            <g transform="translate(100, 72)">
              <line x1="0" y1="-3" x2="2" y2="-7" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round">
                <animate attributeName="opacity" values="0;1;0" dur="0.4s" repeatCount="indefinite" />
              </line>
              <line x1="4" y1="-4" x2="7" y2="-6" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round">
                <animate attributeName="opacity" values="0;1;0" dur="0.5s" repeatCount="indefinite" />
              </line>
            </g>
          )}
        </g>

        <rect x="40" y="108" width="14" height="16" rx="6" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        <rect x="66" y="108" width="14" height="16" rx="6" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        <ellipse cx="47" cy="126" rx="10" ry="5" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
        <ellipse cx="73" cy="126" rx="10" ry="5" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1" />
      </g>

      <defs>
        <linearGradient id="headGrad" x1="28" y1="18" x2="92" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c7d2fe" /><stop offset="1" stopColor="#a5b4fc" />
        </linearGradient>
        <linearGradient id="bodyGrad" x1="32" y1="72" x2="88" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#818cf8" /><stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
};

// ─── Main ChibiBot Component ──────────────────────────────
const ChibiBot: React.FC<ChibiBotProps> = ({ userName, userId }) => {
  const [visible, setVisible] = useState(false);
  const [botState, setBotState] = useState<BotState>('peek');
  const [frame, setFrame] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [showBubble, setShowBubble] = useState(false);
  const [dbMessages, setDbMessages] = useState<ChatbotMessage[]>([]);
  const [bubbleCount, setBubbleCount] = useState(0);
  const [sleeping, setSleeping] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Chat popup state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistory(userId));
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatConvId, setChatConvId] = useState<string | null>(() => loadConvId(userId));

  // Resizable popup
  const [popupSize, setPopupSize] = useState(() => loadPopupSize());
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ edge: string; startX: number; startY: number; startW: number; startH: number } | null>(null);

  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frameRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const usedMessagesRef = useRef<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const firstName = userName?.split(' ').pop() || 'bạn';

  // ─── Persist chat history ───────────────────
  useEffect(() => {
    if (chatMessages.length > 0) {
      saveChatHistory(userId, chatMessages);
    }
  }, [chatMessages, userId]);

  useEffect(() => {
    saveConvId(userId, chatConvId);
  }, [chatConvId, userId]);

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // ─── Resize logic ──────────────────────────
  const startResize = useCallback((e: React.MouseEvent, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startW: popupSize.width,
      startH: popupSize.height,
    };
  }, [popupSize]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { edge, startX, startY, startW, startH } = resizeRef.current;
      let newW = startW;
      let newH = startH;

      if (edge.includes('left'))  newW = Math.max(320, Math.min(700, startW + (startX - e.clientX)));
      if (edge.includes('top'))   newH = Math.max(350, Math.min(900, startH + (startY - e.clientY)));
      if (edge.includes('right')) newW = Math.max(320, Math.min(700, startW + (e.clientX - startX)));

      setPopupSize({ width: newW, height: newH });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      savePopupSize(popupSize);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, popupSize]);

  // Save size when resize ends
  useEffect(() => {
    if (!isResizing) {
      savePopupSize(popupSize);
    }
  }, [isResizing, popupSize]);

  // ─── Load random messages from DB ──────────────────
  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('chatbot_messages')
        .select('*')
        .eq('is_active', true);
      if (data) setDbMessages(data);
    };
    fetchMessages();

    const channel = supabase
      .channel('chatbot-messages-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chatbot_messages' }, () => {
        fetchMessages();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Frame animation
  useEffect(() => {
    frameRef.current = setInterval(() => setFrame(f => f + 1), 200);
    return () => clearInterval(frameRef.current);
  }, []);

  // Initial appearance
  useEffect(() => {
    const lastDismissed = sessionStorage.getItem('chibibot_dismissed');
    if (lastDismissed) { setDismissed(true); return; }

    const timer = setTimeout(() => {
      setVisible(true);
      setBotState('peek');
      setTimeout(() => {
        setBotState('wave');
        showGreeting();
      }, 1500);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // Bubble cycle: 300s interval
  useEffect(() => {
    if (!visible || sleeping || dismissed || chatOpen) return;

    const scheduleBubble = () => {
      bubbleTimerRef.current = setTimeout(() => {
        if (bubbleCount >= 4) {
          setSleeping(true);
          setBotState('sleep');
          setBubbleCount(0);
          usedMessagesRef.current.clear();

          sleepTimerRef.current = setTimeout(() => {
            setSleeping(false);
            setBotState('wave');
            showGreeting();
          }, 60 * 60 * 1000);
          return;
        }
        showRandomMessage();
        scheduleBubble();
      }, 300000);
    };

    const initial = setTimeout(scheduleBubble, 30000);
    return () => {
      clearTimeout(initial);
      clearTimeout(bubbleTimerRef.current);
      clearTimeout(sleepTimerRef.current);
    };
  }, [visible, sleeping, dismissed, bubbleCount, dbMessages, chatOpen]);

  const getTimeFilteredMessages = useCallback(() => {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    return dbMessages.filter(msg => {
      if (usedMessagesRef.current.has(msg.id)) return false;
      if (!msg.time_range) return true;
      const [start, end] = msg.time_range.split('-');
      return currentTime >= start && currentTime <= end;
    });
  }, [dbMessages]);

  const showGreeting = useCallback(() => {
    const hour = new Date().getHours();
    let greeting: string;
    if (hour < 10) greeting = `Chào buổi sáng, ${firstName}! ☀️ Bắt đầu ngày mới thôi nào!`;
    else if (hour < 12) greeting = `Hi ${firstName}! Làm việc hiệu quả nha! 💪`;
    else if (hour < 14) greeting = `Chào buổi trưa, ${firstName}! Ăn gì chưa? 🍜`;
    else if (hour < 18) greeting = `Buổi chiều vui vẻ, ${firstName}! ☕`;
    else greeting = `Chào buổi tối, ${firstName}! Làm OT hả? 🌙`;

    const greetings = getTimeFilteredMessages().filter(m => m.type === 'greeting');
    if (greetings.length > 0) {
      const picked = greetings[Math.floor(Math.random() * greetings.length)];
      greeting = picked.message.replace('{name}', firstName);
      usedMessagesRef.current.add(picked.id);
    }
    setBubble(greeting);
    setShowBubble(true);
    setBotState('talk');
    setBubbleCount(c => c + 1);
    setTimeout(() => { setShowBubble(false); setBotState('idle'); }, 6000);
  }, [firstName, getTimeFilteredMessages]);

  const showRandomMessage = useCallback(() => {
    const available = getTimeFilteredMessages();
    if (available.length === 0) { usedMessagesRef.current.clear(); return; }
    const reminders = available.filter(m => m.type === 'reminder' && m.time_range);
    const pool = reminders.length > 0 ? reminders : available;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const msg = picked.message.replace('{name}', firstName);
    usedMessagesRef.current.add(picked.id);
    setBubble(`${picked.emoji} ${msg}`);
    setShowBubble(true);
    setBotState(picked.type === 'motivation' ? 'excited' : 'talk');
    setBubbleCount(c => c + 1);
    setTimeout(() => { setShowBubble(false); setBotState('idle'); }, 6000);
  }, [firstName, getTimeFilteredMessages]);

  // ─── Open Chat Popup ────────────────────────
  const openChat = useCallback(() => {
    if (sleeping) {
      setSleeping(false);
      clearTimeout(sleepTimerRef.current);
      setBotState('wave');
      setBubbleCount(0);
    }
    setShowBubble(false);
    setChatOpen(true);
    setBotState('excited');
    setTimeout(() => {
      chatInputRef.current?.focus();
      setBotState('idle');
    }, 500);
  }, [sleeping]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setBotState('wave');
    setTimeout(() => setBotState('idle'), 2000);
  }, []);

  // ─── Clear chat history ─────────────────────
  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatConvId(null);
    localStorage.removeItem(getChatStorageKey(userId));
    localStorage.removeItem(getConvIdStorageKey(userId));
  }, [userId]);

  // ─── Send chat message to AI ────────────────
  const sendChatMessage = useCallback(async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    setChatInput('');
    setChatLoading(true);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, userMsg]);
    setBotState('talk');

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId: chatConvId,
          userId,
          mode: 'data',
          history: chatMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await resp.json();

      if (!chatConvId && data.conversationId) {
        setChatConvId(data.conversationId);
      }

      setChatMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.error ? `⚠️ ${data.error}` : data.answer,
        createdAt: new Date().toISOString(),
      }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Lỗi kết nối: ${err.message}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setChatLoading(false);
      setBotState('idle');
    }
  }, [chatInput, chatLoading, chatConvId, userId, chatMessages]);

  // ─── Dismiss ────────────────────────────────
  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    setVisible(false);
    setChatOpen(false);
    sessionStorage.setItem('chibibot_dismissed', 'true');
  }, []);

  if (!visible || dismissed) return null;

  return (
    <>
      {/* ═══ Chat Popup (Mobile: fullscreen, Desktop: floating resizable) ═══ */}
      {chatOpen && (
        <div
          ref={popupRef}
          className="fixed z-[998] flex flex-col bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-visible inset-0 rounded-none lg:inset-auto lg:rounded-2xl"
          style={{
            ...( typeof window !== 'undefined' && window.innerWidth >= 1024 ? {
              bottom: 130,
              right: 20,
              width: popupSize.width,
              height: popupSize.height,
              maxHeight: 'calc(100vh - 160px)',
            } : {}),
            animation: !isResizing ? 'chibiChatIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
          }}
        >
          {/* ─── Resize Handles ─── */}
          {/* Top edge */}
          <div
            className="absolute -top-1 left-4 right-4 h-3 cursor-ns-resize z-10 group"
            onMouseDown={e => startResize(e, 'top')}
          >
            <div className="w-10 h-1 mx-auto mt-1 rounded-full bg-slate-300 group-hover:bg-indigo-400 transition-colors opacity-0 group-hover:opacity-100" />
          </div>
          {/* Left edge */}
          <div
            className="absolute top-4 -left-1 bottom-4 w-3 cursor-ew-resize z-10"
            onMouseDown={e => startResize(e, 'left')}
          />
          {/* Top-left corner */}
          <div
            className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-20"
            onMouseDown={e => startResize(e, 'top-left')}
          />

          {/* ─── Chat Header ─── */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 text-white shrink-0 rounded-t-2xl">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Bot size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black truncate">Trợ lý AI Vioo</h3>
              <p className="text-[10px] text-white/70 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online · Powered by Gemini
              </p>
            </div>
            {chatMessages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="Xóa lịch sử chat"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button onClick={closeChat} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
              <ChevronDown size={18} />
            </button>
          </div>

          {/* ─── Chat Messages ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 rounded-b-2xl" style={{
            background: 'linear-gradient(180deg, #f5f3ff 0%, #faf5ff 50%, #f8fafc 100%)',
          }}>
            {/* Welcome */}
            {chatMessages.length === 0 && !chatLoading && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg mb-3">
                  <Sparkles size={24} className="text-white" />
                </div>
                <p className="text-sm font-black text-slate-700 dark:text-white mb-1">Xin chào, {firstName}!</p>
                <p className="text-xs text-slate-400 mb-4">Mình có thể giúp gì cho bạn hôm nay?</p>
                <div className="space-y-2 w-full">
                  {['Tổng tồn kho hiện tại?', 'Có bao nhiêu nhân viên?', 'Thống kê dự án tháng này'].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setChatInput(q); }}
                      className="w-full text-left px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:shadow-md transition-all"
                    >
                      💡 {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 self-end">
                    <Bot size={13} className="text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] px-3 py-2 text-[13px] leading-relaxed rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-br-md'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-md border border-slate-100 dark:border-slate-700 shadow-sm'
                }`}>
                  {msg.role === 'assistant' ? (
                    <div
                      className="chibi-md-content"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                    />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {chatLoading && (
              <div className="flex gap-2 items-end">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Bot size={13} className="text-white" />
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-md px-4 py-3 border border-slate-100 dark:border-slate-700">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ─── Chat Input ─── */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0 rounded-b-2xl">
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2 border-2 border-transparent focus-within:border-indigo-400 focus-within:bg-white dark:focus-within:bg-slate-750 transition-all">
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  placeholder="Nhập tin nhắn..."
                  rows={1}
                  className="w-full bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none resize-none max-h-[80px] leading-relaxed"
                  style={{ minHeight: 24 }}
                />
              </div>
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="w-9 h-9 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg disabled:opacity-40 hover:shadow-xl hover:scale-105 transition-all active:scale-95 shrink-0"
              >
                {chatLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Random Speech Bubble (desktop only) ═══ */}
      {showBubble && bubble && !chatOpen && (
        <div
          className="fixed z-[997] cursor-pointer hidden lg:block"
          style={{
            bottom: 130,
            right: 20,
            animation: 'chibiBubbleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          onClick={openChat}
        >
          <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-br-md px-5 py-3.5 shadow-xl border border-indigo-100 dark:border-indigo-900/50"
            style={{ minWidth: 280, maxWidth: 360 }}
          >
            <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-200 leading-relaxed">
              {bubble}
            </p>
            <p className="text-[10px] text-indigo-400 mt-1.5 font-bold flex items-center gap-1">
              💬 Nhấn để trò chuyện
            </p>
          </div>
          {/* Bubble tail */}
          <div className="absolute -bottom-1.5 right-8 w-3 h-3 bg-white dark:bg-slate-800 border-r border-b border-indigo-100 dark:border-indigo-900/50 rotate-45" />
        </div>
      )}


      {/* ═══ ChibiBot Character — Desktop: full robot, Mobile: mini icon ═══ */}
      {/* Desktop full robot */}
      <div className="fixed z-[996] select-none hidden lg:block" style={{ bottom: 20, right: 110 }}>
        <div
          className={`relative transition-all duration-500 cursor-pointer ${
            isHovered ? 'scale-110' : 'scale-100'
          } ${sleeping ? 'opacity-60' : 'opacity-100'}`}
          style={{
            width: 80,
            height: 100,
            animation: visible ? 'chibiEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
          }}
          onClick={openChat}
          onMouseEnter={() => { setIsHovered(true); if (!sleeping) setBotState('wave'); }}
          onMouseLeave={() => { setIsHovered(false); if (!sleeping && !showBubble) setBotState('idle'); }}
          title={sleeping ? 'Click để đánh thức trợ lý' : 'Trò chuyện với Trợ lý AI'}
        >
          <ChibiSVG state={botState} frame={frame} />

          {isHovered && !sleeping && (
            <div className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
                animation: 'chibiGlow 1s ease-in-out infinite alternate',
              }}
            />
          )}

          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-14 h-2 rounded-full bg-indigo-900/10 dark:bg-indigo-300/5"
            style={{ animation: 'chibiBob 3s ease-in-out infinite' }}
          />
        </div>

        {/* Close */}
        <button
          onClick={handleDismiss}
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-400/80 hover:bg-red-500 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-all shadow-lg"
          style={{ fontSize: 10 }}
          title="Ẩn trợ lý"
        >
          <X size={10} />
        </button>
      </div>

      {/* Mobile mini icon */}
      <div className="lg:hidden fixed z-[996] select-none" style={{ bottom: 48, right: 60 }}>
        <button
          onClick={openChat}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg flex items-center justify-center opacity-70 hover:opacity-100 active:scale-90 transition-all"
          title="Trợ lý AI"
        >
          <Bot size={16} />
        </button>
      </div>

      {/* ═══ Animations & Styles ═══ */}
      <style>{`
        @keyframes chibiEnter {
          from { transform: translateY(100px) scale(0.3); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes chibiBubbleIn {
          from { transform: scale(0.5) translateY(10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes chibiBob {
          0%, 100% { transform: translateX(-50%) scaleX(1); }
          50% { transform: translateX(-50%) scaleX(0.85); }
        }
        @keyframes chibiGlow {
          from { opacity: 0.3; }
          to { opacity: 0.7; }
        }
        @keyframes chibiChatIn {
          from { transform: scale(0.8) translateY(20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* Markdown content styling inside chat bubble */
        .chibi-md-content strong {
          font-weight: 700;
        }
        .chibi-md-content h3, .chibi-md-content h4 {
          margin-top: 6px;
          margin-bottom: 2px;
        }
        .chibi-md-content pre {
          margin: 6px 0;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .chibi-md-content table {
          font-size: 11px;
        }
        .chibi-md-content table th,
        .chibi-md-content table td {
          padding: 4px 6px;
        }
      `}</style>
    </>
  );
};

export default ChibiBot;
