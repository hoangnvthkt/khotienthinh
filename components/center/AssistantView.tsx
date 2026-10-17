import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, ChevronRight, History, Plus, RefreshCcw, RotateCcw, Sparkles, Square, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import type { CenterPerson, TodayState } from './TodayView';
import type { DrillTarget } from '../../lib/center/drill';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import {
  answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys, pronounOf, type Brief, type BriefLine,
} from '../../lib/center/assistantBrief';
import { aiErrorMessage, aiGateway, type AiGatewayStatus, type AiRunResult } from '../../lib/aiGateway';
import {
  assistantChat, boldParts, displayText, isTodayThread, textBlocks, threadDayLabel, threadTimeLabel,
  type ChatHandlers, type ChatSendInput, type ChatSendResult, type ChatThread, type ChatThreadSummary,
} from '../../lib/assistantChat';

// Tab Trợ lý v2 · T0 (chủ SP duyệt 17/10/2026): khung chat. Bản tin gọn (câu đầu · Làm trước ≤ 3 · Đáng lo ≤ 3) là khối đầu của hội thoại
// hôm nay; hỏi tiếp được (máy chủ đọc lại các lượt trước), trả lời chạy dần, mở lại từ Lịch sử (chỉ chủ xem, giữ 90 ngày).
// Chỉ đọc: Trợ lý không gửi, duyệt, trả lại, xóa gì — mọi nút chỉ mở chứng từ / màn gốc để người dùng tự làm.

export interface AssistantHooks {
  status: () => Promise<AiGatewayStatus>;
  narrate: (facts: string, context: Record<string, unknown>) => Promise<AiRunResult<{ brief: string }>>;
  feedback: (runId: string, accepted: boolean) => void;
  chat: (input: ChatSendInput, handlers: ChatHandlers, signal?: AbortSignal) => Promise<ChatSendResult>;
  listThreads: () => Promise<ChatThreadSummary[]>;
  getThread: (id: string) => Promise<ChatThread>;
}
export const defaultAssistantHooks: AssistantHooks = {
  status: () => aiGateway.status(),
  narrate: (facts, context) => aiGateway.run<{ brief: string }>('morning_brief', { facts }, context),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
  chat: (input, handlers, signal) => assistantChat.send(input, handlers, signal),
  listThreads: () => assistantChat.listThreads(),
  getThread: id => assistantChat.getThread(id),
};

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: string[];
  runId: string | null;
  accepted: boolean | null;
  /** pending: chờ chữ đầu · streaming: đang chạy · done · error */
  state: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  /** Câu hỏi nhanh: dòng số liệu của nhóm, không qua AI, không lưu. */
  lines?: BriefLine[];
  /** Câu hỏi gốc để Thử lại. */
  question?: string;
}

const Feedback: React.FC<{ value: boolean | null | undefined; onPick: (accepted: boolean) => void; label: string }> = ({ value, onPick, label }) => (
  <span className="vcc-fb">
    <button type="button" className="vcc-iconbtn" aria-pressed={value === true} onClick={() => onPick(true)} aria-label={`${label} đúng`} title="Đúng"><ThumbsUp size={13} /></button>
    <button type="button" className="vcc-iconbtn" aria-pressed={value === false} onClick={() => onPick(false)} aria-label={`${label} chưa đúng`} title="Chưa đúng"><ThumbsDown size={13} /></button>
  </span>
);

const RichText: React.FC<{ text: string }> = ({ text }) => {
  const inline = (value: string) => boldParts(value).map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <React.Fragment key={i}>{part.text}</React.Fragment>));
  return (
    <>
      {textBlocks(text).map((block, i) => block.kind === 'p'
        ? <p key={i}>{inline(block.text)}</p>
        : React.createElement(block.kind, { key: i }, block.items.map((item, j) => <li key={j}>{inline(item)}</li>)))}
    </>
  );
};

