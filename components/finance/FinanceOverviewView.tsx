import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarClock, CheckCircle2, ChevronRight, ClipboardList, HandCoins, Landmark, PiggyBank, ShieldAlert, TrendingUp, Wallet,
} from 'lucide-react';
import { financeService, type FinanceOverview, type FinanceOverviewProject } from '../../lib/financeService';
import { StateBox } from '../procurement/hub/hubUi';
import { shortMoney, viDate } from './financeUi';

// Tổng quan tài chính cho TGĐ / GĐTC: số lớn, dòng tiền, sức khỏe từng dự án; bấm dự án để xem chi tiết.
// Số chưa có nguồn hiện "Chưa có dữ liệu", không hiện 0. Sản lượng = tiến độ Gantt × giá trị HĐ (ước tính) cho tới khi có nghiệm thu.

type Period = 'all' | 'year' | 'quarter' | 'month';
const CAT: Record<string, string> = { materials: 'Vật tư', labor: 'Nhân công', overhead: 'Chi phí chung', machinery: 'Máy thi công', subcontract: 'Thầu phụ', other: 'Khác' };
const CAT_COLOR: Record<string, string> = { materials: '#268576', labor: '#52b53a', overhead: '#3cbfaa', machinery: '#93d17e', subcontract: '#206a5f', other: '#94a3b8' };
const ty = (n: number | null | undefined) => n == null ? '—' : `${(n / 1e9).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tỷ`;
const pct = (a: number | null | undefined, b: number | null | undefined) => a == null || !b ? null : Math.round(a / b * 1000) / 10;
const NO_DATA = 'Chưa có dữ liệu';

const inPeriod = (month: string, period: Period, today: string) => {
  if (period === 'all') return true;
  if (month.slice(0, 4) !== today.slice(0, 4)) return false;
  if (period === 'year') return true;
  const m = Number(month.slice(5, 7)); const tm = Number(today.slice(5, 7));
  return period === 'month' ? m === tm : Math.ceil(m / 3) === Math.ceil(tm / 3);
};
const flows = (p: FinanceOverviewProject, period: Period, today: string) => p.months.filter(m => inPeriod(m.month, period, today))
  .reduce((s, m) => ({ in: s.in + (m.in || 0), out: s.out + (m.out || 0) }), { in: 0, out: 0 });
const estOutput = (p: FinanceOverviewProject) => p.contractValue != null && p.progress != null ? p.contractValue * p.progress / 100 : null;

