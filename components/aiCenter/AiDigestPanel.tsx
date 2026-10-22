import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Bell, CheckCircle2, Loader2, RefreshCcw, Send } from 'lucide-react';
import { StateBox, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { mondayOf, type AiDigest, type AiDigestPick } from '../../lib/aiAdmin';

// Trung tâm AI · Bản tin tuần (B4, chủ SP 22/10/2026): Thứ Hai 7h máy chủ gộp tín hiệu tuần trước thành tối đa 3 việc nên làm và gửi mọi Admin
// (app + web push). Ở đây Admin đọc lại bản tin, xem đủ tín hiệu phía sau, dựng thử tuần đang chạy, hoặc gửi ngay. Không gọi model.

const nf = new Intl.NumberFormat('vi-VN');
const ddmm = (iso: string) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const when = (iso: string | null) => { if (!iso) return null; const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ddmm(iso)}` : null; };

const Pick: React.FC<{ pick: AiDigestPick; index: number; onOpen: (route: string) => void }> = ({ pick, index, onOpen }) => (
  <li className={`flex gap-3 rounded-xl border px-3 py-2.5 ${pick.score >= 85 ? 'border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30' : 'border-border bg-card'}`}>
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">{index + 1}</span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-foreground">{pick.title}</p>
      {pick.detail && <p className="mt-0.5 text-xs text-muted-foreground">{pick.detail}</p>}
    </div>
    {pick.link && <button type="button" onClick={() => onOpen(pick.link!)} className="shrink-0 self-center rounded-lg px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300" title={pick.link}><ArrowUpRight size={14} className="inline" /> Mở</button>}
  </li>
);

const Stat: React.FC<{ label: string; value: number | string; tone?: 'warn' | 'ok' }> = ({ label, value, tone }) => (
  <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={`text-sm font-bold ${tone === 'warn' ? 'text-rose-700 dark:text-rose-300' : tone === 'ok' ? 'text-leaf-700 dark:text-leaf-300' : 'text-foreground'}`}>{typeof value === 'number' ? nf.format(value) : value}</p>
  </div>
);

const Signals: React.FC<{ d: AiDigest }> = ({ d }) => {
  const a = d.assistant; const f = d.feedback; const s = d.stale;
  const jevPct = a.jev.auto > 0 ? Math.round((100 * a.jev.autoAgree) / a.jev.auto) : null;
  const group = (title: string, items: Array<{ label: string; value: number | string; tone?: 'warn' | 'ok' }>) => (
    <div key={title}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{items.map(i => <Stat key={i.label} {...i} />)}</div>
    </div>
  );
  return (
    <div className="space-y-3" aria-label="Tín hiệu tuần">
      {group('Trợ lý', [{ label: 'Câu hỏi', value: a.questions }, { label: 'Người hỏi', value: `${a.askers}/${a.granted}` }, { label: 'Lỗi', value: a.errors, tone: a.errors > 0 ? 'warn' : 'ok' }, { label: 'Bị chê 👎', value: a.dislikes, tone: a.dislikes > 0 ? 'warn' : undefined },
        { label: 'Từ chối', value: a.refusals }, { label: 'Chậm > 30 s', value: a.slow, tone: a.slow > 0 ? 'warn' : undefined }, { label: 'Thẻ nháp gửi / bỏ dở', value: `${a.commands.done} / ${a.commands.expired}` }, { label: 'Chi phí', value: `$${a.costUsd.toFixed(2)}` }])}
      {group('Góp ý · sự cố', [{ label: 'Mới trong tuần', value: f.new, tone: f.new > 0 ? 'warn' : undefined }, { label: 'Từ Trợ lý', value: f.fromAssistant }, { label: 'Đang mở', value: f.open }, { label: 'Cũ nhất (ngày)', value: f.oldestOpenDays ?? '—' }])}
      {group('Việc treo · nháp bỏ dở', [{ label: 'Phép chờ > 3 ngày', value: s.leavePending3d, tone: s.leavePending3d > 0 ? 'warn' : undefined }, { label: 'Quy trình > 7 ngày', value: s.wfRunningStale7d }, { label: 'Yêu cầu chờ > 3 ngày', value: s.requestPending3d }, { label: 'Phiếu giao chưa nhận', value: s.captureUnreceived3d, tone: s.captureUnreceived3d > 0 ? 'warn' : undefined },
        { label: 'Đơn mua nháp', value: s.poDraft7d }, { label: 'Yêu cầu nháp', value: s.requestDraft7d }, { label: 'Nhật ký nháp', value: s.dailyLogDraft3d }, { label: 'Jev khớp (auto)', value: jevPct == null ? '—' : `${jevPct} %` }])}
      {a.idle.length > 0 && <p className="text-xs text-muted-foreground">Chưa hỏi Trợ lý tuần này ({a.idleCount}): {a.idle.join(', ')}{a.idleCount > a.idle.length ? '…' : ''}</p>}
    </div>
  );
};

const AiDigestPanel: React.FC<{ list?: () => Promise<AiDigest[]>; run?: (weekStart: string | null, send: boolean) => Promise<AiDigest>; onOpenRoute: (route: string) => void;
  confirm: (opts: { title: string; targetName: string; message: string; confirmText: string }) => Promise<boolean>; notify: (text: string, kind?: 'success' | 'error') => void; now?: Date }> = ({ list, run, onOpenRoute, confirm, notify, now = new Date() }) => {
  const [items, setItems] = useState<AiDigest[] | 'loading' | 'error'>('loading');
  const [busy, setBusy] = useState<null | 'preview' | 'send'>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { if (!list) { setItems([]); return; } setItems('loading'); list().then(setItems, () => setItems('error')); };
  useEffect(load, [list]);
  const thisMonday = mondayOf(now);
  const upsert = (d: AiDigest) => setItems(cur => (Array.isArray(cur) ? [d, ...cur.filter(x => x.weekStart !== d.weekStart)].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) : [d]));
  const preview = async () => {
    if (!run) return; setBusy('preview');
    try { const d = await run(thisMonday, false); upsert(d); setOpen(d.weekStart); notify(`Đã dựng bản tin tuần ${ddmm(d.weekStart)}–${ddmm(d.weekEnd)} (chưa gửi).`); } catch (e) { notify(e instanceof Error ? e.message : 'Chưa dựng được bản tin.', 'error'); } finally { setBusy(null); }
  };
  const send = async (d: AiDigest) => {
    if (!run) return;
    if (!(await confirm({ title: 'Gửi bản tin cho mọi Admin?', targetName: `Tuần ${ddmm(d.weekStart)}–${ddmm(d.weekEnd)} · ${d.picks.length} việc`, message: 'Mỗi Admin nhận một thông báo (app + web push). Mỗi tuần chỉ gửi một lần.', confirmText: 'Gửi ngay' }))) return;
    setBusy('send');
    try { const sent = await run(d.weekStart, true); upsert(sent); notify(sent.recipients > 0 ? `Đã gửi ${sent.recipients} Admin.` : 'Tuần này đã gửi trước đó — không gửi lại.'); } catch (e) { notify(e instanceof Error ? e.message : 'Chưa gửi được.', 'error'); } finally { setBusy(null); }
  };

  if (items === 'loading') return <StateBox kind="loading" title="Đang tải bản tin…" />;
  if (items === 'error') return <StateBox kind="error" title="Chưa tải được bản tin" message="Thử lại sau." onRetry={load} />;
  const latest = items[0] ?? null;
  const rest = items.slice(1);
  return (
    <section role="tabpanel" aria-label="Bản tin tuần" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground"><Bell size={12} className="mr-1 inline" />Tự gửi mọi Admin <b>Thứ Hai 07:00</b> (tuần vừa qua), app + web push. Việc xếp theo luật từ tín hiệu tuần, không gọi model.</p>
        {run && <button type="button" className={secondaryBtn} onClick={() => void preview()} disabled={Boolean(busy)}>{busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Dựng thử tuần này</button>}
      </div>
      {!latest && <StateBox kind="empty" title="Chưa có bản tin nào" message="Bản tin đầu tiên gửi vào Thứ Hai tới; bấm Dựng thử tuần này để xem ngay." />}
      {latest && (
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label={`Bản tin tuần ${ddmm(latest.weekStart)}–${ddmm(latest.weekEnd)}`}>
          <header className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-foreground">Tuần {ddmm(latest.weekStart)} – {ddmm(latest.weekEnd)}</h3>
            {latest.sentAt ? <span className="inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2 py-0.5 text-xs font-semibold text-leaf-700 dark:bg-leaf-950/40 dark:text-leaf-300"><CheckCircle2 size={12} /> Đã gửi {latest.recipients} Admin · {when(latest.sentAt)}</span>
              : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Chưa gửi · dựng {when(latest.generatedAt)}</span>}
            {!latest.sentAt && run && <button type="button" className={`${primaryBtn} ml-auto`} onClick={() => void send(latest)} disabled={Boolean(busy)}>{busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gửi Admin ngay</button>}
          </header>
          {latest.picks.length ? (
            <ol className="space-y-2" aria-label="Việc nên làm">{latest.picks.map((p, i) => <Pick key={p.key} pick={p} index={i} onOpen={onOpenRoute} />)}</ol>
          ) : <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"><CheckCircle2 size={15} className="text-leaf-600" /> Tuần yên: không có việc cần làm ngay.</p>}
          <details className="mt-3 group">
            <summary className="cursor-pointer text-xs font-semibold text-teal-700 dark:text-teal-300">Tín hiệu phía sau</summary>
            <div className="mt-2"><Signals d={latest} /></div>
          </details>
        </article>
      )}
      {rest.length > 0 && (
        <section aria-label="Bản tin trước">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tuần trước</p>
          <ul className="space-y-1.5">
            {rest.map(d => (
              <li key={d.weekStart} className="rounded-xl border border-border bg-card">
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(open === d.weekStart ? null : d.weekStart)} aria-expanded={open === d.weekStart}>
                  <span className="text-sm font-semibold text-foreground">Tuần {ddmm(d.weekStart)} – {ddmm(d.weekEnd)}</span>
                  <span className="text-xs text-muted-foreground">{d.picks.length} việc · {d.sentAt ? `đã gửi ${d.recipients} Admin` : 'chưa gửi'}</span>
                  {d.picks[0]?.score >= 85 && <AlertTriangle size={13} className="text-amber-600" aria-label="Có việc gấp" />}
                </button>
                {open === d.weekStart && <div className="border-t border-border px-3 py-2"><ol className="space-y-1.5">{d.picks.map((p, i) => <Pick key={p.key} pick={p} index={i} onOpen={onOpenRoute} />)}</ol><div className="mt-2"><Signals d={d} /></div></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
};

export default AiDigestPanel;
