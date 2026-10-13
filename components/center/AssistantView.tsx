import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Inbox, Lock, RefreshCcw, Send, Sparkles, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react';
import { WIDGET_ICONS, type CenterPerson, type TodayState } from './TodayView';
import type { DrillTarget } from '../../lib/center/drill';
import type { CenterWidgetId } from '../../lib/center/centerRegistry';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import {
  answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys, type Brief, type BriefLine, type BriefSection,
} from '../../lib/center/assistantBrief';
import { AI_PROVIDER_LABELS, aiErrorMessage, aiGateway, type AiGatewayStatus, type AiRunResult } from '../../lib/aiGateway';

// Tab Trợ lý (lộ trình A1, đợt đầu chỉ đọc): bản tin hôm nay dựng từ cùng số liệu Hôm nay + Việc của tôi; câu hỏi nhanh trả lời
// không cần AI; có khóa AI thì hỏi tự do qua cổng AI (skill center_question) và kể lại bản tin (morning_brief) — AI chỉ đọc đúng các
// dòng số liệu này, mỗi câu trả lời dẫn về chứng từ / màn gốc. Không có nút Gửi / Duyệt nào ở đây.

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
  /** Câu hỏi nhanh: trả bằng các nhóm của bản tin. */
  sections?: BriefSection[];
  /** AI: câu trả lời + dòng số liệu đã dùng (chỉ khóa có thật). */
  answer?: string;
  sources?: BriefLine[];
  runId?: string;
  error?: string;
  feedback?: boolean | null;
}

const SECTION_ICONS: Partial<Record<string, LucideIcon>> = { attention: AlertTriangle, mine: Inbox };
const hhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const Line: React.FC<{ line: BriefLine; onDrill: (target: DrillTarget) => void; onOpenItem: (item: WorkItem) => void }> = ({ line, onDrill, onOpenItem }) => {
  const clickable = !line.locked && (line.item || line.target);
  const open = () => { if (line.item) onOpenItem(line.item); else if (line.target) onDrill(line.target); };
  return (
    <button type="button" className="vcc-brief-line" data-tone={line.tone} data-key={line.key} disabled={!clickable} onClick={open}
      title={line.locked || (line.item ? `Mở ${line.item.code}` : line.target?.title ? `Mở ${line.target.title}` : undefined)}>
      <span className="vcc-brief-label">{line.label}</span>
      <span className="vcc-brief-text">{line.locked && <Lock size={12} className="mr-1 inline-block align-[-1px]" />}{line.text}</span>
      {(line.hint || line.locked) && <span className="vcc-brief-hint">{line.locked || line.hint}</span>}
    </button>
  );
};

