import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, Brain, Building2, CalendarCheck, ChevronRight, Package, Wallet, FileSpreadsheet, FileText, History, Loader2, Lock, Paperclip, Plus, RefreshCcw, RotateCcw, Sparkles, Square, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import type { CenterPerson, TodayState } from './TodayView';
import type { DrillTarget } from '../../lib/center/drill';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import {
  answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys, pronounOf, type Brief, type BriefLine,
} from '../../lib/center/assistantBrief';
import { aiErrorMessage, aiGateway, type AiGatewayStatus, type AiRunResult, AI_FEEDBACK_REASONS, type AiFeedbackReason, type MyAiAccess } from '../../lib/aiGateway';
import {
  assistantChat, boldParts, displayText, isTodayThread, suggestionsOf, textBlocks, threadDayLabel, threadTimeLabel,
  type ChatHandlers, type ChatSendInput, type ChatSendResult, type ChatSource, type ChatThread, type ChatThreadSummary, type ChatToolUse,
} from '../../lib/assistantChat';
import { recordTarget } from '../../lib/search/recordPresentation';
import { executeCommand, finishCommand, type AssistantCommand } from '../../lib/assistantCommands';
import AssistantCommandCard, { type CommandActions } from './AssistantCommandCard';
import type { MrFormActions } from '../../lib/assistantMrForm';
import { createPoFormActions, type PoFormActions } from '../../lib/assistantPoForm';
import { defaultDailyLogFormActions, type DailyLogFormActions } from '../../lib/assistantDailyLogForm';
import { displayCode } from '../../lib/center/workItemsService';
import { defaultMemoryActions, type MemoryActions } from '../../lib/aiMemory';
import AssistantMemoryPanel from './AssistantMemoryPanel';
import AssistantModelPicker, { modelForTurn, readStoredModel, storeModel } from './AssistantModelPicker';
import { ACCEPT, addAttachments, attachmentLabel, type ChatAttachment } from '../../lib/assistantFiles';

// Tab Trợ lý v2 · T0 (chủ SP duyệt 17/10/2026): khung chat. Bản tin gọn (câu đầu · Làm trước ≤ 3 · Đáng lo ≤ 3) là khối đầu của hội thoại
// hôm nay; hỏi tiếp được (máy chủ đọc lại các lượt trước), trả lời chạy dần, mở lại từ Lịch sử (chỉ chủ xem, giữ 90 ngày).
// Chỉ đọc: Trợ lý không gửi, duyệt, trả lại, xóa gì — mọi nút chỉ mở chứng từ / màn gốc để người dùng tự làm.

