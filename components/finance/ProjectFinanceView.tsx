import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownUp, CalendarRange, ArrowLeft, Banknote, BarChart3, Building2, ChevronDown, ChevronLeft, ChevronRight, Coins, Download, FileSpreadsheet, FileText, HandCoins, HardHat, PiggyBank, ReceiptText, Scale, Search, TrendingUp, Wallet, X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useToast } from '../../context/ToastContext';
import { SOURCE_LABELS, financeService, type FinanceMyScope, type FinanceProjectPage } from '../../lib/financeService';
import { loadXlsx } from '../../lib/loadXlsx';
import { Badge, StateBox, inputCls, money, secondaryBtn } from '../procurement/hub/hubUi';
import { ProjectCost } from './CostView';
import { MisaImportDrawer } from './MisaImport';
import { ForecastView } from './ForecastView';
import { CustomerContractPanel } from './CustomerContractPanel';
import { SubcontractPanel } from './SubcontractsView';
import { ENT, NUM, clickCls, dueText, shortMoney, toneOf, TONE_TEXT, viDate, type LedgerFilter } from './financeUi';

// Tài chính dự án: một trang cho một dự án — thay tab Tài chính trong Module Dự án (chủ SP duyệt doc 14, 05/10/2026).
// Người có Tài chính — Xem thấy mọi dự án; người được Admin bật công tắc "xem tài chính dự án" chỉ thấy dự án được bật, chỉ đọc.

type Tab = 'overview' | 'cost' | 'receivables' | 'payables' | 'ledger' | 'forecast';
const TABS: Array<[Tab, string, React.ElementType]> = [['overview', 'Tổng quan', BarChart3], ['cost', 'Chi phí & ngân sách', Scale],
  ['receivables', 'Phải thu', HandCoins], ['payables', 'Phải trả', Wallet], ['ledger', 'Sổ giao dịch', ReceiptText], ['forecast', 'Dự báo', CalendarRange]];
const Unknown: React.FC<{ why: string }> = ({ why }) => <span className="font-semibold text-slate-500" title={why}>chưa biết</span>;
const Kpi: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; hint: React.ReactNode; tone?: string; onClick?: () => void; title?: string }> = ({ icon: I, label, value, hint, tone = 'text-leaf-700 dark:text-leaf-300', onClick, title }) => {
  const body = <><span className="flex items-start gap-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground"><I size={14} className="shrink-0 text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span><span className="block text-xs text-muted-foreground">{hint}</span></>;
  return onClick ? <button type="button" onClick={onClick} title={title} className={`rounded-2xl border border-border bg-card p-3 shadow-sm ${clickCls(true)}`}>{body}</button>
    : <article className="rounded-2xl border border-border bg-card p-3 shadow-sm">{body}</article>;
};
/** Giao dịch chưa gắn khoản mục được tự xếp theo loại chi phí (như máy chủ: finance_cost_item_of). */
const ITEM_BY_CATEGORY: Record<string, string> = { materials: 'CPNVL', labor: 'CPNC', machinery: 'CPMTC', overhead: 'CPQL' };
type Row = FinanceProjectPage['ledger'][number];
const kindOf = (x: Row) => x.payment ? 'payment' : x.type;
const itemOf = (x: Row) => x.item || ITEM_BY_CATEGORY[x.category || ''] || 'CPK';
/** Thu là +, chi phí / chi tiền là −; dòng đảo (số âm) đổi dấu. */
const signedOf = (x: Row) => (x.type === 'revenue_received' ? 1 : -1) * x.amount;