const Section: React.FC<{ section: BriefSection; onDrill: (target: DrillTarget) => void; onOpenItem: (item: WorkItem) => void; compact?: boolean }> = ({ section, onDrill, onOpenItem, compact }) => {
  const Icon = SECTION_ICONS[section.id] || WIDGET_ICONS[section.id as CenterWidgetId] || Sparkles;
  return (
    <section className={`vcc-card vcc-brief${compact ? ' vcc-brief-compact' : ''}`} data-section={section.id} aria-label={section.title}>
      <header className="vcc-whead">
        <span className="vcc-wicon"><Icon size={14} /></span>
        <h3 className="vcc-wname vcc-ellipsis flex-1">{section.title}</h3>
        {section.route && section.routeLabel && (
          <button type="button" className="vcc-wlink" onClick={() => onDrill({ kind: 'route', path: section.route!, title: section.routeLabel! })} aria-label={section.routeLabel} title={section.routeLabel}>
            <ArrowUpRight size={15} />
          </button>
        )}
      </header>
      <div className="vcc-brief-lines">{section.lines.map(line => <Line key={line.key} line={line} onDrill={onDrill} onOpenItem={onOpenItem} />)}</div>
    </section>
  );
};

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
}> = ({ now, today, mineCount, active, loadWorkItems, onDrill, onOpenItem, onRetry, hooks = defaultAssistantHooks }) => {
  const [items, setItems] = useState<WorkItem[] | null | 'error'>(null);
  const [itemsAttempt, setItemsAttempt] = useState(0);
  const [ai, setAi] = useState<AiGatewayStatus | null | 'error'>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [narration, setNarration] = useState<{ state: 'idle' | 'pending' | 'done' | 'error'; text?: string; runId?: string; feedback?: boolean | null }>({ state: 'idle' });
  const started = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (!started.current) { started.current = true; hooks.status().then(setAi).catch(() => setAi('error')); }
    let alive = true;
    loadWorkItems('mine').then(page => { if (alive) setItems(page.items); }).catch(() => { if (alive) setItems('error'); });
    return () => { alive = false; };
  }, [active, loadWorkItems, hooks, itemsAttempt]);

  const brief: Brief | null = useMemo(
    () => (today.status === 'ready' ? buildBrief(today.data, items === 'error' ? null : items, now, mineCount) : null),
    [today, items, now, mineCount],
  );
  const projectId = today.status === 'ready' ? today.data.project?.id || null : null;
  const configured = ai !== null && ai !== 'error' && ai.configured;
  const quick = brief ? availableQuickQuestions(brief) : [];

  const refresh = () => { onRetry(); setItemsAttempt(value => value + 1); };

  const askQuick = (id: string, text: string) => {
    if (!brief) return;
    setTurns(current => [{ id: ++seq.current, question: text, state: 'done', sections: answerQuick(brief, id) }, ...current]);
  };

  const askAi = useCallback(async () => {
    const text = question.trim();
    if (!brief || !configured || text.length < 3) return;
    const id = ++seq.current;
    setQuestion('');
    setTurns(current => [{ id, question: text, state: 'pending' }, ...current]);
    const result = await hooks.ask(text, briefFacts(brief), { projectId, tab: 'assistant' }).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    setTurns(current => current.map(turn => turn.id !== id ? turn : result.code === 'OK'
      ? { ...turn, state: 'done', answer: result.result.answer, sources: linesByKeys(brief, result.result.sources || []), runId: result.runId, feedback: null }
      : { ...turn, state: 'done', error: aiErrorMessage(result) }));
  }, [question, brief, configured, hooks, projectId]);

  const narrate = async () => {
    if (!brief || !configured) return;
    setNarration({ state: 'pending' });
    const result = await hooks.narrate(briefFacts(brief), { projectId, tab: 'assistant' }).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    setNarration(result.code === 'OK' ? { state: 'done', text: result.result.brief, runId: result.runId, feedback: null } : { state: 'error', text: aiErrorMessage(result) });
  };

  const feedback = (runId: string | undefined, accepted: boolean, apply: () => void) => { if (runId) hooks.feedback(runId, accepted); apply(); };

  return (
    <div className="vcc-page vcc-assist" data-testid="assistant">
      <div className="vcc-assist-head">
        <div className="min-w-0">
          <h1 className="vcc-hero-hi m-0 text-[22px] font-semibold leading-tight">Bản tin hôm nay</h1>
          <p className="m-0 mt-1 text-xs vcc-muted">
            {briefDateLabel(now)}
            {today.status === 'ready' && hhmm(today.data.generatedAt) ? ` · số liệu lúc ${hhmm(today.data.generatedAt)}` : ''}
            {brief ? ` · ${brief.attention} điểm cần chú ý` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {configured && brief && (
            <button type="button" className="vcc-btn" onClick={narrate} disabled={narration.state === 'pending'} title="AI kể lại bản tin bằng vài câu (chỉ từ số liệu trên màn)">
              <Sparkles size={14} /> {narration.state === 'pending' ? 'Đang viết…' : 'Kể lại bằng lời'}
            </button>
          )}
          <button type="button" className="vcc-btn" onClick={refresh} title="Tải lại số liệu"><RefreshCcw size={14} /> Làm mới</button>
        </div>
      </div>

      {today.status === 'loading' && <p className="text-sm vcc-muted" role="status">Đang tải số liệu…</p>}
      {today.status === 'error' && (
        <div className="vcc-card p-4" role="alert">
          <p className="m-0 font-semibold">Chưa dựng được bản tin</p>
          <p className="m-0 mt-1 text-sm vcc-muted">{today.message}</p>
          <button type="button" className="vcc-btn mt-3" onClick={refresh}>Thử lại</button>
        </div>
      )}

      {narration.state !== 'idle' && (
        <div className={`vcc-narr${narration.state === 'error' ? ' vcc-narr-err' : ''}`} data-testid="narration" aria-live="polite">
          {narration.state === 'pending' ? 'Trợ lý đang viết bản tin…' : narration.text}
          {narration.state === 'done' && (
            <span className="vcc-fb">
              <button type="button" className="vcc-iconbtn" aria-pressed={narration.feedback === true} onClick={() => feedback(narration.runId, true, () => setNarration(n => ({ ...n, feedback: true })))} aria-label="Bản tin đúng" title="Đúng ý"><ThumbsUp size={13} /></button>
              <button type="button" className="vcc-iconbtn" aria-pressed={narration.feedback === false} onClick={() => feedback(narration.runId, false, () => setNarration(n => ({ ...n, feedback: false })))} aria-label="Bản tin chưa đúng" title="Chưa đúng"><ThumbsDown size={13} /></button>
            </span>
          )}
        </div>
      )}

      {brief && (
        <div className="vcc-assist-grid">
          {brief.sections.map(section => <Section key={section.id} section={section} onDrill={onDrill} onOpenItem={onOpenItem} />)}
        </div>
      )}

      <section className="vcc-card vcc-ask" aria-label="Hỏi Trợ lý">
        <header className="vcc-whead">
          <span className="vcc-wicon"><Sparkles size={14} /></span>
          <h3 className="vcc-wname flex-1">Hỏi Trợ lý</h3>
          {ai !== null && (
            <span className="vcc-badge" title={configured ? 'Hỏi tự do qua cổng AI; AI chỉ đọc các dòng số liệu trên màn này' : 'Admin bật khóa AI ở Cài đặt → Cổng AI'}>
              {configured ? `AI · ${AI_PROVIDER_LABELS[(ai as AiGatewayStatus).provider]}` : 'Chưa có khóa AI'}
            </span>
          )}
        </header>
        <div className="vcc-wbody">
          {quick.length > 0 && (
            <div className="vcc-chips" role="group" aria-label="Hỏi nhanh">
              {quick.map(item => <button key={item.id} type="button" className="vcc-chip" onClick={() => askQuick(item.id, item.text)}>{item.text}</button>)}
            </div>
          )}
          <form className="vcc-ask-form" onSubmit={event => { event.preventDefault(); void askAi(); }}>
            <input className="vcc-ask-input" value={question} onChange={event => setQuestion(event.target.value)} disabled={!configured || !brief} aria-label="Câu hỏi"
              placeholder={configured ? 'Hỏi về việc, dự án, vật tư, tiền… của hôm nay' : 'Hỏi tự do cần khóa AI — chọn câu hỏi nhanh ở trên'} maxLength={500} />
            <button type="submit" className="vcc-btn" data-pri="true" disabled={!configured || !brief || question.trim().length < 3}><Send size={14} /> Hỏi</button>
          </form>
          {turns.length > 0 && (
            <div className="vcc-turns" aria-live="polite">
              {turns.map(turn => (
                <div key={turn.id} className="vcc-turn" data-testid="turn">
                  <div className="vcc-turn-q">{turn.question}</div>
                  <div className="vcc-turn-a">
                    {turn.state === 'pending' && <span className="vcc-muted">Trợ lý đang trả lời…</span>}
                    {turn.error && <span className="vcc-danger-text">{turn.error}</span>}
                    {turn.answer && <p className="m-0">{turn.answer}</p>}
                    {turn.sections && turn.sections.map(section => <Section key={section.id} section={section} onDrill={onDrill} onOpenItem={onOpenItem} compact />)}
                    {turn.sources && turn.sources.length > 0 && (
                      <div className="vcc-turn-src" role="group" aria-label="Chứng từ, màn gốc">
                        {turn.sources.map(line => (
                          <button key={line.key} type="button" className="vcc-chip" disabled={Boolean(line.locked) || !(line.item || line.target)}
                            onClick={() => { if (line.item) onOpenItem(line.item); else if (line.target) onDrill(line.target); }} title={line.locked || line.text}>
                            <ArrowUpRight size={12} /> {line.item ? line.item.code : line.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {turn.answer && (
                      <span className="vcc-fb">
                        <button type="button" className="vcc-iconbtn" aria-pressed={turn.feedback === true} aria-label="Trả lời đúng" title="Đúng"
                          onClick={() => feedback(turn.runId, true, () => setTurns(c => c.map(t => t.id === turn.id ? { ...t, feedback: true } : t)))}><ThumbsUp size={13} /></button>
                        <button type="button" className="vcc-iconbtn" aria-pressed={turn.feedback === false} aria-label="Trả lời chưa đúng" title="Chưa đúng"
                          onClick={() => feedback(turn.runId, false, () => setTurns(c => c.map(t => t.id === turn.id ? { ...t, feedback: false } : t)))}><ThumbsDown size={13} /></button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AssistantView;
