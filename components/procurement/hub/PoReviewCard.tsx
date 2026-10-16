import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Loader2, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { aiErrorMessage, aiGateway, type AiRunResult } from '../../../lib/aiGateway';
import { buildPoReview, poReviewFacts, poReviewService, type PoReview, type PoReviewData } from '../../../lib/procurementPoReview';
import type { ProcurementOrderDetail } from '../../../lib/procurementInboxService';

// Tóm tắt trước khi duyệt Đơn mua (lộ trình AI A1, chủ SP 16/10/2026): điểm "cần xem" tính bằng quy tắc; người duyệt đơn thêm một câu AI (tắt được).

export interface PoReviewHooks {
  load: (poId: string) => Promise<PoReviewData | null>;
  brief: (facts: string, context: Record<string, unknown>) => Promise<AiRunResult<{ sentence: string }>>;
  feedback: (runId: string, accepted: boolean) => void;
}
export const defaultPoReviewHooks: PoReviewHooks = {
  load: id => poReviewService.get(id),
  brief: (facts, context) => aiGateway.run<{ sentence: string }>('po_review_brief', { facts }, context),
  feedback: (runId, accepted) => aiGateway.feedback(runId, accepted),
};

const AI_PREF = 'vioo.poReview.ai';
const readPref = () => { try { return localStorage.getItem(AI_PREF) !== 'off'; } catch { return true; } };
const writePref = (on: boolean) => { try { localStorage.setItem(AI_PREF, on ? 'on' : 'off'); } catch { /* chế độ riêng tư */ } };
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const cacheGet = (key: string) => { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as { sentence: string; runId: string } : null; } catch { return null; } };
const cacheSet = (key: string, v: { sentence: string; runId: string }) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* đầy / riêng tư */ } };
/** Không có AI cho người này / tính năng đang tắt → ẩn dòng AI, thẻ quy tắc vẫn chạy. */
const AI_HIDDEN = new Set(['AI_NOT_CONFIGURED', 'AI_DENIED', 'AI_OFF', 'AI_SKILL_OFF', 'AI_SKILL_UNKNOWN']);

type AiState = { state: 'idle' | 'pending' | 'hidden' } | { state: 'done'; sentence: string; runId: string; feedback: boolean | null } | { state: 'error'; message: string };

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold';

