import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { NUM } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { formatQuantityInput, parseQuantityInput } from '../../lib/quantityInput';
import { specKey } from '../../lib/materialLineDescription';
import { catalogErrorMessage, wmsCatalogService, type ItemCard, type SpecAllocation } from '../../lib/wmsCatalogService';
import { Section, dateVi, fmtQty } from './wmsUi';

// V1-3b Tồn theo quy cách: tồn của mã = cộng các quy cách. Xuất không ghi quy cách tự lấy từ trên xuống (nhập trước).
// Phiếu chuyển quy cách (cùng mã, cùng kho, có lý do) dùng khi hàng về khác quy cách hoặc gắn quy cách cho hàng cũ.

export const UNSPEC_LABEL = 'Chưa ghi quy cách';
// Cỡ chữ 12px không dùng lớp text-xs: index.css ép text-xs trong khung lưới thành một dòng trên mobile (ẩn ô nhập).
const CAP = 'block text-[12px] font-semibold text-muted-foreground';
const REASONS = ['Hàng về khác quy cách trên phiếu', 'Gắn quy cách cho hàng cũ sau khi kiểm thực tế'];

/** Chip quy cách trên dòng thẻ kho; nhiều phần (xuất lấy từ nhiều quy cách) thì kèm số lượng. */
export const SpecChips: React.FC<{ allocations?: SpecAllocation[] | null; fallback?: string | null }> = ({ allocations, fallback }) => {
  const parts = (allocations || []).filter(a => Number(a.qty) > 0);
  if (!parts.some(a => a.specification)) return fallback ? <SpecChip>{fallback}</SpecChip> : null;
  return <>{parts.map((a, i) => <SpecChip key={i} muted={!a.specification}>{a.specification || 'chưa ghi'}{parts.length > 1 && <> · {fmtQty(Number(a.qty))}</>}</SpecChip>)}</>;
};
const SpecChip: React.FC<{ muted?: boolean; children: React.ReactNode }> = ({ muted, children }) =>
  <span title="Quy cách của dòng chứng từ" className={`mt-0.5 mr-1 inline-block w-fit rounded px-1 ${muted ? 'bg-muted text-muted-foreground' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{children}</span>;

export const SpecStockSection: React.FC<{ card: ItemCard; itemId: string; warehouseId: string; unit: string | null; onChanged: () => void }> = ({ card, itemId, warehouseId, unit, onChanged }) => {
  const toast = useToast();
  const specs = useMemo(() => (card.specs || []).filter(s => Math.abs(Number(s.qty)) > 0.0000005), [card.specs]);
  const available = specs.filter(s => Number(s.qty) > 0.0000005);
  const named = specs.some(s => s.specification);
  const transfers = card.specTransfers || [];
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!named && !(card.canTransferSpec && available.length)) return null;

  const fromSpec = available.find(s => specKey(s.specification) === from) || available[0];
  const max = Number(fromSpec?.qty || 0);
  const start = () => {
    const first = available.find(s => !s.specification) || available[0];
    setFrom(specKey(first?.specification)); setTo(''); setQty(formatQuantityInput(Number(first?.qty || 0))); setReason(''); setError(null); setOpen(true);
  };
  const suggestions = [...new Set(specs.map(s => s.specification).filter((s): s is string => !!s))].filter(s => specKey(s) !== specKey(fromSpec?.specification));
  const save = async () => {
    const n = parseQuantityInput(qty);
    if (!to.trim()) { setError('Nhập quy cách mới.'); return; }
    if (specKey(to) === specKey(fromSpec?.specification)) { setError('Quy cách mới trùng quy cách cũ.'); return; }
    if (!Number.isFinite(n) || n <= 0 || n > max + 0.0000005) { setError(`Số lượng từ 0 đến ${fmtQty(max)}.`); return; }
    if (!reason.trim()) { setError('Ghi lý do chuyển quy cách.'); return; }
    setSaving(true); setError(null);
    try {
      const r = await wmsCatalogService.transferSpec({ itemId, warehouseId, fromSpec: fromSpec?.specification ?? null, toSpec: to.trim(), qty: n, reason: reason.trim() });
      toast.success(`Đã chuyển quy cách · ${r.code}`, `${fmtQty(n)} ${unit || ''} từ "${fromSpec?.specification || UNSPEC_LABEL}" sang "${to.trim()}". Tồn của mã không đổi.`);
      setOpen(false); onChanged();
    } catch (e) { setError(catalogErrorMessage(e)); } finally { setSaving(false); }
  };

  return <Section title="Theo quy cách" right={named ? <span className="text-xs text-muted-foreground">xuất tự lấy từ trên xuống</span> : undefined}>
    {named && <ul className="divide-y divide-border rounded-xl border border-border text-sm">{specs.map(s =>
      <li key={specKey(s.specification) || '-'} className="flex items-center justify-between gap-3 px-3 py-1.5">
        <span className={s.specification ? 'font-medium' : 'text-muted-foreground'}>{s.specification || UNSPEC_LABEL}</span>
        <span className="!whitespace-nowrap"><span className={Number(s.qty) < 0 ? 'font-semibold text-rose-700' : NUM}>{fmtQty(Number(s.qty))}</span> <span className="text-xs text-muted-foreground">{unit}</span></span>
      </li>)}</ul>}
    {!named && <p className="text-sm text-muted-foreground">Hàng tồn chưa ghi quy cách.</p>}

    {card.canTransferSpec && available.length > 0 && !open && <button type="button" onClick={start} className={`mt-2 ${secondaryBtn}`}>
      <ArrowRightLeft size={15} />{named ? 'Chuyển quy cách' : 'Gắn quy cách cho hàng tồn'}</button>}

    {open && <div className="mt-2 space-y-2 rounded-xl border border-teal-200 bg-teal-50/40 p-3 text-sm dark:border-teal-900 dark:bg-teal-950/20">
      <p className="text-[12px] text-muted-foreground">Chuyển một phần tồn sang quy cách khác — cùng mã, cùng kho, tồn và giá trị của mã không đổi.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><span className={CAP}>Từ quy cách</span>
          <select value={specKey(fromSpec?.specification)} onChange={e => { setFrom(e.target.value); const s = available.find(x => specKey(x.specification) === e.target.value); setQty(formatQuantityInput(Number(s?.qty || 0))); }}
            className={`mt-1 w-full ${inputCls}`}>
            {available.map(s => <option key={specKey(s.specification) || '-'} value={specKey(s.specification)}>{s.specification || UNSPEC_LABEL} — còn {fmtQty(Number(s.qty))}</option>)}
          </select></label>
        <label className="block"><span className={CAP}>Sang quy cách</span>
          <input value={to} onChange={e => setTo(e.target.value)} maxLength={80} list={`spec-${itemId}`} placeholder="VD M350CV, R7" className={`mt-1 w-full ${inputCls}`} />
          <datalist id={`spec-${itemId}`}>{suggestions.map(s => <option key={s} value={s} />)}</datalist></label>
        <label className="block"><span className={CAP}>Số lượng ({unit})</span>
          <input value={qty} inputMode="decimal" onChange={e => setQty(e.target.value)} className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
        <label className="block"><span className={CAP}>Lý do</span>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Bắt buộc" className={`mt-1 w-full ${inputCls}`} /></label>
      </div>
      <div className="flex flex-wrap gap-1">{REASONS.map(x => <button key={x} type="button" onClick={() => setReason(x)}
        className="rounded-full border border-border bg-card px-2 py-0.5 text-[12px] hover:bg-muted">{x}</button>)}</div>
      {error && <p role="alert" className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className={secondaryBtn}>Hủy</button>
        <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}Lưu phiếu chuyển</button>
      </div>
    </div>}

    {transfers.length > 0 && <>
      <button type="button" aria-expanded={showLog} onClick={() => setShowLog(v => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
        {showLog ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Phiếu chuyển quy cách ({transfers.length})</button>
      {showLog && <ul className="mt-1 space-y-1 text-[12px]">{transfers.map(t => <li key={t.code} className="rounded-lg bg-muted/50 px-2 py-1.5">
        <span className="font-semibold">{t.code}</span> · {dateVi(t.date)} · {fmtQty(Number(t.qty))} {unit}: {t.fromSpec || UNSPEC_LABEL} → <b>{t.toSpec}</b>
        <span className="block text-muted-foreground">{t.reason}{t.byName ? ` · ${t.byName}` : ''}</span></li>)}</ul>}
    </>}
  </Section>;
};
