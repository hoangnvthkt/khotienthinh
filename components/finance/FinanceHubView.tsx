import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, CalendarClock, CircleDollarSign, ClipboardCheck, FileCheck2, FileWarning, HandCoins, Inbox, PiggyBank, Coins,
  ArrowLeftRight, ListTodo, RefreshCw, Scale, Search, Settings2, Truck, Wallet,
} from 'lucide-react';
import { financeService, type FinanceAdvances, type FinancePayablesList, type FinanceSupplierSummary } from '../../lib/financeService';
import { AdvancesView, type AdvanceFilter } from './AdvancesView';
import { ReceivablesView } from './ReceivablesView';
import { CashView } from './CashView';
import type { FinanceReceivables } from '../../lib/financeService';
import { Badge, StateBox, inputCls, secondaryBtn } from '../procurement/hub/hubUi';
import { FinanceSettingsView } from './FinanceSettingsView';
import { DirectReceiptsView } from './DirectReceiptsView';
import { PaymentRequestsView } from './PaymentRequestsView';
import { PendingStatementsView } from './PendingStatementsView';
import { SupplierPanel } from './SupplierPanel';
import { TransferReviewsView } from './TransferReviewsView';
import { FinanceOverviewView } from './FinanceOverviewView';
import { FinanceTodoView, type TodoTarget } from './FinanceTodoView';
import { ENT, Kpi, NUM, TONE_BAR, TONE_TEXT, shortMoney, viDate } from './financeUi';

// Module Tài chính: một nơi cho công nợ, chi tiền, dòng tiền toàn công ty — không phải vào từng dự án.
// Tổng quan (Ban giám đốc), Việc cần làm (kế toán), Phải trả NCC (gồm tạm ứng NCC), Quản trị. Phải thu, Thu chi & quỹ, Chi phí & ngân sách mở ở đợt sau.

type Section = 'auto' | 'overview' | 'todo' | 'receivables' | 'payables' | 'cash' | 'settings';
type Stage = 'pending' | 'owed' | 'request' | 'approved' | 'paid' | 'advances';
type Filter = 'all' | 'overdue' | 'soon' | 'issues' | 'opening';
type Sort = 'overdue' | 'owed' | 'due' | 'name';

