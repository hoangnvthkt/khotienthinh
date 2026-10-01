import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, FileSignature, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import {
  STATEMENT_STATUS_LABELS, limitPct, monthLabel, procurementContractService,
  type ContractDeliveryLine, type ContractDetail, type ContractStatement, type ContractSummary,
} from '../../../lib/procurementContractService';
import { dateVi, fmt, parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Badge, Drawer, StateBox, inputCls, money, primaryBtn, secondaryBtn } from './hubUi';

// Hợp đồng nguyên tắc: công trường gọi hàng theo HĐ, Mua hàng quản đơn giá, theo dõi lũy kế
// so với hạn mức và cuối tháng gom phiếu giao thành một bảng đối soát cho kế toán ghi công nợ.

const pctTone = (pct: number | null) => pct == null ? 'bg-slate-300' : pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
const UsageBar: React.FC<{ pct: number | null; label?: string }> = ({ pct, label }) => pct == null
  ? <span className="text-xs text-muted-foreground">{label || 'Chưa khai hạn mức'}</span>
  : <span className="inline-flex items-center gap-1.5 text-xs">
    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${pctTone(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
    <b className={pct >= 100 ? 'text-rose-700 dark:text-rose-300' : pct >= 80 ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}>{fmt(pct, 1)}%</b></span>;

const STATEMENT_TONE: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  confirmed: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
};

// ---------------------------------------------------------------------------
// Bảng đối soát tháng
// ---------------------------------------------------------------------------
interface StmtRow { line: ContractDeliveryLine; date: string; noteCode: string; ticketNo: string | null; include: boolean; price: string; vat: string }

const StatementEditor: React.FC<{ contract: ContractDetail; month: string; statement?: ContractStatement | null; onClose: () => void; onSaved: () => void }> = ({ contract, month, statement = null, onClose, onSaved }) => {
  const toast = useToast();
  const [rows, setRows] = useState<StmtRow[]>(() => contract.deliveries
    .filter(d => d.date.slice(0, 7) === month.slice(0, 7))
    .flatMap(d => d.lines.filter(l => !l.statementId || l.statementId === statement?.id).map(l => ({
      line: l, date: d.date, noteCode: d.code, ticketNo: d.ticketNo, include: l.wmsReady,
      price: l.unitPrice != null ? qtyInput(l.unitPrice) : '', vat: qtyInput(l.vatRate ?? 0),
    })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.noteCode.localeCompare(b.noteCode)));
  const [note, setNote] = useState(statement?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (id: string, p: Partial<StmtRow>) => setRows(cur => cur.map(r => r.line.lineId === id ? { ...r, ...p } : r));

  const totals = useMemo(() => rows.filter(r => r.include).reduce((t, r) => {
    const price = parseQty(r.price); const vat = parseQty(r.vat) ?? 0;
    if (price == null || Number.isNaN(price) || price < 0 || Number.isNaN(vat) || vat < 0 || vat > 100) return { ...t, invalid: t.invalid + 1 };
    const gross = Math.round(r.line.qty * price);
    return { ...t, gross: t.gross + gross, vat: t.vat + Math.round(gross * vat / 100), count: t.count + 1 };
  }, { gross: 0, vat: 0, count: 0, invalid: 0 }), [rows]);

  const save = async (confirm: boolean) => {
    setError(null);
    if (totals.invalid) { setError('Còn dòng chưa có đơn giá hoặc VAT không hợp lệ.'); return; }
    if (!totals.count) { setError('Chọn ít nhất một dòng giao nhận.'); return; }
    setSaving(true);
    try {
      const r = await procurementContractService.saveStatement({ contractId: contract.id, month, statementId: statement?.id, note: note.trim(),
        lines: rows.filter(x => x.include).map(x => ({ deliveryLineId: x.line.lineId, unitPrice: parseQty(x.price) || 0, vatRate: parseQty(x.vat) || 0 })) });
      if (confirm) await procurementContractService.transitionStatement({ statementId: r.statementId, action: 'confirm' });
      toast.success(confirm ? `Đã chốt ${r.code} — chờ kế toán ghi công nợ` : `Đã lưu nháp ${r.code}`, confirm ? 'Kế toán dự án đã được thông báo.' : undefined);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return <Drawer wide label={`Đối soát tháng ${monthLabel(month)}`} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Bảng đối soát tháng {monthLabel(month)}{statement ? ` · ${statement.code}` : ''}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{contract.supplierName}</h2>
      <p className="text-sm text-muted-foreground">HĐ {contract.code} · {contract.projectCode}</p>
    </>}
    footer={<>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving} onClick={() => void save(false)} className={secondaryBtn}>Lưu nháp</button>
      <button type="button" disabled={saving} onClick={() => void save(true)} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}Chốt & gửi kế toán</button>
    </>}>
    {statement?.returnReason && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><b>Kế toán trả lại:</b> {statement.returnReason}</p>}
    <p className="text-sm text-muted-foreground">Mọi phiếu giao tháng {monthLabel(month)} chưa đối soát. Đơn giá lấy theo bảng giá HĐ tại ngày giao — sửa nếu NCC tính khác. Khớp số với NCC rồi bấm Chốt.</p>
    {rows.length === 0 ? <StateBox kind="empty" title="Không còn phiếu giao chưa đối soát trong tháng" /> :
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{rows.map(r => {
        const price = parseQty(r.price);
        return <li key={r.line.lineId} className={`px-3 py-2.5 ${r.include ? '' : 'opacity-60'}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input type="checkbox" checked={r.include} disabled={!r.line.wmsReady} onChange={e => patch(r.line.lineId, { include: e.target.checked })}
              aria-label={`Chọn ${r.noteCode} ${r.line.name}`} className="h-4 w-4 accent-teal-600" />
            <span className="w-20 text-xs tabular-nums text-muted-foreground">{dateVi(r.date)}</span>
            <span className="text-xs text-muted-foreground">{r.noteCode}{r.ticketNo ? ` · ${r.ticketNo}` : ''}</span>
            <span className="min-w-0 flex-1 font-medium text-foreground">{r.line.name}</span>
            <span className="text-sm tabular-nums">{fmt(r.line.qty, 3)} {r.line.unit}</span>
          </div>
          {!r.line.wmsReady ? <p className="mt-1 pl-7 text-xs text-amber-700 dark:text-amber-300">Chưa hoàn tất nhập–xuất kho (WMS) — chưa đối soát được.</p>
            : r.include && <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">Đơn giá
                <input inputMode="decimal" value={r.price} onChange={e => patch(r.line.lineId, { price: e.target.value })} aria-label={`Đơn giá ${r.line.name} ${r.noteCode}`}
                  className={`w-28 text-right tabular-nums ${inputCls} ${r.price === '' ? 'border-rose-400' : ''}`} /></label>
              <label className="flex items-center gap-1.5">VAT %
                <input inputMode="decimal" value={r.vat} onChange={e => patch(r.line.lineId, { vat: e.target.value })} aria-label={`VAT ${r.line.name}`} className={`w-14 text-right ${inputCls}`} /></label>
              {r.line.priceSource === 'missing' && r.price === '' && <span className="text-rose-700 dark:text-rose-300">HĐ chưa có giá vật tư này</span>}
              {r.line.priceSource === 'contract' && <span>theo giá HĐ</span>}
              <span className="ml-auto font-semibold tabular-nums text-foreground">{price != null && !Number.isNaN(price) ? `${money(r.line.qty * price)} đ` : ''}</span>
            </div>}
        </li>;
      })}</ul>}
    <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
      <label className="text-xs font-semibold text-muted-foreground">Ghi chú (biên bản với NCC…)
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={`mt-1 w-full ${inputCls}`} /></label>
      <dl className="space-y-0.5 rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">{totals.count} dòng · tiền hàng</dt><dd className="tabular-nums">{money(totals.gross)} đ</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">VAT</dt><dd className="tabular-nums">{money(totals.vat)} đ</dd></div>
        <div className="flex justify-between font-bold"><dt>Tổng đối soát</dt><dd className="tabular-nums">{money(totals.gross + totals.vat)} đ</dd></div>
      </dl>
    </section>
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Bảng giá HĐ
// ---------------------------------------------------------------------------
interface PriceRow { id?: string; itemId: string; name: string; unit: string | null; unitPrice: string; vatRate: string; quantityLimit: string; amountLimit: string; effectiveFrom: string; effectiveTo: string; used: boolean }

const PriceEditor: React.FC<{ contract: ContractDetail; onDone: () => void; onCancel: () => void }> = ({ contract, onDone, onCancel }) => {
  const toast = useToast();
  const [rows, setRows] = useState<PriceRow[]>(() => {
    const base = contract.priceLines.map(l => ({ id: l.id, itemId: l.itemId, name: l.name, unit: l.unit, unitPrice: qtyInput(l.unitPrice), vatRate: qtyInput(l.vatRate),
      quantityLimit: qtyInput(l.quantityLimit), amountLimit: qtyInput(l.amountLimit), effectiveFrom: l.effectiveFrom || '', effectiveTo: l.effectiveTo || '', used: l.used }));
    // Delivered items without a price yet are proposed first.
    const priced = new Set(base.map(r => r.itemId));
    const missing = contract.usage.filter(u => !priced.has(u.itemId)).map(u => ({ itemId: u.itemId, name: u.name, unit: u.unit, unitPrice: '', vatRate: '8',
      quantityLimit: '', amountLimit: '', effectiveFrom: contract.signedDate || '', effectiveTo: '', used: false }));
    return [...base, ...missing];
  });
  const [deleted, setDeleted] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Array<{ id: string; name: string; sku: string | null; unit: string | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!search.trim()) { setFound([]); return; }
    const t = setTimeout(() => { procurementContractService.searchItems(search).then(setFound).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const patch = (i: number, p: Partial<PriceRow>) => setRows(cur => cur.map((r, j) => j === i ? { ...r, ...p } : r));
  const save = async () => {
    setError(null);
    const active = rows.filter(r => r.unitPrice.trim() !== '');
    if (active.some(r => Number.isNaN(parseQty(r.unitPrice)))) { setError('Đơn giá không hợp lệ.'); return; }
    setSaving(true);
    try {
      await procurementContractService.savePrices({ contractId: contract.id, deleteIds: deleted, lines: active.map(r => ({
        id: r.id, itemId: r.itemId, unitPrice: parseQty(r.unitPrice) || 0, vatRate: parseQty(r.vatRate) || 0,
        quantityLimit: parseQty(r.quantityLimit), amountLimit: parseQty(r.amountLimit), effectiveFrom: r.effectiveFrom || null, effectiveTo: r.effectiveTo || null })) });
      toast.success('Đã lưu bảng giá HĐ', 'Phiếu giao chưa đối soát tự áp giá theo ngày giao.');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return <section className="space-y-3 rounded-2xl border border-teal-200 bg-card p-4 dark:border-teal-900">
    <p className="text-sm text-muted-foreground">Đổi giá giữa chừng: đặt <b>ngày hết hiệu lực</b> cho giá cũ và thêm dòng giá mới với <b>ngày bắt đầu</b>. Dòng giá đã dùng cho phiếu giao không xóa được.</p>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] text-sm">
        <thead className="text-xs text-muted-foreground"><tr>
          <th className="px-2 py-1 text-left font-semibold">Vật tư</th><th className="px-2 py-1 text-right font-semibold">Đơn giá</th><th className="px-2 py-1 text-right font-semibold">VAT %</th>
          <th className="px-2 py-1 text-right font-semibold">Hạn mức SL</th><th className="px-2 py-1 text-left font-semibold">Hiệu lực từ</th><th className="px-2 py-1 text-left font-semibold">đến</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id || `${r.itemId}-${i}`} className="border-t border-border">
          <td className="min-w-[14rem] px-2 py-1.5"><span className="font-medium text-foreground">{r.name}</span> <span className="text-xs text-muted-foreground">{r.unit}</span></td>
          <td className="px-2 py-1.5 text-right"><input inputMode="decimal" value={r.unitPrice} onChange={e => patch(i, { unitPrice: e.target.value })} placeholder="Chưa có giá" aria-label={`Đơn giá ${r.name}`} className={`w-28 text-right tabular-nums ${inputCls}`} /></td>
          <td className="px-2 py-1.5 text-right"><input inputMode="decimal" value={r.vatRate} onChange={e => patch(i, { vatRate: e.target.value })} aria-label={`VAT ${r.name}`} className={`w-14 text-right ${inputCls}`} /></td>
          <td className="px-2 py-1.5 text-right"><input inputMode="decimal" value={r.quantityLimit} onChange={e => patch(i, { quantityLimit: e.target.value })} placeholder="—" aria-label={`Hạn mức ${r.name}`} className={`w-24 text-right ${inputCls}`} /></td>
          <td className="px-2 py-1.5"><input type="date" value={r.effectiveFrom} onChange={e => patch(i, { effectiveFrom: e.target.value })} aria-label={`Hiệu lực từ ${r.name}`} className={inputCls} /></td>
          <td className="px-2 py-1.5"><input type="date" value={r.effectiveTo} onChange={e => patch(i, { effectiveTo: e.target.value })} aria-label={`Hiệu lực đến ${r.name}`} className={inputCls} /></td>
          <td className="px-2 py-1.5">{!r.used && <button type="button" aria-label={`Xóa ${r.name}`} onClick={() => { if (r.id) setDeleted(d => [...d, r.id!]); setRows(cur => cur.filter((_, j) => j !== i)); }} className="rounded p-1 text-muted-foreground hover:bg-muted"><Trash2 size={14} /></button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="relative max-w-md">
      <Plus size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Thêm vật tư vào bảng giá…" className={`w-full pl-8 ${inputCls}`} />
      {found.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">{found.map(f => <li key={f.id}>
        <button type="button" onClick={() => { setRows(cur => [...cur, { itemId: f.id, name: f.name, unit: f.unit, unitPrice: '', vatRate: '8', quantityLimit: '', amountLimit: '', effectiveFrom: '', effectiveTo: '', used: false }]); setSearch(''); }}
          className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"><span>{f.name}</span><span className="text-xs text-muted-foreground">{[f.sku, f.unit].filter(Boolean).join(' · ')}</span></button></li>)}</ul>}
    </div>
    <div className="flex items-center justify-end gap-2">
      {error && <p role="alert" className="mr-auto text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <button type="button" onClick={onCancel} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}Lưu bảng giá</button>
    </div>
  </section>;
};

// ---------------------------------------------------------------------------
// Chi tiết HĐ
// ---------------------------------------------------------------------------
const ContractDrawer: React.FC<{ contractId: string; onClose: () => void; onChanged: () => void }> = ({ contractId, onClose, onChanged }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const [c, setC] = useState<ContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'statements' | 'usage' | 'prices'>('statements');
  const [editPrices, setEditPrices] = useState(false);
  const [stmt, setStmt] = useState<{ month: string; statement: ContractStatement | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(null); procurementContractService.get(contractId).then(setC).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [contractId]);
  useEffect(load, [load]);
  const refresh = () => { load(); onChanged(); };

  const openMonths = useMemo(() => {
    if (!c) return [];
    const map = new Map<string, { lines: number; value: number; unpriced: number }>();
    c.deliveries.forEach(d => d.lines.filter(l => !l.statementId).forEach(l => {
      const m = `${d.date.slice(0, 7)}-01`; const cur = map.get(m) || { lines: 0, value: 0, unpriced: 0 };
      map.set(m, { lines: cur.lines + 1, value: cur.value + (l.amount || 0), unpriced: cur.unpriced + (l.priceSource === 'missing' ? 1 : 0) });
    }));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [c]);
  const totals = useMemo(() => {
    const lines = c?.deliveries.flatMap(d => d.lines) || [];
    return { delivered: lines.reduce((s, l) => s + (l.amount || 0), 0), posted: lines.filter(l => l.statementStatus === 'posted').reduce((s, l) => s + (l.amount || 0), 0),
      open: lines.filter(l => !l.statementId).reduce((s, l) => s + (l.amount || 0), 0), unpriced: lines.filter(l => l.priceSource === 'missing').length };
  }, [c]);

  const act = async (s: ContractStatement, action: 'confirm' | 'withdraw' | 'delete' | 'return' | 'post', reason?: string) => {
    setBusy(true);
    try {
      await procurementContractService.transitionStatement({ statementId: s.id, action, reason });
      toast.success({ confirm: `Đã chốt ${s.code}`, withdraw: `Đã rút ${s.code} về nháp`, delete: `Đã xóa nháp ${s.code}`, return: `Đã trả lại ${s.code}`, post: `Đã ghi công nợ ${s.code}` }[action]);
      refresh();
    } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  if (c && stmt) return <StatementEditor contract={c} month={stmt.month} statement={stmt.statement} onClose={() => setStmt(null)} onSaved={() => { setStmt(null); refresh(); }} />;
  const usagePct = c && c.value && c.value > 0 ? totals.delivered / c.value * 100 : null;

  return <Drawer wide label={c ? `HĐ ${c.code}` : 'Hợp đồng'} onClose={onClose}
    header={c ? <>
      <div className="flex flex-wrap items-center gap-1.5"><Badge className="border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">HĐ nguyên tắc</Badge>
        {c.expiryDate && <span className="text-xs text-muted-foreground">Hết hạn {dateVi(c.expiryDate)}</span>}</div>
      <h2 className="mt-2 text-lg font-bold text-foreground">{c.supplierName}</h2>
      <p className="text-sm text-muted-foreground">HĐ {c.code}{c.name ? ` · ${c.name}` : ''} · {c.projectCode}</p>
    </> : <h2 className="text-lg font-bold">Hợp đồng</h2>}>
    {error ? <StateBox kind="error" message={error} onRetry={load} /> : !c ? <StateBox kind="loading" title="Đang tải hợp đồng…" /> : <>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {([['Lũy kế đã giao', `${money(totals.delivered)} đ`, totals.unpriced ? `${totals.unpriced} dòng chưa có giá — chưa tính` : 'trước VAT'],
          ['Đã ghi công nợ', `${money(totals.posted)} đ`, 'theo bảng đối soát'],
          ['Chưa đối soát', `${money(totals.open)} đ`, `${openMonths.reduce((s, [, m]) => s + m.lines, 0)} dòng giao`],
          ['So với giá trị HĐ', usagePct == null ? '—' : `${fmt(usagePct, 1)}%`, c.value && c.value > 0 ? `${money(c.value)} đ` : 'HĐ chưa khai giá trị']] as const).map(([label, value, hint]) =>
          <div key={label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-bold tabular-nums text-foreground">{value}</p><p className="text-xs text-muted-foreground">{hint}</p></div>)}
      </section>

      <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="tablist">
        {([['statements', 'Đối soát tháng'], ['usage', 'Lũy kế & phiếu giao'], ['prices', `Đơn giá (${c.priceLines.length})`]] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1 font-semibold ${tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>{l}</button>)}
      </div>

      {tab === 'statements' && <>
        {openMonths.length > 0 && <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Phiếu giao chưa đối soát</h3>
          {openMonths.map(([m, v]) => <div key={m} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/20">
            <span className="font-semibold text-foreground">Tháng {monthLabel(m)}</span>
            <span className="text-sm text-muted-foreground">{v.lines} dòng giao · ~{money(v.value)} đ{v.unpriced ? ` · ${v.unpriced} dòng chưa có giá` : ''}</span>
            {c.canManage && <button type="button" onClick={() => setStmt({ month: m, statement: null })} className={`${primaryBtn} ml-auto`}>Lập bảng đối soát</button>}
          </div>)}
        </section>}
        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Bảng đối soát ({c.statements.length})</h3>
          {c.statements.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Chưa có bảng đối soát.</p>
            : <ul className="space-y-2">{c.statements.map(s => <li key={s.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-foreground">{s.code}</span>
                <Badge className={STATEMENT_TONE[s.status] || STATEMENT_TONE.draft}>{STATEMENT_STATUS_LABELS[s.status] || s.status}</Badge>
                <span className="text-xs text-muted-foreground">Tháng {monthLabel(s.periodMonth)} · {s.lineCount} dòng</span>
                <span className="ml-auto font-semibold tabular-nums">{money(s.totalAmount)} đ</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.status === 'posted' ? `Ghi công nợ bởi ${s.postedByName || '—'}${s.postedAt ? `, ${dateVi(s.postedAt)}` : ''}`
                  : s.status === 'confirmed' ? `Chốt bởi ${s.confirmedByName || '—'} — chờ kế toán dự án ghi công nợ` : `Lập bởi ${s.createdByName || '—'}`}</p>
              {s.returnReason && s.status === 'draft' && <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">Kế toán trả lại: {s.returnReason}</p>}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {s.status === 'draft' && c.canManage && <>
                  <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void act(s, 'delete')}>Xóa nháp</button>
                  <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setStmt({ month: s.periodMonth, statement: s })}>Sửa</button>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={() => void act(s, 'confirm')}>Chốt & gửi kế toán</button>
                </>}
                {s.status === 'confirmed' && c.canManage && !s.canPost && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void act(s, 'withdraw')}>Rút về sửa</button>}
                {s.canPost && <>
                  <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
                    const reason = await askReason({ title: `Trả lại ${s.code}`, targetName: c.supplierName || '', reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' });
                    if (reason) void act(s, 'return', reason);
                  }}>Trả lại</button>
                  <button type="button" disabled={busy} className={primaryBtn} onClick={() => void act(s, 'post')}>Ghi công nợ</button>
                </>}
              </div>
            </li>)}</ul>}
        </section>
      </>}

      {tab === 'usage' && <>
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-semibold">Vật tư</th><th className="px-2 py-2 text-right font-semibold">Lũy kế SL</th>
              <th className="px-2 py-2 text-right font-semibold">Giá trị</th><th className="px-3 py-2 text-left font-semibold">So với hạn mức</th></tr></thead>
            <tbody>{c.usage.map(u => <tr key={u.itemId} className="border-t border-border">
              <td className="px-3 py-2"><span className="font-medium text-foreground">{u.name}</span>
                <span className="block text-xs text-muted-foreground">{u.currentPrice != null ? `Giá hiện hành ${money(u.currentPrice)} đ/${u.unit}` : 'Chưa có giá HĐ'}</span></td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(u.deliveredQty, 3)} {u.unit}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(u.deliveredValue)} đ{u.unpricedLines ? <span className="block text-xs text-amber-700 dark:text-amber-300">+{u.unpricedLines} dòng chưa giá</span> : null}</td>
              <td className="px-3 py-2"><UsageBar pct={limitPct(u.deliveredQty, u.quantityLimit) ?? limitPct(u.deliveredValue, u.amountLimit)} />
                {u.quantityLimit ? <span className="block text-xs text-muted-foreground">hạn mức {fmt(u.quantityLimit)} {u.unit}</span> : null}</td>
            </tr>)}</tbody>
          </table>
        </section>
        <section>
          <h3 className="mb-2 font-semibold text-foreground">Phiếu giao ({c.deliveries.length})</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{c.deliveries.map(d => <li key={d.noteId} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap gap-x-3"><span className="tabular-nums text-muted-foreground">{dateVi(d.date)}</span><span className="font-medium text-foreground">{d.code}</span>
              {d.ticketNo && <span className="text-xs text-muted-foreground">Phiếu NCC {d.ticketNo}</span>}</div>
            <ul className="mt-0.5 text-xs text-muted-foreground">{d.lines.map(l => <li key={l.lineId}>{l.name}: {fmt(l.qty, 3)} {l.unit}
              {l.unitPrice != null ? ` × ${money(l.unitPrice)} = ${money(l.amount)} đ` : ' · chưa có giá'}
              {l.statementCode ? ` · ${l.statementCode} (${STATEMENT_STATUS_LABELS[l.statementStatus || ''] || l.statementStatus})` : ' · chưa đối soát'}</li>)}</ul>
          </li>)}</ul>
        </section>
      </>}

      {tab === 'prices' && (editPrices ? <PriceEditor contract={c} onCancel={() => setEditPrices(false)} onDone={() => { setEditPrices(false); refresh(); }} /> : <>
        {c.priceLines.length === 0 ? <StateBox kind="empty" title="HĐ chưa có bảng giá" message="Khai đơn giá từng vật tư để phiếu giao tự tính tiền và theo dõi hạn mức." />
          : <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{c.priceLines.map(l => <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 font-medium text-foreground">{l.name}</span>
            <span className="tabular-nums">{money(l.unitPrice)} đ/{l.unit} · VAT {fmt(l.vatRate)}%</span>
            <span className="text-xs text-muted-foreground">{l.effectiveFrom || l.effectiveTo ? `Hiệu lực ${l.effectiveFrom ? dateVi(l.effectiveFrom) : '…'} – ${l.effectiveTo ? dateVi(l.effectiveTo) : 'nay'}` : 'Hiệu lực cả HĐ'}</span>
            {l.quantityLimit ? <span className="text-xs text-muted-foreground">hạn mức {fmt(l.quantityLimit)} {l.unit}</span> : null}
          </li>)}</ul>}
        {c.canManage && <button type="button" onClick={() => setEditPrices(true)} className={secondaryBtn}>Sửa bảng giá</button>}
      </>)}
    </>}
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Danh sách HĐ
// ---------------------------------------------------------------------------
export const ContractsView: React.FC<{ projects: Array<{ id: string; code: string | null; name: string | null }>; initialContractId?: string | null }> = ({ projects, initialContractId = null }) => {
  const [data, setData] = useState<{ canManage: boolean; contracts: ContractSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialContractId);
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const load = useCallback(() => {
    setError(null);
    procurementContractService.list({ projectId: projectId || undefined, search: query || undefined }).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId, query]);
  useEffect(load, [load]);
  const active = (data?.contracts || []).filter(c => c.deliveryNotes > 0 || c.priceLines > 0);
  const idle = (data?.contracts || []).filter(c => !(c.deliveryNotes > 0 || c.priceLines > 0));

  const row = (c: ContractSummary) => <li key={c.id}>
    <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full flex-col gap-1.5 border-t border-border bg-card px-3 py-3 text-left hover:bg-muted/40 md:flex-row md:items-center md:gap-4">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-foreground">{c.supplierName || 'NCC'}</span>
          {c.openLines > 0 && <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {c.openLines} dòng chưa đối soát · {c.openMonths.map(m => monthLabel(m.month)).join(', ')}</Badge>}
          {c.openStatements > 0 && <Badge className="border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">{c.openStatements} bảng chờ xử lý</Badge>}
          {c.priceLines === 0 && c.deliveryNotes > 0 && <Badge className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Chưa có bảng giá</Badge>}
          {c.limitOver > 0 ? <Badge className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{c.limitOver} vật tư vượt hạn mức</Badge>
            : c.limitNear > 0 && <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{c.limitNear} vật tư ≥80% hạn mức</Badge>}</span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">HĐ {c.code}{c.name ? ` · ${c.name}` : ''} · {c.projectCode || 'Không gắn dự án'}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:w-[26rem] md:shrink-0 md:justify-end">
        <span className="text-muted-foreground">{c.deliveryNotes} phiếu giao{c.lastDeliveryDate ? ` · gần nhất ${dateVi(c.lastDeliveryDate)}` : ''}</span>
        <UsageBar pct={c.usagePct} label="HĐ chưa khai giá trị" />
        <span className="w-28 text-right font-semibold tabular-nums text-foreground">{money(c.deliveredValue)} đ</span>
      </span>
      <ChevronRight size={16} className="hidden shrink-0 text-muted-foreground md:block" />
    </button>
  </li>;

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <p className="px-1 text-sm text-muted-foreground">Công trường gọi hàng theo HĐ; Mua hàng quản giá, lũy kế và đối soát cuối tháng.</p>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <select aria-label="Dự án" value={projectId} onChange={e => setProjectId(e.target.value)} className={`max-w-[12rem] ${inputCls}`}>
          <option value="">Mọi dự án</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select>
        <label className="relative"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Số HĐ, NCC…" className={`w-48 pl-8 ${inputCls}`} /></label>
      </span>
    </div>
    {error ? <StateBox kind="error" message={error} onRetry={load} /> : !data ? <StateBox kind="loading" title="Đang tải hợp đồng…" />
      : data.contracts.length === 0 ? <StateBox kind="empty" title="Chưa có hợp đồng nguyên tắc" message="Khai HĐ NCC ở module Hợp đồng — Đối tác." />
        : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><FileSignature size={13} />Đang dùng · {active.length}</p>
          <ul>{active.map(row)}</ul>
          {idle.length > 0 && <details><summary className="cursor-pointer border-t border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chưa phát sinh · {idle.length}</summary><ul>{idle.map(row)}</ul></details>}
        </div>}
    {openId && <ContractDrawer contractId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
  </section>;
};

export default ContractsView;