export interface AssistantHooks {
  status: () => Promise<AiGatewayStatus>;
  narrate: (facts: string, context: Record<string, unknown>) => Promise<AiRunResult<{ brief: string }>>;
  feedback: (runId: string, accepted: boolean, detail?: { reason?: AiFeedbackReason | null; note?: string | null }) => void;
  chat: (input: ChatSendInput, handlers: ChatHandlers, signal?: AbortSignal) => Promise<ChatSendResult>;
  listThreads: () => Promise<ChatThreadSummary[]>;
  getThread: (id: string) => Promise<ChatThread>;
  /** T2a: người dùng bấm Xác nhận trên thẻ lệnh nháp → chạy lệnh gửi của module, ghi biên nhận. */
  runCommand: (command: AssistantCommand, edits: { reason?: string }) => Promise<AssistantCommand>;
  cancelCommand: (command: AssistantCommand) => Promise<AssistantCommand>;
  /** Form đề xuất vật tư ngay trong chat (app thật: CenterPage dựng bằng addRequest của app). Không có → thẻ mở form của dự án. */
  mrForm?: MrFormActions;
  /** Form đơn mua trong chat (T2c) — chỉ gọi lệnh máy chủ nên có sẵn trong bản mặc định. */
  poForm?: PoFormActions;
  /** Nhật ký từ báo cáo Zalo trong chat (T2d) — đọc bằng bộ của màn Nhật ký, tạo phiếu nháp. */
  dailyLog?: DailyLogFormActions;
  /** T4b: bảng "Trí nhớ" (xem / quên) + thẻ "nhớ giúp". */
  memory?: MemoryActions;
  /** Trung tâm AI: người dùng đã được cấp Trợ lý chưa, trần câu / ngày. Không có → coi như được dùng (bản cũ). */
  access?: () => Promise<MyAiAccess>;
}
export const defaultAssistantHooks: AssistantHooks = {
  memory: defaultMemoryActions,
  access: () => aiGateway.myAccess(),
  poForm: createPoFormActions(),
  dailyLog: defaultDailyLogFormActions,
  status: () => aiGateway.status(),
  narrate: (facts, context) => aiGateway.run<{ brief: string }>('morning_brief', { facts }, context),
  feedback: (runId, accepted, detail) => aiGateway.feedback(runId, accepted, detail),
  chat: (input, handlers, signal) => assistantChat.send(input, handlers, signal),
  listThreads: () => assistantChat.listThreads(),
  getThread: id => assistantChat.getThread(id),
  runCommand: async (command, edits) => {
    let result: Record<string, unknown>;
    try { result = await executeCommand(command, edits); } catch (e) {
      const message = e instanceof Error ? e.message : 'Chưa gửi được.';
      await finishCommand(command.id, 'failed', {}, message).catch(() => null);
      throw e;
    }
    // Đã gửi thật: ghi biên nhận; ghi lỗi thì vẫn báo đã gửi (chứng từ đã có ở module).
    return (await finishCommand(command.id, 'done', result).catch(() => null)) ?? { ...command, status: 'done', result };
  },
  cancelCommand: async command => (await finishCommand(command.id, 'cancelled')) ?? { ...command, status: 'cancelled' },
};

/** Câu hỏi nhanh dạng thẻ có biểu tượng (học từ màn /ai cũ). */
const QUICK_ICON: Record<string, React.ElementType> = { project: Building2, supply: Package, finance: Wallet, hrm: CalendarCheck };

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: ChatSource[];
  /** T1: công cụ Trợ lý đã tra trong lượt này (chỉ lượt vừa hỏi, không lưu). */
  tools?: ChatToolUse[];
  /** T2a: lệnh nháp (thẻ Xác nhận / biên nhận). */
  commands?: AssistantCommand[];
  runId: string | null;
  accepted: boolean | null;
  /** T4a: đã chọn lý do "chưa đúng" (hiện lời cảm ơn thay hàng lý do). */
  feedbackReason?: AiFeedbackReason;
  /** pending: chờ chữ đầu · streaming: đang chạy · done · error */
  state: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  /** Câu hỏi nhanh: dòng số liệu của nhóm, không qua AI, không lưu. */
  lines?: BriefLine[];
  /** Câu hỏi gốc để Thử lại. */
  question?: string;
  /** T3: tệp gửi kèm câu này (để Thử lại gửi lại đúng tệp). */
  attachments?: ChatAttachment[];
}

const Feedback: React.FC<{ value: boolean | null | undefined; onPick: (accepted: boolean) => void; label: string }> = ({ value, onPick, label }) => (
  <span className="vcc-fb">
    <button type="button" className="vcc-iconbtn" aria-pressed={value === true} onClick={() => onPick(true)} aria-label={`${label} đúng`} title="Đúng"><ThumbsUp size={13} /></button>
    <button type="button" className="vcc-iconbtn" aria-pressed={value === false} onClick={() => onPick(false)} aria-label={`${label} chưa đúng`} title="Chưa đúng"><ThumbsDown size={13} /></button>
  </span>
);

