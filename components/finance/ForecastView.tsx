import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarRange, ChevronDown, ChevronRight, Download, ExternalLink, FileSpreadsheet, Info, Landmark, Lightbulb, Loader2, Pencil, Plus,
  SlidersHorizontal, TrendingDown, TrendingUp, Upload, Wallet, X,
} from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import {
  financeService, type FinanceForecast, type ForecastConf, type ForecastItem, type ForecastItemInput, type ForecastLoan, type ForecastRow, type ForecastScenario,
} from '../../lib/financeService';
import { loadXlsx } from '../../lib/loadXlsx';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, FieldError, moneyInput, parseMoney, projectFinanceHref, shortMoney, viDate } from './financeUi';

// Dự báo dòng tiền 1 / 3 / 6 tháng (doc 15 mục 4, chủ SP duyệt 8 câu). Máy chủ tính từng dòng tiền theo ngày rồi gộp tháng / tuần;
// màn này cộng dồn, tìm tháng căng nhất, số cần chuẩn bị và gợi ý. Thiếu dữ liệu thì nói rõ thiếu gì và mở đúng chỗ khai.

const sm = (n: number) => `${n < -0.5 ? '−' : ''}${shortMoney(Math.abs(n))}`;
const ty = (n: number) => Math.round(n / 1e7) / 100;
const monthLabel = (d: string) => `T${Number(d.slice(5, 7))}/${d.slice(2, 4)}`;
const weekLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const CONF: Record<ForecastConf, { label: string; cls: string }> = {
  sure: { label: 'Chắc chắn', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  sent: { label: 'Đã đặt / đã gửi', cls: 'border-teal-200 bg-teal-50 text-teal-800' },
  plan: { label: 'Theo kế hoạch', cls: 'border-sky-200 bg-sky-50 text-sky-800' },
  est: { label: 'Ước tính', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
};
const SOURCE: Record<string, { label: string; href?: string; how: (f: FinanceForecast) => string }> = {
  in_receivable: { label: 'CĐT đã xác nhận, chưa trả', href: '#/finance/receivables', how: () => 'Các đợt CĐT đã xác nhận còn phải thu, theo hạn thanh toán; quá hạn tính vào hôm nay.' },
  in_sent: { label: 'Đợt đã gửi CĐT, chờ xác nhận', href: '#/finance/receivables', how: f => `Ngày gửi + ${f.params.approvalDays} ngày CĐT duyệt + hạn thanh toán trên HĐ (mặc định 30 ngày).` },
  in_unbilled: { label: 'Khối lượng đã làm, chưa đề nghị thanh toán', href: '#/finance/receivables',
    how: f => `Tiền còn phải thu đến hết HĐ (giá trị gồm VAT × (1 − % giữ lại) − đã thu − đang chờ) chia theo sản lượng; phần đã làm theo Gantt về sau ${f.params.approvalDays} ngày duyệt + hạn HĐ tính từ hôm nay. Ước tính vì chưa đối chiếu đầu kỳ phải thu.` },
  in_progress: { label: 'Khối lượng theo tiến độ Gantt', href: '#/finance/receivables',
    how: f => `Phần việc làm trong từng tháng theo Gantt × tiền còn phải thu của HĐ; CĐT trả sau cuối tháng ${f.params.approvalDays} ngày duyệt + hạn HĐ${f.params.delayDays ? ` ${f.params.delayDays > 0 ? '+' : '−'} ${Math.abs(f.params.delayDays)} ngày theo kịch bản` : ''}${f.params.slipPercent ? `; tiến độ chậm ${f.params.slipPercent}%` : ''}. Giữ lại bảo hành thu sau, ngoài dự báo.` },
  in_recurring: { label: 'Khoản thu định kỳ', href: '#/finance/cash', how: () => 'Khai ở Thu chi & quỹ → Khoản định kỳ.' },
  in_item: { label: 'Khoản thu dự kiến', how: () => 'Khai ở mục Khoản dự kiến bên dưới (nhập tay hoặc Excel).' },
  out_payable: { label: 'Công nợ NCC / thầu phụ đã ghi nhận', href: '#/finance/payables', how: () => 'Chứng từ công nợ còn phải trả theo hạn; quá hạn hoặc chưa có hạn tính vào hôm nay. Không tính đối tác nội bộ.' },
  out_request: { label: 'Tạm ứng, chi khác đã lập chưa chi', href: '#/finance/payables', how: () => 'Đề nghị tạm ứng NCC và phiếu chi khác đang duyệt / chờ chi, theo ngày dự kiến chi.' },
  out_po: { label: 'Đơn mua đã đặt, chưa giao', href: '#/procurement', how: f => `Phần chưa nhận của đơn mua (gồm VAT), trả sau ngày hẹn giao ${f.params.payDays} ngày.` },
  out_po_stale: { label: 'Đơn mua quá hẹn > 30 ngày', href: '#/procurement',
    how: f => `Như trên nhưng đã quá hẹn giao hơn 30 ngày — có thể NCC không giao. Mua hàng "Kết thúc thiếu" đơn không giao để bỏ khỏi dự báo. Trả sau ${f.params.payDays} ngày tính từ hôm nay.` },
  out_material: { label: 'Vật tư dự toán chưa đặt', href: '#/finance/cost',
    how: f => `Dự toán vật tư − đã ghi nhận − đơn đã đặt, cộng VAT ${f.params.materialVatPercent}%, rải theo phần việc còn lại của Gantt, trả sau giữa tháng ${f.params.payDays} ngày.` },
  out_subcontract: { label: 'Thầu phụ — phần còn lại của HĐ', href: '#/finance/subcontracts',
    how: f => `Giá trị HĐ thầu phụ gồm VAT − đã nghiệm thu, trừ giữ lại và tạm ứng còn lại, rải theo Gantt, trả sau giữa tháng ${f.params.payDays} ngày.` },
  out_labor: { label: 'Nhân công chưa có HĐ (ước tính)', href: '#/finance/subcontracts',
    how: f => `${String(f.params.laborPercent).replace('.', ',')}% giá trị HĐ CĐT của phần việc còn lại, trừ phần đã có HĐ thầu phụ. Lập HĐ thầu phụ để thay bằng số HĐ.` },
  out_payroll: { label: 'Lương', href: '#/hrm/payroll', how: () => 'Tổng lương gộp của bảng lương gần nhất, trả ngày 10 tháng sau. Bảng lương còn nháp thì là ước tính.' },
  out_recurring: { label: 'Chi định kỳ', href: '#/finance/cash', how: () => 'Khai ở Thu chi & quỹ → Khoản định kỳ (thuê văn phòng, điện nước, bảo hiểm, thuế cố định…).' },
  out_loan_interest: { label: 'Lãi vay', how: () => 'Dư nợ × lãi suất năm ÷ 12, trả vào ngày trả hằng tháng của khoản vay.' },
  out_loan_principal: { label: 'Trả gốc vay', how: () => 'Trả một lần lúc đáo hạn, hoặc chia đều hằng tháng đến ngày đáo hạn.' },
  out_item: { label: 'Khoản chi dự kiến', how: () => 'Khai ở mục Khoản dự kiến bên dưới (nhập tay hoặc Excel).' },
};
const MISSING_HREF: Record<string, string> = {
  cash: '#/finance/cash', payroll: '#/hrm/payroll', receivables: '#/finance/receivables', subcontracts: '#/finance/subcontracts', cost: '#/finance/cost', procurement: '#/procurement',
};
const ITEM_CATEGORIES: Record<string, string> = { tax: 'Thuế', loan: 'Vay / trả nợ', capital: 'Vốn góp', asset: 'Tài sản', contract: 'Hợp đồng', other: 'Khác' };
const CONF_IMPORT: Record<string, 'sure' | 'plan' | 'est'> = { 'chắc chắn': 'sure', 'chac chan': 'sure', 'theo kế hoạch': 'plan', 'kế hoạch': 'plan', 'ke hoach': 'plan', 'ước tính': 'est', 'uoc tinh': 'est' };
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);

export const ForecastView: React.FC<{ projectId?: string | null }> = ({ projectId = null }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [scenario, setScenario] = useState<ForecastScenario>('base');
  const [horizon, setHorizon] = useState<1 | 3 | 6>(6);
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const [data, setData] = useState<FinanceForecast | null>(null);
  const [faster, setFaster] = useState<FinanceForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const [sel, setSel] = useState<number | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [drawer, setDrawer] = useState<{ kind: 'settings' } | { kind: 'loan'; loan?: ForecastLoan } | { kind: 'item'; item?: ForecastItem } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setError(null); setData(null); setFaster(null);
    financeService.forecast({ scenario, projectId }).then(d => {
      setData(d);
      financeService.forecast({ scenario, projectId, extraDelayDays: -30 }).then(setFaster).catch(() => setFaster(null));
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [scenario, projectId]);
  useEffect(load, [load]);

  const calc = useMemo(() => {
    if (!data) return null;
    const n = grain === 'month' ? horizon : 13;
    const cols = grain === 'month' ? data.months.slice(0, n).map(monthLabel) : data.weeks.map(weekLabel);
    const vals = (r: ForecastRow) => grain === 'month' ? r.months.slice(0, n) : r.weeks;
    const sumDir = (d: 'in' | 'out', rows: ForecastRow[]) => cols.map((_, i) => rows.filter(r => r.dir === d).reduce((a, r) => a + vals(r)[i], 0));
    const inS = sumDir('in', data.rows); const outS = sumDir('out', data.rows);
    const net = inS.map((v, i) => v - outS[i]);
    const start = data.cash?.start ?? 0;
    let run = start; const bal = net.map(v => (run += v));
    const lowest = Math.min(...bal); const lowIdx = bal.indexOf(lowest);
    const floor = data.companyView ? data.params.minBalance : 0;
    const need = Math.max(0, floor - lowest);
    const needOf = (f: FinanceForecast | null) => { if (!f) return null; let r = f.cash?.start ?? 0; const b = cols.map((_, i) => (r += f.rows.reduce((a, x) => a + (x.dir === 'in' ? 1 : -1) * (grain === 'month' ? x.months[i] : x.weeks[i]), 0)));
      return Math.max(0, floor - Math.min(...b)); };
    const byProject = new Map<string, { id: string | null; code: string; in: number; out: number }>();
    for (const r of data.rows) { const k = r.projectId || 'company'; const cur = byProject.get(k) || { id: r.projectId, code: r.projectCode || 'Chung công ty', in: 0, out: 0 };
      const t = vals(r).reduce((a, b) => a + b, 0); if (r.dir === 'in') cur.in += t; else cur.out += t; byProject.set(k, cur); }
    return { n, cols, vals, inS, outS, net, bal, start, lowest, lowIdx, need, fasterNeed: needOf(faster), floor,
      projects: [...byProject.values()].sort((a, b) => (a.in - a.out) - (b.in - b.out)) };
  }, [data, faster, grain, horizon]);

  if (error) return <StateBox kind={error.includes('Quản trị') || error.includes('quyền') ? 'denied' : 'error'} title="Chưa mở được Dự báo dòng tiền" message={error} onRetry={error.includes('Quản trị') ? undefined : load} />;
  if (!data || !calc) return <StateBox kind="loading" title="Đang tính dự báo dòng tiền…" />;
  const c = calc; const company = data.companyView; const can = data.can;
  const period = grain === 'month' ? `${horizon} tháng` : '13 tuần';
  const total = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const rows = data.rows.filter(r => dir === 'all' || r.dir === dir);
  const missing = showAllMissing ? data.missing : data.missing.slice(0, 4);
  const unknownCash = company && !data.cash?.known;
  const chart = c.cols.map((m, i) => ({ m, Thu: ty(c.inS[i]), Chi: -ty(c.outS[i]), [company ? 'Số dư dự kiến' : 'Lũy kế ròng']: ty(c.bal[i]) }));
  const done = (msg: string) => { toast.success('Dự báo dòng tiền', msg); setDrawer(null); load(); };
  const bigOut = data.rows.filter(r => r.dir === 'out').map(r => ({ r, v: c.vals(r).slice(0, c.lowIdx + 1).reduce((a, b) => a + b, 0) })).sort((a, b) => b.v - a.v).slice(0, 2);
  const missingHref = (m: FinanceForecast['missing'][number]) => m.target === 'project' && m.projectId ? projectFinanceHref(m.projectId, 'overview') : MISSING_HREF[m.target];

  const exportXlsx = async () => {
    try {
      const XLSX = await loadXlsx();
      const out = rows.map(r => ({ 'Nguồn': SOURCE[r.source]?.label || r.source, 'Dự án': r.projectCode || 'Chung', 'Thu / Chi': r.dir === 'in' ? 'Thu' : 'Chi', 'Độ tin cậy': CONF[r.conf].label,
        ...Object.fromEntries(c.cols.map((col, i) => [col, Math.round((r.dir === 'in' ? 1 : -1) * c.vals(r)[i])])) }));
      const ws = XLSX.utils.json_to_sheet(out); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Du bao');
      XLSX.writeFile(wb, `du-bao-dong-tien-${scenario}-${grain === 'month' ? `${horizon}thang` : '13tuan'}.xlsx`);
      toast.success('Đã xuất Excel', `${out.length} dòng`);
    } catch (e) { toast.error('Chưa xuất được Excel', e instanceof Error ? e.message : ''); }
  };
  const importItems = async (file: File) => {
    setImporting(true);
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const col = (r: Record<string, unknown>, ...keys: string[]) => { const k = Object.keys(r).find(x => keys.some(y => x.trim().toLowerCase().startsWith(y))); return k ? r[k] : ''; };
      const dateOf = (v: unknown) => { if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
        const s = String(v || '').trim(); const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10); };
      const rowsIn: ForecastItemInput[] = raw.filter(r => String(col(r, 'nội dung', 'noi dung', 'tên')).trim()).map((r, i) => {
        const code = String(col(r, 'mã dự án', 'ma du an', 'dự án')).trim().toLowerCase();
        const amt = col(r, 'số tiền', 'so tien'); const kind = String(col(r, 'loại', 'loai', 'thu')).trim().toLowerCase();
        return { row: i + 2, direction: kind.startsWith('thu') ? 'in' : 'out', name: String(col(r, 'nội dung', 'noi dung', 'tên')).trim(),
          amount: typeof amt === 'number' ? amt : parseMoney(String(amt)), expectedDate: dateOf(col(r, 'ngày', 'ngay')),
          projectId: code ? data.projects.find(p => p.code.toLowerCase() === code)?.id || `?${code}` : null,
          confidence: CONF_IMPORT[String(col(r, 'độ tin cậy', 'do tin cay')).trim().toLowerCase()] || 'plan', note: String(col(r, 'ghi chú', 'ghi chu')).trim() || null };
      });
      if (!rowsIn.length) { toast.error('File không có dòng nào', 'Cần các cột: Loại (Thu/Chi), Nội dung, Số tiền, Ngày dự kiến — tải file mẫu để xem.'); return; }
      const sumIn = rowsIn.filter(r => r.direction === 'in').reduce((a, r) => a + (r.amount || 0), 0); const sumOut = rowsIn.filter(r => r.direction === 'out').reduce((a, r) => a + (r.amount || 0), 0);
      if (!await confirm({ title: 'Nhập khoản dự kiến?', targetName: `${file.name} · ${rowsIn.length} dòng`, confirmText: 'Nhập', actionLabel: 'Nhập', intent: 'success', countdownSeconds: 0,
        warningText: `Thu ${shortMoney(sumIn)} · chi ${shortMoney(sumOut)}. Dòng sai (thiếu số tiền, ngày, mã dự án không có) sẽ được báo lại, chưa ghi dòng nào.` })) return;
      const r = await financeService.saveForecastItems({ rows: rowsIn });
      done(`Đã nhập ${r.saved} khoản dự kiến.`);
    } catch (e) { toast.error('Chưa nhập được file', e instanceof Error ? e.message : ''); }
    finally { setImporting(false); }
  };
  const template = async () => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet([
      { 'Loại': 'Chi', 'Nội dung': 'Nộp thuế VAT tháng 10', 'Số tiền': 850000000, 'Ngày dự kiến': '20/11/2026', 'Mã dự án': '', 'Độ tin cậy': 'Ước tính', 'Ghi chú': '' },
      { 'Loại': 'Thu', 'Nội dung': 'Hoàn tiền bảo lãnh dự thầu', 'Số tiền': 300000000, 'Ngày dự kiến': '15/12/2026', 'Mã dự án': 'DA29', 'Độ tin cậy': 'Theo kế hoạch', 'Ghi chú': '' },
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Khoan du kien'); XLSX.writeFile(wb, 'Mau_Khoan_Du_Kien_Thu_Chi.xlsx');
  };

  return <div className="space-y-3">
    {company && <header className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-700 to-mint-500 text-white"><CalendarRange size={20} /></span>
      <div className="min-w-0 flex-1"><h2 className="text-lg font-bold">Dự báo dòng tiền</h2>
        <p className="text-sm text-muted-foreground">Bao nhiêu tiền sẽ vào, phải chi bao nhiêu, tháng nào thiếu — để chuẩn bị vốn trước. Tính lại mỗi lần mở từ hợp đồng, Gantt, công nợ, đơn mua.</p></div>
    </header>}
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Kịch bản" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">{([['base', 'Cơ sở'], ['safe', 'Thận trọng'], ['good', 'Thuận lợi']] as const).map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={scenario === k} onClick={() => setScenario(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${scenario === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}</div>
      <div role="tablist" aria-label="Khoảng dự báo" className="inline-flex rounded-xl border border-border bg-card p-1 shadow-sm">
        {([1, 3, 6] as const).map(h => <button key={h} type="button" role="tab" aria-selected={grain === 'month' && horizon === h} onClick={() => { setGrain('month'); setHorizon(h); setSel(null); }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${grain === 'month' && horizon === h ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{h} tháng</button>)}
        <button type="button" role="tab" aria-selected={grain === 'week'} onClick={() => { setGrain('week'); setSel(null); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${grain === 'week' ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>13 tuần</button>
      </div>
      <span className="text-xs text-muted-foreground">{scenario === 'safe' ? `CĐT trả chậm thêm ${data.params.safeDelayDays} ngày, tiến độ chậm ${data.params.safeSlipPercent}%` : scenario === 'good' ? `CĐT trả sớm ${data.params.goodEarlyDays} ngày` : 'Theo hạn HĐ và kế hoạch Gantt'}</span>
    </div>

    {data.missing.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <h3 className="flex items-center gap-1.5 font-bold"><AlertTriangle size={16} />Dự báo còn thiếu {data.missing.length} dữ liệu — khai đến đâu, số chắc đến đó</h3>
      <ul className="mt-2 grid gap-1.5 md:grid-cols-2">{missing.map((m, i) => { const href = missingHref(m);
        return <li key={i} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-card px-3 py-2 text-foreground dark:border-amber-900"><span className="min-w-0 flex-1">{m.text}</span>
          {href ? <a href={href} className="shrink-0 text-xs font-semibold text-teal-700 hover:underline">Khai <ExternalLink size={11} className="inline" /></a>
            : m.target === 'loans' || m.target === 'items' ? <button type="button" onClick={() => scrollTo(m.target === 'loans' ? 'fc-loans' : 'fc-items')} className="shrink-0 text-xs font-semibold text-teal-700 hover:underline">Khai</button> : null}</li>; })}</ul>
      {data.missing.length > 4 && <button type="button" onClick={() => setShowAllMissing(v => !v)} className="mt-2 text-xs font-semibold text-teal-700 hover:underline">{showAllMissing ? 'Thu gọn' : `Xem thêm ${data.missing.length - 4} mục`}</button>}
    </section>}

    <section className={`grid grid-cols-2 gap-2 ${company ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {company && <Tile icon={Wallet} label="Tiền đang có" value={!data.cash || data.cash.accounts === 0 ? 'Chưa khai' : unknownCash ? 'Chưa biết' : shortMoney(data.cash.start)}
        hint={!data.cash || data.cash.accounts === 0 ? 'khai tài khoản ngân hàng, tiền mặt' : unknownCash ? `${data.cash.accounts} tài khoản, chưa chốt đủ số dư 30/09` : `${data.cash.accounts} tài khoản`}
        tone={unknownCash ? 'text-amber-700' : 'text-leaf-700'} onClick={() => { window.location.hash = '/finance/cash'; }} />}
      <Tile icon={TrendingUp} label={`Thu dự kiến ${period}`} value={shortMoney(total(c.inS))} hint="bấm để xem các nguồn thu" tone="text-leaf-700" active={dir === 'in'} onClick={() => { setDir(d => d === 'in' ? 'all' : 'in'); scrollTo('fc-table'); }} />
      <Tile icon={TrendingDown} label={`Chi dự kiến ${period}`} value={shortMoney(total(c.outS))} hint="bấm để xem các khoản chi" tone="text-foreground" active={dir === 'out'} onClick={() => { setDir(d => d === 'out' ? 'all' : 'out'); scrollTo('fc-table'); }} />
      <Tile icon={CalendarRange} label={grain === 'month' ? 'Tháng căng nhất' : 'Tuần căng nhất'} value={c.cols[c.lowIdx]} hint={`${company ? 'số dư' : 'lũy kế ròng'} thấp nhất ${sm(c.lowest)}`}
        tone={c.lowest < c.floor ? 'text-rose-700' : 'text-foreground'} active={sel === c.lowIdx} onClick={() => { setSel(c.lowIdx); scrollTo('fc-table'); }} />
      <Tile icon={AlertTriangle} label="Cần chuẩn bị thêm" value={c.need > 0.5 ? shortMoney(c.need) : 'Không thiếu'} hint={c.need > 0.5 ? `trước ${c.cols[c.lowIdx]}${company ? ` · gồm tồn tối thiểu ${shortMoney(c.floor)}` : ' · vốn công ty cấp cho dự án'}` : 'trong khoảng đang xem'}
        tone={c.need > 0.5 ? 'text-rose-700' : 'text-leaf-700'} onClick={() => scrollTo('fc-advice')} />
    </section>
    {unknownCash && <p className="text-xs text-muted-foreground"><Info size={12} className="mr-1 inline" />Số dư dự kiến mới gồm các tài khoản đã khai; khai đủ tài khoản ngân hàng, tiền mặt và chốt số dư 30/09 để số này đúng.</p>}

    <section id="fc-advice" className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-100">
      <h3 className="flex items-center gap-1.5 font-bold"><Lightbulb size={16} />Gợi ý cho GĐ tài chính</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {c.need > 0.5 ? <li>Chuẩn bị <b>{shortMoney(c.need)}</b> trước <b>{c.cols[c.lowIdx]}</b>{bigOut.length > 0 && <> — chi lớn nhất đến lúc đó: {bigOut.map(({ r, v }) => `${SOURCE[r.source]?.label || r.source}${r.projectCode ? ` ${r.projectCode}` : ''} ${shortMoney(v)}`).join('; ')}</>}.</li>
          : <li>Trong {period} tới {company ? 'số dư không xuống dưới tồn quỹ tối thiểu' : 'dự án tự cân đối được thu chi'} theo kịch bản này.</li>}
        {c.fasterNeed != null && c.need > 0.5 && <li>Nếu tiền CĐT về sớm hơn 30 ngày (gửi hồ sơ nghiệm thu ngay cuối tháng, bám CĐT duyệt): {c.fasterNeed > 0.5 ? <>cần chuẩn bị còn <b>{shortMoney(c.fasterNeed)}</b></> : <b>không phải chuẩn bị thêm vốn</b>}.</li>}
        {scenario === 'base' && <li>Xem kịch bản <button type="button" onClick={() => setScenario('safe')} className="font-semibold text-teal-700 hover:underline">Thận trọng</button> để biết mức vốn cần nếu CĐT trả chậm và tiến độ trễ.</li>}
        {data.rows.some(r => r.source === 'out_po_stale') && <li>Rà các đơn mua quá hẹn với Mua hàng: đơn nào NCC không giao thì "Kết thúc thiếu" để bỏ khỏi dự báo.</li>}
        {data.rows.some(r => r.source === 'out_labor') && <li>Nhân công {data.rows.filter(r => r.source === 'out_labor').map(r => r.projectCode).join(', ')} đang ước theo % giá trị HĐ — lập HĐ thầu phụ để số chắc hơn và đàm phán hạn trả khớp tiền CĐT về.</li>}
      </ul>
    </section>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">Thu, chi và {company ? 'số dư dự kiến' : 'lũy kế ròng'} theo {grain === 'month' ? 'tháng' : 'tuần'}</h3>
        <span className="text-xs text-muted-foreground">tỷ đồng · bấm cột để tô cột trong bảng</span></div>
      <div className="mt-2 h-64"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ left: -8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} width={48} />
        <Tooltip formatter={(v: number) => `${v.toLocaleString('vi-VN')} tỷ`} /><Legend /><ReferenceLine y={0} stroke="#71717a" />
        {company && c.floor > 0 && <ReferenceLine y={ty(c.floor)} stroke="#d97706" strokeDasharray="4 4" label={{ value: 'tồn tối thiểu', fontSize: 11, fill: '#b45309', position: 'insideTopLeft' }} />}
        <Bar dataKey="Thu" fill="#52b53a" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(_, i) => setSel(i)} />
        <Bar dataKey="Chi" fill="#3cbfaa" radius={[0, 0, 4, 4]} cursor="pointer" onClick={(_, i) => setSel(i)} />
        <Line dataKey={company ? 'Số dư dự kiến' : 'Lũy kế ròng'} stroke="#dc2626" strokeWidth={2} dot /></ComposedChart></ResponsiveContainer></div>
    </section>

    <section id="fc-table" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"><h3 className="mr-auto font-semibold">Chi tiết theo nguồn</h3>
        {dir !== 'all' && <button type="button" onClick={() => setDir('all')} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{dir === 'in' ? 'Chỉ tiền vào' : 'Chỉ tiền ra'}<X size={12} /></button>}
        {sel != null && <button type="button" onClick={() => setSel(null)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{c.cols[sel]}<X size={12} /></button>}
        <button type="button" onClick={() => void exportXlsx()} className={secondaryBtn}><Download size={15} />Xuất Excel</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Nguồn</th><th className="px-2 text-left">Độ tin cậy</th>
          {c.cols.map((m, i) => <th key={m} className={`px-2 text-right ${sel === i ? 'bg-teal-100 text-teal-900' : ''}`}>{m}</th>)}<th className="px-3 text-right">Cộng</th></tr></thead>
        <tbody className="divide-y divide-border">
          {(['in', 'out'] as const).filter(d => dir === 'all' || dir === d).map(d => <React.Fragment key={d}>
            <tr className="bg-muted/20"><td colSpan={c.n + 3} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide">{d === 'in' ? 'Tiền vào' : 'Tiền ra'}</td></tr>
            {rows.filter(r => r.dir === d).length === 0 && <tr><td colSpan={c.n + 3} className="px-3 py-2 text-xs text-muted-foreground">Chưa có khoản nào.</td></tr>}
            {rows.filter(r => r.dir === d).map(r => { const v = c.vals(r); const src = SOURCE[r.source];
              return <React.Fragment key={r.key}>
                <tr className="cursor-pointer hover:bg-muted/30" onClick={() => setOpen(o => ({ ...o, [r.key]: !o[r.key] }))}>
                  <td className="px-3 py-2"><span className="flex items-center gap-1">{open[r.key] ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                    <span>{src?.label || r.source}{r.projectCode && <span className={`ml-1 text-xs ${ENT}`}>{r.projectCode}</span>}</span></span></td>
                  <td className="px-2"><Badge className={CONF[r.conf].cls}>{CONF[r.conf].label}</Badge></td>
                  {v.map((x, i) => <td key={i} className={`whitespace-nowrap px-2 text-right tabular-nums ${sel === i ? 'bg-teal-50' : ''} ${x > 0.5 && d === 'out' ? 'text-rose-700' : ''}`}>{x > 0.5 ? `${d === 'out' ? '−' : '+'}${shortMoney(x)}` : '—'}</td>)}
                  <td className="whitespace-nowrap px-3 text-right font-semibold tabular-nums">{shortMoney(total(v))}</td></tr>
                {open[r.key] && <tr><td colSpan={c.n + 3} className="bg-muted/10 px-8 py-2 text-xs text-muted-foreground"><Info size={12} className="mr-1 inline" />{src?.how(data)}
                  {r.beyond > 0.5 && ` Sau khoảng dự báo còn ${shortMoney(r.beyond)}.`} ({r.count} khoản){src?.href && <> · <a href={src.href} className="font-semibold text-teal-700 hover:underline">Mở nguồn</a></>}</td></tr>}
              </React.Fragment>; })}
          </React.Fragment>)}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
          <tr><td className="px-3 py-2" colSpan={2}>Ròng trong {grain === 'month' ? 'tháng' : 'tuần'}</td>{c.net.map((v, i) => <td key={i} className={`whitespace-nowrap px-2 text-right tabular-nums ${sel === i ? 'bg-teal-50' : ''} ${v < -0.5 ? 'text-rose-700' : 'text-leaf-700'}`}>{sm(v)}</td>)}<td className="px-3 text-right tabular-nums">{sm(total(c.net))}</td></tr>
          <tr><td className="px-3 py-2" colSpan={2}>{company ? `Số dư dự kiến (đầu kỳ ${shortMoney(c.start)})` : 'Lũy kế ròng'}</td>{c.bal.map((v, i) => <td key={i} className={`whitespace-nowrap px-2 text-right tabular-nums ${sel === i ? 'bg-teal-50' : ''} ${v < c.floor ? 'text-rose-700' : ''}`}>{sm(v)}</td>)}<td /></tr>
        </tfoot>
      </table></div>
    </section>

    <section className="grid gap-3 lg:grid-cols-2">
      {company && <article className="rounded-2xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">Theo dự án ({period})</h3>
        <ul className="mt-2 divide-y divide-border text-sm">{c.projects.map(p => <li key={p.code} className="flex flex-wrap items-center gap-2 py-2">
          {p.id ? <a href={projectFinanceHref(p.id, 'forecast')} className={`min-w-0 flex-1 hover:underline ${ENT}`}>{p.code}</a> : <b className="min-w-0 flex-1">{p.code}</b>}
          <span className="text-xs text-muted-foreground">thu {shortMoney(p.in)} · chi {shortMoney(p.out)}</span>
          <span className={`w-24 text-right font-semibold tabular-nums ${p.in - p.out < -0.5 ? 'text-rose-700' : 'text-leaf-700'}`}>{sm(p.in - p.out)}</span></li>)}</ul></article>}
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2"><h3 className="mr-auto flex items-center gap-1.5 font-semibold"><SlidersHorizontal size={15} className="text-teal-700" />Giả định</h3>
          {can.manage && company && <button type="button" onClick={() => setDrawer({ kind: 'settings' })} className="text-xs font-semibold text-teal-700 hover:underline"><Pencil size={12} className="mr-0.5 inline" />Sửa</button>}</div>
        <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
          {([['CĐT duyệt hồ sơ', `${data.params.approvalDays} ngày + hạn trên HĐ`], ['Trả NCC / thầu phụ sau khi nhận', `${data.params.payDays} ngày`],
            ['Nhân công khi chưa có HĐ thầu phụ', `${String(data.params.laborPercent).replace('.', ',')}% giá trị HĐ`], ['VAT vật tư chưa đặt', `${data.params.materialVatPercent}%`],
            ['Thận trọng', `trả chậm +${data.params.safeDelayDays} ngày, tiến độ chậm ${data.params.safeSlipPercent}%`], ['Thuận lợi', `trả sớm ${data.params.goodEarlyDays} ngày`],
            ...(company ? [['Tồn quỹ tối thiểu', shortMoney(data.params.minBalance)]] : [])] as Array<[string, string]>).map(([k, v]) =>
            <div key={k} className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Hạn thanh toán, % giữ lại, % thu hồi tạm ứng lấy theo từng HĐ (sửa ở Phải thu / Thầu phụ → điều khoản).</p></article>
    </section>

    {company && <section id="fc-loans" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2"><h3 className="mr-auto flex items-center gap-1.5 font-semibold"><Landmark size={15} className="text-teal-700" />Khoản vay</h3>
        {can.record && <button type="button" onClick={() => setDrawer({ kind: 'loan' })} className={secondaryBtn}><Plus size={14} />Thêm khoản vay</button>}</div>
      {(data.loans || []).length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Chưa khai khoản vay nào. Khai dư nợ, lãi suất, ngày đáo hạn — Vioo tự tính lãi hằng tháng và tiền trả gốc vào dự báo. Công ty không vay thì bỏ qua.</p>
        : <ul className="mt-2 divide-y divide-border text-sm">{(data.loans || []).map(l => <li key={l.id} className={`flex flex-wrap items-center gap-2 py-2 ${l.active ? '' : 'opacity-50'}`}>
          <span className="min-w-0 flex-1"><b>{l.lender}</b>{l.contractNo && <span className="text-xs text-muted-foreground"> · {l.contractNo}</span>}
            <span className="block text-xs text-muted-foreground">Lãi {String(l.interestRate).replace('.', ',')}%/năm · {l.repayKind === 'bullet' ? 'gốc trả một lần' : 'gốc chia đều hằng tháng'} · đáo hạn {viDate(l.maturityDate)} · trả ngày {l.payDay}{l.active ? '' : ' · ngừng tính'}</span></span>
          <span className="font-semibold tabular-nums">{shortMoney(l.outstanding)}</span>
          {can.record && <button type="button" onClick={() => setDrawer({ kind: 'loan', loan: l })} className="text-xs font-semibold text-teal-700 hover:underline">Sửa</button>}</li>)}</ul>}
    </section>}

    <section id="fc-items" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto flex items-center gap-1.5 font-semibold"><FileSpreadsheet size={15} className="text-teal-700" />Khoản dự kiến (chưa có chứng từ)</h3>
        {can.record && <><button type="button" onClick={() => void template()} className="text-xs font-semibold text-teal-700 hover:underline">Tải file mẫu</button>
          <button type="button" disabled={importing} onClick={() => fileRef.current?.click()} className={secondaryBtn}>{importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Import Excel</button>
          <button type="button" onClick={() => setDrawer({ kind: 'item' })} className={primaryBtn}><Plus size={14} />Thêm khoản</button></>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importItems(f); }} /></div>
      <p className="mt-1 text-xs text-muted-foreground">Thuế phải nộp, thu hồi bảo lãnh, góp vốn, mua tài sản… Khoản lặp hằng tháng (thuê văn phòng, điện nước) khai ở <a href="#/finance/cash" className="font-semibold text-teal-700 hover:underline">Thu chi & quỹ → Khoản định kỳ</a>.</p>
      {data.items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có khoản dự kiến.</p>
        : <ul className="mt-2 divide-y divide-border text-sm">{data.items.map(it => <li key={it.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="w-20 tabular-nums text-muted-foreground">{viDate(it.expectedDate)}</span>
          <span className="min-w-0 flex-1"><b>{it.name}</b> <Badge className={CONF[it.confidence].cls}>{CONF[it.confidence].label}</Badge>
            <span className="block text-xs text-muted-foreground">{ITEM_CATEGORIES[it.category] || it.category}{it.projectCode ? ` · ${it.projectCode}` : ' · chung công ty'}{it.note ? ` · ${it.note}` : ''}</span></span>
          <span className={`font-semibold tabular-nums ${it.direction === 'in' ? 'text-leaf-700' : 'text-rose-700'}`}>{it.direction === 'in' ? '+' : '−'}{money(it.amount)}</span>
          {can.record && <><button type="button" onClick={() => setDrawer({ kind: 'item', item: it })} className="text-xs font-semibold text-teal-700 hover:underline">Sửa</button>
            <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
              const r = await askReason({ title: 'Bỏ khoản dự kiến', targetName: `${it.name} · ${shortMoney(it.amount)}`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: đã có chứng từ thật / không còn phát sinh', actionLabel: 'Bỏ khoản', intent: 'warning' });
              if (r) financeService.cancelForecastItem({ id: it.id, reason: r }).then(() => done('Đã bỏ khoản dự kiến.')).catch(e => toast.error('Chưa bỏ được khoản', e instanceof Error ? e.message : ''));
            }}>Bỏ</button></>}</li>)}</ul>}
    </section>

    {drawer?.kind === 'settings' && <SettingsDrawer f={data} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'loan' && <LoanDrawer f={data} loan={drawer.loan} onClose={() => setDrawer(null)} onSaved={done} />}
    {drawer?.kind === 'item' && <ItemDrawer f={data} item={drawer.item} defaultProjectId={projectId} onClose={() => setDrawer(null)} onSaved={done} />}
  </div>;
};

const Tile: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; tone: string; active?: boolean; onClick: () => void }> = ({ icon: Icon, label, value, hint, tone, active, onClick }) =>
  <button type="button" onClick={onClick} aria-pressed={active}
    className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition hover:border-teal-300 ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon size={14} className="text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span><span className="block text-[11px] text-muted-foreground">{hint}</span></button>;

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) =>
  <label className="block text-sm font-medium">{label}{children}{hint && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
const Footer: React.FC<{ err: string | null; blockers: string[]; busy: boolean; onClose: () => void; onSave: () => void; label: string }> = ({ err, blockers, busy, onClose, onSave, label }) => <>
  <FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700">{blockers.join(' · ')}</span>}
  <button type="button" onClick={onClose} className={secondaryBtn}>Huỷ</button>
  <button type="button" disabled={busy || blockers.length > 0} onClick={onSave} className={primaryBtn}>{busy && <Loader2 size={15} className="animate-spin" />}{label}</button></>;

const SettingsDrawer: React.FC<{ f: FinanceForecast; onClose: () => void; onSaved: (m: string) => void }> = ({ f, onClose, onSaved }) => {
  const p = f.params;
  const [v, setV] = useState({ approvalDays: String(p.approvalDays), payDays: String(p.payDays), laborPercent: String(p.laborPercent).replace('.', ','), materialVatPercent: String(p.materialVatPercent).replace('.', ','),
    safeDelayDays: String(p.safeDelayDays), safeSlipPercent: String(p.safeSlipPercent).replace('.', ','), goodEarlyDays: String(p.goodEarlyDays) });
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(',', '.'));
  const bad = Object.values(v).some(x => x.trim() === '' || !Number.isFinite(num(x)) || num(x) < 0);
  const blockers = [bad && 'Nhập số hợp lệ cho mọi ô', !reason.trim() && 'Ghi lý do'].filter(Boolean) as string[];
  const field = (k: keyof typeof v, label: string, hint?: string) => <Field label={label} hint={hint}><input value={v[k]} onChange={e => setV(o => ({ ...o, [k]: e.target.value }))} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>;
  const save = async () => { setBusy(true); setErr(null);
    try { await financeService.saveForecastSettings({ approvalDays: num(v.approvalDays), payDays: num(v.payDays), laborPercent: num(v.laborPercent), materialVatPercent: num(v.materialVatPercent),
      safeDelayDays: num(v.safeDelayDays), safeSlipPercent: num(v.safeSlipPercent), goodEarlyDays: num(v.goodEarlyDays), reason: reason.trim() }); onSaved('Đã lưu giả định — dự báo đã tính lại.'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <Drawer label="Giả định dự báo" onClose={onClose} header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dự báo dòng tiền</p><h2 className="text-lg font-bold">Sửa giả định</h2>
    <p className="text-sm text-muted-foreground">Áp cho toàn bộ dự báo, mọi người xem đều thấy số mới. Hạn thanh toán từng HĐ sửa ở điều khoản HĐ.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} onSave={() => void save()} label="Lưu giả định" />}>
    <div className="grid gap-3 sm:grid-cols-2">
      {field('approvalDays', 'CĐT duyệt hồ sơ (ngày)', 'Cộng thêm hạn thanh toán trên HĐ')}{field('payDays', 'Trả NCC / thầu phụ sau khi nhận (ngày)')}
      {field('laborPercent', 'Nhân công khi chưa có HĐ thầu phụ (% giá trị HĐ)', 'SMB: 11,8 tỷ nhân công / 105,8 tỷ HĐ ≈ 11,1%')}{field('materialVatPercent', 'VAT vật tư chưa đặt (%)')}
      {field('safeDelayDays', 'Thận trọng: CĐT trả chậm thêm (ngày)')}{field('safeSlipPercent', 'Thận trọng: tiến độ chậm (%)')}{field('goodEarlyDays', 'Thuận lợi: CĐT trả sớm (ngày)')}
    </div>
    <Field label="Lý do sửa"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="VD: CĐT DA29 duyệt hồ sơ 20 ngày" className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

const LoanDrawer: React.FC<{ f: FinanceForecast; loan?: ForecastLoan; onClose: () => void; onSaved: (m: string) => void }> = ({ f, loan, onClose, onSaved }) => {
  const [lender, setLender] = useState(loan?.lender || ''); const [no, setNo] = useState(loan?.contractNo || ''); const [proj, setProj] = useState(loan?.projectId || '');
  const [out, setOut] = useState(moneyInput(loan?.outstanding)); const [rate, setRate] = useState(loan ? String(loan.interestRate).replace('.', ',') : '');
  const [kind, setKind] = useState<'bullet' | 'monthly'>(loan?.repayKind || 'bullet'); const [mat, setMat] = useState(loan?.maturityDate || ''); const [day, setDay] = useState(String(loan?.payDay || 25));
  const [active, setActive] = useState(loan?.active ?? true); const [note, setNote] = useState(loan?.note || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amt = parseMoney(out); const r = Number(rate.replace(',', '.') || '0'); const d = Number(day);
  const blockers = [!lender.trim() && 'Nhập bên cho vay', !(amt >= 0) && 'Nhập dư nợ', !mat && 'Chọn ngày đáo hạn', !(r >= 0 && r <= 100) && 'Lãi suất 0–100%', !(d >= 1 && d <= 28) && 'Ngày trả 1–28'].filter(Boolean) as string[];
  const save = async () => { setBusy(true); setErr(null);
    try { await financeService.saveLoan({ id: loan?.id, lender: lender.trim(), contractNo: no.trim() || null, projectId: proj || null, outstanding: amt, interestRate: r, repayKind: kind,
      maturityDate: mat, payDay: d, note: note.trim() || null, active }); onSaved(loan ? 'Đã sửa khoản vay.' : 'Đã thêm khoản vay vào dự báo.'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <Drawer label="Khoản vay" onClose={onClose} header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dự báo dòng tiền</p><h2 className="text-lg font-bold">{loan ? 'Sửa khoản vay' : 'Thêm khoản vay'}</h2>
    <p className="text-sm text-muted-foreground">Vioo tính lãi hằng tháng trên dư nợ và tiền trả gốc vào dự báo. Khi trả thật vẫn lập phiếu chi.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} onSave={() => void save()} label="Lưu khoản vay" />}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Bên cho vay"><input value={lender} onChange={e => setLender(e.target.value)} placeholder="VD: Vietcombank Thái Bình" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Số hợp đồng vay"><input value={no} onChange={e => setNo(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Dư nợ hiện tại (đ)"><input value={out} onChange={e => setOut(e.target.value)} onBlur={() => out.trim() && setOut(moneyInput(parseMoney(out) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Lãi suất (%/năm)"><input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="VD: 8,5" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Trả gốc"><select value={kind} onChange={e => setKind(e.target.value as 'bullet' | 'monthly')} className={`mt-1 w-full ${inputCls}`}><option value="bullet">Một lần khi đáo hạn</option><option value="monthly">Chia đều hằng tháng</option></select></Field>
      <Field label="Ngày đáo hạn"><input type="date" value={mat} onChange={e => setMat(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Ngày trả hằng tháng (1–28)"><input value={day} onChange={e => setDay(e.target.value)} inputMode="numeric" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Vay cho dự án (không bắt buộc)"><select value={proj} onChange={e => setProj(e.target.value)} className={`mt-1 w-full ${inputCls}`}><option value="">Chung công ty</option>{f.projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
    </div>
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
    {loan && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Còn tính vào dự báo (bỏ tích khi đã tất toán)</label>}
  </Drawer>;
};

const ItemDrawer: React.FC<{ f: FinanceForecast; item?: ForecastItem; defaultProjectId: string | null; onClose: () => void; onSaved: (m: string) => void }> = ({ f, item, defaultProjectId, onClose, onSaved }) => {
  const [direction, setDirection] = useState<'in' | 'out'>(item?.direction || 'out'); const [name, setName] = useState(item?.name || ''); const [cat, setCat] = useState(item?.category || 'tax');
  const [proj, setProj] = useState(item?.projectId || defaultProjectId || ''); const [amount, setAmount] = useState(moneyInput(item?.amount)); const [date, setDate] = useState(item?.expectedDate || '');
  const [conf, setConf] = useState<'sure' | 'plan' | 'est'>(item?.confidence || 'plan'); const [note, setNote] = useState(item?.note || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amt = parseMoney(amount);
  const blockers = [!name.trim() && 'Nhập nội dung', !(amt > 0) && 'Nhập số tiền', !date && 'Chọn ngày dự kiến'].filter(Boolean) as string[];
  const save = async () => { setBusy(true); setErr(null);
    try { await financeService.saveForecastItems({ id: item?.id, direction, name: name.trim(), category: cat, projectId: proj || null, amount: amt, expectedDate: date, confidence: conf, note: note.trim() || null });
      onSaved(item ? 'Đã sửa khoản dự kiến.' : 'Đã thêm khoản dự kiến vào dự báo.'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <Drawer label="Khoản dự kiến" onClose={onClose} header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dự báo dòng tiền</p><h2 className="text-lg font-bold">{item ? 'Sửa khoản dự kiến' : 'Thêm khoản dự kiến'}</h2>
    <p className="text-sm text-muted-foreground">Khoản thu / chi chưa có chứng từ nhưng biết trước. Khi có chứng từ thật thì bỏ khoản này để không tính 2 lần.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} onSave={() => void save()} label="Lưu khoản" />}>
    <div role="tablist" aria-label="Thu hay chi" className="inline-flex rounded-xl border border-border p-1">{([['out', 'Khoản chi'], ['in', 'Khoản thu']] as const).map(([k, l]) =>
      <button key={k} type="button" role="tab" aria-selected={direction === k} onClick={() => setDirection(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${direction === k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nội dung"><input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Nộp thuế VAT tháng 10" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Loại"><select value={cat} onChange={e => setCat(e.target.value)} className={`mt-1 w-full ${inputCls}`}>{Object.entries(ITEM_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Số tiền (đ)"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => amount.trim() && setAmount(moneyInput(parseMoney(amount) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Ngày dự kiến"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Dự án"><select value={proj} onChange={e => setProj(e.target.value)} className={`mt-1 w-full ${inputCls}`}><option value="">Chung công ty</option>{f.projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
      <Field label="Độ tin cậy"><select value={conf} onChange={e => setConf(e.target.value as 'sure' | 'plan' | 'est')} className={`mt-1 w-full ${inputCls}`}><option value="sure">Chắc chắn</option><option value="plan">Theo kế hoạch</option><option value="est">Ước tính</option></select></Field>
    </div>
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};
