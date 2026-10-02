import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, CalendarClock, CircleDollarSign, ClipboardCheck, FileCheck2, FileWarning, HandCoins, Inbox, PiggyBank,
  RefreshCw, Scale, Search, Settings2, Truck, Wallet,
} from 'lucide-react';
import { financeService, type FinancePayablesList, type FinanceSupplierSummary } from '../../lib/financeService';
import { Badge, StateBox, inputCls, secondaryBtn } from '../procurement/hub/hubUi';
import { FinanceSettingsView } from './FinanceSettingsView';
import { PendingStatementsView } from './PendingStatementsView';
import { SupplierPanel } from './SupplierPanel';
import { ENT, Kpi, NUM, TONE_BAR, TONE_TEXT, shortMoney, viDate } from './financeUi';

// Module Tài chính: một nơi cho công nợ, chi tiền, dòng tiền toàn công ty — không phải vào từng dự án.
// K3a: phần Phải trả NCC (danh sách NCC trái, chi tiết phải), Chờ ghi nợ, Thiết lập. Các phần khác mở dần (K3b → F5).

type Section = 'payables' | 'settings';
type Stage = 'pending' | 'owed';
type Filter = 'all' | 'overdue' | 'soon' | 'issues' | 'opening';
type Sort = 'overdue' | 'owed' | 'due' | 'name';

const OPENING_BADGE: Record<FinanceSupplierSummary['opening'], { label: string; cls: string } | null> = {
  not_needed: null,
  todo: { label: 'Chưa đối chiếu đầu kỳ', cls: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  pending: { label: 'Đầu kỳ chờ xác nhận', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  done: { label: 'Đã chốt đầu kỳ', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
};

export const FinanceHubView: React.FC<{ currentUserId: string; initialSection?: string | null; initialSupplierId?: string | null }> = ({ currentUserId, initialSection, initialSupplierId }) => {
  const [section, setSection] = useState<Section>(initialSection === 'settings' ? 'settings' : 'payables');
  const [stage, setStage] = useState<Stage>(initialSection === 'pending' ? 'pending' : 'owed');
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

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const r = await financeService.list({ projectId: projectId || undefined, source: source || undefined });
      setData(r); setStatus('ready');
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
      && words.every(w => `${s.name} ${s.projects.join(' ')}`.toLowerCase().includes(w)));
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
  return <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className={`flex flex-wrap items-start justify-between gap-3 ${mobileDetail ? 'hidden md:flex' : ''}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white shadow-sm"><Wallet size={22} /></span>
        <div><h1 className="text-xl font-bold tracking-tight md:text-2xl">Tài chính</h1>
          <p className="text-sm text-muted-foreground">Công nợ, chi tiền và dòng tiền toàn công ty — không cần vào từng dự án.</p></div>
      </div>
      <button type="button" onClick={() => { void load(true); setPanelKey(k => k + 1); }} disabled={refreshing} className={`${secondaryBtn} bg-card`}>
        <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Làm mới</button>
    </header>

    <nav className={`inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm ${mobileDetail ? 'hidden md:inline-flex' : ''}`} role="tablist" aria-label="Phần">
      {([['payables', 'Phải trả', Wallet], ['receivables', 'Phải thu', HandCoins], ['cash', 'Dòng tiền & quỹ', PiggyBank], ['cost', 'Chi phí & ngân sách', Scale],
        ['overview', 'Tổng quan', CircleDollarSign], ['settings', 'Thiết lập', Settings2]] as const).map(([k, l, I]) => {
        const ready = k === 'payables' || k === 'settings';
        return <button key={k} type="button" role="tab" aria-selected={section === k} disabled={!ready} title={ready ? undefined : 'Sẽ mở ở các đợt sau (F4, F5)'}
          onClick={() => ready && setSection(k as Section)}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${section === k ? 'bg-teal-700 text-white' : ready ? 'text-muted-foreground hover:text-foreground' : 'cursor-not-allowed text-muted-foreground/60'}`}>
          <I size={14} />{l}{!ready && <span className="text-[10px] font-normal">sắp có</span>}</button>;
      })}
    </nav>

    {status === 'denied' ? <StateBox kind="denied" message={message} />
      : status === 'error' && !data ? <StateBox kind="error" title="Chưa tải được Tài chính" message={message} onRetry={() => void load()} />
        : !data || !t ? <StateBox kind="loading" title="Đang tải công nợ…" />
          : section === 'settings' ? <FinanceSettingsView currentUserId={currentUserId} /> : <>
            {t.openingPendingSuppliers > 0 && <p className={`flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100 ${hideOnMobile}`}>
              <AlertTriangle size={17} className="shrink-0" />
              <span className="min-w-[14rem] flex-1"><b>{t.openingPendingSuppliers}/{t.supplierCount} NCC chưa chốt đối chiếu đầu kỳ.</b> Số nợ và quá hạn chỉ gồm chứng từ phát sinh trong Vioo; kế toán có thể đã trả ngoài hệ thống. Đối chiếu đầu kỳ trước khi chi để tránh trả trùng.</span>
              <button type="button" onClick={() => setFilter('opening')} className={`${secondaryBtn} bg-card`}><ClipboardCheck size={15} />Xem NCC cần đối chiếu</button>
            </p>}

            <nav aria-label="Các bước công nợ" className={`grid grid-cols-2 gap-2 md:grid-cols-5 ${mobileDetail ? 'hidden md:grid' : ''}`}>
              {([['pending', 'Chờ ghi nợ', String(data.pendingStatements.count), data.pendingStatements.count ? `${shortMoney(data.pendingStatements.amount)} · bảng đối soát đã chốt` : 'bảng đối soát đã chốt', Inbox, true],
                ['owed', 'Đang nợ', String(t.docCount), `${shortMoney(t.owed)} · ${t.supplierCount} NCC`, Banknote, true],
                ['request', 'Đề nghị chi', '—', 'mở ở K3b', FileCheck2, false], ['approved', 'Chờ chi', '—', 'mở ở K3b', CalendarClock, false], ['paid', 'Đã chi', '—', 'mở ở K3b', Truck, false]] as const).map(([k, l, v, h, I, on], i) =>
                <button key={k} type="button" disabled={!on} aria-current={stage === k ? 'page' : undefined} onClick={() => on && setStage(k as Stage)}
                  className={`rounded-2xl border bg-card p-3 text-left transition ${stage === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'} ${on ? '' : 'cursor-not-allowed opacity-50'} ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`}>
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>{l}</span>
                  <span className="mt-1.5 flex items-center gap-2"><I size={17} className="text-teal-700" /><span className={`text-2xl font-bold tabular-nums ${k === 'pending' && Number(v) > 0 ? 'text-amber-700' : ''}`}>{v}</span></span>
                  <span className="block text-xs text-muted-foreground">{h}</span></button>)}
            </nav>

            {stage === 'pending' ? <PendingStatementsView onChanged={() => void load(true)} /> : <>
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
                  <option value="">Mọi nguồn</option><option value="purchase_delivery_receipt">Nhận hàng PO</option><option value="supplier_delivery_statement">Đối soát HĐ</option>
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
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{s.projects.join(', ')} · {s.docCount} chứng từ
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
                  {sel ? <SupplierPanel key={`${sel}:${panelKey}`} supplierId={sel} onBack={() => setMobileDetail(false)} onChanged={() => void load(true)} />
                    : <StateBox kind="empty" title="Chọn một NCC" message="Chọn NCC ở danh sách để xem chứng từ, nguồn gốc và các khoản chi." />}
                </div>
              </div>
            </>}
          </>}
  </main>;
};

export default FinanceHubView;