export const ProjectFinanceView: React.FC<{ initialProjectId?: string | null; standalone?: boolean; onProjectChange?: (id: string) => void }> = ({ initialProjectId, standalone, onProjectChange }) => {
  const [scope, setScope] = useState<FinanceMyScope | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId || null);
  const [data, setData] = useState<FinanceProjectPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q0 = new URLSearchParams(useLocation().search);
  const t0 = q0.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.some(([k]) => k === t0) ? t0 as Tab : 'overview');
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>({ kind: (q0.get('kind') as LedgerFilter['kind']) || undefined, item: q0.get('item') || undefined, month: q0.get('month') || undefined });
  const [costTab, setCostTab] = useState<'budget' | 'fund'>('budget');
  const [payFilter, setPayFilter] = useState<'all' | 'overdue'>('all');
  const [reloadKey, setReloadKey] = useState(0);
  const openLedger = (f: LedgerFilter) => { setLedgerFilter(f); setTab('ledger'); window.scrollTo({ top: 0 }); };
  const go = (t: Tab, opts: { cost?: 'budget' | 'fund'; pay?: 'all' | 'overdue' } = {}) => { if (opts.cost) setCostTab(opts.cost); if (opts.pay) setPayFilter(opts.pay); setTab(t); window.scrollTo({ top: 0 }); };
  useEffect(() => {
    financeService.myScope().then(s => { setScope(s); setProjectId(cur => (cur && s.projects.some(p => p.id === cur) ? cur : s.projects[0]?.id || null)); })
      .catch(e => setScopeError(e instanceof Error ? e.message : String(e)));
  }, []);
  const load = useCallback(() => {
    if (!projectId) return;
    setError(null); setData(null);
    financeService.projectPage(projectId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);
  useEffect(load, [load, reloadKey]);
  const pick = (id: string) => { setProjectId(id); setTab('overview'); setLedgerFilter({}); onProjectChange?.(id); };

  if (scopeError) return <StateBox kind="error" title="Chưa tải được Tài chính dự án" message={scopeError} />;
  if (!scope) return <StateBox kind="loading" title="Đang tải các dự án bạn được xem…" />;
  if (scope.projects.length === 0) return <StateBox kind="denied" title="Chưa có dự án nào bạn được xem tài chính"
    message="Tài chính dự án mở cho người có quyền Tài chính — Xem, hoặc người được Admin bật công tắc &quot;Xem tài chính dự án&quot; ở dự án. Nhờ Admin bật nếu bạn cần." />;
  return <div className="space-y-3">
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-sm font-semibold"><Building2 size={16} className="shrink-0 text-teal-700" />
        <select value={projectId || ''} onChange={e => pick(e.target.value)} aria-label="Dự án" className={`w-full ${inputCls}`}>
          {scope.projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label>
      {!scope.companyView && <Badge className="border-slate-200 bg-slate-100 text-slate-600">Chỉ xem · {scope.projects.length} dự án được bật</Badge>}
      <nav role="tablist" aria-label="Phần của dự án" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-background p-1">
        {TABS.map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}><I size={14} />{l}</button>)}
      </nav>
    </section>
    {error ? <StateBox kind={error.includes('chưa được bật') ? 'denied' : 'error'} title="Chưa tải được dự án" message={error} onRetry={load} />
      : !data ? <StateBox kind="loading" title="Đang tải tài chính dự án…" />
      : tab === 'overview' ? <Overview d={data} onGo={go} onLedger={openLedger} />
      : tab === 'cost' ? <ProjectCost key={`${data.project.id}:${reloadKey}:${costTab}`} projectId={data.project.id} initialTab={costTab} onOpenLedger={openLedger} onChanged={() => setReloadKey(k => k + 1)} />
      : tab === 'receivables' ? <Receivables d={data} onChanged={() => setReloadKey(k => k + 1)} />
      : tab === 'forecast' ? <ForecastView key={data.project.id} projectId={data.project.id} />
      : tab === 'payables' ? <Payables d={data} filter={payFilter} setFilter={setPayFilter} onChanged={() => setReloadKey(k => k + 1)} />
      : <Ledger d={data} filter={ledgerFilter} setFilter={setLedgerFilter} onImported={() => setReloadKey(k => k + 1)} />}
    {standalone && <p className="text-xs text-muted-foreground">Số liệu chỉ xem. Thu chi, công nợ, ngân sách do kế toán ghi ở module Tài chính.</p>}
  </div>;
};