const BriefCard: React.FC<{
  brief: Brief; now: Date; items: WorkItem[] | 'loading' | 'error'; today: TodayState; configured: boolean;
  narration: { state: 'idle' | 'pending' | 'done' | 'error'; text?: string; runId?: string; feedback?: boolean | null };
  onNarrate: () => void; onNarrationFeedback: (accepted: boolean) => void; onRefresh: () => void;
  onOpenItem: (item: WorkItem) => void; onDrill: (target: DrillTarget) => void;
}> = ({ brief, now, items, today, configured, narration, onNarrate, onNarrationFeedback, onRefresh, onOpenItem, onDrill }) => {
  const todayData = today.status === 'ready' ? today.data : null;
  return (
    <section className="vcc-assist" data-testid="assistant" aria-label="Bản tin hôm nay">
      <header className="vcc-brief-top">
        <div className="min-w-0">
          <p className="vcc-brief-date">{briefDateLabel(now)}</p>
          <h1 className="vcc-brief-head">{items === 'loading' ? 'Đang tải việc của bạn…' : brief.headline}</h1>
        </div>
        <div className="vcc-brief-tools">
          {configured && (
            <button type="button" className="vcc-btn" onClick={onNarrate} disabled={narration.state === 'pending'} title="AI viết bản tin vài câu từ số liệu trên màn">
              <Sparkles size={14} /> {narration.state === 'pending' ? 'Đang viết…' : 'Tóm tắt'}
            </button>
          )}
          <button type="button" className="vcc-iconbtn" onClick={onRefresh} aria-label="Làm mới" title="Làm mới"><RefreshCcw size={15} /></button>
        </div>
      </header>

      {narration.state !== 'idle' && (
        <div className={`vcc-narr${narration.state === 'error' ? ' vcc-narr-err' : ''}`} data-testid="narration" aria-live="polite">
          {narration.state === 'pending' ? 'Đang viết…' : narration.text}
          {narration.state === 'done' && <Feedback label="Bản tin" value={narration.feedback} onPick={onNarrationFeedback} />}
        </div>
      )}

      <section className="vcc-card" aria-label="Làm trước">
        <div className="vcc-sec-head">
          <h2 className="vcc-sec-title">Làm trước</h2>
          {brief.total !== null && brief.total > 0 && <span className="vcc-sec-count">{brief.total} việc chờ</span>}
        </div>
        {items === 'loading' && <p className="vcc-brief-empty" role="status">Đang tải…</p>}
        {items === 'error' && (
          <p className="vcc-brief-empty" role="alert">Chưa đọc được Việc của tôi · <button type="button" className="vcc-link" onClick={onRefresh}>Thử lại</button></p>
        )}
        {Array.isArray(items) && brief.tasks.length === 0 && <p className="vcc-brief-empty">Không có việc chờ</p>}
        {brief.tasks.length > 0 && (
          <ol className="m-0 list-none p-0">
            {brief.tasks.map((task, index) => (
              <li key={task.key}>
                <button type="button" className="vcc-task" data-key={task.key} onClick={() => onOpenItem(task.item)} title={`Mở ${task.code}`}>
                  <span className="vcc-task-num">{index + 1}</span>
                  <span className="vcc-task-code">{task.code}</span>
                  <span className="vcc-task-title"><i>{task.verb}</i> {task.title}</span>
                  {task.due && <span className="vcc-task-due" data-tone={task.tone}>{task.due}</span>}
                  <span className="vcc-open">Mở <ChevronRight size={13} /></span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {brief.more && (
          <button type="button" className="vcc-more" onClick={() => onDrill({ kind: 'inbox', title: 'Việc của tôi' })}>{brief.more} <ChevronRight size={13} /></button>
        )}
      </section>

      <section className="vcc-card" aria-label="Đáng lo">
        <div className="vcc-sec-head">
          <h2 className="vcc-sec-title">Đáng lo</h2>
          {todayData?.project && <span className="vcc-sec-count">{todayData.project.code}</span>}
        </div>
        {today.status === 'loading' && <p className="vcc-brief-empty" role="status">Đang tải…</p>}
        {today.status === 'error' && (
          <p className="vcc-brief-empty" role="alert">Chưa đọc được số liệu dự án · <button type="button" className="vcc-link" onClick={onRefresh}>Thử lại</button></p>
        )}
        {brief.worries && brief.worries.length === 0 && <p className="vcc-brief-empty">Không có gì bất thường</p>}
        {brief.worries && brief.worries.length > 0 && (
          <ul className="m-0 list-none p-0">
            {brief.worries.map(worry => (
              <li key={worry.key}>
                <button type="button" className="vcc-worry" data-tone={worry.tone} data-key={worry.key} onClick={() => onDrill(worry.target)}>
                  <span className="vcc-worry-text">{worry.text}</span>
                  <span className="vcc-open">Xem <ChevronRight size={13} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};

const STOP_ERRORS = new Set(['AI_ABORTED']);

const AssistantView: React.FC<{
  person: CenterPerson;
  now: Date;
  today: TodayState;
  mineCount: number | null;
  /** Tab đang hiện: lần đầu hiện mới tải Việc của tôi, tình trạng AI và hội thoại hôm nay. */
  active: boolean;
  loadWorkItems: (tab: InboxTab) => Promise<WorkItemsPage>;
  onDrill: (target: DrillTarget) => void;
  onOpenItem: (item: WorkItem) => void;
  onRetry: () => void;
  hooks?: AssistantHooks;
}> = ({ person, now, today, active, loadWorkItems, onDrill, onOpenItem, onRetry, hooks = defaultAssistantHooks }) => {
  const [items, setItems] = useState<WorkItem[] | 'loading' | 'error'>('loading');
  const [itemsAttempt, setItemsAttempt] = useState(0);
  const [ai, setAi] = useState<AiGatewayStatus | null>(null);
  const [narration, setNarration] = useState<{ state: 'idle' | 'pending' | 'done' | 'error'; text?: string; runId?: string; feedback?: boolean | null }>({ state: 'idle' });
  const [thread, setThread] = useState<{ id: string | null; title: string; startedAt: string | null }>({ id: null, title: '', startedAt: null });
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [history, setHistory] = useState<{ open: boolean; list: ChatThreadSummary[] | 'loading' | 'error' | null }>({ open: false, list: null });
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const started = useRef(false);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const historyBox = useRef<HTMLDivElement | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  const openThread = useCallback(async (id: string) => {
    setThreadState('loading');
    setHistory(h => ({ ...h, open: false }));
    try {
      const loaded = await hooks.getThread(id);
      setThread({ id: loaded.id, title: loaded.title, startedAt: loaded.messages[0]?.createdAt || loaded.lastMessageAt });
      setMessages(loaded.messages.map(m => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, runId: m.runId, accepted: m.accepted, state: 'done' })));
      setThreadState('idle');
      pinned.current = true;
    } catch {
      setThreadState('error');
    }
  }, [hooks]);

  useEffect(() => {
    if (!active) return;
    if (!started.current) {
      started.current = true;
      hooks.status().then(setAi).catch(() => setAi(null));
      // Hội thoại có tin trong hôm nay → mở lại để hỏi tiếp (tải lại trang không mất).
      hooks.listThreads().then(list => {
        setHistory(h => ({ ...h, list }));
        const latest = list[0];
        if (latest && isTodayThread(latest, nowRef.current)) void openThread(latest.id);
      }).catch(() => setHistory(h => ({ ...h, list: 'error' })));
    }
    let alive = true;
    loadWorkItems('mine').then(page => { if (alive) setItems(page.items); }).catch(() => { if (alive) setItems('error'); });
    return () => { alive = false; };
  }, [active, loadWorkItems, hooks, itemsAttempt, openThread]);

  const todayData = today.status === 'ready' ? today.data : null;
  const brief = useMemo(
    () => buildBrief(todayData, Array.isArray(items) ? items : null, now, person.gender),
    [todayData, items, now, person.gender],
  );
  const configured = !!ai?.configured;
  const quick = availableQuickQuestions(brief);
  const context = { projectId: todayData?.project?.id || null, tab: 'assistant' };
  const isToday = !thread.startedAt || isTodayThread({ lastMessageAt: thread.startedAt }, now);

  // Giữ cuộn ở cuối khi người dùng đang ở cuối (chữ chạy dần); cuộn lên đọc lại thì không kéo xuống.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Đóng Lịch sử khi bấm ra ngoài / Esc.
  useEffect(() => {
    if (!history.open) return;
    const onDown = (event: PointerEvent) => { if (historyBox.current && !historyBox.current.contains(event.target as Node)) setHistory(h => ({ ...h, open: false })); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setHistory(h => ({ ...h, open: false })); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [history.open]);

  const toggleHistory = () => {
    const opening = !history.open;
    setHistory(h => ({ ...h, open: opening, list: opening && (h.list === null || h.list === 'error') ? 'loading' : h.list }));
    if (opening) hooks.listThreads().then(list => setHistory(h => ({ ...h, list }))).catch(() => setHistory(h => ({ ...h, list: 'error' })));
  };

  const newThread = () => {
    abort.current?.abort();
    setThread({ id: null, title: '', startedAt: null });
    setMessages([]);
    setThreadState('idle');
    setHistory(h => ({ ...h, open: false }));
    pinned.current = true;
    setTimeout(() => input.current?.focus(), 0);
  };

  const refresh = () => { onRetry(); setItems('loading'); setItemsAttempt(value => value + 1); };

  const open = (line: Pick<BriefLine, 'item' | 'target' | 'locked'>) => {
    if (line.locked) return;
    if (line.item) onOpenItem(line.item); else if (line.target) onDrill(line.target);
  };

  const askQuick = (id: string, text: string) => {
    pinned.current = true;
    setMessages(current => [...current,
      { id: `q-${++seq.current}`, role: 'user', content: text, sources: [], runId: null, accepted: null, state: 'done' },
      { id: `a-${++seq.current}`, role: 'assistant', content: '', sources: [], runId: null, accepted: null, state: 'done', lines: answerQuick(brief, id) }]);
  };

  const send = async (text: string, retryOf?: string) => {
    const q = text.trim();
    if (!configured || sending || q.length < 2) return;
    const replyId = `a-${++seq.current}`;
    pinned.current = true;
    setSending(true);
    setMessages(current => [
      ...current.filter(m => m.id !== retryOf),
      ...(retryOf ? [] : [{ id: `q-${++seq.current}`, role: 'user' as const, content: q, sources: [], runId: null, accepted: null, state: 'done' as const }]),
      { id: replyId, role: 'assistant', content: '', sources: [], runId: null, accepted: null, state: 'pending', question: q },
    ]);
    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages(current => current.map(m => (m.id === replyId ? fn(m) : m)));
    const controller = new AbortController();
    abort.current = controller;
    const result = await hooks.chat(
      { threadId: thread.id, question: q, facts: briefFacts(brief), pronoun: pronounOf(person.gender), context },
      { onStart: ({ runId }) => patch(m => ({ ...m, runId })), onDelta: delta => patch(m => ({ ...m, state: 'streaming', content: m.content + delta })) },
      controller.signal,
    ).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    abort.current = null;
    setSending(false);
    if (result.code === 'OK') {
      patch(m => ({ ...m, state: 'done', content: result.answer, sources: result.sources, runId: result.runId, id: result.messageId || m.id }));
      if (result.threadId && !thread.id) setThread({ id: result.threadId, title: q.slice(0, 80), startedAt: now.toISOString() });
      setHistory(h => ({ ...h, list: null }));
    } else if ('error' in result && result.error && STOP_ERRORS.has(result.error)) {
      patch(m => ({ ...m, state: m.content ? 'done' : 'error', error: m.content ? undefined : 'Đã dừng.' }));
    } else {
      // Đứt giữa chừng: bỏ nửa câu dở (dễ hiểu nhầm), chỉ báo lý do + Thử lại.
      patch(m => ({ ...m, state: 'error', content: '', error: aiErrorMessage(result) }));
    }
  };

  const submit = () => {
    const text = question;
    if (text.trim().length < 2) return;
    setQuestion('');
    void send(text);
  };

  // Ô nhập tự cao theo chữ (tối đa ~6 dòng); ô trống về một dòng (chữ gợi ý không đẩy cao ô).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '';
    if (question) el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

  const narrate = async () => {
    setNarration({ state: 'pending' });
    const result = await hooks.narrate(briefFacts(brief), context).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    setNarration(result.code === 'OK' ? { state: 'done', text: result.result.brief, runId: result.runId, feedback: null } : { state: 'error', text: aiErrorMessage(result) });
  };
  const sendFeedback = (runId: string | null | undefined, accepted: boolean) => { if (runId) hooks.feedback(runId, accepted); };

  const showChips = quick.length > 0 && (!configured || messages.length === 0);
  const historyList = history.list;

  return (
    <section className="vcc-chat" aria-label="Trợ lý">
      <div className="vcc-chat-bar">
        <p className="vcc-chat-title" title={thread.title || undefined}>{thread.title || 'Hội thoại mới'}</p>
        <div className="vcc-chat-actions" ref={historyBox}>
          <button type="button" className="vcc-btn" onClick={toggleHistory} aria-expanded={history.open} aria-haspopup="dialog" title="Hội thoại đã có">
            <History size={14} /> <span className="vcc-chat-label">Lịch sử</span>
          </button>
          <button type="button" className="vcc-btn" onClick={newThread} disabled={!thread.id && messages.length === 0} title="Bắt đầu hội thoại mới">
            <Plus size={14} /> <span className="vcc-chat-label">Hội thoại mới</span>
          </button>
          {history.open && (
            <div className="vcc-chat-history" role="dialog" aria-label="Lịch sử hội thoại">
              <p className="vcc-chat-history-head">Hội thoại của bạn · giữ 90 ngày</p>
              {historyList === 'loading' && <p className="vcc-chat-history-empty" role="status">Đang tải…</p>}
              {historyList === 'error' && <p className="vcc-chat-history-empty" role="alert">Chưa đọc được lịch sử.</p>}
              {Array.isArray(historyList) && historyList.length === 0 && <p className="vcc-chat-history-empty">Chưa có hội thoại nào.</p>}
              {Array.isArray(historyList) && historyList.length > 0 && (
                <ul className="m-0 list-none p-0">
                  {historyList.map(item => (
                    <li key={item.id}>
                      <button type="button" className="vcc-chat-history-item" aria-current={item.id === thread.id || undefined} onClick={() => void openThread(item.id)}>
                        <span className="vcc-chat-history-title">{item.title}</span>
                        <span className="vcc-chat-history-time">{threadTimeLabel(item.lastMessageAt, now)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="vcc-chat-scroll" ref={scroller} onScroll={onScroll}>
        <div className="vcc-chat-col">
          {isToday ? (
            <BriefCard brief={brief} now={now} items={items} today={today} configured={configured} narration={narration}
              onNarrate={narrate} onNarrationFeedback={accepted => { sendFeedback(narration.runId, accepted); setNarration(n => ({ ...n, feedback: accepted })); }}
              onRefresh={refresh} onOpenItem={onOpenItem} onDrill={onDrill} />
          ) : (
            <p className="vcc-chat-day">Hội thoại ngày {threadDayLabel(thread.startedAt || '')}</p>
          )}

          {threadState === 'loading' && <p className="vcc-chat-note" role="status">Đang mở hội thoại…</p>}
          {threadState === 'error' && (
            <p className="vcc-chat-note" role="alert">Chưa mở được hội thoại · <button type="button" className="vcc-link" onClick={newThread}>Bắt đầu hội thoại mới</button></p>
          )}

          {messages.length > 0 && (
            <div className="vcc-thread" aria-label="Hội thoại">
              {messages.map(message => message.role === 'user' ? (
                <div key={message.id} className="vcc-msg" data-role="user"><div className="vcc-msg-q">{message.content}</div></div>
              ) : (
                <div key={message.id} className="vcc-msg" data-role="assistant" data-testid="turn" data-state={message.state}>
                  <span className="vcc-msg-avatar" aria-hidden="true"><Sparkles size={14} /></span>
                  <div className="vcc-msg-body">
                    {message.state === 'pending' && <p className="vcc-msg-wait" role="status">Đang đọc số liệu…</p>}
                    {message.content && <div className="vcc-msg-a"><RichText text={displayText(message.content)} />{message.state === 'streaming' && <span className="vcc-caret" aria-hidden="true" />}</div>}
                    {message.lines && (
                      <ul className="vcc-qlines">
                        {message.lines.map(line => (
                          <li key={line.key}>
                            <button type="button" className="vcc-qline" data-tone={line.tone} disabled={Boolean(line.locked) || !(line.item || line.target)} onClick={() => open(line)} title={line.locked || line.hint}>
                              <span className="vcc-qline-label">{line.label}</span>
                              <span className="vcc-qline-text">{line.text}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {message.state === 'error' && (
                      <p className="vcc-msg-err" role="alert">
                        {message.error}
                        {message.question && <button type="button" className="vcc-link" onClick={() => void send(message.question!, message.id)} disabled={sending}><RotateCcw size={12} /> Thử lại</button>}
                      </p>
                    )}
                    {message.state === 'done' && !message.lines && (() => {
                      const sources = linesByKeys(brief, message.sources);
                      return (
                        <div className="vcc-msg-foot">
                          {sources.length > 0 && (
                            <div className="vcc-turn-src" role="group" aria-label="Chứng từ, màn gốc">
                              {sources.map(line => (
                                <button key={line.key} type="button" className="vcc-chip" disabled={Boolean(line.locked) || !(line.item || line.target)} onClick={() => open(line)} title={line.locked || line.text}>
                                  <ArrowUpRight size={12} /> {line.item ? line.item.code : line.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {message.runId && (
                            <Feedback label="Trả lời" value={message.accepted} onPick={accepted => {
                              sendFeedback(message.runId, accepted);
                              setMessages(c => c.map(m => (m.id === message.id ? { ...m, accepted } : m)));
                            }} />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="vcc-chat-foot">
        <div className="vcc-chat-col">
          {showChips && (
            <div className="vcc-chips" role="group" aria-label="Hỏi nhanh">
              {quick.map(q => <button key={q.id} type="button" className="vcc-chip" onClick={() => askQuick(q.id, q.text)}>{q.text}</button>)}
            </div>
          )}
          {configured && (
            <form className="vcc-composer" onSubmit={event => { event.preventDefault(); if (sending) abort.current?.abort(); else submit(); }}>
              <textarea
                ref={input}
                className="vcc-composer-input"
                value={question}
                rows={1}
                maxLength={1000}
                aria-label="Câu hỏi"
                placeholder="Hỏi về việc, vật tư, tiền…"
                onChange={event => setQuestion(event.target.value)}
                onKeyDown={event => {
                  // Enter gửi, Shift+Enter xuống dòng; đang gõ dấu tiếng Việt (bộ gõ đang ghép chữ) thì Enter không gửi.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending) submit(); }
                }}
              />
              {question.length > 800 && <span className="vcc-composer-count" aria-live="polite">{question.length}/1000</span>}
              {sending ? (
                <button type="submit" className="vcc-composer-send" aria-label="Dừng" title="Dừng"><Square size={13} fill="currentColor" /></button>
              ) : (
                <button type="submit" className="vcc-composer-send" aria-label="Gửi" title="Gửi (Enter)" disabled={question.trim().length < 2}><ArrowUp size={16} /></button>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
};

export default AssistantView;
