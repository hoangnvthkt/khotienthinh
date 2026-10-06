import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, BarChart3, Clock, Download, HandCoins, Info, Scale, TrendingUp, Wallet } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceReports } from '../../lib/financeService';
import { loadXlsx } from '../../lib/loadXlsx';
import { Badge, StateBox, inputCls, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, projectFinanceHref, shortMoney, viDate } from './financeUi';

// Báo cáo Tài chính: tuổi nợ phải trả (NCC), tuổi nợ phải thu (CĐT), lãi lỗ theo dự án và theo tháng.
// Mọi ô số bấm được: lọc bảng hoặc mở đúng NCC / HĐ / dự án. Xuất Excel đúng bảng đang xem.

type Tab = 'ap' | 'ar' | 'pl';
type Bucket = 'all' | 'overdue' | 'over90' | 'noDue';
const BUCKETS = [['notDue', 'Chưa đến hạn'], ['d30', '1–30 ngày'], ['d60', '31–60'], ['d90', '61–90'], ['over90', '> 90 ngày'], ['noDue', 'Chưa có hạn']] as const;
type BucketKey = typeof BUCKETS[number][0];
const BAR: Record<BucketKey, string> = { notDue: 'bg-leaf-400', d30: 'bg-amber-300', d60: 'bg-amber-500', d90: 'bg-orange-600', over90: 'bg-rose-600', noDue: 'bg-slate-300' };
const PAGE = 10;
const sm = (n: number) => `${n < -0.5 ? '−' : ''}${shortMoney(Math.abs(n))}`;
const pct = (a: number, b: number) => b ? `${Math.round(a * 1000 / b) / 10}%` : '—';
const monthLabel = (d: string) => `T${Number(d.slice(5, 7))}/${d.slice(2, 4)}`;
const CAT: Record<string, string> = { materials: 'Vật tư', labor: 'Nhân công', machinery: 'Máy', subcontract: 'Thầu phụ', overhead: 'Chi phí chung', other: 'Khác' };

type Row = { key: string; name: string; sub: string | null; href: string | null; total: number; pending?: number; sent?: number; retention?: number; opening?: string | null; oldest: string | null }
  & Record<BucketKey, number>;

const AgingBar: React.FC<{ r: Row }> = ({ r }) => <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
  {BUCKETS.map(([k]) => r[k] > 0.5 ? <span key={k} className={BAR[k]} style={{ width: `${(r[k] * 100) / (r.total || 1)}%` }} /> : null)}</span>;