// ---------- Tổng quan ----------
const Overview: React.FC<{ d: FinanceProjectPage; onGo: (t: Tab, opts?: { cost?: 'budget' | 'fund'; pay?: 'all' | 'overdue' }) => void; onLedger: (f: LedgerFilter) => void }> = ({ d, onGo, onLedger }) => {
  const cs = d.contracts; const c = d.cost; const f = d.fund;
  const gross = cs.reduce((s, x) => s + x.metrics.gross, 0);
  const est = cs.some(x => x.metrics.estOutput != null) ? cs.reduce((s, x) => s + (x.metrics.estOutput || 0), 0) : null;
  const estNet = cs.some(x => x.metrics.estOutput != null) ? cs.reduce((s, x) => s + (x.metrics.estOutput || 0) / (1 + x.vatPercent / 100), 0) : null;
  const received = cs.reduce((s, x) => s + x.metrics.received, 0);
  const receivable = cs.reduce((s, x) => s + x.metrics.outstanding, 0);
  const openingTodo = cs.some(x => x.metrics.opening === 'todo');
  const payable = d.payables.reduce((s, x) => s + x.outstanding, 0);
  const overdue = d.payables.filter(x => x.dueDate && x.dueDate < d.today).reduce((s, x) => s + x.outstanding, 0);
  const subTodo = d.subcontracts.filter(x => x.metrics.opening !== 'confirmed').length;
  const margin = estNet != null ? estNet - c.actual : null;
  const chart = d.months.map(m => ({ m: `${m.month.slice(5, 7)}/${m.month.slice(2, 4)}`, 'CĐT trả': Math.round(m.revenue / 1e6) / 1e3, 'Chi phí ghi nhận': Math.round(m.cost / 1e6) / 1e3, 'Đã chi NCC': Math.round(m.paid / 1e6) / 1e3 }));
  const alerts = [
    openingTodo && { t: 'Chưa chốt đầu kỳ phải thu theo MISA', s: 'Phải thu, tạm ứng CĐT còn thu hồi đang tạm tính.', go: 'receivables' as Tab },
    subTodo > 0 && { t: `${subTodo} HĐ thầu phụ chưa chốt đầu kỳ`, s: 'Còn nợ / giữ lại thầu phụ trước 01/10 chưa biết.', go: 'payables' as Tab },
    f.balance == null && { t: 'Chưa chốt đầu kỳ quỹ dự án', s: 'Số dư quỹ dự án chưa biết.', go: 'cost' as Tab },
    c.overItems > 0 && { t: `${c.overItems} khoản mục vượt ngân sách`, s: c.overList.slice(0, 2).map(o => `${o.item}: ${shortMoney(o.used)} / ${shortMoney(o.budget)}`).join(' · '), go: 'cost' as Tab },
    c.budget == null && { t: 'Chưa có ngân sách khoản mục', s: 'Chưa cảnh báo được vượt ngân sách.', go: 'cost' as Tab },
    c.unclassified > 0.5 && { t: `${shortMoney(c.unclassified)} chi phí chưa xếp khoản mục`, s: 'Xem ở Sổ giao dịch.', go: 'ledger' as Tab },
  ].filter(Boolean) as Array<{ t: string; s: string; go: Tab }>;
  return <div className="space-y-3">
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Building2 size={20} /></span>
      <div className="min-w-0 flex-1"><h2 className={`text-lg ${ENT}`}>{d.project.code} — {d.project.name}</h2>
        <p className="text-sm text-muted-foreground">Tiến độ theo Gantt {d.project.progress != null ? `${d.project.progress}%` : 'chưa có kế hoạch'} ·{' '}
          <button type="button" onClick={() => onGo('receivables')} className="font-semibold text-teal-700 hover:underline">{cs.length} HĐ chủ đầu tư</button> ·{' '}
          <button type="button" onClick={() => onGo('payables')} className="font-semibold text-teal-700 hover:underline">{d.subcontracts.length} HĐ thầu phụ</button></p></div>
    </section>
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Kpi icon={FileText} label="Giá trị HĐ (gồm VAT)" onClick={() => onGo('receivables')} title="Xem HĐ chủ đầu tư, đợt thu" value={gross ? shortMoney(gross) : '—'} hint={est != null ? `sản lượng ước tính ${shortMoney(est)}` : 'chưa có tiến độ'} />
      <Kpi icon={HandCoins} label="CĐT đã trả" onClick={() => onLedger({ kind: 'revenue_received' })} title="Mở Sổ giao dịch — các khoản CĐT trả" value={shortMoney(received)} hint={gross ? `${Math.round(received * 100 / gross)}% giá trị HĐ` : '—'} />
      <Kpi icon={TrendingUp} label="Phải thu đang mở" onClick={() => onGo('receivables')} title="Xem đợt thu còn phải thu" value={shortMoney(receivable)} hint={openingTodo ? 'tạm tính — chưa chốt đầu kỳ' : 'CĐT đã xác nhận, chưa trả'} tone={openingTodo ? 'text-foreground' : undefined} />
      <Kpi icon={Coins} label="Chi phí đã ghi nhận" onClick={() => onLedger({ kind: 'expense' })} title="Mở Sổ giao dịch — các khoản chi phí" value={shortMoney(c.actual)} hint={`cam kết thêm ${shortMoney(c.committed)}${c.eac ? ` · dự báo khi xong ${shortMoney(c.eac)}` : ''}`} tone="text-foreground" />
      <Kpi icon={Scale} label="Sản lượng − chi phí (tạm tính)" onClick={() => onGo('cost')} title="Xem chi phí theo khoản mục" value={margin == null ? <Unknown why="Chưa có tiến độ Gantt" /> : shortMoney(margin)} hint="sản lượng trước VAT − chi phí đã ghi"
        tone={margin != null && margin < 0 ? 'text-rose-700' : undefined} />
      <Kpi icon={Wallet} label="Còn phải trả NCC / thầu phụ" onClick={() => onGo('payables', { pay: overdue > 0 ? 'overdue' : 'all' })} title={overdue > 0 ? 'Xem chứng từ quá hạn' : 'Xem công nợ đang mở'} value={shortMoney(payable)} hint={overdue > 0 ? `${shortMoney(overdue)} quá hạn` : subTodo ? `chưa gồm đầu kỳ ${subTodo} HĐ thầu phụ` : 'theo hạn'}
        tone={overdue > 0 ? 'text-rose-700' : undefined} />
      <Kpi icon={PiggyBank} label="Quỹ dự án" onClick={() => onGo('cost', { cost: 'fund' })} title="Xem quỹ dự án" value={f.balance == null ? <Unknown why="Chưa chốt đầu kỳ quỹ dự án" /> : shortMoney(f.balance)} hint={f.balance == null ? 'chưa chốt đầu kỳ' : `thu ${shortMoney(f.received)} · chi ${shortMoney(f.spent)} từ 01/10`} />
      <Kpi icon={Banknote} label="Vật tư so với dự toán" onClick={() => onLedger({ item: 'CPNVL' })} title="Mở Sổ giao dịch — khoản mục vật tư" value={c.materialBudget ? `${Math.round((c.materialActual + c.materialCommitted) * 100 / c.materialBudget)}%` : '—'}
        hint={c.materialBudget ? `${shortMoney(c.materialActual + c.materialCommitted)} / ${shortMoney(c.materialBudget)} (gồm đơn chưa nhận)` : 'chưa có dự toán vật tư'}
        tone={c.materialBudget && c.materialActual + c.materialCommitted > c.materialBudget ? 'text-rose-700' : undefined} />
    </section>
    {alerts.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <h3 className="flex items-center gap-1.5 font-bold"><AlertTriangle size={16} />Cần chú ý</h3>
      <ul className="mt-2 grid gap-2 md:grid-cols-2">{alerts.map(a => <li key={a.t}><button type="button" onClick={() => onGo(a.go)} className="w-full rounded-xl border border-amber-200 bg-card p-2.5 text-left hover:shadow">
        <b className="block">{a.t}</b><span className="text-xs text-muted-foreground">{a.s}</span></button></li>)}</ul></section>}
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">Theo tháng (tỷ đồng)</h3>
      {chart.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có giao dịch trong 12 tháng gần nhất.</p>
        : <div className="mt-2 h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ left: -16, right: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} /><Tooltip formatter={(v: number) => `${v.toLocaleString('vi-VN')} tỷ`} /><Legend />
          <Bar dataKey="CĐT trả" fill="#52b53a" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(_, i) => onLedger({ kind: 'revenue_received', month: d.months[i]?.month })} />
          <Bar dataKey="Chi phí ghi nhận" fill="#3cbfaa" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(_, i) => onLedger({ kind: 'expense', month: d.months[i]?.month })} />
          <Bar dataKey="Đã chi NCC" fill="#0f766e" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(_, i) => onLedger({ kind: 'payment', month: d.months[i]?.month })} />
        </BarChart></ResponsiveContainer></div>}
      <p className="mt-1 text-xs text-muted-foreground">Bấm vào cột để xem giao dịch của tháng đó. Trước 01/10 phần lớn là số MISA nhập vào; chi NCC trước mốc chưa có trong Vioo.</p>
    </section>
  </div>;
};