/** T4a: bấm "chưa đúng" → hỏi lý do một chạm (+ ghi chú tùy chọn cho "Khác"); Quản trị AI xem theo skill ở Cài đặt → Cổng AI. */
const DislikeReasons: React.FC<{ picked?: AiFeedbackReason; onPick: (reason: AiFeedbackReason, note?: string) => void }> = ({ picked, onPick }) => {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  if (picked) return <span className="vcc-fb-thanks" role="status">Cảm ơn — Quản trị AI sẽ xem để sửa.</span>;
  return (
    <div className="vcc-fb-reasons" role="group" aria-label="Vì sao chưa đúng">
      <span>Vì sao chưa đúng?</span>
      {AI_FEEDBACK_REASONS.map(r => <button key={r.code} type="button" onClick={() => (r.code === 'other' ? setOther(true) : onPick(r.code))} aria-pressed={r.code === 'other' && other}>{r.label}</button>)}
      {other && <form onSubmit={e => { e.preventDefault(); onPick('other', note); }}>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} aria-label="Ghi chú lý do" placeholder="Điều chưa đúng (tùy chọn)" autoFocus />
        <button type="submit">Gửi</button>
      </form>}
    </div>
  );
};

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
/** "Đang tra tồn kho: thép D16…"; công cụ chuẩn bị lệnh nháp: "Đang chuẩn bị đơn nghỉ phép…". */
/** Tin tối đa 8.000 ký tự (báo cáo Zalo nhiều ngày dán vào để ghi nhật ký) — bằng giới hạn lưu tin của hội thoại. */
const QUESTION_MAX = 8000;
const isPrepareTool = (tool: ChatToolUse) => tool.name.startsWith('chuan_bi_');
const toolStatus = (tool: ChatToolUse) => (isPrepareTool(tool) ? `Đang ${tool.label.toLowerCase()}…`
  : `Đang tra ${tool.label.toLowerCase()}${tool.query ? `: ${tool.query}` : ''}…`);

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
  /** Mở một màn (hồ sơ Trợ lý tìm được) thành tab trong Trung tâm. */
  onOpenRoute?: (route: string, title?: string, state?: unknown) => void;
  hooks?: AssistantHooks;
}> = ({ person, now, today, active, loadWorkItems, onDrill, onOpenItem, onRetry, onOpenRoute, hooks = defaultAssistantHooks }) => {
  const [items, setItems] = useState<WorkItem[] | 'loading' | 'error'>('loading');
  const [itemsAttempt, setItemsAttempt] = useState(0);
  const [ai, setAi] = useState<AiGatewayStatus | null>(null);
  const [narration, setNarration] = useState<{ state: 'idle' | 'pending' | 'done' | 'error'; text?: string; runId?: string; feedback?: boolean | null }>({ state: 'idle' });
  const [thread, setThread] = useState<{ id: string | null; title: string; startedAt: string | null }>({ id: null, title: '', startedAt: null });
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadState, setThreadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [history, setHistory] = useState<{ open: boolean; list: ChatThreadSummary[] | 'loading' | 'error' | null }>({ open: false, list: null });
  const [question, setQuestion] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [access, setAccess] = useState<MyAiAccess | null>(null);
  const [asked, setAsked] = useState(0);
  const [modelId, setModelId] = useState<string | null>(() => readStoredModel());
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const filePicker = useRef<HTMLInputElement | null>(null);
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
    setMemoryOpen(false);
    setHistory(h => ({ ...h, open: false }));
    try {
      const loaded = await hooks.getThread(id);
      setThread({ id: loaded.id, title: loaded.title, startedAt: loaded.messages[0]?.createdAt || loaded.lastMessageAt });
      setMessages(loaded.messages.map(m => ({ id: m.id, role: m.role, content: m.content, sources: m.sources, runId: m.runId, accepted: m.accepted, state: 'done', commands: m.commands })));
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
      hooks.access?.().then(setAccess).catch(() => setAccess(null));
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
  // Cổng AI đã có khóa (Tóm tắt bản tin dùng) + người này được cấp Trợ lý (Trung tâm AI) thì mới hỏi đáp được.
  const aiReady = !!ai?.configured;
  const notGranted = aiReady && access?.assistant === false;
  const configured = aiReady && !notGranted;
  const models = access?.models || [];
  const hasImages = attachments.some(a => a.kind === 'image');
  const turnModel = modelForTurn(models, modelId, hasImages);
  const leftToday = access?.dailyQuestionCap != null ? Math.max(0, access.dailyQuestionCap - access.usedToday - asked) : null;
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
    setMemoryOpen(false);
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

  // Nguồn của câu trả lời → nút: dòng số liệu bản tin (mở như bấm ở bản tin), hồ sơ tìm được (mở đúng màn như Tìm kiếm), việc (mở hồ sơ).
  const sourceChips = (sources: ChatSource[]) => sources.flatMap(source => {
    if (typeof source === 'string') {
      const line = linesByKeys(brief, [source])[0];
      return line ? [{ key: line.key, label: line.item ? line.item.code : line.label, title: line.locked || line.text, disabled: Boolean(line.locked) || !(line.item || line.target), open: () => open(line) }] : [];
    }
    if (source.type === 'work') {
      const item = source.item;
      return [{ key: `w:${item.source}:${item.id}`, label: displayCode(item), title: item.title, disabled: false, open: () => onOpenItem(item) }];
    }
    const record = source.record;
    const label = record.code || record.title || 'Hồ sơ';
    return [{ key: `r:${record.kind}:${record.id}`, label, title: [record.title, record.subtitle].filter(Boolean).join(' · '), disabled: false, open: () => {
      const target = recordTarget(record);
      if (onOpenRoute) onOpenRoute(target.route, label, target.state);
      else onDrill({ kind: 'route', path: target.route, title: label });
    } }];
  });

  const you = pronounOf(person.gender).toLowerCase();
  const commandActions: CommandActions = {
    run: (command, edits) => hooks.runCommand(command, edits),
    cancel: command => hooks.cancelCommand(command),
    openRoute: (route, title) => (onOpenRoute ? onOpenRoute(route, title) : onDrill({ kind: 'route', path: route, title })),
    mrForm: hooks.mrForm,
    poForm: hooks.poForm,
    dailyLog: hooks.dailyLog,
    memory: hooks.memory,
    openMemory: hooks.memory ? () => setMemoryOpen(true) : undefined,
  };

  const askQuick = (id: string, text: string) => {
    pinned.current = true;
    setMessages(current => [...current,
      { id: `q-${++seq.current}`, role: 'user', content: text, sources: [], runId: null, accepted: null, state: 'done' },
      { id: `a-${++seq.current}`, role: 'assistant', content: '', sources: [], runId: null, accepted: null, state: 'done', lines: answerQuick(brief, id) }]);
  };

  const attach = async (files: File[]) => {
    if (!files.length) return;
    setReading(true); setFileErrors([]);
    const out = await addAttachments(attachments, files);
    setAttachments(out.list); setFileErrors(out.errors); setReading(false);
    input.current?.focus();
  };
  const unattach = (id: string) => setAttachments(list => {
    const gone = list.find(a => a.id === id);
    if (gone?.kind === 'image') URL.revokeObjectURL(gone.previewUrl);
    return list.filter(a => a.id !== id);
  });

  const send = async (text: string, retryOf?: string, files: ChatAttachment[] = []) => {
    const typed = text.trim();
    // Chỉ gửi tệp, không gõ gì: câu mặc định (cổng cũng làm vậy) để Trợ lý tóm tắt tệp rồi hỏi cần làm gì.
    const q = typed.length >= 2 ? typed : files.length ? 'Xem tệp đính kèm.' : typed;
    if (!configured || sending || q.length < 2) return;
    const label = attachmentLabel(files);
    // Model của câu này (Trung tâm AI): model đang chọn ở ô hỏi; có ảnh mà model không đọc ảnh → model đọc ảnh được cấp.
    const useModel = modelForTurn(models, modelId, files.some(f => f.kind === 'image')).model?.id ?? null;
    const replyId = `a-${++seq.current}`;
    pinned.current = true;
    setSending(true);
    setMessages(current => [
      ...current.filter(m => m.id !== retryOf),
      ...(retryOf ? [] : [{ id: `q-${++seq.current}`, role: 'user' as const, content: label ? `${q}\n${label}` : q, sources: [], runId: null, accepted: null, state: 'done' as const }]),
      { id: replyId, role: 'assistant', content: '', sources: [], runId: null, accepted: null, state: 'pending', question: q, attachments: files.length ? files : undefined },
    ]);
    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages(current => current.map(m => (m.id === replyId ? fn(m) : m)));
    const controller = new AbortController();
    abort.current = controller;
    const result = await hooks.chat(
      { threadId: thread.id, question: q, facts: briefFacts(brief), pronoun: pronounOf(person.gender),
        context: { ...context, ...(useModel ? { connectionId: useModel } : {}) },
        ...(files.length ? { images: files.flatMap(f => (f.kind === 'image' ? [{ mime: f.mime, b64: f.b64 }] : [])),
          files: files.flatMap(f => (f.kind === 'image' ? [] : [{ name: f.name, text: f.text }])) } : {}) },
      {
        onStart: ({ runId }) => patch(m => ({ ...m, runId })),
        onDelta: delta => patch(m => ({ ...m, state: 'streaming', content: m.content + delta })),
        onTool: tool => patch(m => ({ ...m, tools: [...(m.tools || []), tool] })),
        onCommand: command => patch(m => ({ ...m, commands: [...(m.commands || []), command] })),
      },
      controller.signal,
    ).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    abort.current = null;
    setSending(false);
    if (result.code === 'OK') setAsked(n => n + 1);
    if (result.code === 'OK') {
      // Giữ nguyên id hiển thị (không đổi sang id máy chủ): đổi khóa sẽ dựng lại thẻ lệnh nháp, mất những gì người dùng đang chọn / gõ
      // trên thẻ trong lúc chữ còn chạy (lỗi thấy ở form đơn mua trên điện thoại, 18/10).
      patch(m => ({ ...m, state: 'done', content: result.answer, sources: result.sources, runId: result.runId }));
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
    if ((text.trim().length < 2 && !attachments.length) || reading) return;
    const files = attachments;
    setQuestion(''); setAttachments([]); setFileErrors([]);
    void send(text, undefined, files);
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
          {hooks.memory && (
            <button type="button" className="vcc-btn" onClick={() => { setMemoryOpen(o => !o); setHistory(h => ({ ...h, open: false })); }} aria-pressed={memoryOpen} aria-label="Trí nhớ" title="Trợ lý đã nhớ gì — xem, quên">
              <Brain size={14} /> <span className="vcc-chat-label">Trí nhớ</span>
            </button>
          )}
          <button type="button" className="vcc-btn" onClick={() => { setMemoryOpen(false); toggleHistory(); }} aria-expanded={history.open} aria-haspopup="dialog" title="Hội thoại đã có">
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

      {memoryOpen && hooks.memory && <AssistantMemoryPanel actions={hooks.memory} you={you} onClose={() => setMemoryOpen(false)} />}
      <div className="vcc-chat-scroll" ref={scroller} onScroll={onScroll} style={memoryOpen ? { display: 'none' } : undefined}>
        <div className="vcc-chat-col">
          {isToday ? (
            <BriefCard brief={brief} now={now} items={items} today={today} configured={aiReady} narration={narration}
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
                    {(message.state === 'pending' || (message.state === 'streaming' && !displayText(message.content).trim())) && (
                      <p className="vcc-msg-wait" role="status">{message.tools?.length ? toolStatus(message.tools[message.tools.length - 1]) : 'Đang đọc số liệu…'}</p>
                    )}
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
                    {message.commands && message.commands.length > 0 && (
                      <div className="vcc-cmds">
                        {message.commands.map(command => <AssistantCommandCard key={command.id} command={command} now={now} you={you} actions={commandActions} />)}
                      </div>
                    )}
                    {message.state === 'done' && message.id === messages[messages.length - 1]?.id && (() => {
                      // Gợi ý bấm chỉ ở câu trả lời cuối: bấm là gửi đúng câu đó (chủ SP 18/10 — không bắt gõ lại).
                      // T3: câu trả lời cho lượt có tệp → gửi kèm lại đúng tệp đó (tệp chỉ đi theo từng lượt).
                      const options = suggestionsOf(message.content);
                      return options.length > 0 && (
                        <div className="vcc-suggest" role="group" aria-label="Gợi ý trả lời">
                          {options.map(option => <button key={option} type="button" disabled={sending || !configured} onClick={() => void send(option, undefined, message.attachments)}>{option}</button>)}
                        </div>
                      );
                    })()}
                    {message.state === 'error' && (
                      <p className="vcc-msg-err" role="alert">
                        {message.error}
                        {message.question && <button type="button" className="vcc-link" onClick={() => void send(message.question!, message.id, message.attachments)} disabled={sending}><RotateCcw size={12} /> Thử lại</button>}
                      </p>
                    )}
                    {message.state === 'done' && !message.lines && (() => {
                      const chips = sourceChips(message.sources);
                      return (
                        <div className="vcc-msg-foot">
                          {chips.length > 0 && (
                            <div className="vcc-turn-src" role="group" aria-label="Chứng từ, màn gốc">
                              {chips.map(chip => (
                                <button key={chip.key} type="button" className="vcc-chip" disabled={chip.disabled} onClick={chip.open} title={chip.title}>
                                  <ArrowUpRight size={12} /> {chip.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {message.tools && message.tools.some(t => !isPrepareTool(t)) && (
                            <span className="vcc-msg-tools" title={message.tools.filter(t => !isPrepareTool(t)).map(toolStatus).join('\n')}>
                              Đã tra: {[...new Set(message.tools.filter(t => !isPrepareTool(t)).map(t => t.label))].join(' · ')}
                            </span>
                          )}
                          {message.runId && (
                            <Feedback label="Trả lời" value={message.accepted} onPick={accepted => {
                              sendFeedback(message.runId, accepted);
                              setMessages(c => c.map(m => (m.id === message.id ? { ...m, accepted, feedbackReason: undefined } : m)));
                            }} />
                          )}
                          {message.runId && message.accepted === false && (
                            <DislikeReasons picked={message.feedbackReason} onPick={(reason, note) => {
                              if (message.runId) hooks.feedback(message.runId, false, { reason, note: note || null });
                              setMessages(c => c.map(m => (m.id === message.id ? { ...m, feedbackReason: reason } : m)));
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

      <div className="vcc-chat-foot" style={memoryOpen ? { display: 'none' } : undefined}>
        <div className="vcc-chat-col">
          {showChips && (
            <div className="vcc-quick" role="group" aria-label="Hỏi nhanh">
              {quick.map(q => {
                const Icon = QUICK_ICON[q.id] || Sparkles;
                return <button key={q.id} type="button" className="vcc-quick-card" data-kind={q.id} onClick={() => askQuick(q.id, q.text)}>
                  <span className="vcc-quick-icon" aria-hidden="true"><Icon size={16} /></span><span>{q.text}</span></button>;
              })}
            </div>
          )}
          {notGranted && (
            <p className="vcc-chat-denied" role="status"><Lock size={14} aria-hidden="true" /> Trợ lý AI chưa được cấp cho {you}{access?.admin ? ` — nhờ ${access.admin} cấp ở Trung tâm AI` : ' — nhờ Quản trị AI cấp ở Trung tâm AI'}. Bản tin và các nút bên trên vẫn dùng được.</p>
          )}
          {configured && (
            <>
            {(attachments.length > 0 || reading || fileErrors.length > 0) && (
              <div className="vcc-attach-tray" role="group" aria-label="Tệp đính kèm">
                {attachments.map(a => (
                  <span key={a.id} className="vcc-attach" data-kind={a.kind} title={a.kind === 'image' ? a.name : `${a.kind === 'table' ? `${a.rows} hàng` : `${a.pages} trang`}${a.truncated ? ' · tệp dài, chỉ gửi phần đầu' : ''}`}>
                    {a.kind === 'image' ? <img src={a.previewUrl} alt="" /> : a.kind === 'doc' ? <FileText size={16} aria-hidden="true" /> : <FileSpreadsheet size={16} aria-hidden="true" />}
                    <span className="vcc-attach-name">{a.kind === 'image' ? a.name : a.kind === 'doc' ? `${a.name} · ${a.pages} trang` : `${a.name} · ${a.rows} hàng`}</span>
                    <button type="button" onClick={() => unattach(a.id)} aria-label={`Bỏ tệp ${a.name}`} disabled={sending}>×</button>
                  </span>
                ))}
                {reading && <span className="vcc-attach" data-kind="reading" role="status"><Loader2 size={14} className="animate-spin" /> Đang đọc tệp…</span>}
                {fileErrors.map(e => <span key={e} className="vcc-attach-err" role="alert">{e}</span>)}
                {turnModel.switched && turnModel.model && <span className="vcc-attach-note" role="status">Có ảnh — câu này dùng {turnModel.model.name} (model đang chọn không đọc ảnh).</span>}
              </div>
            )}
            <form className="vcc-composer" data-layout="stack" onSubmit={event => { event.preventDefault(); if (sending) abort.current?.abort(); else submit(); }}
              onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
              onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)); } }}>
              <input ref={filePicker} type="file" accept={ACCEPT} multiple hidden onChange={event => { void attach(Array.from(event.target.files || [])); event.target.value = ''; }} />
              <textarea
                ref={input}
                className="vcc-composer-input"
                value={question}
                rows={1}
                maxLength={QUESTION_MAX}
                aria-label="Câu hỏi"
                placeholder="Hỏi về việc, vật tư, tiền…"
                onChange={event => setQuestion(event.target.value)}
                onPaste={event => {
                  // Dán ảnh chụp màn hình (Zalo, báo giá) thẳng vào ô hỏi.
                  const files = Array.from(event.clipboardData.files || []);
                  if (files.length) { event.preventDefault(); void attach(files); }
                }}
                onKeyDown={event => {
                  // Enter gửi, Shift+Enter xuống dòng; đang gõ dấu tiếng Việt (bộ gõ đang ghép chữ) thì Enter không gửi.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending) submit(); }
                }}
              />
              <div className="vcc-composer-bar">
              <button type="button" className="vcc-composer-attach" onClick={() => filePicker.current?.click()} disabled={sending || reading}
                aria-label="Đính kèm ảnh, PDF hoặc Excel" title="Đính kèm ảnh (báo giá, phiếu, báo cáo), PDF (≤ 50 MB) hoặc Excel / CSV — đọc ngay trên máy"><Paperclip size={17} /></button>
              <span className="vcc-composer-gap" />
              {question.length > QUESTION_MAX - 1000 && <span className="vcc-composer-count" aria-live="polite">{question.length.toLocaleString('vi-VN')}/{QUESTION_MAX.toLocaleString('vi-VN')}</span>}
              {models.length > 0 && <AssistantModelPicker models={models} value={modelId} disabled={sending} onChange={id => { setModelId(id); storeModel(id); }} />}
              {sending ? (
                <button type="submit" className="vcc-composer-send" aria-label="Dừng" title="Dừng"><Square size={13} fill="currentColor" /></button>
              ) : (
                <button type="submit" className="vcc-composer-send" aria-label="Gửi" title="Gửi (Enter)" disabled={reading || (question.trim().length < 2 && !attachments.length)}><ArrowUp size={16} /></button>
              )}
              </div>
            </form>
            {leftToday != null && <p className="vcc-chat-left" data-low={leftToday <= 3 || undefined}>Còn {leftToday} câu hôm nay</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default AssistantView;