export const ReportsView: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<FinanceReports | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ap');
  const [group, setGroup] = useState<'supplier' | 'project'>('supplier');
  const [project, setProject] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');
  const [page, setPage] = useState(1);
  const [plProject, setPlProject] = useState('');
  const load = useCallback(() => { setError(null); financeService.reports().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [tab, group, project, bucket]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    if (tab === 'ap') {
      const src = data.ap.filter(x => !project || (x.projectId || '') === project);
      const m = new Map<string, Row>();
      for (const x of src) {
        const key = group === 'supplier' ? x.supplierId : x.projectId || 'company';
        const cur = m.get(key) || { key, name: group === 'supplier' ? x.supplierName : x.projectCode || 'Chung công ty', sub: null,
          href: group === 'supplier' ? `#/finance/payables?supplier=${encodeURIComponent(x.supplierId)}` : x.projectId ? projectFinanceHref(x.projectId, 'payables') : null,
          total: 0, notDue: 0, d30: 0, d60: 0, d90: 0, over90: 0, noDue: 0, pending: 0, oldest: null };
        cur.total += x.outstanding; cur.pending! += x.pending; BUCKETS.forEach(([k]) => { cur[k] += x[k]; });
        if (x.oldestDue && (!cur.oldest || x.oldestDue < cur.oldest)) cur.oldest = x.oldestDue;
        const n = group === 'supplier' ? x.projectCode : x.supplierName; cur.sub = cur.sub ? (n && !cur.sub.includes(n) ? `${cur.sub}, ${n}` : cur.sub) : n || null;
        m.set(key, cur);
      }
      return [...m.values()];
    }
    return data.ar.filter(x => !project || (x.projectId || '') === project).map(x => ({ key: x.contractId, name: x.customerName || x.contractCode, sub: `${x.contractCode}${x.projectCode ? ` · ${x.projectCode}` : ''}`,
      href: `#/finance/receivables?contract=${encodeURIComponent(x.contractId)}`, total: x.outstanding, notDue: x.notDue, d30: x.d30, d60: x.d60, d90: x.d90, over90: x.over90, noDue: x.noDue,
      sent: x.sent, retention: x.retention, opening: x.opening, oldest: x.oldestDue }));
  }, [data, tab, group, project]);

  if (error) return <StateBox kind={error.includes('quyền') ? 'denied' : 'error'} title="Chưa tải được báo cáo" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang lập báo cáo…" />;
  const projects = [...new Map([...data.ap.filter(x => x.projectId).map(x => [x.projectId!, x.projectCode || x.projectId!] as const),
    ...data.ar.filter(x => x.projectId).map(x => [x.projectId!, x.projectCode || x.projectId!] as const)]).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const overdueOf = (r: Row) => r.d30 + r.d60 + r.d90 + r.over90;
  const shown = rows.filter(r => r.total > 0.5 || (tab === 'ar' && ((r.sent || 0) > 0.5 || (r.retention || 0) > 0.5)))
    .filter(r => bucket === 'all' || (bucket === 'overdue' ? overdueOf(r) > 0.5 : bucket === 'over90' ? r.over90 > 0.5 : r.noDue > 0.5))
    .sort((a, b) => overdueOf(b) - overdueOf(a) || b.total - a.total);
  const sum = (k: BucketKey | 'total') => rows.reduce((a, r) => a + r[k], 0);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)); const cur = Math.min(page, pages);

  const exportAging = async () => {
    try {
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.json_to_sheet(shown.map(r => ({ [tab === 'ap' ? (group === 'supplier' ? 'Nhà cung cấp' : 'Dự án') : 'Chủ đầu tư']: r.name, 'Chi tiết': r.sub || '',
        ...Object.fromEntries(BUCKETS.map(([k, l]) => [l, Math.round(r[k])])), 'Tổng': Math.round(r.total),
        ...(tab === 'ar' ? { 'Đã gửi chờ xác nhận': Math.round(r.sent || 0), 'Giữ lại bảo hành': Math.round(r.retention || 0) } : { 'Đang đề nghị chi': Math.round(r.pending || 0) }),
        'Hạn quá cũ nhất': r.oldest || '' })));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, tab === 'ap' ? 'Tuoi no phai tra' : 'Tuoi no phai thu');
      XLSX.writeFile(wb, `${tab === 'ap' ? 'tuoi-no-phai-tra' : 'tuoi-no-phai-thu'}-${data.today}.xlsx`); toast.success('Đã xuất Excel', `${shown.length} dòng`);
    } catch (e) { toast.error('Chưa xuất được Excel', e instanceof Error ? e.message : ''); }
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Báo cáo" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm">
        {([['ap', 'Tuổi nợ phải trả', Wallet], ['ar', 'Tuổi nợ phải thu', HandCoins], ['pl', 'Lãi lỗ dự án', TrendingUp]] as const).map(([k, l, I]) =>
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setBucket('all'); }}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}><I size={14} />{l}</button>)}</div>
      <span className="text-xs text-muted-foreground">Số đến hôm nay {viDate(data.today)}</span>
    </div>

    {tab !== 'pl' ? <>
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([['all', tab === 'ap' ? 'Tổng còn phải trả' : 'Tổng còn phải thu', shortMoney(sum('total')), `${rows.filter(r => r.total > 0.5).length} ${tab === 'ap' ? (group === 'supplier' ? 'NCC' : 'dự án') : 'HĐ'}`, 'text-foreground'],
          ['overdue', 'Đã quá hạn', shortMoney(sum('d30') + sum('d60') + sum('d90') + sum('over90')), pct(sum('d30') + sum('d60') + sum('d90') + sum('over90'), sum('total')) + ' tổng', 'text-amber-700'],
          ['over90', 'Quá hạn trên 90 ngày', shortMoney(sum('over90')), 'cần xử lý ngay', sum('over90') > 0.5 ? 'text-rose-700' : 'text-leaf-700'],
          ['noDue', 'Chưa có hạn', shortMoney(sum('noDue')), tab === 'ap' ? 'khai hạn ở HĐ / NCC' : 'đợt chưa có hạn', sum('noDue') > 0.5 ? 'text-amber-700' : 'text-leaf-700']] as const).map(([k, l, v, h, tone]) =>
          <button key={k} type="button" aria-pressed={bucket === k} onClick={() => setBucket(k)}
            className={`rounded-2xl border bg-card p-3 text-left shadow-sm ${bucket === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</span><b className={`mt-1 block text-xl tabular-nums ${tone}`}>{v}</b>
            <span className="block text-[11px] text-muted-foreground">{h}</span></button>)}
      </section>
      {tab === 'ar' && data.ar.some(x => x.opening === 'todo') && <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{data.ar.filter(x => x.opening === 'todo').length} HĐ chưa đối chiếu đầu kỳ phải thu — phần nợ trước 30/09 chưa có trong báo cáo. Đối chiếu ở Phải thu → HĐ → Đối chiếu đầu kỳ.</span></p>}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          {tab === 'ap' && <div role="tablist" aria-label="Gộp theo" className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            {([['supplier', 'Theo NCC'], ['project', 'Theo dự án']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={group === k} onClick={() => setGroup(k)}
              className={`rounded-md px-2.5 py-1 font-semibold ${group === k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div>}
          <select value={project} onChange={e => setProject(e.target.value)} aria-label="Dự án" className={`max-w-full ${inputCls}`}>
            <option value="">Mọi dự án</option>{projects.map(([id, code]) => <option key={id} value={id}>{code}</option>)}</select>
          <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{BUCKETS.map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${BAR[k]}`} />{l}</span>)}</span>
          <button type="button" onClick={() => void exportAging()} disabled={!shown.length} className={secondaryBtn}><Download size={15} />Xuất Excel</button>
        </div>
        {shown.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không có khoản nào khớp bộ lọc.</p> : <>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">{tab === 'ap' ? (group === 'supplier' ? 'Nhà cung cấp' : 'Dự án') : 'Chủ đầu tư · HĐ'}</th>
              {BUCKETS.map(([k, l]) => <th key={k} className="px-2 text-right">{l}</th>)}<th className="px-3 text-right">Tổng</th>{tab === 'ar' && <th className="px-3 text-right">Chờ CĐT xác nhận</th>}</tr></thead>
            <tbody className="divide-y divide-border">{shown.slice((cur - 1) * PAGE, cur * PAGE).map(r => <tr key={r.key}>
              <td className="px-3 py-2"><a href={r.href || undefined} className={`hover:underline ${ENT}`}>{r.name}</a>
                {r.opening === 'todo' && <Badge className="ml-1 border-slate-200 bg-slate-100 text-slate-600">chưa đối chiếu đầu kỳ</Badge>}
                <span className="block max-w-[20rem] truncate text-xs text-muted-foreground" title={r.sub || ''}>{r.sub}{r.oldest ? ` · quá hạn từ ${viDate(r.oldest)}` : ''}</span>
                <span className="mt-1 block max-w-[20rem]"><AgingBar r={r} /></span></td>
              {BUCKETS.map(([k]) => <td key={k} className={`whitespace-nowrap px-2 text-right tabular-nums ${r[k] > 0.5 ? (k === 'over90' ? 'font-semibold text-rose-700' : k === 'notDue' ? '' : k === 'noDue' ? 'text-slate-500' : 'text-amber-700') : 'text-muted-foreground'}`}>{r[k] > 0.5 ? shortMoney(r[k]) : '—'}</td>)}
              <td className="whitespace-nowrap px-3 text-right font-semibold tabular-nums">{shortMoney(r.total)}{tab === 'ap' && (r.pending || 0) > 0.5 && <span className="block text-[11px] font-normal text-muted-foreground">đang chi {shortMoney(r.pending || 0)}</span>}</td>
              {tab === 'ar' && <td className="whitespace-nowrap px-3 text-right tabular-nums text-muted-foreground">{(r.sent || 0) > 0.5 ? shortMoney(r.sent || 0) : '—'}{(r.retention || 0) > 0.5 && <span className="block text-[11px]">giữ lại {shortMoney(r.retention || 0)}</span>}</td>}
            </tr>)}</tbody>
            <tfoot className="border-t-2 border-border bg-muted/30 font-semibold"><tr><td className="px-3 py-2">Tổng</td>{BUCKETS.map(([k]) => <td key={k} className="px-2 text-right tabular-nums">{shortMoney(shown.reduce((a, r) => a + r[k], 0))}</td>)}
              <td className="px-3 text-right tabular-nums">{shortMoney(shown.reduce((a, r) => a + r.total, 0))}</td>{tab === 'ar' && <td className="px-3 text-right tabular-nums">{shortMoney(shown.reduce((a, r) => a + (r.sent || 0), 0))}</td>}</tr></tfoot>
          </table></div>
          <ul className="divide-y divide-border text-sm md:hidden">{shown.slice((cur - 1) * PAGE, cur * PAGE).map(r => <li key={r.key} className="px-3 py-2.5">
            <p className="flex items-start gap-2"><a href={r.href || undefined} className={`min-w-0 flex-1 hover:underline ${ENT}`}>{r.name}</a><b className="tabular-nums">{shortMoney(r.total)}</b></p>
            <p className="text-xs text-muted-foreground">{r.sub}</p><span className="mt-1 block"><AgingBar r={r} /></span>
            <p className="mt-1 text-xs">{overdueOf(r) > 0.5 ? <span className="font-semibold text-amber-700">Quá hạn {shortMoney(overdueOf(r))}{r.over90 > 0.5 ? ` · > 90 ngày ${shortMoney(r.over90)}` : ''}</span> : <span className="text-leaf-700">Chưa quá hạn</span>}
              {r.noDue > 0.5 && <span className="text-slate-500"> · chưa có hạn {shortMoney(r.noDue)}</span>}</p></li>)}</ul>
          {pages > 1 && <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground"><span>{(cur - 1) * PAGE + 1}–{Math.min(cur * PAGE, shown.length)} / {shown.length}</span>
            <span className="flex gap-1">{Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - cur) <= 1).map(n =>
              <button key={n} type="button" onClick={() => setPage(n)} className={`min-w-7 rounded-md border px-2 py-0.5 font-semibold ${n === cur ? 'border-teal-600 bg-teal-700 text-white' : 'border-border'}`}>{n}</button>)}</span></div>}
        </>}
      </section>
    </> : <ProfitLoss data={data} plProject={plProject} setPlProject={setPlProject} />}
  </div>;
};

const ProfitLoss: React.FC<{ data: FinanceReports; plProject: string; setPlProject: (id: string) => void }> = ({ data, plProject, setPlProject }) => {
  const toast = useToast();
  const [sort, setSort] = useState<'net' | 'margin' | 'cost'>('net');
  const pl = data.pl;
  const t = pl.reduce((a, p) => ({ net: a.net + (p.contractNet || 0), out: a.out + (p.outputNet || 0), acc: a.acc + p.acceptedNet, cost: a.cost + p.cost,
    eacNet: a.eacNet + (p.eac != null && p.contractNet ? p.contractNet : 0), eac: a.eac + (p.eac ?? 0) }), { net: 0, out: 0, acc: 0, cost: 0, eacNet: 0, eac: 0 });
  const withOut = pl.filter(p => p.outputNet != null);
  const marginOut = withOut.reduce((a, p) => a + (p.outputNet! - p.cost), 0); const outBase = withOut.reduce((a, p) => a + p.outputNet!, 0);
  const rows = [...pl].sort((a, b) => sort === 'net' ? (b.contractNet || 0) - (a.contractNet || 0) : sort === 'cost' ? b.cost - a.cost
    : ((b.outputNet ?? 0) - b.cost) - ((a.outputNet ?? 0) - a.cost));
  const months = data.months;
  const sel = plProject || '';
  const series = months.map(m => { const xs = data.plMonths.filter(x => x.month === m && (!sel || x.projectId === sel));
    return { m: monthLabel(m), 'Doanh thu nghiệm thu': Math.round(xs.reduce((a, x) => a + x.accepted, 0) / 1e7) / 100, 'Chi phí': Math.round(xs.reduce((a, x) => a + x.cost, 0) / 1e7) / 100,
      'CĐT trả': Math.round(xs.reduce((a, x) => a + x.cashIn, 0) / 1e7) / 100 }; });
  const selP = pl.find(p => p.projectId === sel);
  const cats = selP ? Object.entries(selP.byCategory).sort((a, b) => b[1] - a[1]) : [];
  const exportPl = async () => {
    try {
      const XLSX = await loadXlsx();
      const ws = XLSX.utils.json_to_sheet(rows.map(p => ({ 'Dự án': p.code, 'Tên': p.name, 'Giá trị HĐ (chưa VAT)': Math.round(p.contractNet || 0), 'Tiến độ %': p.progress ?? '',
        'Doanh thu theo sản lượng': p.outputNet != null ? Math.round(p.outputNet) : '', 'Doanh thu đã nghiệm thu': Math.round(p.acceptedNet), 'Chi phí ghi nhận': Math.round(p.cost),
        'Lãi gộp theo sản lượng': p.outputNet != null ? Math.round(p.outputNet - p.cost) : '', 'Dự báo chi phí khi xong': p.eac != null ? Math.round(p.eac) : '',
        'Lãi dự kiến khi xong': p.eac != null && p.contractNet ? Math.round(p.contractNet - p.eac) : '', 'CĐT đã trả (gồm VAT)': Math.round(p.received) })));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Lai lo du an'); XLSX.writeFile(wb, `lai-lo-du-an-${data.today}.xlsx`); toast.success('Đã xuất Excel', `${rows.length} dự án`);
    } catch (e) { toast.error('Chưa xuất được Excel', e instanceof Error ? e.message : ''); }
  };
  return <div className="space-y-3">
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {([[Scale, 'Giá trị HĐ (chưa VAT)', shortMoney(t.net), `${pl.filter(p => p.contractNet).length} dự án có HĐ CĐT`, 'text-foreground'],
        [BarChart3, 'Doanh thu theo sản lượng', shortMoney(t.out), `đã nghiệm thu ${shortMoney(t.acc)}`, 'text-leaf-700'],
        [Wallet, 'Chi phí ghi nhận', shortMoney(t.cost), 'MISA đã nhập + Vioo từ mốc', 'text-foreground'],
        [TrendingUp, 'Lãi gộp tạm tính', sm(marginOut), outBase ? `${pct(marginOut, outBase)} doanh thu theo sản lượng` : 'chưa có tiến độ', marginOut < 0 ? 'text-rose-700' : 'text-leaf-700'],
        [Clock, 'Lãi dự kiến khi xong', t.eac ? sm(t.eacNet - t.eac) : 'Chưa dự báo', t.eac ? `HĐ ${shortMoney(t.eacNet)} − chi phí dự báo ${shortMoney(t.eac)}` : 'cần tiến độ ≥ 20%', t.eacNet - t.eac < 0 ? 'text-rose-700' : 'text-leaf-700']] as const).map(([I, l, v, h, tone]) =>
        <article key={l} className="rounded-2xl border border-border bg-card p-3 shadow-sm"><span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><I size={14} className="text-teal-700" />{l}</span>
          <b className={`mt-1 block text-xl tabular-nums ${tone}`}>{v}</b><span className="block text-[11px] text-muted-foreground">{h}</span></article>)}
    </section>
    <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0" /><span>Doanh thu, chi phí tính chưa VAT. Lãi gộp tạm tính = giá trị HĐ × tiến độ Gantt − chi phí đã ghi nhận.
      Chi phí trước mốc là số MISA đã nhập — MISA nhập chưa đủ thì lãi đang cao hơn thực tế (kiểm ở Chi phí & ngân sách → Số MISA đã nhập).</span></p>

    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2"><h3 className="mr-auto px-2 font-semibold">Theo dự án</h3>
        <label className="inline-flex items-center gap-1 text-sm"><ArrowDownUp size={14} className="text-muted-foreground" /><select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp" className={inputCls}>
          <option value="net">Giá trị HĐ lớn → nhỏ</option><option value="margin">Lãi gộp thấp → cao</option><option value="cost">Chi phí lớn → nhỏ</option></select></label>
        <button type="button" onClick={() => void exportPl()} className={secondaryBtn}><Download size={15} />Xuất Excel</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[64rem] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Dự án</th><th className="px-2 text-right">Giá trị HĐ</th><th className="px-2 text-right">Tiến độ</th>
          <th className="px-2 text-right">DT theo sản lượng</th><th className="px-2 text-right">DT đã nghiệm thu</th><th className="px-2 text-right">Chi phí</th><th className="px-2 text-right">Lãi gộp tạm tính</th>
          <th className="px-2 text-right">Chi phí khi xong (dự báo)</th><th className="px-3 text-right">Lãi dự kiến khi xong</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map(p => { const m = p.outputNet != null ? p.outputNet - p.cost : null; const fin = p.eac != null && p.contractNet ? p.contractNet - p.eac : null;
          return <tr key={p.projectId} className={sel === p.projectId ? 'bg-teal-50/60 dark:bg-teal-950/20' : ''}>
            <td className="px-3 py-2"><button type="button" onClick={() => setPlProject(sel === p.projectId ? '' : p.projectId)} className={`text-left hover:underline ${ENT}`}>{p.code}</button>
              <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={p.name}>{p.name}</span>
              <a href={projectFinanceHref(p.projectId, 'overview')} className="text-[11px] font-semibold text-teal-700 hover:underline">Tài chính dự án</a></td>
            <td className="whitespace-nowrap px-2 text-right tabular-nums">{p.contractNet ? shortMoney(p.contractNet) : <span className="text-xs text-muted-foreground">chưa có HĐ</span>}</td>
            <td className="px-2 text-right tabular-nums">{p.progress != null ? `${p.progress}%` : <span className="text-xs text-muted-foreground">chưa có</span>}</td>
            <td className="whitespace-nowrap px-2 text-right tabular-nums">{p.outputNet != null ? shortMoney(p.outputNet) : '—'}</td>
            <td className="whitespace-nowrap px-2 text-right tabular-nums">{shortMoney(p.acceptedNet)}{p.outputNet != null && p.outputNet - p.acceptedNet > 1e8 && <span className="block text-[11px] text-amber-700">chưa đề nghị {shortMoney(p.outputNet - p.acceptedNet)}</span>}</td>
            <td className="whitespace-nowrap px-2 text-right tabular-nums">{shortMoney(p.cost)}</td>
            <td className={`whitespace-nowrap px-2 text-right font-semibold tabular-nums ${m == null ? 'text-muted-foreground' : m < 0 ? 'text-rose-700' : 'text-leaf-700'}`}>{m == null ? '—' : sm(m)}{m != null && p.outputNet ? <span className="block text-[11px] font-normal">{pct(m, p.outputNet)}</span> : null}</td>
            <td className="whitespace-nowrap px-2 text-right tabular-nums">{p.eac != null ? shortMoney(p.eac) : <span className="text-xs text-muted-foreground">tiến độ &lt; 20%</span>}</td>
            <td className={`whitespace-nowrap px-3 text-right font-semibold tabular-nums ${fin == null ? 'text-muted-foreground' : fin < 0 ? 'text-rose-700' : 'text-leaf-700'}`}>{fin == null ? '—' : sm(fin)}{fin != null && p.contractNet ? <span className="block text-[11px] font-normal">{pct(fin, p.contractNet)}</span> : null}</td>
          </tr>; })}</tbody>
      </table></div>
    </section>

    <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">Theo tháng — {selP ? selP.code : 'toàn công ty'}</h3>
          <select value={sel} onChange={e => setPlProject(e.target.value)} aria-label="Dự án" className={inputCls}><option value="">Toàn công ty</option>{pl.map(p => <option key={p.projectId} value={p.projectId}>{p.code}</option>)}</select></div>
        <p className="text-xs text-muted-foreground">tỷ đồng · doanh thu = đợt CĐT đã xác nhận (chưa VAT); chi phí theo ngày chứng từ; CĐT trả gồm VAT và tạm ứng</p>
        <div className="mt-2 h-64"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series} margin={{ left: -8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} width={44} /><Tooltip formatter={(v: number) => `${v.toLocaleString('vi-VN')} tỷ`} /><Legend />
          <Bar dataKey="Doanh thu nghiệm thu" fill="#52b53a" radius={[4, 4, 0, 0]} /><Bar dataKey="Chi phí" fill="#3cbfaa" radius={[4, 4, 0, 0]} />
          <Line dataKey="CĐT trả" stroke="#0f766e" strokeWidth={2} dot /></ComposedChart></ResponsiveContainer></div>
      </article>
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">Chi phí theo loại {selP ? `— ${selP.code}` : ''}</h3>
        {!selP ? <p className="mt-1 text-sm text-muted-foreground">Bấm mã dự án trong bảng để xem chi phí theo loại.</p>
          : <ul className="mt-2 space-y-2 text-sm">{cats.map(([k, v]) => <li key={k}><p className="flex justify-between"><span>{CAT[k] || k}</span><b className="tabular-nums">{shortMoney(v)}</b></p>
            <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-mint-500" style={{ width: `${selP.cost ? Math.max(0, v * 100 / selP.cost) : 0}%` }} /></span></li>)}</ul>}
      </article>
    </section>
  </div>;
};