type Health = { key: 'idle' | 'ok' | 'watch' | 'risk'; label: string; cls: string; reasons: string[] };
const healthOf = (p: FinanceOverviewProject): Health => {
  if (!p.received && !p.cost) return { key: 'idle', label: 'Chưa phát sinh', cls: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300', reasons: [] };
  const reasons: string[] = [];
  const costPct = pct(p.cost, p.contractValue); const matPct = pct(p.costByCategory.materials || 0, p.materialBudget);
  if (p.received - p.cost < 0) reasons.push(`Chi phí vượt số đã thu ${shortMoney(p.cost - p.received)}`);
  if (costPct != null && p.progress != null && costPct > p.progress + 10) reasons.push(`Chi phí ${costPct}% giá trị HĐ khi tiến độ ${p.progress}%`);
  if (matPct != null && p.progress != null && matPct > p.progress + 15) reasons.push(`Vật tư đã dùng ${matPct}% dự toán khi tiến độ ${p.progress}%`);
  // Nợ quá hạn còn tạm tính (đầu kỳ chưa chốt) nên chỉ cảnh báo khi đáng kể.
  if (p.payable.overdue >= 5e7) reasons.push(`Nợ NCC quá hạn ${shortMoney(p.payable.overdue)}`);
  if (p.received - p.cost < 0) return { key: 'risk', label: 'Rủi ro', cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200', reasons };
  if (reasons.length) return { key: 'watch', label: 'Cần chú ý', cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200', reasons };
  return { key: 'ok', label: 'Ổn định', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200', reasons };
};

const series = (ps: FinanceOverviewProject[], today: string) => {
  const year = today.slice(0, 4); const until = Number(today.slice(5, 7));
  let cum = ps.reduce((s, p) => s + p.months.filter(m => m.month < `${year}-01`).reduce((a, m) => a + (m.in || 0) - (m.out || 0), 0), 0);
  return Array.from({ length: until }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const inn = ps.reduce((s, p) => s + (p.months.find(m => m.month === key)?.in || 0), 0);
    const out = ps.reduce((s, p) => s + (p.months.find(m => m.month === key)?.out || 0), 0);
    cum += inn - out;
    return { m: `T${i + 1}`, thu: inn / 1e9, chi: -out / 1e9, luyke: cum / 1e9 };
  });
};
const tip = (v: number) => `${Math.abs(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) =>
  <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${className}`}>{children}</section>;
const Meter: React.FC<{ value: number | null; tone?: string }> = ({ value, tone = 'bg-leaf-500' }) => value == null
  ? <span className="text-xs text-muted-foreground">{NO_DATA}</span>
  : <span className="flex items-center gap-2"><span className="h-2 w-20 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} /></span>
    <b className="whitespace-nowrap tabular-nums text-sm">{value.toLocaleString('vi-VN')}%</b></span>;

// ---------------------------------------------------------------------------
// Sức khỏe dự án
// ---------------------------------------------------------------------------
const ProjectHealth: React.FC<{ p: FinanceOverviewProject; today: string; onBack: () => void; onOpenPayables: (projectId: string) => void }> = ({ p, today, onBack, onOpenPayables }) => {
  const h = healthOf(p); const est = estOutput(p); const gap = est != null ? p.received - est : null;
  const steps: Array<[string, number | null, string, string?]> = [['Giá trị HĐ', p.contractValue, '#cbd5e1'],
    ['Sản lượng ước tính', est, '#3cbfaa', p.progress != null ? `tiến độ Gantt ${p.progress}% × HĐ` : 'chưa có kế hoạch Gantt'],
    ['Đã nghiệm thu', null, '#78d8c5', 'chưa nhập nghiệm thu với chủ đầu tư'], ['Đã thu', p.received, '#52b53a'], ['Chi phí ghi nhận', p.cost, '#206a5f']];
  const base = p.contractValue || Math.max(p.received, p.cost, 1);
  const cats = Object.entries(p.costByCategory).sort((a, b) => b[1] - a[1]);
  return <div className="space-y-4">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 dark:text-teal-300"><ArrowLeft size={15} />Tổng quan</button>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Sức khỏe tài chính dự án</p>
        <h2 className="text-2xl font-black text-mint-700 dark:text-mint-300">{p.name}</h2>
        <p className="text-sm text-muted-foreground">{p.code} · HĐ {p.contractValue != null ? ty(p.contractValue) : 'chưa khai'} · tiến độ {p.progress != null ? `${p.progress}%` : '—'}</p></div>
      <span className={`ml-auto rounded-full border px-3 py-1 text-sm font-semibold ${h.cls}`}>{h.label}</span>
    </div>
    {h.reasons.length > 0 && <ul className="flex flex-wrap gap-2">{h.reasons.map(r => <li key={r} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{r}</li>)}</ul>}
    <Card>
      <h3 className="font-bold">Từ hợp đồng đến tiền</h3>
      <div className="mt-3 space-y-2">{steps.map(([k, v, c, hint]) => <div key={k} className="flex items-center gap-3 text-sm">
        <span className="w-36 shrink-0 text-muted-foreground sm:w-44">{k}{hint && <span className="block text-[11px]">{hint}</span>}</span>
        <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-muted">{v != null && <div className="flex h-full items-center rounded-lg px-2 text-xs font-bold text-white" style={{ width: `${Math.max(4, Math.min(100, v / base * 100))}%`, background: c }}>{pct(v, p.contractValue) != null ? `${pct(v, p.contractValue)}%` : ''}</div>}</div>
        <span className="w-24 text-right font-bold tabular-nums sm:w-28">{v == null ? <span className="text-xs font-normal text-muted-foreground">{NO_DATA}</span> : ty(v)}</span></div>)}</div>
      {gap != null && Math.abs(gap) >= 1e8 && <p className={`mt-3 rounded-xl p-2.5 text-sm ${gap > 0 ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/30 dark:text-teal-100' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100'}`}>
        {gap > 0 ? <><b>Đã thu vượt sản lượng ước tính {ty(gap)}</b> — phần lớn là tạm ứng; khi nghiệm thu sẽ bị khấu trừ dần, các tháng tới dòng tiền có thể âm.</>
          : <><b>Sản lượng ước tính vượt số đã thu {ty(-gap)}</b> — nên lập hồ sơ nghiệm thu / đề nghị thanh toán với chủ đầu tư.</>}</p>}
    </Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h3 className="font-bold">Thu chi theo tháng · {today.slice(0, 4)}</h3>
        <div className="h-60"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series([p], today)} margin={{ left: -10, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} /><XAxis dataKey="m" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} unit=" tỷ" />
          <Tooltip formatter={tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="thu" name="Thu" fill="#52b53a" radius={[6, 6, 0, 0]} /><Bar dataKey="chi" name="Chi phí" fill="#206a5f" radius={[0, 0, 6, 6]} />
          <Line type="monotone" dataKey="luyke" name="Lũy kế thu − chi" stroke="#3cbfaa" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer></div></Card>
      <Card><h3 className="font-bold">Chi phí theo khoản mục</h3>
        {cats.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có chi phí.</p> : <ul className="mt-2 space-y-3 text-sm">{cats.map(([k, v]) => { const budget = k === 'materials' ? p.materialBudget : null;
          return <li key={k}><div className="flex flex-wrap justify-between gap-1"><span>{CAT[k] || k}</span><span className="tabular-nums"><b className="text-leaf-700 dark:text-leaf-300">{ty(v)}</b>
            {budget ? <span className="text-muted-foreground"> / dự toán {ty(budget)}</span> : <span className="text-xs text-muted-foreground"> · chưa có dự toán</span>}</span></div>
            {budget ? <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${p.progress != null && v / budget * 100 > p.progress + 15 ? 'bg-amber-500' : 'bg-leaf-500'}`} style={{ width: `${Math.min(100, v / budget * 100)}%` }} /></div> : null}</li>; })}</ul>}
        {p.materialBudget && <p className="mt-3 text-xs text-muted-foreground">Vật tư đã dùng {pct(p.costByCategory.materials || 0, p.materialBudget)}% dự toán vật tư · tiến độ {p.progress ?? '—'}%.</p>}</Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h3 className="flex items-center gap-1.5 font-bold"><HandCoins size={16} className="text-leaf-600" />Phải thu chủ đầu tư</h3>
        <ul className="mt-2 divide-y divide-border text-sm">
          {p.receivables.map((r, i) => <li key={i} className="flex items-center gap-2 py-2">
            {r.status === 'paid' ? <CheckCircle2 size={15} className="shrink-0 text-leaf-600" /> : <CalendarClock size={15} className="shrink-0 text-amber-600" />}
            <span className="min-w-0 flex-1">{r.description}<span className="block text-xs text-muted-foreground">{r.status === 'paid' ? `đã thu ${viDate(r.paidDate)}` : `hạn ${viDate(r.dueDate)}`}{r.advance ? ' · tạm ứng' : ''}</span></span>
            <b className="tabular-nums text-leaf-700 dark:text-leaf-300">{ty(r.status === 'paid' ? r.paidAmount : r.amount)}</b></li>)}
          {p.contractValue != null && <li className="flex items-center gap-2 py-2 text-muted-foreground"><CalendarClock size={15} className="shrink-0" /><span className="flex-1">Còn lại theo HĐ (chưa lập đợt thu)</span>
            <b className="tabular-nums">{ty(Math.max(0, p.contractValue - p.received))}</b></li>}
          {p.receivables.length === 0 && p.contractValue == null && <li className="py-2 text-muted-foreground">Chưa có HĐ / đợt thu với chủ đầu tư.</li>}
        </ul></Card>
      <Card><h3 className="flex items-center gap-1.5 font-bold"><Wallet size={16} className="text-teal-700" />Phải trả nhà cung cấp</h3>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          {([['Đang nợ', p.payable.outstanding, ''], ['Quá hạn', p.payable.overdue, 'text-rose-700 dark:text-rose-300'], ['Đến hạn 7 ngày', p.payable.soon, 'text-amber-700 dark:text-amber-300']] as const).map(([l, v, cls]) =>
            <div key={l} className="rounded-xl bg-muted/50 p-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className={`font-bold tabular-nums ${v > 0 ? cls : ''}`}>{shortMoney(v)}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{p.payable.docs} chứng từ đang mở. Quá hạn là tạm tính khi NCC chưa chốt đối chiếu đầu kỳ.</p>
        <button type="button" onClick={() => onOpenPayables(p.id)} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 dark:text-teal-300">Mở Phải trả của dự án<ChevronRight size={15} /></button></Card>
    </div>
  </div>;
};

// ---------------------------------------------------------------------------
// Tổng quan
// ---------------------------------------------------------------------------
export const FinanceOverviewView: React.FC<{
  openingPendingSuppliers: number; supplierCount: number; directPending: { count: number; amount: number; missing: number } | null;
  onOpenPayables: (projectId?: string) => void; onOpenPending: () => void; onOpenTodo: () => void;
}> = ({ openingPendingSuppliers, supplierCount, directPending, onOpenPayables, onOpenPending, onOpenTodo }) => {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [proj, setProj] = useState('all');
  const [open, setOpenRaw] = useState<string | null>(null);
  const setOpen = (id: string | null) => { setOpenRaw(id); window.scrollTo({ top: 0 }); };
  const load = useCallback(() => { setError(null); financeService.overview().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);

  const today = data?.today || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const ps = useMemo(() => (data?.projects || []).filter(p => proj === 'all' || p.id === proj), [data, proj]);
  const t = useMemo(() => {
    const f = ps.reduce((s, p) => { const x = flows(p, period, today); return { in: s.in + x.in, out: s.out + x.out }; }, { in: 0, out: 0 });
    const contracts = ps.filter(p => p.contractValue != null);
    const allReceived = ps.reduce((s, p) => s + p.received, 0);
    return { ...f, contract: contracts.reduce((s, p) => s + (p.contractValue || 0), 0), contracts: contracts.length,
      remaining: contracts.reduce((s, p) => s + Math.max(0, (p.contractValue || 0) - p.received), 0), allReceived,
      advance: ps.some(p => p.advanceReceived != null) ? ps.reduce((s, p) => s + (p.advanceReceived || 0), 0) : null,
      ap: ps.reduce((s, p) => s + p.payable.outstanding, 0) + (proj === 'all' ? data?.companyPayable?.outstanding || 0 : 0),
      overdue: ps.reduce((s, p) => s + p.payable.overdue, 0), soon: ps.reduce((s, p) => s + p.payable.soon, 0),
      est: ps.some(p => estOutput(p) != null) ? ps.reduce((s, p) => s + (estOutput(p) || 0), 0) : null };
  }, [ps, period, today, proj, data]);
  const cats = useMemo(() => Object.entries(ps.reduce<Record<string, number>>((m, p) => {
    Object.entries(p.costByCategory).forEach(([k, v]) => { m[k] = (m[k] || 0) + v; }); return m; }, {})).sort((a, b) => b[1] - a[1]), [ps]);
  const costAll = cats.reduce((s, [, v]) => s + v, 0);

  if (error) return <StateBox kind="error" title="Chưa tải được Tổng quan" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tổng hợp số liệu toàn công ty…" />;
  if (!data.canOverview) return <StateBox kind="denied" message="Tổng quan toàn công ty dành cho Ban giám đốc và Kế toán trưởng (quyền Tài chính — Quản trị). Bạn vẫn dùng được Việc cần làm và Phải trả." />;
  const selected = open ? data.projects.find(p => p.id === open) : null;
  if (selected) return <ProjectHealth p={selected} today={today} onBack={() => setOpen(null)} onOpenPayables={onOpenPayables} />;

  const net = t.in - t.out;
  const periodLabel = { all: 'lũy kế', year: `năm ${today.slice(0, 4)}`, quarter: `quý ${Math.ceil(Number(today.slice(5, 7)) / 3)}`, month: `tháng ${Number(today.slice(5, 7))}` }[period];
  const alerts: Array<{ tone: 'amber' | 'teal' | 'slate' | 'rose'; title: string; text: string; onClick?: () => void }> = [];
  data.projects.forEach(p => { const h = healthOf(p); if (h.key === 'risk' || h.key === 'watch') alerts.push({ tone: h.key === 'risk' ? 'rose' : 'amber', title: `${p.code}: ${h.label.toLowerCase()}`, text: h.reasons.join(' · '), onClick: () => setOpen(p.id) }); });
  if (directPending && directPending.count > 0) alerts.push({ tone: 'amber', title: `${shortMoney(directPending.amount)} phiếu nhập trực tiếp chưa ghi nợ`, text: `${directPending.count} phiếu chờ kế toán kiểm giá + VAT${directPending.missing ? ` (${directPending.missing} phiếu thiếu giá)` : ''} — chi phí dự án đang ghi thiếu tương ứng.`, onClick: onOpenPending });
  if (openingPendingSuppliers > 0) alerts.push({ tone: 'amber', title: `${openingPendingSuppliers}/${supplierCount} NCC chưa đối chiếu đầu kỳ`, text: 'Số nợ quá hạn chỉ là tạm tính — có thể kế toán đã trả ngoài hệ thống.', onClick: () => onOpenPayables() });
  const advanceTotal = data.projects.reduce((s, p) => s + (p.advanceReceived || 0), 0);
  if (advanceTotal > 0) alerts.push({ tone: 'teal', title: `Tạm ứng chủ đầu tư ${ty(advanceTotal)}`, text: 'Tiền dương một phần nhờ tạm ứng; sẽ bị khấu trừ dần qua các đợt nghiệm thu.' });
  data.projects.filter(p => !p.received && !p.cost && p.contractValue).forEach(p => alerts.push({ tone: 'slate', title: `${p.code}: HĐ ${ty(p.contractValue)} chưa phát sinh thu chi`, text: 'Chưa có giao dịch nào trong Vioo.', onClick: () => setOpen(p.id) }));
  const ALERT_CLS = { amber: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30', rose: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30',
    teal: 'border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30', slate: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900' };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Kỳ" className="inline-flex rounded-xl border border-border bg-card p-1 text-sm shadow-sm">
        {([['all', 'Lũy kế'], ['year', `Năm ${today.slice(0, 4)}`], ['quarter', 'Quý này'], ['month', 'Tháng này']] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}
            className={`rounded-lg px-3 py-1 font-semibold ${period === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}</div>
      <select aria-label="Dự án" value={proj} onChange={e => setProj(e.target.value)} className="max-w-[18rem] rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold shadow-sm">
        <option value="all">Toàn công ty · {data.projects.length} dự án</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
      <span className="ml-auto text-xs text-muted-foreground">Số liệu đến {viDate(today)} · đơn vị tỷ đồng</span>
    </div>

    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-mint-600 p-4 text-white shadow-lg sm:p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" /><div className="pointer-events-none absolute -bottom-20 right-40 h-48 w-48 rounded-full bg-white/5" />
      <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([['Đã thu từ chủ đầu tư', t.in, ArrowDownRight, t.contract ? `${pct(t.allReceived, t.contract)}% giá trị HĐ (lũy kế)` : periodLabel, undefined],
          ['Chi phí đã ghi nhận', t.out, ArrowUpRight, periodLabel, undefined],
          ['Chênh lệch thu − chi', net, TrendingUp, net >= 0 ? `Dương tiền · ${periodLabel}` : `Âm tiền · ${periodLabel}`, undefined],
          ['Phải trả NCC đang nợ', t.ap, Wallet, t.overdue ? `${shortMoney(t.overdue)} quá hạn` : 'Không quá hạn', () => onOpenPayables(proj === 'all' ? undefined : proj)]] as const).map(([l, v, I, s, click]) => {
          const body = <><p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-white/80 sm:text-xs"><I size={13} className="-mt-0.5 mr-1 inline" />{l}</p>
            <p className="mt-1 text-2xl font-black tabular-nums tracking-tight sm:text-3xl">{ty(v)}</p><p className="text-xs text-white/80">{s}</p></>;
          return click ? <button key={l} type="button" onClick={click} className="rounded-2xl bg-white/10 p-3 text-left backdrop-blur-sm transition hover:bg-white/20 sm:p-4">{body}</button>
            : <div key={l} className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm sm:p-4">{body}</div>;
        })}
      </div>
    </section>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {([['Giá trị HĐ đang thực hiện', t.contracts ? ty(t.contract) : NO_DATA, Landmark, `${t.contracts} HĐ với chủ đầu tư`],
        ['Còn phải thu theo HĐ', t.contracts ? ty(t.remaining) : NO_DATA, HandCoins, 'chưa trừ giữ lại bảo hành'],
        ['Tạm ứng chủ đầu tư đã nhận', t.advance != null ? ty(t.advance) : NO_DATA, PiggyBank, 'thu hồi dần qua nghiệm thu'],
        ['Sản lượng ước tính', t.est != null ? ty(t.est) : NO_DATA, ClipboardList, 'tiến độ Gantt × HĐ · chưa có nghiệm thu']] as const).map(([l, v, I, s]) =>
        <Card key={l} className="!p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><I size={14} className="shrink-0 text-teal-700 dark:text-teal-300" /><span>{l}</span></p>
          <p className={`mt-0.5 font-bold tabular-nums ${v === NO_DATA ? 'text-base text-muted-foreground' : 'text-xl text-leaf-700 dark:text-leaf-300'}`}>{v}</p><p className="text-xs text-muted-foreground">{s}</p></Card>)}
    </div>

    {alerts.length > 0 && <Card>
      <div className="flex items-center justify-between"><h3 className="flex items-center gap-1.5 font-bold"><ShieldAlert size={16} className="text-amber-600" />Cần Ban giám đốc chú ý</h3>
        <button type="button" onClick={onOpenTodo} className="text-xs font-semibold text-teal-700 dark:text-teal-300">Việc của kế toán →</button></div>
      <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">{alerts.map((a, i) => <li key={i}>
        {a.onClick ? <button type="button" onClick={a.onClick} className={`h-full w-full rounded-xl border p-2.5 text-left hover:shadow-sm ${ALERT_CLS[a.tone]}`}>
          <b className="text-foreground">{a.title}</b><span className="block text-xs text-muted-foreground">{a.text}</span></button>
          : <div className={`h-full rounded-xl border p-2.5 ${ALERT_CLS[a.tone]}`}><b className="text-foreground">{a.title}</b><span className="block text-xs text-muted-foreground">{a.text}</span></div>}</li>)}</ul>
    </Card>}

    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-1"><h3 className="font-bold">Dòng tiền theo tháng · {today.slice(0, 4)}</h3><span className="text-xs text-muted-foreground">Thu · Chi phí · Lũy kế thu − chi</span></div>
        <div className="mt-2 h-72"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={series(ps, today)} margin={{ left: -10, right: 8 }}>
          <defs><linearGradient id="fin-cum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3cbfaa" stopOpacity={0.35} /><stop offset="100%" stopColor="#3cbfaa" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} /><XAxis dataKey="m" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} unit=" tỷ" />
          <Tooltip formatter={tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="luyke" name="Lũy kế thu − chi" stroke="#268576" fill="url(#fin-cum)" strokeWidth={2} />
          <Bar dataKey="thu" name="Thu" fill="#52b53a" radius={[6, 6, 0, 0]} /><Bar dataKey="chi" name="Chi phí" fill="#206a5f" radius={[0, 0, 6, 6]} />
        </ComposedChart></ResponsiveContainer></div>
      </Card>
      <Card>
        <h3 className="font-bold">Cơ cấu chi phí (lũy kế)</h3>
        {cats.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có chi phí.</p> : <>
          <div className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={cats.map(([k, v]) => ({ name: CAT[k] || k, value: v / 1e9, k }))} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
            {cats.map(([k]) => <Cell key={k} fill={CAT_COLOR[k] || '#94a3b8'} />)}</Pie><Tooltip formatter={tip} /></PieChart></ResponsiveContainer></div>
          <ul className="space-y-1 text-sm">{cats.map(([k, v]) => <li key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[k] || '#94a3b8' }} />{CAT[k] || k}
            <span className="ml-auto font-semibold tabular-nums text-leaf-700 dark:text-leaf-300">{ty(v)}</span><span className="w-12 text-right text-xs text-muted-foreground">{pct(v, costAll)}%</span></li>)}</ul></>}
      </Card>
    </div>

    <Card className="overflow-hidden !p-0">
      <div className="flex items-center justify-between px-4 pt-4"><h3 className="font-bold">Sức khỏe từng dự án</h3><span className="text-xs text-muted-foreground">Bấm dự án để xem chi tiết</span></div>
      {/* Điện thoại: thẻ từng dự án */}
      <ul className="mt-2 divide-y divide-border sm:hidden">{data.projects.map(p => { const h = healthOf(p); const n = p.received - p.cost;
        return <li key={p.id}><button type="button" onClick={() => setOpen(p.id)} className="w-full space-y-1.5 px-4 py-3 text-left">
          <span className="flex items-start gap-2"><span className="min-w-0 flex-1"><b className="block text-mint-700 dark:text-mint-300">{p.code}</b><span className="line-clamp-1 text-xs text-muted-foreground">{p.name}</span></span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${h.cls}`}>{h.label}</span></span>
          <span className="grid grid-cols-3 gap-2 text-xs">
            <span><span className="block text-muted-foreground">HĐ</span><b className="tabular-nums">{p.contractValue != null ? ty(p.contractValue) : '—'}</b></span>
            <span><span className="block text-muted-foreground">Đã thu</span><b className="tabular-nums text-leaf-700 dark:text-leaf-300">{ty(p.received)}</b></span>
            <span><span className="block text-muted-foreground">Thu − chi</span><b className={`tabular-nums ${n >= 0 ? 'text-leaf-700 dark:text-leaf-300' : 'text-rose-700 dark:text-rose-300'}`}>{p.received || p.cost ? ty(n) : '—'}</b></span></span>
          <span className="block text-xs text-muted-foreground">Tiến độ {p.progress != null ? `${p.progress}%` : '—'} · chi phí {p.cost ? `${pct(p.cost, p.contractValue) ?? '—'}% HĐ` : 'chưa có'}{p.payable.outstanding ? ` · phải trả ${shortMoney(p.payable.outstanding)}` : ''}</span>
        </button></li>; })}</ul>
      <div className="hidden overflow-x-auto sm:block"><table className="mt-2 w-full min-w-[48rem] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Dự án</th><th className="px-2 py-2 text-right font-medium">Giá trị HĐ</th>
          <th className="px-2 py-2 font-medium">Tiến độ</th><th className="px-2 py-2 font-medium">Đã thu / HĐ</th><th className="px-2 py-2 font-medium">Chi phí / HĐ</th>
          <th className="px-2 py-2 text-right font-medium">Thu − chi</th><th className="px-2 py-2 text-right font-medium">Phải trả</th><th className="px-4 py-2 font-medium">Đánh giá</th></tr></thead>
        <tbody>{data.projects.map(p => { const h = healthOf(p); const n = p.received - p.cost;
          return <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer border-t border-border hover:bg-teal-50/50 dark:hover:bg-teal-950/20">
            <td className="px-4 py-3"><b className="text-mint-700 dark:text-mint-300">{p.name}</b><span className="block text-xs text-muted-foreground">{p.code}</span></td>
            <td className="whitespace-nowrap px-2 py-3 text-right font-semibold tabular-nums">{p.contractValue != null ? ty(p.contractValue) : <span className="text-xs font-normal text-muted-foreground">chưa khai</span>}</td>
            <td className="px-2 py-3"><Meter value={p.progress} tone="bg-mint-500" /></td>
            <td className="px-2 py-3"><Meter value={pct(p.received, p.contractValue)} /></td>
            <td className="px-2 py-3"><Meter value={p.cost ? pct(p.cost, p.contractValue) : null} tone="bg-teal-600" /></td>
            <td className={`whitespace-nowrap px-2 py-3 text-right font-bold tabular-nums ${n >= 0 ? 'text-leaf-700 dark:text-leaf-300' : 'text-rose-700 dark:text-rose-300'}`}>{p.received || p.cost ? ty(n) : '—'}</td>
            <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{p.payable.outstanding ? shortMoney(p.payable.outstanding) : '—'}{p.payable.overdue > 0 && <span className="block text-xs text-rose-700 dark:text-rose-300">{shortMoney(p.payable.overdue)} quá hạn</span>}</td>
            <td className="whitespace-nowrap px-4 py-3"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${h.cls}`}>{h.label}</span><ChevronRight size={14} className="ml-1 inline text-muted-foreground" /></td></tr>; })}</tbody>
      </table></div>
    </Card>
  </div>;
};

export default FinanceOverviewView;