// ---------- Phải thu ----------
const Receivables: React.FC<{ d: FinanceProjectPage; onChanged: () => void }> = ({ d, onChanged }) => {
  const [sel, setSel] = useState<string | null>(d.contracts[0]?.id || null);
  if (d.contracts.length === 0) return <StateBox kind="empty" title="Dự án chưa có HĐ chủ đầu tư" message="Khai HĐ chủ đầu tư ở module Hợp đồng; đợt thu, phiếu thu làm ở Tài chính → Phải thu." />;
  return <div className="space-y-3">
    {d.contracts.length > 1 && <div className="flex flex-wrap gap-2">{d.contracts.map(c => <button key={c.id} type="button" onClick={() => setSel(c.id)}
      className={`rounded-xl border px-3 py-2 text-left text-sm ${sel === c.id ? 'border-teal-500 bg-teal-50' : 'border-border bg-card'}`}><b className={ENT}>{c.code}</b><span className="block text-xs text-muted-foreground">{c.customerName}</span></button>)}</div>}
    {sel && <CustomerContractPanel key={sel} contractId={sel} onBack={() => undefined} onChanged={onChanged} />}
  </div>;
};

// ---------- Phải trả ----------
const Payables: React.FC<{ d: FinanceProjectPage; filter: 'all' | 'overdue'; setFilter: (f: 'all' | 'overdue') => void; onChanged: () => void }> = ({ d, filter, setFilter, onChanged }) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sub, setSub] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; docs: FinanceProjectPage['payables'] }>();
    d.payables.filter(x => filter === 'all' || (x.dueDate && x.dueDate < d.today)).forEach(x => { const g = m.get(x.supplierId) || { name: x.supplierName, docs: [] }; g.docs.push(x); m.set(x.supplierId, g); });
    return [...m.entries()].map(([id, g]) => ({ id, ...g, owed: g.docs.reduce((s, x) => s + x.outstanding, 0),
      overdue: g.docs.filter(x => x.dueDate && x.dueDate < d.today).reduce((s, x) => s + x.outstanding, 0) })).sort((a, b) => b.overdue - a.overdue || b.owed - a.owed);
  }, [d, filter]);
  if (sub) return <div className="space-y-2"><button type="button" onClick={() => setSub(null)} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700"><ArrowLeft size={15} />Phải trả của dự án</button>
    <SubcontractPanel id={sub} onBack={() => setSub(null)} onChanged={onChanged} /></div>;
  return <div className="space-y-3">
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"><span className="min-w-0 flex-1"><h3 className="font-semibold">Nhà cung cấp / thầu phụ đang nợ</h3><p className="text-xs text-muted-foreground">Chứng từ đã ghi nhận, chưa trả hết. Trả bằng Đề nghị chi ở Tài chính → Phải trả.</p></span>
        <div role="tablist" aria-label="Lọc công nợ" className="inline-flex rounded-lg border border-border p-0.5 text-sm">{([['all', 'Tất cả'], ['overdue', 'Quá hạn']] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 font-semibold ${filter === k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div></div>
      {groups.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{filter === 'overdue' ? 'Không có chứng từ quá hạn.' : 'Không còn công nợ đang mở của dự án.'}</p>
        : <ul className="divide-y divide-border text-sm">{groups.map(g => <li key={g.id}>
          <button type="button" onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40">
            {open[g.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span className={`min-w-0 flex-1 truncate ${ENT}`}>{g.name}</span>
            <span className="text-xs text-muted-foreground">{g.docs.length} chứng từ</span>
            {g.overdue > 0 && <span className="text-xs font-semibold text-rose-700">{shortMoney(g.overdue)} quá hạn</span>}<span className={`w-20 text-right ${NUM}`}>{shortMoney(g.owed)}</span></button>
          {open[g.id] && <ul className="divide-y divide-border bg-muted/20">{g.docs.map(x => { const tone = toneOf(x.dueDate, x.outstanding, d.today);
            return <li key={x.id} className="flex flex-wrap items-center gap-2 px-10 py-2 text-xs"><span className="min-w-0 flex-1"><b>{x.documentNo}</b> · {SOURCE_LABELS[x.sourceType] || x.sourceType} · {viDate(x.documentDate)}</span>
              <span className={TONE_TEXT[tone]}>{x.sourceType === 'subcontract_retention' && !x.dueDate ? 'giữ lại — chưa có hạn' : dueText(x.dueDate, x.outstanding, d.today)}</span><span className="w-24 text-right tabular-nums">{money(x.outstanding)} đ</span></li>; })}</ul>}
        </li>)}</ul>}
    </section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5"><h3 className="flex items-center gap-1.5 font-semibold"><HardHat size={15} className="text-teal-700" />Hợp đồng thầu phụ</h3></div>
      {d.subcontracts.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Dự án chưa có HĐ thầu phụ trong Vioo.</p>
        : <ul className="divide-y divide-border text-sm">{d.subcontracts.map(s => <li key={s.id}><button type="button" onClick={() => setSub(s.id)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40">
          <span className="min-w-0 flex-1"><b className={ENT}>{s.name}</b><span className="block text-xs text-muted-foreground">{s.code} · lũy kế {s.metrics.hasRounds ? shortMoney(s.metrics.cumulativeNet) : 'chưa biết'}</span></span>
          {s.metrics.opening !== 'confirmed' && <Badge className="border-slate-200 bg-slate-100 text-slate-600">Chưa chốt đầu kỳ</Badge>}
          <span className="text-right text-xs text-muted-foreground">còn phải trả<b className={`block text-sm ${NUM}`}>{s.metrics.opening === 'confirmed' ? shortMoney(s.metrics.outstanding) : '—'}</b></span></button></li>)}</ul>}
    </section>
  </div>;
};

// ---------- Sổ giao dịch ----------
const TYPE_LABEL: Record<string, string> = { revenue_received: 'Thu CĐT', expense: 'Chi phí', payment: 'Chi tiền NCC' };
type Sort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
const PAGE = 10;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const Ledger: React.FC<{ d: FinanceProjectPage; filter: LedgerFilter; setFilter: (f: LedgerFilter) => void; onImported: () => void }> = ({ d, filter, setFilter, onImported }) => {
  const [misa, setMisa] = useState(false);
  const toast = useToast();
  const [q, setQ] = useState(''); const [sort, setSort] = useState<Sort>('date_desc'); const [page, setPage] = useState(1);
  const months = useMemo(() => [...new Set(d.ledger.map(x => x.date.slice(0, 7)))].sort().reverse(), [d]);
  const items = useMemo(() => { const m = new Map<string, string>(); d.ledger.forEach(x => { if (x.type === 'expense' && !x.payment) { const k = itemOf(x); if (!m.has(k)) m.set(k, x.item ? x.itemName || k : k); } });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }, [d]);
  const rows = useMemo(() => { const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    const r = d.ledger.filter(x => (!filter.kind || kindOf(x) === filter.kind) && (!filter.month || x.date.startsWith(filter.month))
      && (!filter.item || (x.type === 'expense' && !x.payment && (filter.item === '__none__' ? !x.item : itemOf(x) === filter.item)))
      && w.every(t => `${x.description || ''} ${x.counterparty || ''} ${x.item || ''} ${x.itemName || ''} ${x.invoiceNo || ''}`.toLowerCase().includes(t)));
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      date_desc: (a, b) => b.date.localeCompare(a.date), date_asc: (a, b) => a.date.localeCompare(b.date),
      amount_desc: (a, b) => Math.abs(b.amount) - Math.abs(a.amount), amount_asc: (a, b) => Math.abs(a.amount) - Math.abs(b.amount) };
    return [...r].sort(by[sort]); }, [d, q, filter, sort]);
  useEffect(() => setPage(1), [q, filter, sort, d]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages);
  const view = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const tin = rows.filter(x => signedOf(x) > 0).reduce((s, x) => s + signedOf(x), 0); const tout = rows.filter(x => signedOf(x) < 0).reduce((s, x) => s + signedOf(x), 0);
  const chips = [filter.kind && { k: 'kind', l: TYPE_LABEL[filter.kind] }, filter.item && { k: 'item', l: `Khoản mục ${filter.item === '__none__' ? 'chưa xếp' : filter.item}` },
    filter.month && { k: 'month', l: `Tháng ${filter.month.slice(5, 7)}/${filter.month.slice(0, 4)}` }].filter(Boolean) as Array<{ k: keyof LedgerFilter; l: string }>;
  const exportXlsx = async () => {
    try {
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.json_to_sheet(rows.map(x => ({ 'Ngày': x.date.slice(0, 10), 'Loại': TYPE_LABEL[kindOf(x)] || x.type, 'Khoản mục': x.type === 'expense' && !x.payment ? itemOf(x) : '', 'Nội dung': x.description || '',
        'Đối tượng': x.counterparty || '', 'Số HĐ': x.invoiceNo || '', 'Số tiền (+ thu, − chi)': signedOf(x), 'Nguồn': x.source || '' })));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'So giao dich');
      XLSX.writeFile(wb, `so-giao-dich-${d.project.code}${filter.month ? `-${filter.month}` : ''}${filter.item ? `-${filter.item}` : ''}.xlsx`);
      toast.success('Đã xuất Excel', `${rows.length} dòng`);
    } catch (e) { toast.error('Chưa xuất được Excel', e instanceof Error ? e.message : ''); }
  };
  const pageBtns = Array.from(new Set([1, cur - 1, cur, cur + 1, pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
      <label className="relative min-w-[12rem] flex-1"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm nội dung, đối tượng, khoản mục, số HĐ…" className={`w-full pl-8 ${inputCls}`} /></label>
      <select value={filter.kind || ''} onChange={e => setFilter({ ...filter, kind: (e.target.value || undefined) as LedgerFilter['kind'] })} aria-label="Loại" className={`max-w-full ${inputCls}`}>
        <option value="">Mọi loại</option><option value="revenue_received">Thu CĐT</option><option value="expense">Chi phí</option><option value="payment">Chi tiền NCC</option></select>
      <select value={filter.item || ''} onChange={e => setFilter({ ...filter, item: e.target.value || undefined })} aria-label="Khoản mục" className={`max-w-full ${inputCls}`}>
        <option value="">Mọi khoản mục</option>{items.map(([k, n]) => <option key={k} value={k}>{k}{n !== k ? ` — ${n}` : ''}</option>)}<option value="__none__">Chưa gắn khoản mục</option></select>
      <select value={filter.month || ''} onChange={e => setFilter({ ...filter, month: e.target.value || undefined })} aria-label="Tháng" className={`max-w-full ${inputCls}`}>
        <option value="">Mọi tháng</option>{months.map(m => <option key={m} value={m}>{m.slice(5, 7)}/{m.slice(0, 4)}</option>)}</select>
      <label className="inline-flex items-center gap-1 text-sm"><ArrowDownUp size={14} className="text-muted-foreground" /><select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sắp xếp" className={inputCls}>
        <option value="date_desc">Ngày mới → cũ</option><option value="date_asc">Ngày cũ → mới</option><option value="amount_desc">Số tiền lớn → nhỏ</option><option value="amount_asc">Số tiền nhỏ → lớn</option></select></label>
      <button type="button" onClick={() => void exportXlsx()} disabled={!rows.length} className={secondaryBtn}><Download size={15} />Xuất Excel</button>
      {d.can.record && <button type="button" onClick={() => setMisa(true)} title="Nhập chi phí từ file Excel sổ chi tiết MISA" className={secondaryBtn}><FileSpreadsheet size={15} />Nhập số MISA</button>}
    </div>
    {misa && <MisaImportDrawer projectId={d.project.id} projectLabel={`${d.project.code} · ${d.project.name}`} onClose={() => setMisa(false)} onSaved={() => { setMisa(false); onImported(); }} />}
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-xs">
      {chips.map(c => <button key={c.k} type="button" onClick={() => setFilter({ ...filter, [c.k]: undefined })} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-semibold text-teal-800">{c.l}<X size={12} /></button>)}
      {chips.length > 1 && <button type="button" onClick={() => setFilter({})} className="font-semibold text-teal-700 hover:underline">Xóa lọc</button>}
      <span className="ml-auto text-muted-foreground">{rows.length.toLocaleString('vi-VN')} dòng · thu <b className="text-leaf-700">{signed(tin)}</b> · chi <b className="text-rose-700">{signed(tout)}</b>
        {d.ledgerTotal > d.ledger.length ? ` · trong ${d.ledger.length.toLocaleString('vi-VN')}/${d.ledgerTotal.toLocaleString('vi-VN')} dòng gần nhất` : ''}</span>
    </div>
    {rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không có giao dịch khớp bộ lọc.</p> : <>
      <div className="hidden md:block"><table className="w-full text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Ngày</th><th className="px-2 text-left">Loại</th><th className="px-2 text-left">Khoản mục</th><th className="px-2 text-left">Nội dung</th><th className="px-3 text-right">Số tiền</th></tr></thead>
        <tbody className="divide-y divide-border">{view.map(x => { const v = signedOf(x); const isCost = x.type === 'expense' && !x.payment;
          return <tr key={x.id}><td className="whitespace-nowrap px-3 py-1.5">{viDate(x.date)}</td><td className="px-2 text-xs">{TYPE_LABEL[kindOf(x)] || x.type}</td>
            <td className="px-2 text-xs">{isCost ? <button type="button" onClick={() => setFilter({ ...filter, item: x.item ? itemOf(x) : '__none__' })} className="text-left hover:text-teal-700 hover:underline">{x.item || <span className="text-amber-700">tự xếp {itemOf(x)}</span>}</button> : '—'}</td>
            <td className="px-2"><span className="line-clamp-2">{x.description}</span>{x.counterparty && <span className="block text-xs text-muted-foreground">{x.counterparty}</span>}</td>
            <td className={`whitespace-nowrap px-3 text-right font-semibold tabular-nums ${v < 0 ? 'text-rose-700' : 'text-leaf-700'}`}>{signed(v)}</td></tr>; })}</tbody></table></div>
      <ul className="divide-y divide-border md:hidden">{view.map(x => { const v = signedOf(x);
        return <li key={x.id} className="px-3 py-2 text-sm"><span className="flex justify-between gap-2"><b>{viDate(x.date)} · {TYPE_LABEL[kindOf(x)] || x.type}</b><span className={`font-semibold tabular-nums ${v < 0 ? 'text-rose-700' : 'text-leaf-700'}`}>{signed(v)}</span></span>
          <span className="block text-xs text-muted-foreground">{x.type === 'expense' && !x.payment ? `${x.item || `tự xếp ${itemOf(x)}`} · ` : ''}{x.description}</span></li>; })}</ul>
      <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">{((cur - 1) * PAGE + 1).toLocaleString('vi-VN')}–{Math.min(cur * PAGE, rows.length).toLocaleString('vi-VN')} / {rows.length.toLocaleString('vi-VN')}</span>
        <span className="flex items-center gap-1">
          <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="Trang trước" className="rounded-lg border border-border p-1.5 disabled:opacity-40"><ChevronLeft size={15} /></button>
          {pageBtns.map((n, i) => <React.Fragment key={n}>{i > 0 && n - pageBtns[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <button type="button" onClick={() => setPage(n)} aria-current={n === cur ? 'page' : undefined} className={`min-w-[2rem] rounded-lg px-2 py-1 font-semibold ${n === cur ? 'bg-teal-700 text-white' : 'border border-border'}`}>{n}</button></React.Fragment>)}
          <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label="Trang sau" className="rounded-lg border border-border p-1.5 disabled:opacity-40"><ChevronRight size={15} /></button>
        </span>
      </nav>
    </>}
  </section>;
};
