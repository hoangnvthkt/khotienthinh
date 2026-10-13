import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, RefreshCcw, Send, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { CenterPerson, TodayState } from './TodayView';
import type { DrillTarget } from '../../lib/center/drill';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import {
  answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys, type BriefLine,
} from '../../lib/center/assistantBrief';
import { aiErrorMessage, aiGateway, type AiGatewayStatus, type AiRunResult } from '../../lib/aiGateway';

// Tab Trợ lý — bản tin sáng gọn (chủ SP 13/10): một câu tóm tắt · Làm trước (≤ 3 việc) · Đáng lo (≤ 3 điều) · Hỏi.
// Không lặp số liệu của Hôm nay / Bảng điều khiển; số theo nhóm chỉ hiện khi người dùng hỏi. Chỉ đọc, không nút Gửi / Duyệt.

export interface CenterAnswer { answer: string; sources: string[] }
export interface AssistantHooks {
  status: () => Promise<AiGatewayStatus>;
  ask: (question: string, facts: string, context: Record<string, unknown>) => Promise<AiRunResult<CenterAnswer>>;
  narrate: (facts: string, context: Record<string, unknown>) => Promise<AiRunResult<{ brief: string }>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultAssistantHooks: AssistantHooks = {
  status: () => aiGateway.status(),
  ask: (question, facts, context) => aiGateway.run<CenterAnswer>('center_question', { question, facts }, context),
  narrate: (facts, context) => aiGateway.run<{ brief: string }>('morning_brief', { facts }, context),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};

interface Turn {
  id: number;
  question: string;
  state: 'pending' | 'done';
  /** Hỏi nhanh: các dòng số liệu của nhóm. */
  lines?: BriefLine[];
  answer?: string;
  sources?: BriefLine[];
  runId?: string;
  error?: string;
  feedback?: boolean | null;
}

const Feedback: React.FC<{ value: boolean | null | undefined; onPick: (accepted: boolean) => void; label: string }> = ({ value, onPick, label }) => (
  <span className="vcc-fb">
    <button type="button" className="vcc-iconbtn" aria-pressed={value === true} onClick={() => onPick(true)} aria-label={`${label} đúng`} title="Đúng"><ThumbsUp size={13} /></button>
    <button type="button" className="vcc-iconbtn" aria-pressed={value === false} onClick={() => onPick(false)} aria-label={`${label} chưa đúng`} title="Chưa đúng"><ThumbsDown size={13} /></button>
  </span>
);

const AssistantView: React.FC<{
  person: CenterPerson;
  now: Date;
  today: TodayState;
  mineCount: number | null;
  /** Tab đang hiện: lần đầu hiện mới tải Việc của tôi và tình trạng AI. */
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
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [narration, setNarration] = useState<{ state: 'idle' | 'pending' | 'done' | 'error'; text?: string; runId?: string; feedback?: boolean | null }>({ state: 'idle' });
  const started = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (!started.current) { started.current = true; hooks.status().then(setAi).catch(() => setAi(null)); }
    let alive = true;
    loadWorkItems('mine').then(page => { if (alive) setItems(page.items); }).catch(() => { if (alive) setItems('error'); });
    return () => { alive = false; };
  }, [active, loadWorkItems, hooks, itemsAttempt]);

  const todayData = today.status === 'ready' ? today.data : null;
  const brief = useMemo(
    () => buildBrief(todayData, Array.isArray(items) ? items : null, now, person.gender),
    [todayData, items, now, person.gender],
  );
  const configured = !!ai?.configured;
  const quick = availableQuickQuestions(brief);
  const context = { projectId: todayData?.project?.id || null, tab: 'assistant' };
  const open = (line: Pick<BriefLine, 'item' | 'target' | 'locked'>) => {
    if (line.locked) return;
    if (line.item) onOpenItem(line.item); else if (line.target) onDrill(line.target);
  };
  const refresh = () => { onRetry(); setItems('loading'); setItemsAttempt(value => value + 1); };

  const askQuick = (id: string, text: string) =>
    setTurns(current => [{ id: ++seq.current, question: text, state: 'done', lines: answerQuick(brief, id) }, ...current]);

  const askAi = useCallback(async () => {
    const text = question.trim();
    if (!configured || text.length < 3) return;
    const id = ++seq.current;
    setQuestion('');
    setTurns(current => [{ id, question: text, state: 'pending' }, ...current]);
    const result = await hooks.ask(text, briefFacts(brief), context).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    setTurns(current => current.map(turn => turn.id !== id ? turn : result.code === 'OK'
      ? { ...turn, state: 'done', answer: result.result.answer, sources: linesByKeys(brief, result.result.sources || []), runId: result.runId, feedback: null }
      : { ...turn, state: 'done', error: aiErrorMessage(result) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, brief, configured, hooks]);

  const narrate = async () => {
    setNarration({ state: 'pending' });
    const result = await hooks.narrate(briefFacts(brief), context).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    setNarration(result.code === 'OK' ? { state: 'done', text: result.result.brief, runId: result.runId, feedback: null } : { state: 'error', text: aiErrorMessage(result) });
  };
  const sendFeedback = (runId: string | undefined, accepted: boolean) => { if (runId) hooks.feedback(runId, accepted); };

  return (
    <section className="vcc-page vcc-assist" data-testid="assistant" aria-label="Bản tin hôm nay">
      <header className="vcc-brief-top">
        <div className="min-w-0">
          <p className="vcc-brief-date">{briefDateLabel(now)}</p>
          <h1 className="vcc-brief-head">{items === 'loading' ? 'Đang tải việc của bạn…' : brief.headline}</h1>
        </div>
        <div className="vcc-brief-tools">
          {configured && (
            <button type="button" className="vcc-btn" onClick={narrate} disabled={narration.state === 'pending'} title="AI viết bản tin vài câu từ số liệu trên màn">
              <Sparkles size={14} /> {narration.state === 'pending' ? 'Đang viết…' : 'Tóm tắt'}
            </button>
          )}
          <button type="button" className="vcc-iconbtn" onClick={refresh} aria-label="Làm mới" title="Làm mới"><RefreshCcw size={15} /></button>
        </div>
      </header>

      {narration.state !== 'idle' && (
        <div className={`vcc-narr${narration.state === 'error' ? ' vcc-narr-err' : ''}`} data-testid="narration" aria-live="polite">
          {narration.state === 'pending' ? 'Đang viết…' : narration.text}
          {narration.state === 'done' && <Feedback label="Bản tin" value={narration.feedback} onPick={accepted => { sendFeedback(narration.runId, accepted); setNarration(n => ({ ...n, feedback: accepted })); }} />}
        </div>
      )}

      <section className="vcc-card" aria-label="Làm trước">
        <div className="vcc-sec-head">
          <h2 className="vcc-sec-title">Làm trước</h2>
          {brief.total !== null && brief.total > 0 && <span className="vcc-sec-count">{brief.total} việc chờ</span>}
        </div>
        {items === 'loading' && <p className="vcc-brief-empty" role="status">Đang tải…</p>}
        {items === 'error' && (
          <p className="vcc-brief-empty" role="alert">Chưa đọc được Việc của tôi · <button type="button" className="vcc-link" onClick={refresh}>Thử lại</button></p>
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
          <p className="vcc-brief-empty" role="alert">Chưa đọc được số liệu dự án · <button type="button" className="vcc-link" onClick={refresh}>Thử lại</button></p>
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

      {(quick.length > 0 || configured) && (
        <section className="vcc-card" aria-label="Hỏi Trợ lý">
          <div className="vcc-sec-head"><h2 className="vcc-sec-title">Hỏi Trợ lý</h2></div>
          <div className="vcc-ask">
            {configured && (
              <form className="vcc-ask-form" onSubmit={event => { event.preventDefault(); void askAi(); }}>
                <input className="vcc-ask-input" value={question} onChange={event => setQuestion(event.target.value)} aria-label="Câu hỏi"
                  placeholder="Hỏi về việc, dự án, vật tư, tiền… hôm nay" maxLength={500} />
                <button type="submit" className="vcc-btn" data-pri="true" disabled={question.trim().length < 3}><Send size={14} /> Hỏi</button>
              </form>
            )}
            {quick.length > 0 && (
              <div className="vcc-chips" role="group" aria-label="Hỏi nhanh">
                {quick.map(q => <button key={q.id} type="button" className="vcc-chip" onClick={() => askQuick(q.id, q.text)}>{q.text}</button>)}
              </div>
            )}
            {turns.map(turn => (
              <div key={turn.id} className="vcc-turn" data-testid="turn">
                <div className="vcc-turn-q">{turn.question}</div>
                {turn.state === 'pending' && <p className="m-0 mt-1 text-sm vcc-muted">Đang trả lời…</p>}
                {turn.error && <p className="m-0 mt-1 text-sm vcc-danger-text">{turn.error}</p>}
                {turn.answer && <p className="vcc-turn-a">{turn.answer}</p>}
                {turn.lines && (
                  <ul className="vcc-qlines">
                    {turn.lines.map(line => (
                      <li key={line.key}>
                        <button type="button" className="vcc-qline" data-tone={line.tone} disabled={Boolean(line.locked) || !(line.item || line.target)} onClick={() => open(line)} title={line.locked || line.hint}>
                          <span className="vcc-qline-label">{line.label}</span>
                          <span className="vcc-qline-text">{line.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {turn.sources && turn.sources.length > 0 && (
                  <div className="vcc-turn-src" role="group" aria-label="Chứng từ, màn gốc">
                    {turn.sources.map(line => (
                      <button key={line.key} type="button" className="vcc-chip" disabled={Boolean(line.locked) || !(line.item || line.target)} onClick={() => open(line)} title={line.locked || line.text}>
                        <ArrowUpRight size={12} /> {line.item ? line.item.code : line.label}
                      </button>
                    ))}
                  </div>
                )}
                {turn.answer && <Feedback label="Trả lời" value={turn.feedback} onPick={accepted => { sendFeedback(turn.runId, accepted); setTurns(c => c.map(t => t.id === turn.id ? { ...t, feedback: accepted } : t)); }} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
};

export default AssistantView;
