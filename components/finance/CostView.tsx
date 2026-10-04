import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calculator, Check, ChevronDown, ClipboardList, FileText, HandCoins, PiggyBank, Plus, RotateCcw, Scale, Undo2, Users, X } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceCost, type FinanceCostLine, type FinanceCostProject, type FinanceFundRowKind, type FinanceProjectBudget, type FinanceProjectCost } from '../../lib/financeService';
import { Badge, StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney, viDate } from './financeUi';
import { BudgetDrawer, CapitalDrawer, FundOpeningDrawer, signedMoney } from './CostDrawers';
import { AllocationView } from './AllocationView';

// Tài chính → Chi phí & ngân sách: dự án đang tiêu bao nhiêu so với ngân sách, có sắp vượt không; mỗi dự án tự nuôi được bằng
// tiền chủ đầu tư hay đang dùng vốn công ty (quỹ dự án). Số chưa biết hiện "chưa có", không hiện 0.

const pct = (a: number, b: number | null) => b ? Math.round((a / b) * 100) : null;
const FUND_KIND: Record<FinanceFundRowKind, string> = {
  customer_receipt: 'Tiền CĐT trả', advance_refund: 'NCC hoàn tạm ứng', other_receipt: 'Thu khác', supplier_payment: 'Chi NCC', expense: 'Chi khác',
  site_transfer: 'Quỹ công trường', capital: 'Công ty cấp vốn', capital_return: 'Thu hồi vốn', allocation: 'Phân bổ tháng',
};
const BUDGET_STATUS: Record<FinanceProjectBudget['status'], { label: string; cls: string }> = {
  submitted: { label: 'Chờ duyệt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  approved: { label: 'Đang áp dụng', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  rejected: { label: 'Bị trả lại', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  withdrawn: { label: 'Đã rút', cls: 'border-border bg-muted text-muted-foreground' },
  superseded: { label: 'Bản cũ', cls: 'border-border bg-muted text-muted-foreground' },
};

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint: React.ReactNode; tone?: string }> = ({ icon: I, label, value, hint, tone = 'text-leaf-700 dark:text-leaf-300' }) =>
  <div className="rounded-2xl border border-border bg-card p-3 shadow-sm"><span className="flex items-start gap-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground"><I size={14} className="shrink-0 text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span><span className="block text-xs text-muted-foreground">{hint}</span></div>;