export const PoReviewCard: React.FC<{
  order: ProcurementOrderDetail;
  canApprove: boolean;
  /** Thẻ hiện được (có quyền, tải xong) — màn đơn ẩn băng "vượt dự toán" riêng vì thẻ đã có dòng đó. */
  onShown?: (shown: boolean) => void;
  hooks?: PoReviewHooks;
}> = ({ order, canApprove, onShown, hooks = defaultPoReviewHooks }) => {
  const [data, setData] = useState<PoReviewData | null | 'loading' | 'error' | 'denied'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [aiOn, setAiOn] = useState(readPref);
  const [ai, setAi] = useState<AiState>({ state: 'idle' });

  useEffect(() => {
    let alive = true;
    setData('loading');
    hooks.load(order.id)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setData((e as { code?: string })?.code === '42501' ? 'denied' : 'error'); });
    return () => { alive = false; };
  }, [order.id, order.rowVersion, attempt, hooks]);

  const review: PoReview | null = useMemo(() => (data && typeof data === 'object' ? buildPoReview(data, { overBoqReason: order.proactive?.overBoqReason }) : null), [data, order.proactive?.overBoqReason]);
  useEffect(() => { onShown?.(Boolean(review)); }, [review, onShown]);
  const facts = useMemo(() => (review ? poReviewFacts(review, { poNumber: order.poNumber, vendorName: order.vendorName, total: order.totalAmount }) : ''), [review, order.poNumber, order.vendorName, order.totalAmount]);
  const cacheKey = `po-review-ai:${order.id}:${hash(facts)}`;

  const runAi = useCallback(async (force = false) => {
    if (!facts) return;
    const hit = !force && cacheGet(cacheKey);
    if (hit) { setAi({ state: 'done', sentence: hit.sentence, runId: hit.runId, feedback: null }); return; }
    setAi({ state: 'pending' });
    const r = await hooks.brief(facts, { screen: 'po_review', poId: order.id }).catch(e => ({ code: 'AI_FAILED' as const, error: e instanceof Error ? e.message : String(e) }));
    if (r.code === 'OK' && r.result.sentence) { cacheSet(cacheKey, { sentence: r.result.sentence, runId: r.runId }); setAi({ state: 'done', sentence: r.result.sentence, runId: r.runId, feedback: null }); }
    else if (r.code !== 'OK' && AI_HIDDEN.has(r.code)) setAi({ state: 'hidden' });
    else setAi({ state: 'error', message: r.code === 'OK' ? 'AI chưa trả lời được.' : aiErrorMessage(r) });
  }, [facts, cacheKey, hooks, order.id]);

  // Đơn sạch thì nhãn "Không thấy điểm bất thường" đã đủ — không gọi AI nhắc lại.
  const needCount = review?.needs.length ?? 0;
  useEffect(() => { if (canApprove && aiOn && facts && needCount > 0) void runAi(); else setAi({ state: 'idle' }); }, [canApprove, aiOn, facts, needCount, runAi]);

  if (data === 'denied' || data === null) return null;
  if (data === 'loading') return <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground" aria-live="polite">
    <Loader2 size={15} className="animate-spin text-teal-600" />Đang kiểm tra đơn…</p>;
  if (data === 'error' || !review) return <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
    <AlertTriangle size={15} className="text-amber-600" />Chưa kiểm tra được đơn này.
    <button type="button" onClick={() => setAttempt(a => a + 1)} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">Thử lại</button></p>;

  const warnCount = review.needs.filter(n => n.level === 'warn').length;
  const setPref = (on: boolean) => { writePref(on); setAiOn(on); };
  return <section aria-label="Trước khi duyệt" data-testid="po-review" className="space-y-2.5 rounded-2xl border border-border bg-card p-3 sm:p-4">
    <header className="flex items-center gap-2">
      <h3 className="font-semibold text-foreground">Trước khi duyệt</h3>
      {review.needs.length > 0
        ? <span className={`${chip} ${warnCount ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'border-border bg-muted text-muted-foreground'}`}>Cần xem {review.needs.length}</span>
        : <span className={`${chip} border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200`}><CheckCircle2 size={12} />Không thấy điểm bất thường</span>}
      {canApprove && !aiOn && review.needs.length > 0 && <button type="button" onClick={() => setPref(true)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"><Sparkles size={12} />Bật tóm tắt AI</button>}
    </header>

    {canApprove && aiOn && ai.state !== 'idle' && ai.state !== 'hidden' && <div data-testid="po-review-ai" aria-live="polite"
      className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-xl border-l-[3px] border-l-teal-500 bg-teal-50/60 px-3 py-2 text-sm dark:bg-teal-950/20">
      <Sparkles size={14} className="mt-0.5 shrink-0 text-teal-600" />
      <p className="min-w-0 flex-1 basis-[16rem] text-foreground">
        {ai.state === 'pending' && <span className="text-muted-foreground">AI đang tóm tắt…</span>}
        {ai.state === 'done' && ai.sentence}
        {ai.state === 'error' && <span className="text-muted-foreground">{ai.message} <button type="button" onClick={() => void runAi(true)} className="inline-flex items-center gap-0.5 font-semibold text-teal-700 hover:underline dark:text-teal-300"><RefreshCw size={11} />Thử lại</button></span>}
      </p>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {ai.state === 'done' && ([true, false] as const).map(accepted => {
          const Icon = accepted ? ThumbsUp : ThumbsDown;
          return <button key={String(accepted)} type="button" aria-pressed={ai.feedback === accepted} title={accepted ? 'Đúng' : 'Chưa đúng'} aria-label={accepted ? 'Tóm tắt đúng' : 'Tóm tắt chưa đúng'}
            onClick={() => { hooks.feedback(ai.runId, accepted); setAi({ ...ai, feedback: accepted }); }}
            className={`rounded-md p-1 hover:bg-card ${ai.feedback === accepted ? 'text-teal-700 dark:text-teal-300' : 'text-muted-foreground'}`}><Icon size={13} /></button>;
        })}
        <button type="button" onClick={() => setPref(false)} title="Tắt tóm tắt AI" aria-label="Tắt tóm tắt AI" className="rounded-md p-1 text-muted-foreground hover:bg-card"><X size={13} /></button>
      </span>
    </div>}

    {review.needs.length > 0 && <ul className="space-y-1">
      {review.needs.map(n => {
        const body = <>
          {n.level === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" /> : <Circle size={8} className="mt-1.5 shrink-0 fill-current text-slate-400" />}
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.href && <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
        </>;
        const cls = `flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${n.level === 'warn' ? 'text-foreground' : 'text-muted-foreground'}`;
        return <li key={n.key}>{n.href ? <a href={n.href} className={`${cls} hover:bg-muted`}>{body}</a> : <div className={cls}>{body}</div>}</li>;
      })}
    </ul>}

    {(review.ok.length > 0 || review.unknown.length > 0) && <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {review.ok.length > 0 && <span className="font-semibold text-muted-foreground">Ổn</span>}
      {review.ok.map(o => <span key={o.key} className={`${chip} border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200`}>{o.text}</span>)}
      {review.unknown.map(o => <span key={o.key} title="Chưa đủ dữ liệu để kiểm" className={`${chip} border-dashed border-border bg-muted/50 text-muted-foreground`}>{o.text}</span>)}
    </div>}
  </section>;
};
