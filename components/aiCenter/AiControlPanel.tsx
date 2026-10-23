import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BellRing, CheckCircle2, ChevronDown, ChevronRight, Clock, Info, Loader2, RefreshCcw, RotateCcw, ShieldCheck } from 'lucide-react';
import { StateBox, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { controlErrorMessage, controlTotals, type ControlFinding, type ControlOverview, type ControlRule, type ControlService, type ControlSeverity } from '../../lib/controlFindings';

// Kiểm soát (K0–K1, chủ SP 22–23/10/2026): bộ luật máy chủ chạy 15 phút một lượt tìm lệch dữ liệu Mua hàng → Kho → Công nợ → Đề xuất
// (không gọi AI); hết lệch thì tự đóng. Admin (Trung tâm AI → Kiểm soát) thấy hết, bật "Báo người xử lý" từng luật, chạy lại. Người xử lý /
// trưởng bộ phận (/kiem-soat) chỉ thấy lệch của mình ở luật đã bật; trưởng bộ phận, Quản trị phân hệ, Admin chấp nhận lệch có lý do.

type View = 'new' | 'legacy' | 'accepted' | 'resolved';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'new', label: 'Lệch mới' }, { key: 'legacy', label: 'Dữ liệu cũ' }, { key: 'accepted', label: 'Đã chấp nhận' }, { key: 'resolved', label: 'Đã đóng' },
];
const nf = new Intl.NumberFormat('vi-VN');
const money = (v: number | null) => (v == null ? null : `${nf.format(Math.round(v))} đ`);
const ddmm = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const two = (n: number) => String(n).padStart(2, '0');
/** "10:15 23/10" theo giờ máy người xem. */
const hhmm = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${two(d.getHours())}:${two(d.getMinutes())} ${two(d.getDate())}/${two(d.getMonth() + 1)}` : ''; };
const SEV_STYLE: Record<ControlSeverity, string> = {
  P0: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
  P1: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900',
  P2: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
};
const SEV_TITLE: Record<ControlSeverity, string> = { P0: 'P0 — sai tiền hoặc tồn kho', P1: 'P1 — lệch số hiển thị / truy vết', P2: 'P2 — thói quen, cần lý do' };

const Kpi: React.FC<{ label: string; value: number; active: boolean; onClick: () => void; warn?: number; title?: string }> = ({ label, value, active, onClick, warn, title }) => (
  <button type="button" onClick={onClick} aria-pressed={active} title={title}
    className={`flex min-w-[120px] flex-1 flex-col items-start rounded-xl border px-3 py-2 text-left transition ${active ? 'border-teal-600 bg-teal-50/70 dark:border-teal-500 dark:bg-teal-950/30' : 'border-border bg-card hover:border-teal-300'}`}>
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="flex items-baseline gap-1.5"><span className="text-xl font-bold text-leaf-700 dark:text-leaf-300">{nf.format(value)}</span>
      {warn ? <span className="rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{warn} P0</span> : null}</span>
  </button>
);

const FindingRow: React.FC<{ f: ControlFinding; onOpen: (route: string) => void; onAccept: (f: ControlFinding, reason: string) => Promise<boolean>; onReopen: (f: ControlFinding) => Promise<void> }> = ({ f, onOpen, onAccept, onReopen }) => {
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); const ok = await onAccept(f, reason.trim()); setBusy(false); if (ok) { setAccepting(false); setReason(''); } };
  return (
    <li className="px-3 py-2.5" data-finding={f.id}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{f.title}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {f.projectName && <span>{f.projectName}</span>}
            {f.happenedOn && <span>{ddmm(f.happenedOn)}</span>}
            {f.amount != null && f.amount !== 0 && <span className="font-semibold text-foreground">Chênh {money(Math.abs(f.amount))}</span>}
            {f.status === 'accepted' && <span title={f.acceptedReason || undefined}>Chấp nhận{f.acceptedBy ? ` · ${f.acceptedBy}` : ''}: {f.acceptedReason}</span>}
            {f.status === 'resolved' && f.resolvedAt && <span>Tự đóng {ddmm(f.resolvedAt)}</span>}
            {f.assignees.length > 0 && f.status === 'open' && <span title="Người xử lý">Xử lý: {f.assignees.slice(0, 3).join(', ')}{f.assignees.length > 3 ? ` +${f.assignees.length - 3}` : ''}</span>}
            {f.escalated && <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 dark:text-amber-300" title="Quá 3 ngày chưa xử lý — đã báo trưởng bộ phận"><Clock size={11} /> Quá 3 ngày</span>}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {f.link && <button type="button" onClick={() => onOpen(f.link!)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40" title={f.link}><ArrowUpRight size={14} /> Mở</button>}
          {f.status === 'open' && f.canAccept && !accepting && <button type="button" onClick={() => setAccepting(true)} className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted" title="Lệch có lý do chính đáng — ghi lý do, không tính là đang mở">Chấp nhận</button>}
          {f.status === 'accepted' && f.canAccept && <button type="button" onClick={() => { setBusy(true); void onReopen(f).finally(() => setBusy(false)); }} disabled={busy} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"><RotateCcw size={13} /> Mở lại</button>}
        </div>
      </div>
      {accepting && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Lý do chấp nhận (ít nhất 10 ký tự)" aria-label="Lý do chấp nhận"
            onKeyDown={e => { if (e.key === 'Enter' && reason.trim().length >= 10) void submit(); if (e.key === 'Escape') setAccepting(false); }}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-teal-600 focus:outline-none" />
          <div className="flex gap-1.5">
            <button type="button" className={primaryBtn} onClick={() => void submit()} disabled={busy || reason.trim().length < 10}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Chấp nhận</button>
            <button type="button" className={secondaryBtn} onClick={() => { setAccepting(false); setReason(''); }} disabled={busy}>Hủy</button>
          </div>
        </div>
      )}
    </li>
  );
};

const RuleGroup: React.FC<{ rule: ControlRule; items: ControlFinding[]; open: boolean; onToggle: () => void; onSetMode?: (rule: ControlRule) => void } & Omit<React.ComponentProps<typeof FindingRow>, 'f'>> = ({ rule, items, open, onToggle, onSetMode, ...rowProps }) => {
  const total = items.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0);
  const live = rule.mode === 'live';
  return (
    <li className="rounded-xl border border-border bg-card" data-rule={rule.code}>
      <div className="flex items-center">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
        {open ? <ChevronDown size={16} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={16} className="shrink-0 text-muted-foreground" />}
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ${SEV_STYLE[rule.severity]}`} title={SEV_TITLE[rule.severity]}>{rule.severity}</span>
        <span className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold text-foreground sm:truncate" title={`${rule.title}\n${rule.principle}`}>{rule.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{rule.module}</span>
        {total > 0 && <span className="hidden shrink-0 text-xs font-semibold text-foreground sm:inline">{money(total)}</span>}
        <span className="shrink-0 rounded-full bg-teal-700 px-2 py-0.5 text-xs font-bold text-white">{items.length}</span>
      </button>
      {onSetMode && (
        <button type="button" onClick={() => onSetMode(rule)} aria-pressed={live} aria-label={live ? `Tắt báo người xử lý: ${rule.title}` : `Bật báo người xử lý: ${rule.title}`}
          title={live ? 'Đang báo người xử lý — bấm để quay về chạy thử' : 'Đang chạy thử (chỉ Admin thấy) — bấm để báo người xử lý'}
          className={`mr-2 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold ${live ? 'bg-leaf-50 text-leaf-700 dark:bg-leaf-950/40 dark:text-leaf-300' : 'text-muted-foreground hover:bg-muted'}`}>
          <BellRing size={12} /> {live ? 'Đang báo' : 'Chạy thử'}</button>
      )}
      </div>
      {open && (
        <div className="border-t border-border">
          <p className="flex items-start gap-1.5 px-3 pt-2 text-xs text-muted-foreground" title={rule.principle}><Info size={13} className="mt-0.5 shrink-0" />
            <span><b className="font-semibold text-foreground">Xử lý:</b> {rule.fixHint} <b className="font-semibold text-foreground">Ai:</b> {rule.ownerHint}.</span></p>
          <ul className="divide-y divide-border">{items.map(f => <FindingRow key={f.id} f={f} {...rowProps} />)}</ul>
        </div>
      )}
    </li>
  );
};