const OPENING_BADGE: Record<FinanceSupplierSummary['opening'], { label: string; cls: string } | null> = {
  not_needed: null,
  todo: { label: 'Chưa đối chiếu đầu kỳ', cls: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  pending: { label: 'Đầu kỳ chờ xác nhận', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  done: { label: 'Đã chốt đầu kỳ', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
};

export const FinanceHubView: React.FC<{ currentUserId: string; initialSection?: string | null; initialSupplierId?: string | null; initialRequestId?: string | null; initialContractId?: string | null }> = ({ currentUserId, initialSection, initialSupplierId, initialRequestId, initialContractId }) => {
  // Không chỉ định phần: Ban giám đốc (Tài chính — Quản trị) vào Tổng quan, kế toán vào Việc cần làm.
  const [section, setSection] = useState<Section>(initialSection === 'settings' || initialSection === 'overview' || initialSection === 'todo' || initialSection === 'receivables' || initialSection === 'cash' ? initialSection
    : initialSection || initialSupplierId || initialRequestId ? 'payables' : 'auto');
  const [stage, setStage] = useState<Stage>(initialSection === 'pending' ? 'pending' : initialSection === 'requests' ? 'request' : initialSection === 'advances' ? 'advances' : 'owed');
  const [advanceFilter, setAdvanceFilter] = useState<AdvanceFilter>('active');
  const [advances, setAdvances] = useState<FinanceAdvances['totals'] | null>(null);
  const [receivables, setReceivables] = useState<FinanceReceivables['totals'] | null>(null);
  const [rcvKey, setRcvKey] = useState(0);
  const [cashPending, setCashPending] = useState<{ waitingMe: number; openings: number; reconciliations: number; movements: number; accountsWithoutOpening: number; accounts: number; belowMinWeek: string | null; lowest: number | null; minBalance: number } | null>(null);
  const [requestCounts, setRequestCounts] = useState<{ request: number; approved: number; approvedAmount: number; paid: number; waitingMe: number } | null>(null);
  const [stageKey, setStageKey] = useState(0);
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }), []);
  // Link từ thông báo (?section=requests&request=…) mở đúng bước theo trạng thái đề nghị.
  useEffect(() => {
    if (!initialRequestId) return;
    financeService.paymentRequests('all').then(d => {
      const s = d.requests.find(x => x.id === initialRequestId)?.status;
      if (s === 'approved') setStage('approved'); else if (s === 'paid' || s === 'reversed') setStage('paid'); else setStage('request');
    }).catch(() => undefined);
  }, [initialRequestId]);
  const [data, setData] = useState<FinancePayablesList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [projectId, setProjectId] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState<Sort>('overdue');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(initialSupplierId || null);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialSupplierId));
  const [panelKey, setPanelKey] = useState(0);
  const [transferCount, setTransferCount] = useState(0);
  const [direct, setDirect] = useState<{ count: number; amount: number; missing: number } | null>(null);
  const [pendingTab, setPendingTab] = useState<'direct' | 'statements'>('direct');
  const [showTransfers, setShowTransfers] = useState(initialSection === 'transfers');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const r = await financeService.list({ projectId: projectId || undefined, source: source || undefined });
      setData(r); setStatus('ready');
      setSection(cur => (cur === 'auto' ? (r.can.manage ? 'overview' : 'todo') : cur));
      financeService.transferReviews().then(rows => setTransferCount(rows.length)).catch(() => setTransferCount(0));
      financeService.paymentRequests('request').then(d => setRequestCounts(d.counts)).catch(() => setRequestCounts(null));
      financeService.advances().then(d => setAdvances(d.totals)).catch(() => setAdvances(null));
      financeService.receivables().then(d => setReceivables(d.totals)).catch(() => setReceivables(null));
      financeService.cash().then(d => setCashPending({ ...d.pending, accounts: d.forecast.accounts, belowMinWeek: d.forecast.belowMinWeek, lowest: d.forecast.lowest, minBalance: d.forecast.minBalance })).catch(() => setCashPending(null));
      financeService.directReceipts().then(d => setDirect({ count: d.receipts.length, amount: d.receipts.reduce((s, x) => s + x.value, 0), missing: d.receipts.filter(x => x.missingPrice > 0).length }))
        .catch(() => setDirect(null));
      setSel(cur => cur && r.suppliers.some(s => s.supplierId === cur) ? cur : cur || r.suppliers[0]?.supplierId || null);
    } catch (e) {
      const denied = (e as { code?: string })?.code === 'FINANCE_VIEW_DENIED';
      setMessage(e instanceof Error ? e.message : String(e)); setStatus(denied ? 'denied' : 'error');
    } finally { setRefreshing(false); }
  }, [projectId, source]);
  useEffect(() => { void load(); }, [load]);

  const list = useMemo(() => {
    if (!data) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = data.suppliers.filter(s =>
      (filter === 'all' || (filter === 'overdue' && s.overdue > 0) || (filter === 'soon' && s.soon > 0) || (filter === 'issues' && s.issues > 0)
        || (filter === 'opening' && (s.opening === 'todo' || s.opening === 'pending')))
      && words.every(w => `${s.name} ${s.projects.map(p => p || 'Kho công ty').join(' ')}`.toLowerCase().includes(w)));
    const by: Record<Sort, (a: FinanceSupplierSummary, b: FinanceSupplierSummary) => number> = {
      overdue: (a, b) => b.overdue - a.overdue || b.soon - a.soon || b.owed - a.owed,
      owed: (a, b) => b.owed - a.owed,
      due: (a, b) => (a.nextDue || '9999').localeCompare(b.nextDue || '9999'),
      name: (a, b) => a.name.localeCompare(b.name, 'vi'),
    };
    return [...rows].sort(by[sort]);
  }, [data, filter, q, sort]);

  const t = data?.totals;
  const hideOnMobile = mobileDetail ? 'hidden md:block' : '';
  const openPayables = (opts: { stage?: Stage; filter?: Filter; projectId?: string; pending?: 'direct' | 'statements'; transfers?: boolean; advance?: AdvanceFilter } = {}) => {
    setSection('payables'); setStage(opts.stage || 'owed'); setFilter(opts.filter || 'all'); setShowTransfers(Boolean(opts.transfers));
    if (opts.advance) { setAdvanceFilter(opts.advance); setStageKey(k => k + 1); }
    if (opts.pending) setPendingTab(opts.pending);
    if (opts.projectId !== undefined) setProjectId(opts.projectId);
    window.scrollTo({ top: 0 });
  };
  const goTodo = (k: TodoTarget) => {
    if (k === 'opening' || k === 'overdue' || k === 'soon' || k === 'issues') openPayables({ filter: k });
    else if (k === 'direct' || k === 'statements') openPayables({ stage: 'pending', pending: k });
    else if (k === 'request' || k === 'approved') openPayables({ stage: k });
    else if (k.startsWith('cash_')) { setSection('cash'); window.scrollTo({ top: 0 }); }
    else if (k.startsWith('receivable_')) { setSection('receivables'); setRcvKey(x => x + 1); window.scrollTo({ top: 0 }); }
    else if (k === 'advance_overdue' || k === 'advance_refund' || k === 'advance_adjust') openPayables({ stage: 'advances', advance: k === 'advance_overdue' ? 'overdue' : k === 'advance_refund' ? 'refund' : 'active' });
    else openPayables({ transfers: true });
  };
  return <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className={`flex flex-wrap items-start justify-between gap-3 ${mobileDetail ? 'hidden md:flex' : ''}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Wallet size={22} /></span>
        <div><h1 className="text-xl font-bold tracking-tight md:text-2xl">Tài chính</h1>
          <p className="text-sm text-muted-foreground">Sức khỏe tài chính toàn công ty và từng dự án; công nợ, chi tiền cho kế toán.</p></div>
      </div>
      <button type="button" onClick={() => { void load(true); setPanelKey(k => k + 1); }} disabled={refreshing} className={`${secondaryBtn} bg-card`}>
        <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Làm mới</button>
    </header>

    <nav className={`inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm ${mobileDetail ? 'hidden md:inline-flex' : ''}`} role="tablist" aria-label="Phần">
      {([['overview', 'Tổng quan', CircleDollarSign], ['todo', 'Việc cần làm', ListTodo], ['receivables', 'Phải thu', HandCoins], ['payables', 'Phải trả', Wallet],
        ['cash', 'Thu chi & quỹ', PiggyBank], ['cost', 'Chi phí & ngân sách', Scale], ['settings', 'Quản trị', Settings2]] as const).map(([k, l, I]) => {
        const ready = k === 'payables' || k === 'settings' || k === 'todo' || k === 'overview' || k === 'receivables' || k === 'cash';
        return <button key={k} type="button" role="tab" aria-selected={section === k} disabled={!ready} title={ready ? undefined : 'Sẽ mở ở các đợt sau (F4, F5)'}
          onClick={() => ready && setSection(k as Section)}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${section === k ? 'bg-teal-700 text-white' : ready ? 'text-muted-foreground hover:text-foreground' : 'cursor-not-allowed text-muted-foreground/60'}`}>
          <I size={14} />{l}{!ready && <span className="text-[10px] font-normal">sắp có</span>}</button>;
      })}
    </nav>

    {status === 'denied' ? <StateBox kind="denied" message={message} />
      : status === 'error' && !data ? <StateBox kind="error" title="Chưa tải được Tài chính" message={message} onRetry={() => void load()} />
        : !data || !t ? <StateBox kind="loading" title="Đang tải công nợ…" />
          : section === 'settings' ? <FinanceSettingsView currentUserId={currentUserId} />
          : section === 'cash' ? <CashView onChanged={() => void load(true)} onOpenRequests={() => openPayables({ stage: 'request' })} />
          : section === 'receivables' ? <ReceivablesView key={rcvKey} initialContractId={initialContractId} onChanged={() => void load(true)} />
          : section === 'overview' ? <FinanceOverviewView openingPendingSuppliers={t.openingPendingSuppliers} supplierCount={t.supplierCount} directPending={direct}
            onOpenPayables={projectId => openPayables({ projectId: projectId || '' })} onOpenPending={() => openPayables({ stage: 'pending', pending: 'direct' })} onOpenTodo={() => setSection('todo')}
            onOpenAdvances={f => openPayables({ stage: 'advances', advance: f })} onOpenReceivables={() => setSection('receivables')} onOpenCash={() => setSection('cash')} />
          : section === 'todo' || section === 'auto' ? <FinanceTodoView totals={t} direct={direct} pendingStatements={data.pendingStatements} requests={requestCounts} transferCount={transferCount} advances={advances} receivables={receivables} cash={cashPending}
            canRecord={data.can.record} canConfirm={data.can.confirm} onGo={goTodo} />
          : showTransfers ? <TransferReviewsView onBack={() => setShowTransfers(false)} onChanged={() => void load(true)} /> : <>
            {transferCount > 0 && <p className={`flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 ${hideOnMobile}`}>
              <ArrowLeftRight size={17} className="shrink-0" />
              <span className="min-w-[14rem] flex-1"><b>{transferCount} phiếu chuyển kho chờ xác nhận giá vốn.</b> Giá kho gửi chưa tin được nên chưa ghi chi phí dự án.</span>
              <button type="button" onClick={() => setShowTransfers(true)} className={`${secondaryBtn} bg-card`}><ClipboardCheck size={15} />Xác nhận giá vốn</button>
            </p>}
            {t.openingPendingSuppliers > 0 && <p className={`flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 ${hideOnMobile}`}>
              <AlertTriangle size={17} className="shrink-0" />
              <span className="min-w-[14rem] flex-1"><b>{t.openingPendingSuppliers}/{t.supplierCount} NCC chưa chốt đối chiếu đầu kỳ.</b> Số nợ và quá hạn chỉ gồm chứng từ phát sinh trong Vioo; kế toán có thể đã trả ngoài hệ thống. Đối chiếu đầu kỳ trước khi chi để tránh trả trùng.</span>
              <button type="button" onClick={() => setFilter('opening')} className={`${secondaryBtn} bg-card`}><ClipboardCheck size={15} />Xem NCC cần đối chiếu</button>
            </p>}

            <nav aria-label="Các bước công nợ" className={`grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 ${mobileDetail ? 'hidden md:grid' : ''}`}>
              {([['pending', 'Chờ ghi nợ', direct ? String(data.pendingStatements.count + direct.count) : '…',
                  direct ? `${direct.count} phiếu nhập trực tiếp · ${data.pendingStatements.count} bảng đối soát` : 'đang đếm…', Inbox, true],
                ['owed', 'Đang nợ', String(t.docCount), `${shortMoney(t.owed)} · ${t.supplierCount} NCC`, Banknote, true],
                ['request', 'Đề nghị chi', requestCounts ? String(requestCounts.request) : '…', requestCounts?.waitingMe ? `${requestCounts.waitingMe} chờ bạn duyệt` : 'đang duyệt', FileCheck2, true],
                ['approved', 'Chờ chi', requestCounts ? String(requestCounts.approved) : '…', requestCounts ? shortMoney(requestCounts.approvedAmount) : '', CalendarClock, true],
                ['paid', 'Đã chi', requestCounts ? String(requestCounts.paid) : '…', 'có UNC, đảo được', Truck, true],
                ['advances', 'Tạm ứng NCC', advances ? shortMoney(advances.remaining) : '…', advances ? (advances.overdueCount + advances.refundDueCount > 0
                  ? `${advances.overdueCount} quá hạn hoàn ứng · ${advances.refundDueCount} chờ hoàn` : `${advances.openCount} khoản còn lại · ${advances.approving} đang duyệt`) : 'đang tải…', Coins, true]] as const).map(([k, l, v, h, I, on], i) =>
                <button key={k} type="button" disabled={!on} aria-current={stage === k ? 'page' : undefined} onClick={() => on && setStage(k as Stage)}
                  className={`rounded-2xl border bg-card p-3 text-left transition ${stage === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'} ${on ? '' : 'cursor-not-allowed opacity-50'} ${i === 0 || k === 'advances' ? 'col-span-2 md:col-span-1' : ''} ${k === 'advances' ? 'border-dashed' : ''}`}>
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k === 'advances' ? <HandCoins size={15} className="text-teal-700" />
                    : <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>}{l}</span>
                  <span className="mt-1.5 flex items-center gap-2"><I size={17} className="text-teal-700" /><span className={`text-2xl font-bold tabular-nums ${k === 'pending' && Number(v) > 0 ? 'text-amber-700' : ''}`}>{v}</span></span>
                  <span className={`block text-xs ${(k === 'request' && requestCounts?.waitingMe) || (k === 'advances' && advances && advances.overdueCount + advances.refundDueCount > 0) ? 'font-semibold text-amber-700' : 'text-muted-foreground'}`}>{h}</span></button>)}
            </nav>

            {stage === 'advances' ? <AdvancesView key={`adv:${stageKey}`} initialFilter={advanceFilter} onChanged={() => void load(true)} onOpenRequests={() => setStage('request')} />
              : stage === 'request' || stage === 'approved' || stage === 'paid'
              ? <PaymentRequestsView key={`${stage}:${stageKey}`} stage={stage} today={today} initialRequestId={initialRequestId} onChanged={() => { void load(true); setStageKey(k => k + 1); }} />
              : stage === 'pending' ? <div className="space-y-3">
              <div role="tablist" aria-label="Nguồn chờ ghi nợ" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
                {([['direct', 'Phiếu nhập trực tiếp', direct?.count], ['statements', 'Bảng đối soát HĐ', data.pendingStatements.count]] as const).map(([k, l, n]) =>
                  <button key={k} type="button" role="tab" aria-selected={pendingTab === k} onClick={() => setPendingTab(k)}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${pendingTab === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                    {l}{n != null && <span className={`rounded-full px-1.5 text-xs ${pendingTab === k ? 'bg-white/20' : 'bg-muted'}`}>{n}</span>}</button>)}
              </div>
              {pendingTab === 'direct' ? <>
                <p className="rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100">
                  <b>Phiếu nhập trực tiếp NCC</b> (kho nhập thẳng, không qua PO): kiểm giá và VAT rồi ghi công nợ — chi phí dự án ghi cùng lúc. Phiếu trước mốc MISA chỉ ghi nợ. Người lập/duyệt phiếu nhập không tự ghi nợ.</p>
                <DirectReceiptsView onChanged={() => void load(true)} /></>
                : <PendingStatementsView onChanged={() => void load(true)} />}
            </div> : <>
              <section className={`grid grid-cols-2 gap-2 lg:grid-cols-4 ${mobileDetail ? 'hidden md:grid' : ''}`}>
                <Kpi active={filter === 'all'} onClick={() => setFilter('all')} icon={Wallet} label="Phải trả" value={shortMoney(t.owed)} hint={`${t.docCount} chứng từ · ${t.supplierCount} NCC`} tone="text-leaf-700 dark:text-leaf-300" />
                <Kpi active={filter === 'overdue'} onClick={() => setFilter('overdue')} icon={AlertTriangle} label="Quá hạn" value={shortMoney(t.overdue)}
                  hint={`${t.overdueCount} chứng từ${t.openingPendingSuppliers ? ' · tạm tính' : ''}`} tone={t.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} blink={t.overdue > 0} />
                <Kpi active={filter === 'soon'} onClick={() => setFilter('soon')} icon={CalendarClock} label="Đến hạn 7 ngày" value={shortMoney(t.soon)} hint={`${t.soonCount} chứng từ`} tone={t.soon > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'} />
                <Kpi active={filter === 'issues'} onClick={() => setFilter('issues')} icon={FileWarning} label="Cần xử lý" value={String(t.issues)} hint="nội bộ, giá bất thường, cần soát xét" tone={t.issues > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'} />
              </section>

              <div className={`flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm ${mobileDetail ? 'hidden md:flex' : ''}`}>
                <label className="relative min-w-[12rem] flex-1"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm NCC, dự án…" className={`w-full pl-8 ${inputCls}`} /></label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Dự án" className={inputCls}>
                  <option value="">Mọi dự án</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select>
                <select value={source} onChange={e => setSource(e.target.value)} aria-label="Nguồn công nợ" className={inputCls}>
                  <option value="">Mọi nguồn</option><option value="purchase_delivery_receipt">Nhận hàng PO</option><option value="direct_supplier_receipt">Nhập trực tiếp NCC</option><option value="supplier_delivery_statement">Đối soát HĐ</option>
                  <option value="receipt_reconciliation">Đối chiếu lùi ngày</option><option value="opening_balance">Số dư đầu kỳ</option></select>
                <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sắp xếp" className={inputCls}>
                  <option value="overdue">Quá hạn trước</option><option value="owed">Nợ nhiều nhất</option><option value="due">Hạn gần nhất</option><option value="name">Tên NCC</option></select>
                {(filter !== 'all' || q || projectId || source) && <button type="button" onClick={() => { setFilter('all'); setQ(''); setProjectId(''); setSource(''); }} className="rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted">Xóa lọc</button>}
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobileDetail ? 'hidden md:block' : ''}`}>
                  {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{data.suppliers.length ? 'Không có NCC khớp bộ lọc.' : 'Chưa có công nợ NCC nào đang mở.'}</li>}
                  {list.map(s => { const ob = OPENING_BADGE[s.opening];
                    return <li key={s.supplierId}><button type="button" onClick={() => { setSel(s.supplierId); setMobileDetail(true); window.scrollTo({ top: 0 }); }}
                      className={`flex w-full items-start gap-3 border-b border-l-4 border-border px-3 py-3 text-left ${TONE_BAR[s.worst]} ${sel === s.supplierId ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${ENT}`}>{s.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{s.projects.map(p => p || 'Kho công ty').join(', ')} · {s.docCount} chứng từ
                          {ob && <Badge className={ob.cls}>{ob.label}</Badge>}
                          {s.internal && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Nội bộ</Badge>}
                          {s.issues > 0 && !s.internal && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Cần xử lý</Badge>}
                          {s.pendingExternal > 0 && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Chi chờ xác nhận</Badge>}</span>
                        <span className={`mt-0.5 block text-xs font-semibold ${TONE_TEXT[s.worst]} ${s.worst === 'overdue' ? 'overdue-blink' : ''}`}>
                          {s.overdue > 0 ? `Quá hạn ${shortMoney(s.overdue)}` : s.soon > 0 ? `Đến hạn 7 ngày ${shortMoney(s.soon)}` : s.nextDue ? `Hạn gần nhất ${viDate(s.nextDue)}` : 'Chưa có hạn'}</span>
                      </span>
                      <span className={`whitespace-nowrap text-sm ${NUM}`}>{shortMoney(s.owed)}</span>
                    </button></li>; })}
                </ul>
                <div className={`min-w-0 ${mobileDetail ? '' : 'hidden md:block'}`}>
                  {sel ? <SupplierPanel key={`${sel}:${panelKey}`} supplierId={sel} onBack={() => setMobileDetail(false)} onChanged={() => void load(true)}
                    onOpenAdvances={() => openPayables({ stage: 'advances', advance: 'active' })} />
                    : <StateBox kind="empty" title="Chọn một NCC" message="Chọn NCC ở danh sách để xem chứng từ, nguồn gốc và các khoản chi." />}
                </div>
              </div>
            </>}
          </>}
  </main>;
};

export default FinanceHubView;