/** Thanh mức dùng: xanh = đã ghi nhận, nhạt = đơn chưa nhận; đỏ khi vượt. Chưa có ngân sách thì nói rõ. */
const UsageBar: React.FC<{ budget: number | null; actual: number; committed: number; warn: number }> = ({ budget, actual, committed, warn }) => {
  if (budget == null) return <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{actual + committed > 0.5 ? 'chưa lập ngân sách' : '—'}</span>;
  if (budget <= 0) return <span className="text-xs text-muted-foreground">ngân sách 0</span>;
  const used = actual + committed; const a = Math.min(100, (actual / budget) * 100); const c = Math.min(100 - a, (committed / budget) * 100);
  const over = used > budget + 0.5; const near = !over && used * 100 >= budget * warn;
  return <div className="w-full min-w-[9rem]"><div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
    <span className={`absolute inset-y-0 left-0 ${actual > budget ? 'bg-rose-500' : near ? 'bg-amber-500' : 'bg-leaf-600'}`} style={{ width: `${a}%` }} />
    <span className={`absolute inset-y-0 ${over ? 'bg-rose-300' : 'bg-teal-300'}`} style={{ left: `${a}%`, width: `${c}%` }} /></div>
    <p className={`mt-0.5 text-[11px] ${over ? 'font-semibold text-rose-700 dark:text-rose-300' : near ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
      {pct(actual, budget)}% đã ghi nhận{committed > 0.5 ? ` + ${pct(committed, budget)}% đơn chưa nhận` : ''}{over ? ` — vượt ${shortMoney(used - budget)}` : near ? ' — sắp chạm' : ''}</p></div>;
};

const FundCell: React.FC<{ p: FinanceCostProject }> = ({ p }) => p.balance == null
  ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{p.openingStatus === 'submitted' ? 'đầu kỳ chờ chốt' : 'chưa khai đầu kỳ'}</span>
  : <><b className={p.balance < 0 ? 'font-semibold tabular-nums text-rose-700 dark:text-rose-300' : NUM}>{signedMoney(p.balance)}</b>
    <span className="block text-xs text-muted-foreground">{p.capital > 0.5 ? `công ty đang ứng ${shortMoney(p.capital)}` : p.balance < 0 ? 'cần cấp vốn' : 'tự nuôi bằng tiền CĐT'}</span></>;

const ViewTabs: React.FC<{ view: 'projects' | 'allocation'; onChange: (v: 'projects' | 'allocation') => void }> = ({ view, onChange }) =>
  <div role="tablist" aria-label="Phần" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
    {([['projects', 'Dự án & quỹ dự án', Scale], ['allocation', 'Phân bổ tháng', Users]] as const).map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => onChange(k)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}><I size={14} />{l}</button>)}
  </div>;

export const CostView: React.FC<{ initialProjectId?: string | null; initialView?: string | null; onChanged: () => void }> = ({ initialProjectId, initialView, onChanged }) => {
  const [view, setView] = useState<'projects' | 'allocation'>(initialView === 'allocation' && !initialProjectId ? 'allocation' : 'projects');
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceCost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId || null);
  const [busy, setBusy] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const load = useCallback(() => { setError(null); financeService.cost().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  if (projectId) return <ProjectCost projectId={projectId} onBack={() => { setProjectId(null); load(); window.scrollTo({ top: 0 }); }} onChanged={() => { onChanged(); }} />;
  if (view === 'allocation') return <div className="space-y-3"><ViewTabs view={view} onChange={setView} /><AllocationView onChanged={() => { load(); onChanged(); }} /></div>;
  if (error) return <StateBox kind="error" title="Chưa tải được Chi phí & ngân sách" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải chi phí & ngân sách…" />;
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success('Chi phí & ngân sách', msg); load(); onChanged(); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const ps = data.projects; const warn = data.warnPercent;
  const sum = (f: (p: FinanceCostProject) => number) => ps.reduce((s, p) => s + f(p), 0);
  const withBudget = ps.filter(p => p.budget != null);
  const negative = ps.filter(p => p.balance != null && p.balance < -0.5);
  const noOpening = ps.filter(p => p.openingStatus === 'none');
  const alerts: Array<{ tone: 'rose' | 'amber'; title: React.ReactNode; hint: React.ReactNode; projectId?: string }> = [];
  for (const p of ps) {
    for (const o of p.overList) alerts.push({ tone: 'rose', projectId: p.id, title: <>{p.code}: {o.item} đã dùng {pct(o.used, o.budget)}% ngân sách ({shortMoney(o.used)} / {shortMoney(o.budget)})</>,
      hint: <>Gồm chi phí đã ghi nhận và đơn mua chưa nhận. Tiến độ {p.progress == null ? 'chưa có' : `${p.progress}%`}.</> });
    if (p.eac != null && p.budget != null && p.missingItems === 0 && p.eac > p.budget + 0.5) alerts.push({ tone: 'rose', projectId: p.id,
      title: <>{p.code}: dự báo khi hoàn thành ≈ {shortMoney(p.eac)}, vượt ngân sách {shortMoney(p.eac - p.budget)}</>, hint: <>Chi phí đã ghi nhận {shortMoney(p.actual)} ÷ tiến độ Gantt {p.progress}%.</> });
    if (p.warnItems > 0) alerts.push({ tone: 'amber', projectId: p.id, title: <>{p.code}: {p.warnItems} khoản mục đã dùng từ {warn}% ngân sách</>, hint: 'Mở dự án để xem từng khoản mục.' });
    if (p.missingItems > 0) alerts.push({ tone: 'amber', projectId: p.id, title: <>{p.code}: {p.missingItems} khoản mục có chi phí nhưng chưa có ngân sách</>, hint: 'Chưa biết vượt hay không — kế toán / QS lập ngân sách, Quản trị Tài chính duyệt.' });
  }
  if (negative.length) alerts.push({ tone: 'rose', title: <>Quỹ âm: {negative.map(p => `${p.code} ${signedMoney(p.balance!)}`).join(' · ')}</>, hint: `Dự án đang tiêu hơn tiền CĐT trả — ${data.capitalProviders.join(', ') || 'người cấp vốn'} ghi cấp vốn.` });
  if (noOpening.length) alerts.push({ tone: 'amber', title: <>{noOpening.length} dự án chưa khai đầu kỳ quỹ: {noOpening.map(p => p.code).join(', ')}</>, hint: 'Chưa có đầu kỳ thì chưa biết số dư quỹ và chưa xét được bước "Cấp vốn dự án".' });

  return <div className="space-y-3">
    <ViewTabs view={view} onChange={setView} />
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Kpi icon={Calculator} label="Ngân sách chi phí" value={withBudget.length ? shortMoney(sum(p => p.budget || 0)) : 'Chưa có'} hint={`${withBudget.length}/${ps.length} dự án có ngân sách${ps.some(p => p.missingItems > 0) ? ' · còn khoản mục chưa lập' : ''}`} tone={withBudget.length ? undefined : 'text-amber-700 dark:text-amber-300'} />
      <Kpi icon={Scale} label="Chi phí đã ghi nhận" value={shortMoney(sum(p => p.actual))} hint="theo cây khoản mục (MISA + Vioo)" />
      <Kpi icon={ClipboardList} label="Đơn mua chưa nhận" value={shortMoney(sum(p => p.committed))} hint={data.stale.count ? <span className="font-semibold text-amber-700 dark:text-amber-300">{data.stale.count} đơn quá hẹn giao &gt; 30 ngày</span> : 'cam kết, giá trước VAT'} tone="text-foreground" />
      <Kpi icon={HandCoins} label="Vốn công ty đang ứng" value={shortMoney(sum(p => Math.max(p.capital, 0)))} hint={negative.length ? <span className="font-semibold text-rose-700">{negative.length} dự án quỹ âm</span> : 'cho các dự án (quỹ dự án)'} tone={sum(p => p.capital) > 0.5 ? 'text-amber-700 dark:text-amber-300' : undefined} />
    </section>

    {(data.poBudget.length > 0 || ps.some(p => p.pendingBudget || p.openingCanDecide)) && <section className="rounded-2xl border border-amber-300 bg-card p-4 shadow-sm">
      <h3 className="font-bold">Chờ xử lý</h3>
      <ul className="mt-2 divide-y divide-border text-sm">
        {data.poBudget.map(o => <li key={o.purchaseOrderId} className="flex flex-wrap items-center justify-end gap-2 py-2">
          <span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>Đơn mua vượt ngân sách vật tư</b> <span className={ENT}>{o.poNumber}</span> · {o.projectCode} · {o.vendor || 'NCC'}: <b className={NUM}>{money(o.order)} đ</b>
            <span className="block text-xs text-muted-foreground">Sau đơn vật tư dùng {shortMoney(o.projected)} / dự toán {shortMoney(o.budget)} (vượt {shortMoney(o.projected - o.budget)}) · lập: {o.createdByName || '—'} · người duyệt đơn: {o.approverName || '—'}</span></span>
          {o.canDecide ? <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Không duyệt vượt ngân sách', targetName: o.poNumber, subtitle: 'Đơn trả về người lập kèm lý do.', reasonLabel: 'Lý do', actionLabel: 'Trả đơn', intent: 'warning' }); if (r) void run(() => financeService.decidePoBudget({ purchaseOrderId: o.purchaseOrderId, action: 'reject', reason: r }), 'Đã trả đơn về người lập.'); }}><X size={14} />Không duyệt</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Duyệt vượt ngân sách?', targetName: `${o.poNumber} · ${money(o.order)} đ`, confirmText: 'Duyệt', actionLabel: 'Duyệt', intent: 'success', countdownSeconds: 0, warningText: `Người duyệt đơn (${o.approverName || 'Mua hàng'}) sẽ được báo để duyệt đơn.` })) void run(() => financeService.decidePoBudget({ purchaseOrderId: o.purchaseOrderId, action: 'approve' }), 'Đã duyệt vượt ngân sách — đã báo người duyệt đơn.'); }}><Check size={14} />Duyệt vượt ngân sách</button></>
            : <span className="text-xs text-muted-foreground">chờ {data.budgetApprovers.join(', ')}</span>}</li>)}
        {ps.filter(p => p.pendingBudget).map(p => <li key={`b${p.id}`} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1"><b>Ngân sách chờ duyệt</b> <span className={ENT}>{p.code}</span> · phiên bản {p.pendingBudget!.versionNo} · lập: {p.pendingBudget!.createdByName}</span>
          <button type="button" className={secondaryBtn} onClick={() => setProjectId(p.id)}>{p.pendingBudget!.canDecide ? 'Xem và duyệt' : 'Xem'}</button></li>)}
        {ps.filter(p => p.openingCanDecide).map(p => <li key={`o${p.id}`} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1"><b>Đầu kỳ quỹ chờ chốt</b> <span className={ENT}>{p.code}</span></span>
          <button type="button" className={secondaryBtn} onClick={() => setProjectId(p.id)}>Xem và chốt</button></li>)}
      </ul>
    </section>}

    {(alerts.length > 0 || data.stale.count > 0) && <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/20">
      <h3 className="flex items-center gap-1.5 font-bold text-rose-900 dark:text-rose-100"><AlertTriangle size={16} />Cần chú ý</h3>
      <ul className="mt-2 grid gap-2 md:grid-cols-2">
        {alerts.map((a, i) => <li key={i}><button type="button" disabled={!a.projectId} onClick={() => a.projectId && setProjectId(a.projectId)}
          className={`h-full w-full rounded-xl border bg-card p-3 text-left ${a.tone === 'rose' ? 'border-rose-200 dark:border-rose-900' : 'border-amber-200 dark:border-amber-900'} ${a.projectId ? 'hover:border-teal-400' : ''}`}>
          <b className="block">{a.title}</b><span className="block text-xs text-muted-foreground">{a.hint}</span></button></li>)}
        {data.stale.count > 0 && <li className="md:col-span-2"><div className="rounded-xl border border-amber-200 bg-card p-3 dark:border-amber-900">
          <button type="button" onClick={() => setShowStale(s => !s)} className="flex w-full items-start gap-2 text-left"><span className="min-w-0 flex-1"><b className="block">{data.stale.count} đơn mua quá hẹn giao hơn 30 ngày, còn {shortMoney(data.stale.amount)} chưa nhận</b>
            <span className="block text-xs text-muted-foreground">Nếu NCC không giao nữa, Mua hàng "Kết thúc thiếu" đơn — nếu không, phần cam kết làm dự báo vượt ngân sách bị sai.</span></span>
            <ChevronDown size={16} className={`mt-0.5 shrink-0 transition ${showStale ? 'rotate-180' : ''}`} /></button>
          {showStale && <ul className="mt-2 divide-y divide-border border-t border-border text-xs">{data.stale.items.map(s => <li key={s.poNumber} className="flex flex-wrap gap-x-3 py-1.5">
            <b className={ENT}>{s.poNumber}</b><span>{s.projectCode || '—'}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{s.vendor || '—'}</span>
            <span className="text-rose-700">hẹn {viDate(s.expectedDate)}</span><span className="tabular-nums">{shortMoney(s.openNet)}</span>{!s.hub && <span className="text-muted-foreground">lập ở dự án</span>}</li>)}</ul>}
        </div></li>}
      </ul>
    </section>}

    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <h3 className="border-b border-border px-4 py-2.5 font-semibold">Dự án</h3>
      {ps.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có dự án nào có HĐ chủ đầu tư hoặc chi phí.</p> : <>
        <ul className="divide-y divide-border md:hidden">{ps.map(p => <li key={p.id}><button type="button" onClick={() => setProjectId(p.id)} className="w-full px-4 py-3 text-left">
          <p className="flex items-start gap-2"><span className="min-w-0 flex-1"><b className={ENT}>{p.code}</b><span className="block truncate text-xs text-muted-foreground">{p.name}</span></span>
            <span className="text-right text-sm"><FundCell p={p} /></span></p>
          <p className="mt-1 text-xs text-muted-foreground">Tiến độ {p.progress == null ? 'chưa có' : `${p.progress}%`} · chi phí {shortMoney(p.actual)} / {p.budget == null ? 'chưa có ngân sách' : shortMoney(p.budget)}</p>
          <div className="mt-1.5"><span className="text-[11px] text-muted-foreground">Vật tư so với dự toán</span><UsageBar budget={p.materialBudget} actual={p.materialActual} committed={p.materialCommitted} warn={warn} /></div>
        </button></li>)}</ul>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Dự án</th><th className="px-2 py-2 text-right">Tiến độ</th><th className="px-2 py-2 text-left">Vật tư so với dự toán</th>
            <th className="px-2 py-2 text-right">Chi phí / ngân sách</th><th className="px-2 py-2 text-right">Dự báo khi hoàn thành</th><th className="px-3 py-2 text-right">Quỹ dự án</th></tr></thead>
          <tbody className="divide-y divide-border">{ps.map(p => <tr key={p.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setProjectId(p.id)}>
            <td className="px-3 py-3"><b className={ENT}>{p.code}</b>{(p.overItems > 0) && <Badge className="ml-1 border-rose-200 bg-rose-50 text-rose-700">vượt {p.overItems}</Badge>}{p.pendingBudget && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">ngân sách chờ duyệt</Badge>}
              <span className="block text-xs text-muted-foreground">{p.contractValue ? `HĐ ${shortMoney(p.contractValue)} · ` : 'Chưa khai HĐ CĐT · '}CĐT đã trả {shortMoney(p.receivedAll)}</span></td>
            <td className="px-2 py-3 text-right tabular-nums">{p.progress == null ? <span className="text-xs text-muted-foreground">chưa có</span> : `${p.progress}%`}</td>
            <td className="w-64 px-2 py-3"><UsageBar budget={p.materialBudget} actual={p.materialActual} committed={p.materialCommitted} warn={warn} /></td>
            <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{shortMoney(p.actual)} / {p.budget == null ? <span className="text-amber-700">chưa có</span> : shortMoney(p.budget)}
              <span className="block text-xs text-muted-foreground">{p.budget ? `${pct(p.actual, p.budget)}%${p.missingItems ? ` · ${p.missingItems} khoản mục chưa lập` : ''}` : p.currentBudget ? '' : 'chưa lập ngân sách'}</span></td>
            <td className="whitespace-nowrap px-2 py-3 text-right">{p.eac != null ? <><b className={p.budget != null && p.eac > p.budget ? 'font-semibold tabular-nums text-rose-700' : NUM}>{shortMoney(p.eac)}</b><span className="block text-xs text-muted-foreground">theo tiến độ Gantt</span></>
              : <span className="text-xs text-muted-foreground">{p.progress == null ? 'chưa có tiến độ' : 'tiến độ < 20% — chưa dự báo'}</span>}</td>
            <td className="whitespace-nowrap px-3 py-3 text-right"><FundCell p={p} /></td>
          </tr>)}</tbody></table></div></>}
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Ngân sách vật tư = dự toán vật tư của dự án. Đơn chưa nhận = đơn đã duyệt chưa nhận hết (cam kết). Quỹ dự án = đầu kỳ 30/09 + tiền CĐT trả + vốn công ty cấp − tiền đã chi cho dự án (tự tính từ sổ thu chi, không phải tiền ngân hàng).</p>
    </section>
  </div>;
};

// ---------- Một dự án ----------
const ProjectCost: React.FC<{ projectId: string; onBack: () => void; onChanged: () => void }> = ({ projectId, onBack, onChanged }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceProjectCost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'budget' | 'fund'>('budget');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ commitments?: boolean; versions?: boolean }>({});
  const [drawer, setDrawer] = useState<{ kind: 'budget' } | { kind: 'opening' } | { kind: 'capital'; mode: 'topup' | 'return' } | null>(null);
  const load = useCallback(() => { setError(null); financeService.projectCost(projectId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [projectId]);
  useEffect(load, [load]);
  const back = <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:underline"><ArrowLeft size={15} />Toàn công ty</button>;
  if (error) return <div className="space-y-2">{back}<StateBox kind="error" title="Chưa tải được dự án" message={error} onRetry={load} /></div>;
  if (!data) return <div className="space-y-2">{back}<StateBox kind="loading" title="Đang tải dự án…" /></div>;
  const p = data.project; const f = data.fund; const can = data.can; const warn = data.warnPercent;
  const done = (msg: string) => { toast.success('Chi phí & ngân sách', msg); setDrawer(null); load(); onChanged(); };
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); done(msg); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const current = data.budgets.find(b => b.status === 'approved') || null;
  const pending = data.budgets.find(b => b.status === 'submitted') || null;
  const itemName = (id: string) => data.items.find(i => i.id === id)?.name || '—';
  const groups: Array<{ name: string; lines: FinanceCostLine[] }> = [];
  for (const l of data.lines) { const name = l.costItemId ? l.groupName || '' : 'Chưa xếp được khoản mục'; const last = groups[groups.length - 1]; if (last && last.name === name) last.lines.push(l); else groups.push({ name, lines: [l] }); }
  const tot = data.lines.reduce((s, l) => ({ budget: s.budget + (l.budget || 0), actual: s.actual + l.actual, committed: s.committed + l.committed }), { budget: 0, actual: 0, committed: 0 });
  const auto = data.lines.reduce((s, l) => s + l.autoMapped, 0);
  const op = f.openingRecord;

  return <div className="space-y-3">
    {back}
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chi phí & ngân sách · dự án</p><h2 className={`text-lg ${ENT}`}>{p.code} · {p.name}</h2>
        <p className="text-sm text-muted-foreground">{p.contractValue ? `HĐ ${shortMoney(p.contractValue)}` : 'Chưa khai HĐ chủ đầu tư'} · tiến độ {p.progress == null ? 'chưa có' : `${p.progress}%`} · {current ? `ngân sách phiên bản ${current.versionNo} (duyệt ${viDate(current.decidedAt)} bởi ${current.decidedByName})` : 'chưa có ngân sách đã duyệt — chỉ có dự toán vật tư'}</p></div>
      {can.record && tab === 'budget' && <button type="button" onClick={() => setDrawer({ kind: 'budget' })} disabled={Boolean(pending)} title={pending ? 'Đang có bản chờ duyệt' : undefined} className={primaryBtn}><Calculator size={15} />{current ? 'Điều chỉnh ngân sách' : 'Lập ngân sách'}</button>}
      {can.capital && tab === 'fund' && <><button type="button" onClick={() => setDrawer({ kind: 'capital', mode: 'return' })} disabled={f.capital <= 0.5} className={secondaryBtn}><Undo2 size={15} />Thu hồi vốn</button>
        <button type="button" onClick={() => setDrawer({ kind: 'capital', mode: 'topup' })} className={primaryBtn}><HandCoins size={15} />Cấp vốn</button></>}
    </div>

    {pending && tab === 'budget' && <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-start justify-end gap-2"><span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>Ngân sách phiên bản {pending.versionNo} chờ duyệt</b> · lập: {pending.createdByName} {viDate(pending.createdAt)}
        <span className="block">Lý do: {pending.reason}</span></span>
        {pending.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void run(() => financeService.decideProjectBudget({ id: pending.id, expectedRowVersion: pending.rowVersion, action: 'withdraw' }), 'Đã rút bản chờ duyệt.')}><Undo2 size={14} />Rút</button>}
        {pending.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại ngân sách', targetName: `${p.code} · phiên bản ${pending.versionNo}`, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' }); if (r) void run(() => financeService.decideProjectBudget({ id: pending.id, expectedRowVersion: pending.rowVersion, action: 'reject', reason: r }), 'Đã trả lại.'); }}><X size={14} />Trả lại</button>
          <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Duyệt ngân sách?', targetName: `${p.code} · phiên bản ${pending.versionNo}`, confirmText: 'Duyệt', actionLabel: 'Duyệt', intent: 'success', countdownSeconds: 0, warningText: current ? `Thay phiên bản ${current.versionNo} đang áp dụng (bản cũ vẫn giữ trong lịch sử).` : 'Áp dụng làm ngân sách của dự án.' })) void run(() => financeService.decideProjectBudget({ id: pending.id, expectedRowVersion: pending.rowVersion, action: 'approve' }), 'Đã duyệt ngân sách.'); }}><Check size={14} />Duyệt</button></>}
      </div>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[20rem] text-xs"><thead className="text-muted-foreground"><tr><th className="text-left">Khoản mục</th><th className="text-right">Đang áp dụng</th><th className="text-right">Đề nghị</th><th className="text-right">Chênh</th></tr></thead>
        <tbody>{pending.lines.map(l => { const cur = current?.lines.find(x => x.costItemId === l.costItemId)?.amount ?? null; const d = l.amount - (cur || 0);
          return <tr key={l.costItemId}><td>{itemName(l.costItemId)}</td><td className="text-right tabular-nums">{cur == null ? 'chưa lập' : shortMoney(cur)}</td><td className="text-right font-semibold tabular-nums">{shortMoney(l.amount)}</td>
            <td className={`text-right tabular-nums ${d > 0.5 ? 'text-amber-700' : d < -0.5 ? 'text-leaf-700' : 'text-muted-foreground'}`}>{Math.abs(d) < 0.5 ? '—' : `${d > 0 ? '+' : '−'}${shortMoney(Math.abs(d))}`}</td></tr>; })}
          {current?.lines.filter(x => !pending.lines.some(l => l.costItemId === x.costItemId)).map(x => <tr key={x.costItemId} className="text-rose-700"><td>{itemName(x.costItemId)}</td><td className="text-right tabular-nums">{shortMoney(x.amount)}</td><td className="text-right">bỏ (chưa lập)</td><td /></tr>)}</tbody></table></div>
    </section>}

    <div role="tablist" aria-label="Phần" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
      {([['budget', 'Ngân sách & chi phí', Scale], ['fund', 'Quỹ dự án', PiggyBank]] as const).map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}><I size={14} />{l}</button>)}
    </div>

    {tab === 'budget' ? <>
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi icon={Calculator} label="Ngân sách" value={p.budget == null ? 'Chưa có' : shortMoney(p.budget)} hint={p.missingItems ? `${p.missingItems} khoản mục có chi phí chưa lập` : current ? `phiên bản ${current.versionNo}` : 'chỉ dự toán vật tư'} tone={p.budget == null ? 'text-amber-700' : undefined} />
        <Kpi icon={Scale} label="Đã ghi nhận" value={shortMoney(p.actual)} hint={p.budget ? `${pct(p.actual, p.budget)}% ngân sách` : 'chi phí theo khoản mục'} />
        <Kpi icon={ClipboardList} label="Đơn chưa nhận" value={shortMoney(p.committed)} hint={`${data.commitments.length} đơn${data.commitments.some(c => c.stale) ? ` · ${data.commitments.filter(c => c.stale).length} quá hẹn` : ''}`} tone="text-foreground" />
        <Kpi icon={AlertTriangle} label="Dự báo hoàn thành" value={p.eac == null ? 'Chưa dự báo' : shortMoney(p.eac)} hint={p.eac == null ? (p.progress == null ? 'chưa có tiến độ Gantt' : `tiến độ ${p.progress}% < 20%`) : p.budget != null && !p.missingItems ? (p.eac > p.budget ? `vượt ngân sách ${shortMoney(p.eac - p.budget)}` : `trong ngân sách (còn ${shortMoney(p.budget - p.eac)})`) : `chi phí ÷ tiến độ ${p.progress}%`}
          tone={p.eac != null && p.budget != null && p.eac > p.budget ? 'text-rose-700 dark:text-rose-300' : p.eac == null ? 'text-muted-foreground' : undefined} />
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <ul className="divide-y divide-border md:hidden">{data.lines.map(l => <li key={l.costItemId || 'none'} className="px-4 py-2.5 text-sm">
          <p className="flex items-start gap-2"><span className="min-w-0 flex-1"><b>{l.name || 'Chưa xếp được khoản mục'}</b> <span className="text-xs text-muted-foreground">{l.symbol}</span></span>
            <span className="text-right tabular-nums">{shortMoney(l.actual + l.committed)} / {l.budget == null ? <span className="text-amber-700">chưa có</span> : shortMoney(l.budget)}</span></p>
          <div className="mt-1"><UsageBar budget={l.budget} actual={l.actual} committed={l.committed} warn={warn} /></div></li>)}</ul>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Khoản mục</th><th className="px-2 py-2 text-right">Ngân sách</th><th className="px-2 py-2 text-right">Đã ghi nhận</th>
            <th className="px-2 py-2 text-right">Đơn chưa nhận</th><th className="px-2 py-2 text-right">Còn lại</th><th className="w-64 px-3 py-2 text-left">Mức dùng</th></tr></thead>
          {groups.map(g => <tbody key={g.name} className="divide-y divide-border border-t border-border">
            <tr className="bg-muted/20"><td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</td></tr>
            {g.lines.map(l => { const left = l.budget == null ? null : l.budget - l.actual - l.committed;
              return <tr key={l.costItemId || 'none'}>
                <td className="px-3 py-2.5"><b>{l.name || 'Giao dịch chưa xếp được khoản mục'}</b> <span className="text-xs text-muted-foreground">{l.symbol}</span>
                  {l.budgetSource === 'material' && <Badge className="ml-1 border-teal-200 bg-teal-50 text-teal-800">dự toán vật tư</Badge>}
                  {l.autoMapped > 0.5 && <span className="block text-[11px] text-muted-foreground">{shortMoney(l.autoMapped)} tự xếp theo loại chi phí (chưa gắn khoản mục)</span>}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{l.budget == null ? <span className="text-xs text-amber-700">chưa lập</span> : shortMoney(l.budget)}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{shortMoney(l.actual)}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-muted-foreground">{l.committed > 0.5 ? shortMoney(l.committed) : '—'}</td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums ${left != null && left < -0.5 ? 'text-rose-700' : 'text-foreground'}`}>{left == null ? '—' : signedMoney(left)}</td>
                <td className="px-3 py-2.5"><UsageBar budget={l.budget} actual={l.actual} committed={l.committed} warn={warn} /></td></tr>; })}
          </tbody>)}
          <tfoot className="border-t-2 border-border bg-muted/30 font-semibold"><tr><td className="px-3 py-2">Tổng</td><td className="px-2 py-2 text-right tabular-nums">{p.budget == null ? '—' : shortMoney(tot.budget)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{shortMoney(tot.actual)}</td><td className="px-2 py-2 text-right tabular-nums">{shortMoney(tot.committed)}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Vật tư so với dự toán vật tư (sửa ở Dự án → Vật tư). {auto > 0.5 ? `${shortMoney(auto)} chi phí chưa gắn khoản mục được tự xếp theo loại (vật tư, nhân công, máy, chung, khác). ` : ''}Phiếu chi khác / đơn mua làm khoản mục vượt ngân sách sẽ thêm bước "Duyệt vượt ngân sách".</p>
      </section>
      {data.commitments.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button type="button" onClick={() => setOpen(o => ({ ...o, commitments: !o.commitments }))} className="flex w-full items-center gap-2 text-left">
          <h3 className="flex-1 font-semibold">Đơn mua chưa nhận ({data.commitments.length}) · {shortMoney(p.committed)}</h3><ChevronDown size={16} className={`transition ${open.commitments ? 'rotate-180' : ''}`} /></button>
        {open.commitments && <ul className="mt-2 divide-y divide-border text-sm">{data.commitments.map(c => <li key={c.poNumber} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
          <b className={ENT}>{c.poNumber}</b><span className="min-w-0 flex-1 truncate text-muted-foreground">{c.vendor || '—'}{c.hub ? '' : ' · lập ở dự án'}</span>
          <span className={`text-xs ${c.stale ? 'font-semibold text-rose-700' : 'text-muted-foreground'}`}>{c.expectedDate ? `${c.stale ? 'quá hẹn · ' : 'hẹn '}${viDate(c.expectedDate)}` : 'chưa hẹn ngày'}</span>
          <span className="tabular-nums">{shortMoney(c.openNet)}<span className="text-xs text-muted-foreground"> / {shortMoney(c.netTotal)}</span></span></li>)}</ul>}
      </section>}
      {data.budgets.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button type="button" onClick={() => setOpen(o => ({ ...o, versions: !o.versions }))} className="flex w-full items-center gap-2 text-left">
          <h3 className="flex-1 font-semibold">Lịch sử ngân sách ({data.budgets.length} phiên bản)</h3><ChevronDown size={16} className={`transition ${open.versions ? 'rotate-180' : ''}`} /></button>
        {open.versions && <ul className="mt-2 divide-y divide-border text-sm">{data.budgets.map(b => <li key={b.id} className="py-2">
          <p className="flex flex-wrap items-center gap-2"><b>Phiên bản {b.versionNo}</b><Badge className={BUDGET_STATUS[b.status].cls}>{BUDGET_STATUS[b.status].label}</Badge>
            <span className="ml-auto tabular-nums">{shortMoney((b.materialBudget || 0) + b.otherTotal)}</span></p>
          <p className="text-xs text-muted-foreground">{b.reason} · lập: {b.createdByName} {viDate(b.createdAt)}{b.decidedByName ? ` · ${b.status === 'withdrawn' ? 'rút' : 'quyết định'}: ${b.decidedByName} ${viDate(b.decidedAt)}` : ''}{b.decisionNote ? ` — ${b.decisionNote}` : ''}</p></li>)}</ul>}
      </section>}
    </> : <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="flex flex-wrap items-center gap-2 font-bold"><PiggyBank size={16} className="text-teal-700" />Quỹ dự án {p.code}
          {f.balance != null && <Badge className={f.balance < 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : f.capital > 0.5 ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-leaf-200 bg-leaf-50 text-leaf-800'}>
            {f.balance < 0 ? 'Quỹ âm — cần cấp vốn' : f.capital > 0.5 ? 'Đang dùng vốn công ty' : 'Tự nuôi bằng tiền CĐT'}</Badge>}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          {([['Đầu kỳ 30/09', f.opening, op?.status === 'confirmed' ? 'MISA, đã chốt' : op?.status === 'submitted' ? 'chờ chốt' : 'chưa khai'],
            ['Tiền CĐT trả (từ 01/10)', f.received, 'tự động từ phiếu thu'], ['Thu khác của dự án', f.otherIn, 'NCC hoàn tạm ứng, thu khác'],
            ['Đã chi cho dự án', -f.spent, 'NCC, chi khác, quỹ công trường'], ['Vốn công ty cấp (ròng)', f.capital, 'cấp − thu hồi'], ['Số dư quỹ', f.balance, 'không phải tiền ngân hàng']] as const).map(([l, v, h]) =>
            <div key={l} className={`rounded-xl px-3 py-2 ${l === 'Số dư quỹ' ? 'bg-teal-50 dark:bg-teal-950/30' : 'bg-muted/50'}`}><dt className="text-xs text-muted-foreground">{l}</dt>
              <dd className={v == null ? 'font-semibold text-amber-700' : l === 'Đã chi cho dự án' ? 'font-semibold tabular-nums text-foreground' : v < -0.5 ? 'font-semibold tabular-nums text-rose-700' : NUM}>{v == null ? 'Chưa biết' : signedMoney(v)}</dd><dd className="text-[11px] text-muted-foreground">{h}</dd></div>)}
        </dl>
        {f.pending > 0.5 && <p className="mt-2 text-xs text-muted-foreground">Đang duyệt / chờ chi cho dự án: <b className="text-foreground">{shortMoney(f.pending)}</b>{f.balance != null && <> — chi hết thì quỹ còn <b className={f.balance - f.pending < 0 ? 'text-rose-700' : 'text-foreground'}>{signedMoney(f.balance - f.pending)}</b></>}.</p>}

        {(!op || op.status === 'rejected' || op.status === 'cancelled') ? <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <b>Chưa có đầu kỳ quỹ{op?.status === 'rejected' ? ' (bản trước bị trả lại' + (op.decisionNote ? `: ${op.decisionNote}` : '') + ')' : ''}.</b> Kế toán khai tiền CĐT đã trả − tiền đã chi đến 30/09 theo MISA; người khác chốt. Chưa có thì chưa biết số dư và chưa xét được bước "Cấp vốn dự án".
          {can.record && <button type="button" onClick={() => setDrawer({ kind: 'opening' })} className={`${primaryBtn} mt-2`}><Plus size={15} />Khai đầu kỳ quỹ</button>}</div>
          : <div className={`mt-3 flex flex-wrap items-center justify-end gap-2 rounded-xl border px-3 py-2 text-sm ${op.status === 'submitted' ? 'border-amber-300 bg-amber-50/60' : 'border-border'}`}>
            <span className="min-w-0 flex-1 basis-full sm:basis-auto"><b>Đầu kỳ {op.status === 'submitted' ? 'chờ chốt' : 'đã chốt'}:</b> đã thu {shortMoney(op.receivedToDate)} − đã chi {shortMoney(op.spentToDate)} = <b className={op.balance < 0 ? 'text-rose-700' : NUM}>{signedMoney(op.balance)}</b>
              <span className="block text-xs text-muted-foreground">Lập: {op.createdByName}{op.decidedByName ? ` · chốt: ${op.decidedByName} ${viDate(op.decidedAt)}` : ''}{op.note ? ` · ${op.note}` : ''}</span></span>
            {op.attachments.map(x => <button key={x.path} type="button" onClick={() => void financeService.openAttachment(x.path)} className="text-xs font-semibold text-teal-700 hover:underline"><FileText size={12} className="mr-0.5 inline" />{x.name}</button>)}
            {op.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại đầu kỳ quỹ', targetName: p.code, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' }); if (r) void run(() => financeService.decideFundOpening({ id: op.id, action: 'reject', reason: r }), 'Đã trả lại.'); }}><X size={14} />Trả lại</button>
              <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Chốt đầu kỳ quỹ?', targetName: `${p.code} · ${signedMoney(op.balance)}`, confirmText: 'Chốt', actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0, warningText: 'Đã đối chiếu sổ chi tiết MISA theo dự án đến 30/09.' })) void run(() => financeService.decideFundOpening({ id: op.id, action: 'confirm' }), 'Đã chốt đầu kỳ quỹ.'); }}><Check size={14} />Chốt</button></>}
            {op.canCancel && <button type="button" disabled={busy} className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => { const r = await askReason({ title: 'Hủy đầu kỳ đã chốt', targetName: p.code, subtitle: 'Dùng khi số đầu kỳ sai; sau đó khai lại.', reasonLabel: 'Lý do', actionLabel: 'Hủy đầu kỳ', intent: 'danger' }); if (r) void run(() => financeService.decideFundOpening({ id: op.id, action: 'cancel', reason: r }), 'Đã hủy đầu kỳ — khai lại.'); }}>Hủy đầu kỳ</button>}
          </div>}

        <h4 className="mt-4 text-sm font-semibold">Tiền vào / ra của quỹ từ 01/10</h4>
        {f.rows.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Chưa có. Phiếu thu CĐT, khoản chi NCC / chi khác / tạm ứng của dự án, chuyển tiền sang quỹ công trường và cấp vốn sẽ tự ghi vào đây khi được xác nhận.</p>
          : <ul className="mt-1 divide-y divide-border rounded-xl border border-border text-sm">{f.rows.map((r, i) => <li key={i} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${r.reversal ? 'opacity-70' : ''}`}>
            <span className="w-12 tabular-nums text-muted-foreground">{r.date.slice(8, 10)}/{r.date.slice(5, 7)}</span>
            <span className="min-w-0 flex-1"><b>{FUND_KIND[r.kind]}</b>{r.reversal && <Badge className="ml-1 border-border bg-muted text-muted-foreground">đảo</Badge>}<span className="block truncate text-xs text-muted-foreground">{r.code ? `${r.code} · ` : ''}{r.description}</span></span>
            <span className={`whitespace-nowrap font-semibold tabular-nums ${r.amount >= 0 ? 'text-leaf-700' : 'text-foreground'}`}>{r.amount >= 0 ? '+' : '−'}{money(Math.abs(r.amount))}</span></li>)}</ul>}
      </section>
      <aside className="space-y-3">
        <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm"><h3 className="font-semibold">Khi quỹ âm</h3>
          <p className="mt-1 text-muted-foreground">Đề nghị chi / tạm ứng / phiếu chi khác làm quỹ dự án âm → thêm bước <b className="text-foreground">"Cấp vốn dự án"</b>. Chi xong, phần thiếu tự ghi là vốn công ty cấp. Không chặn cứng để kịp hạn trả NCC.</p>
          <p className="mt-2 text-muted-foreground">Cấp vốn / thu hồi vốn tay: chỉ người được cài ở Quản trị. Khi CĐT trả tiền, quỹ tự tăng; ghi "thu hồi vốn" để hoàn vốn công ty.</p></section>
        <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm"><h3 className="font-semibold">Lịch sử cấp vốn</h3>
          {f.capitalList.length === 0 ? <p className="mt-1 text-muted-foreground">Chưa có.</p> : <ul className="mt-1 divide-y divide-border">{f.capitalList.map(c => <li key={c.id} className={`py-2 ${c.status === 'reversed' ? 'opacity-60' : ''}`}>
            <p className="flex items-center gap-2"><b>{c.kind === 'topup' ? 'Cấp vốn' : 'Thu hồi'}</b><span className="text-xs text-muted-foreground">{c.code} · {viDate(c.date)}</span>
              <span className={`ml-auto font-semibold tabular-nums ${c.kind === 'topup' ? 'text-leaf-700' : 'text-foreground'}`}>{c.kind === 'topup' ? '+' : '−'}{shortMoney(c.amount)}</span></p>
            <p className="text-xs text-muted-foreground">{c.reason} · {c.createdByName}{c.sourceType === 'payment_request' ? ' · tự ghi khi chi' : ''}{c.status === 'reversed' ? ` · đã đảo${c.reverseReason ? `: ${c.reverseReason}` : ''}` : ''}</p>
            {c.canReverse && <button type="button" disabled={busy} className="mt-0.5 text-xs font-semibold text-rose-700 hover:underline" onClick={async () => { const r = await askReason({ title: 'Đảo khoản cấp vốn', targetName: `${c.code} · ${shortMoney(c.amount)}`, reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' }); if (r) void run(() => financeService.reverseCapital({ id: c.id, reason: r }), 'Đã đảo.'); }}><RotateCcw size={11} className="mr-0.5 inline" />Đảo</button>}
          </li>)}</ul>}</section>
      </aside>
    </div>}

    {drawer?.kind === 'budget' && <BudgetDrawer data={data} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'opening' && <FundOpeningDrawer data={data} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'capital' && <CapitalDrawer data={data} kind={drawer.mode} onClose={() => setDrawer(null)} onSaved={done} />}
  </div>;
};