const AiControlPanel: React.FC<{ service: ControlService; onOpenRoute: (route: string) => void; notify: (text: string, kind?: 'success' | 'error') => void;
  confirm?: (o: { title: string; targetName: string; message: string; confirmText: string }) => Promise<boolean> }> = ({ service, onOpenRoute, notify, confirm }) => {
  const [overview, setOverview] = useState<ControlOverview | 'loading' | 'error'>('loading');
  const [view, setView] = useState<View>('new');
  const [module, setModule] = useState<string | null>(null);
  const [items, setItems] = useState<ControlFinding[] | 'loading' | 'error'>('loading');
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadOverview = useCallback(() => { setOverview('loading'); service.overview().then(setOverview, () => setOverview('error')); }, [service]);
  const loadItems = useCallback(() => {
    setItems('loading');
    const [status, legacy] = view === 'new' ? ['open', false] as const : view === 'legacy' ? ['open', true] as const : [view, null] as const;
    service.findings(null, status, legacy).then(setItems, () => setItems('error'));
  }, [service, view]);
  useEffect(loadOverview, [loadOverview]);
  useEffect(loadItems, [loadItems]);
  const refresh = () => { loadOverview(); loadItems(); };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await service.runNow();
      if (r.skipped) notify('Đang có lượt kiểm khác chạy — thử lại sau ít phút.');
      else notify(`Đã chạy ${r.rules} luật: ${r.opened} lệch mới, ${r.resolved} lệch tự đóng${r.errors.length ? `, ${r.errors.length} luật lỗi` : ''}.`, r.errors.length ? 'error' : 'success');
      refresh();
    } catch (e) { notify(controlErrorMessage(e), 'error'); } finally { setRunning(false); }
  };
  const accept = async (f: ControlFinding, reason: string) => {
    try { await service.accept(f.id, reason); notify(`Đã chấp nhận: ${f.objectCode || f.ruleTitle}.`); refresh(); return true; } catch (e) { notify(controlErrorMessage(e), 'error'); return false; }
  };
  const setMode = async (rule: ControlRule) => {
    const next = rule.mode === 'live' ? 'shadow' : 'live';
    const ok = !confirm || await confirm(next === 'live'
      ? { title: 'Báo người xử lý?', targetName: rule.title, message: `Lệch mới (từ ${ddmm(rule.sinceDate)}) hiện ở Việc của tôi và bản tin 07:00 của người xử lý${rule.severity === 'P0' ? '; P0 gửi thông báo ngay' : ''}. Quá 3 ngày báo trưởng bộ phận.`, confirmText: 'Bật báo' }
      : { title: 'Quay về chạy thử?', targetName: rule.title, message: 'Người xử lý không còn thấy lệch của luật này; chỉ Admin thấy.', confirmText: 'Quay về chạy thử' });
    if (!ok) return;
    try { await service.setMode(rule.code, next); notify(next === 'live' ? `Đã bật báo người xử lý: ${rule.title}.` : `Đã quay về chạy thử: ${rule.title}.`); refresh(); } catch (e) { notify(controlErrorMessage(e), 'error'); }
  };
  const reopen = async (f: ControlFinding) => {
    try { await service.reopen(f.id); notify(`Đã mở lại: ${f.objectCode || f.ruleTitle}.`); refresh(); } catch (e) { notify(controlErrorMessage(e), 'error'); }
  };

  const rules = overview !== 'loading' && overview !== 'error' ? overview.rules : [];
  const totals = useMemo(() => controlTotals(rules), [rules]);
  // Chip phân hệ: chỉ phân hệ đang có lệch trong ô đang chọn (không có chip bấm vào ra rỗng).
  const modules = useMemo(() => (Array.isArray(items) ? rules.map(r => r.module).filter((m, i, all) => all.indexOf(m) === i && items.some(f => f.module === m)) : []), [rules, items]);
  useEffect(() => { if (module && Array.isArray(items) && !items.some(f => f.module === module)) setModule(null); }, [items, module]);
  const groups = useMemo(() => {
    if (!Array.isArray(items)) return [];
    const byRule = new Map<string, ControlFinding[]>();
    for (const f of items) if (!module || f.module === module) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f]);
    return rules.filter(r => byRule.has(r.code)).map(r => ({ rule: r, items: byRule.get(r.code)! }));
  }, [items, rules, module]);

  if (overview === 'loading') return <StateBox kind="loading" title="Đang tải kiểm soát…" />;
  if (overview === 'error') return <StateBox kind="error" title="Chưa tải được kiểm soát" message="Thử lại sau." onRetry={loadOverview} />;
  const run = overview.lastRun;
  const admin = overview.isAdmin;
  const counts: Record<View, number> = { new: totals.open, legacy: totals.legacy, accepted: totals.accepted, resolved: totals.resolved7d };
  const liveCount = rules.filter(r => r.mode === 'live').length;
  const views = admin ? VIEWS : VIEWS.filter(v => v.key !== 'legacy');

  return (
    <section role="tabpanel" aria-label="Kiểm soát" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {admin ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${liveCount ? 'bg-leaf-50 text-leaf-700 dark:bg-leaf-950/40 dark:text-leaf-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}
            title="Luật đang báo người xử lý / tổng số luật. Luật chưa bật chỉ Admin thấy (chạy thử).">
            <ShieldCheck size={12} /> {liveCount}/{rules.length} luật đang báo</span>
        ) : <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground"><ShieldCheck size={13} className="text-teal-700" /> Lệch giao cho bạn hoặc bộ phận bạn</span>}
        <span className="mr-auto text-xs text-muted-foreground" title="Máy chủ tự chạy 15 phút một lần">{run ? `Lượt gần nhất ${hhmm(run.finishedAt || run.startedAt)}${admin && run.errors.length ? ` · ${run.errors.length} luật lỗi` : ''}` : 'Chưa chạy lượt nào'}</span>
        {admin && <button type="button" className={secondaryBtn} onClick={() => void runNow()} disabled={running}>{running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Chạy lại</button>}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
        {views.map(v => <Kpi key={v.key} label={v.key === 'resolved' ? 'Tự đóng 7 ngày' : v.label} value={counts[v.key]} active={view === v.key} onClick={() => setView(v.key)}
          warn={v.key === 'new' ? totals.p0 : undefined} title={v.key === 'legacy' ? 'Lệch phát sinh trước ngày luật bắt đầu tính (01/10) — dọn một lần' : undefined} />)}
      </div>

      {modules.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo phân hệ">
          {[null, ...modules].map(m => (
            <button key={m ?? 'all'} type="button" onClick={() => setModule(m)} aria-pressed={module === m}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${module === m ? 'bg-teal-700 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{m ?? 'Tất cả'}</button>
          ))}
        </div>
      )}

      {items === 'loading' && <StateBox kind="loading" title="Đang tải lệch…" />}
      {items === 'error' && <StateBox kind="error" title="Chưa tải được danh sách lệch" message="Thử lại sau." onRetry={loadItems} />}
      {Array.isArray(items) && groups.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm text-foreground"><CheckCircle2 size={16} className="text-leaf-600" />
          {view === 'new' ? (admin ? 'Không có lệch mới.' : 'Không có lệch nào cần bạn sửa.') : view === 'legacy' ? 'Không còn lệch dữ liệu cũ.' : view === 'accepted' ? 'Chưa chấp nhận lệch nào.' : 'Chưa có lệch tự đóng trong 7 ngày.'}</p>
      )}
      {groups.length > 0 && (
        <ul className="space-y-2" aria-label="Lệch theo luật">
          {groups.map(g => <RuleGroup key={g.rule.code} rule={g.rule} items={g.items} open={openRule === g.rule.code || groups.length === 1}
            onToggle={() => setOpenRule(openRule === g.rule.code ? null : g.rule.code)} onOpen={onOpenRoute} onAccept={accept} onReopen={reopen}
            onSetMode={admin ? rule => void setMode(rule) : undefined} />)}
        </ul>
      )}
    </section>
  );
};

export default AiControlPanel;
