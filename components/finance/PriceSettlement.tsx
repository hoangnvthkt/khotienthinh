import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Banknote, Check, ChevronDown, ChevronRight, FilePlus2, FileText, Handshake, Loader2, RotateCcw, Send, Wallet, X } from 'lucide-react';
import SearchableSelect from '../common/SearchableSelect';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import {
  financeService, type ApprovalStepInfo, type FinanceAttachment, type InvoiceDocument, type PriceApproval, type PriceInput, type PriceLine, type PriceSettlement, type PriceSettlementStatus, type SupplierCredit,
} from '../../lib/financeService';
import { Badge, Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, CashAccountSelect, ENT, FieldError, moneyInput as moneyText, parseMoney, shortMoney, viDate } from './financeUi';

// Chốt giá NCC (10/10/2026): kho ghi số thực nhận, Mua hàng ghi giá đặt — kế toán ghi giá thật khi NCC đổi đơn giá.
// Không sửa đơn hàng / phiếu kho: chênh lệch thành chứng từ điều chỉnh công nợ + chi phí dự án, có lý do, có người duyệt.
// Giảm giá: Kế toán trưởng xác nhận. Tăng giá: ma trận duyệt theo số tiền tăng. Người lập không tự duyệt.

export const PRICE_STATUS: Record<PriceSettlementStatus, { label: string; cls: string }> = {
  pending_approval: { label: 'Chờ duyệt giá', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  posted: { label: 'Đã chốt giá', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  rejected: { label: 'Trả lại', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  reversed: { label: 'Đã đảo', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const priceKey = (documentId: string, lineId: string) => `${documentId}:${lineId}`;
/** Chênh lệch có VAT của một dòng khi đổi từ giá đang áp sang giá mới. */
export const lineDelta = (l: PriceLine, price: number) => Math.round(l.qty * (price - l.currentPrice) * (1 + l.vatRate / 100));
const unitText = (u: string | null) => u ? `/${u}` : '';
/** Đơn giá giữ phần lẻ (gạch 1.481,48 đ/viên) — tiền thì làm tròn đồng. */
const price = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

export type PriceDraft = Record<string, string>;
/** Giá gõ vào ô: không có chữ số nào thì không hợp lệ (parseMoney('abc') = 0 sẽ thành giá 0). */
const parsePrice = (raw: string) => /\d/.test(raw) ? parseMoney(raw) : NaN;
/** Các dòng có giá mới khác giá đang áp (bỏ ô trống / không đổi). */
export const changedPrices = (docs: InvoiceDocument[], draft: PriceDraft): Array<PriceInput & { doc: InvoiceDocument; line: PriceLine; delta: number }> =>
  docs.flatMap(d => (d.lines || []).flatMap(l => {
    const raw = draft[priceKey(d.id, l.lineId)]; if (raw == null || raw.trim() === '') return [];
    const price = parsePrice(raw); if (!Number.isFinite(price) || price < 0 || Math.abs(price - l.currentPrice) < 0.005) return [];
    return [{ documentId: d.id, lineId: l.lineId, price, doc: d, line: l, delta: lineDelta(l, price) }];
  }));
/** Số ô giá chốt gõ sai (có chữ nhưng không ra số, hoặc âm) — chặn gửi. */
export const invalidPriceCount = (docs: InvoiceDocument[], draft: PriceDraft) => docs.reduce((n, d) => n + (d.lines || []).filter(l => {
  const raw = draft[priceKey(d.id, l.lineId)]; if (l.pendingCode || raw == null || raw.trim() === '') return false; const x = parsePrice(raw); return !Number.isFinite(x) || x < 0; }).length, 0);
export const docDelta = (doc: InvoiceDocument, draft: PriceDraft) => changedPrices([doc], draft).reduce((a, x) => a + x.delta, 0);

/** Luồng duyệt: có phần tăng → ma trận theo tổng số tăng; chỉ giảm → bước Kế toán trưởng. */
export const routeFor = (approval: PriceApproval, increase: number): ApprovalStepInfo[] => {
  if (increase <= 0.5) return approval.decrease;
  const t = approval.tiers.find(x => (increase > x.min || x.min === 0) && (x.max == null || increase <= x.max));
  return t?.steps || approval.tiers[approval.tiers.length - 1]?.steps || [];
};

export const RoutePreview: React.FC<{ steps: ApprovalStepInfo[]; increase: number }> = ({ steps, increase }) =>
  <div className="rounded-xl border border-border bg-card p-3 text-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{increase > 0.5 ? `Tăng giá ${money(increase)} đ — duyệt theo ma trận` : 'Giảm giá — Kế toán trưởng xác nhận'}</p>
    <ol className="mt-2 space-y-1.5">{steps.map((s, i) => <li key={i} className="flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[11px] font-bold text-white">{i + 1}</span>
      <span><b>{s.label}</b><span className="block text-xs text-muted-foreground">{s.names.length ? s.names.join(' / ') : <span className="text-rose-700">Chưa cài người duyệt — vào Quản trị Tài chính</span>}</span></span></li>)}</ol>
    <p className="mt-2 text-xs text-muted-foreground">Người lập không tự duyệt. Duyệt xong: đơn hàng và phiếu kho giữ nguyên; công nợ và chi phí dự án điều chỉnh theo phần chênh.</p>
  </div>;

/** Bảng đơn giá từng dòng của một chứng từ: số thực nhận + giá đặt khóa, ô Giá chốt mặc định = giá đang áp. */
export const PriceLinesEditor: React.FC<{ doc: InvoiceDocument; draft: PriceDraft; onChange: (key: string, v: string) => void }> = ({ doc, draft, onChange }) => {
  if (!doc.lines) return <p className="px-3 py-2 text-xs text-muted-foreground">Chứng từ này không có đơn giá theo dòng ({doc.sourceType === 'opening_balance' ? 'số dư đầu kỳ' : 'giá ghi ở tổng chứng từ'}) — chênh lệch ghi bằng lệch chung trên hóa đơn, kèm lý do.</p>;
  return <div className="border-t border-dashed border-border bg-muted/20 px-3 py-2">
    <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_7rem_8.5rem_7.5rem] gap-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
      <span>Hàng</span><span className="text-right">SL thực nhận</span><span className="text-right">Giá đặt</span><span className="text-right">Giá chốt</span><span className="text-right">Chênh (gồm VAT)</span></div>
    <ul className="space-y-2 md:space-y-1">{doc.lines.map(l => {
      const k = priceKey(doc.id, l.lineId); const raw = l.pendingCode ? undefined : draft[k]; const p = raw == null || raw.trim() === '' ? l.currentPrice : parsePrice(raw);
      const bad = !Number.isFinite(p) || p < 0; const delta = bad ? 0 : lineDelta(l, p); const changed = !bad && Math.abs(p - l.currentPrice) >= 0.005;
      return <li key={l.lineId} className={`grid grid-cols-2 items-center gap-x-2 gap-y-1 rounded-lg px-1 py-1 md:grid-cols-[minmax(0,1fr)_6.5rem_7rem_8.5rem_7.5rem] ${changed ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''}`}>
        <span className="col-span-2 min-w-0 md:col-span-1"><b className="font-semibold">{l.itemName}</b>{l.specification && <span className="text-xs text-muted-foreground"> — {l.specification}</span>}{l.vatRate > 0 && <span className="text-xs text-muted-foreground"> · VAT {l.vatRate}%</span>}</span>
        <span className="text-xs tabular-nums md:text-right md:text-sm"><span className="text-muted-foreground md:hidden">SL nhận </span>{l.qty.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} {l.unit || ''}</span>
        <span className="text-right text-xs tabular-nums md:text-sm"><span className="text-muted-foreground md:hidden">giá đặt </span>{price(l.orderedPrice)}
          {Math.abs(l.currentPrice - l.orderedPrice) >= 0.005 && <span className="block text-[11px] text-teal-700">đã chốt {price(l.currentPrice)}</span>}</span>
        {l.pendingCode ? <span className="text-right text-[11px] font-semibold text-amber-700" title="Duyệt hoặc rút bản đang chờ trước khi chốt giá lại">đang chờ duyệt {l.pendingCode}</span>
          : <input value={raw ?? ''} placeholder={price(l.currentPrice)} inputMode="numeric" aria-label={`Giá chốt ${l.itemName}${l.specification ? ` ${l.specification}` : ''}`}
            onChange={e => onChange(k, e.target.value)} onBlur={e => { const x = parsePrice(e.target.value); if (e.target.value.trim() && Number.isFinite(x)) onChange(k, price(x)); }}
            className={`w-full text-right tabular-nums ${inputCls} ${bad ? 'border-rose-400' : changed ? 'border-amber-400 font-semibold' : ''}`} />}
        <span className={`text-right text-sm font-semibold tabular-nums ${!changed ? 'text-muted-foreground' : delta < 0 ? 'text-leaf-700' : 'text-amber-700'}`}>{changed ? signed(delta) : '—'}</span>
      </li>; })}</ul>
  </div>;
};

/** Cảnh báo theo chứng từ sau khi đổi giá: đã có hóa đơn giá cũ, đã trả (NCC nợ lại), hàng Kho Tổng. */
export const priceWarnings = (docs: InvoiceDocument[], draft: PriceDraft, viaInvoice: boolean) => docs.flatMap(d => {
  const delta = docDelta(d, draft); if (Math.abs(delta) < 0.5) return [];
  const name = d.documentNo || d.code; const out: string[] = [];
  if (!viaInvoice && d.invoiced > 0.5) out.push(`${name} đã có hóa đơn ${money(d.invoiced)} đ theo giá cũ → sau khi duyệt chờ NCC xuất hóa đơn điều chỉnh ${delta < 0 ? 'giảm' : 'tăng'} ${money(Math.abs(delta))} đ.`);
  if (delta < 0 && -delta > d.outstanding + 0.5) out.push(`${name} chỉ còn nợ ${money(d.outstanding)} đ (đã trả ${money(d.paid)} đ) → phần giảm ${money(-delta - d.outstanding)} đ thành khoản NCC nợ lại, trừ vào lần thanh toán sau.`);
  if (d.companyScope) out.push(`${name} là hàng nhập Kho Tổng → giá trị tồn kho cần kế toán điều chỉnh (chưa tự động).`);
  return out;
});

/** Các bước duyệt: bước đã xong (ai duyệt), bước đang chờ (chờ ai), bước sau. */
export const StepChips: React.FC<{ steps: PriceSettlement['steps']; stepIndex: number }> = ({ steps, stepIndex }) =>
  <ol className="mt-1.5 flex flex-wrap gap-1.5 text-xs">{steps.map((x, i) =>
    <li key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${x.doneByName ? 'border-leaf-200 bg-leaf-50 text-leaf-800' : i === stepIndex ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border text-muted-foreground'}`}>
      {x.doneByName ? <Check size={11} /> : <span className="font-bold">{i + 1}</span>}{x.label}{x.doneByName ? ` — ${x.doneByName}` : i === stepIndex ? ` — chờ ${x.names.join(' / ') || '—'}` : ''}</li>)}</ol>;

/** Một bản chốt giá trong danh sách: dòng đổi giá, bước duyệt, thao tác ngay trên dòng. */
export const SettlementCard: React.FC<{ s: PriceSettlement; busy: boolean; embedded?: boolean; onDecide: (action: 'approve' | 'reject' | 'withdraw' | 'reverse', reason?: string) => void; onAttach: () => void }> =
  ({ s, busy, embedded, onDecide, onAttach }) => {
    const confirm = useConfirm(); const askReason = useReasonConfirm();
    const st = PRICE_STATUS[s.status]; const step = s.steps[s.stepIndex];
    const effect = s.deltaGross < 0 ? `giảm công nợ + chi phí ${money(-s.deltaGross)} đ` : `tăng công nợ + chi phí ${money(s.deltaGross)} đ`;
    return <div className={embedded ? 'mt-2 rounded-xl border border-amber-200 bg-amber-50/40 p-2.5 dark:border-amber-900 dark:bg-amber-950/10' : ''}>
      {!embedded && <p className="flex flex-wrap items-start gap-2"><span className="min-w-[12rem] flex-1"><b className={ENT}>{s.supplierName}</b>
        <span className="block text-xs text-muted-foreground"><Handshake size={11} className="mr-0.5 inline" />Biên bản giá{s.agreementNo ? ` số ${s.agreementNo}` : ''} · {viDate(s.agreementDate)} · {s.code} · lập: {s.createdByName || '—'}</span></span>
        <span className="text-right"><b className={`tabular-nums ${s.deltaGross < 0 ? 'text-leaf-700' : 'text-amber-700'}`}>{signed(s.deltaGross)} đ</b><span className="block text-[11px] text-muted-foreground">{s.deltaGross < 0 ? 'giảm công nợ' : 'tăng công nợ'}</span></span>
        <Badge className={st.cls}>{st.label}</Badge>
        {s.status === 'posted' && s.needsAdjustmentInvoice && !s.adjustmentInvoice && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Chờ HĐ điều chỉnh</Badge>}</p>}
      {embedded && <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Chốt giá kèm hóa đơn · {s.code} · {signed(s.deltaGross)} đ</p>}
      <ul className="mt-1.5 space-y-0.5 text-xs">{s.lines.map((l, i) => <li key={i} className="flex flex-wrap items-center gap-x-1.5">
        <b className="font-semibold text-foreground">{l.itemName}</b>{l.specification && <span className="text-muted-foreground">— {l.specification}</span>}<span className="text-muted-foreground">· {l.poNumber || l.documentNo}{l.projectCode ? ` · ${l.projectCode}` : ''}:</span>
        <span className="tabular-nums">{price(l.fromPrice)}</span><ArrowRight size={11} className="text-muted-foreground" /><b className="tabular-nums">{price(l.toPrice)}</b>
        <span className="text-muted-foreground">đ{unitText(l.unit)} × {l.qty.toLocaleString('vi-VN', { maximumFractionDigits: 3 })}{l.vatRate ? ` (+VAT ${l.vatRate}%)` : ''} =</span>
        <b className={`tabular-nums ${l.deltaGross < 0 ? 'text-leaf-700' : 'text-amber-700'}`}>{signed(l.deltaGross)}</b></li>)}</ul>
      <p className="mt-1 text-xs text-muted-foreground">Lý do: {s.reason}</p>
      {s.status === 'pending_approval' && <StepChips steps={s.steps} stepIndex={s.stepIndex} />}
      {s.status === 'posted' && s.effects && <p className="mt-1 text-xs text-leaf-800 dark:text-leaf-300">Đã {effect}{s.effects.increaseDocCode ? ` (chứng từ ${s.effects.increaseDocCode})` : ''}{s.effects.supplierOwes > 0.5 ? ` · NCC nợ lại ${money(s.effects.supplierOwes)} đ` : ''} · duyệt: {s.decidedByName} {viDate(s.decidedAt)}</p>}
      {s.status === 'posted' && (s.effects?.inventoryDocs?.length || 0) > 0 && <p className="mt-1 flex items-start gap-1 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Hàng nhập Kho Tổng ({s.effects!.inventoryDocs!.join(', ')}): chi phí dự án không đổi — kế toán điều chỉnh giá trị tồn kho.</p>}
      {s.adjustmentInvoice && <p className="mt-1 text-xs text-muted-foreground">HĐ điều chỉnh số {s.adjustmentInvoice.number} · {viDate(s.adjustmentInvoice.date)} · gắn: {s.adjustmentInvoice.byName}</p>}
      {(s.decisionNote && s.status === 'rejected') && <p className="mt-1 text-xs text-muted-foreground">Trả lại: {s.decidedByName} {viDate(s.decidedAt)} — {s.decisionNote}</p>}
      {s.status === 'reversed' && <p className="mt-1 text-xs text-muted-foreground">Đảo: {s.reversedByName} {viDate(s.reversedAt)} — {s.reversalReason}</p>}
      {!embedded && <p className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-semibold">
        {s.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)} className="text-teal-700 hover:underline"><FileText size={11} className="mr-0.5 inline" />{a.name}</button>)}
        {s.canAttachInvoice && <button type="button" onClick={onAttach} className="text-teal-700 hover:underline"><FilePlus2 size={11} className="mr-0.5 inline" />Gắn HĐ điều chỉnh</button>}
        {s.canDecide && step && <><button type="button" disabled={busy} className="text-rose-700 hover:underline" onClick={async () => {
            const r = await askReason({ title: 'Trả lại chốt giá', targetName: `${s.supplierName} · ${s.code}`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: biên bản chưa có chữ ký NCC', actionLabel: 'Trả lại', intent: 'warning' });
            if (r) onDecide('reject', r); }}><X size={11} className="mr-0.5 inline" />Trả lại</button>
          <button type="button" disabled={busy} className="text-leaf-700 hover:underline" onClick={async () => {
            const last = s.stepIndex === s.steps.length - 1;
            if (await confirm({ title: last ? 'Xác nhận giá mới?' : `Duyệt bước ${s.stepIndex + 1}?`, targetName: `${s.supplierName} · ${signed(s.deltaGross)} đ`, confirmText: 'Duyệt', actionLabel: last ? 'Xác nhận giá' : 'Duyệt', intent: 'success', countdownSeconds: 0,
              warningText: last ? `Công nợ và chi phí dự án ${s.deltaGross < 0 ? 'giảm' : 'tăng'} ${money(Math.abs(s.deltaGross))} đ. Đơn hàng và phiếu kho giữ nguyên. Mua hàng thấy giá chốt ở đơn.` : `Chuyển bước "${s.steps[s.stepIndex + 1].label}".` }))
              onDecide('approve'); }}><Check size={11} className="mr-0.5 inline" />{s.stepIndex === s.steps.length - 1 ? 'Xác nhận giá' : 'Duyệt'}</button></>}
        {s.canWithdraw && <button type="button" disabled={busy} className="text-muted-foreground hover:underline" onClick={async () => {
          if (await confirm({ title: 'Rút bản chốt giá?', targetName: `${s.supplierName} · ${s.code}`, confirmText: 'Rút', actionLabel: 'Rút', intent: 'warning', countdownSeconds: 0,
            warningText: 'Bản chốt giá không còn chờ duyệt; lập lại nếu cần.' })) onDecide('withdraw'); }}><X size={11} className="mr-0.5 inline" />Rút</button>}
        {s.canReverse && <button type="button" disabled={busy} className="text-muted-foreground hover:text-rose-700 hover:underline" onClick={async () => {
          const r = await askReason({ title: 'Đảo chốt giá', targetName: `${s.supplierName} · ${s.code}`, subtitle: 'Công nợ và chi phí về lại giá trước khi chốt. Chỉ đảo được khi phần điều chỉnh chưa được trả.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
          if (r) onDecide('reverse', r); }}><RotateCcw size={11} className="mr-0.5 inline" />Đảo</button>}
      </p>}
    </div>;
  };

/** Chốt giá theo biên bản / thỏa thuận với NCC — không cần hóa đơn. */
export const PriceAgreementDrawer: React.FC<{ suppliers: Array<{ id: string; name: string; taxCode: string | null }>; approval: PriceApproval; supplierId?: string | null; onClose: () => void; onSaved: (m: string) => void }> =
  ({ suppliers, approval, supplierId, onClose, onSaved }) => {
    const [sup, setSup] = useState(supplierId || '');
    const [docs, setDocs] = useState<InvoiceDocument[] | null>(null);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [draft, setDraft] = useState<PriceDraft>({});
    const [no, setNo] = useState(''); const [date, setDate] = useState(''); const [reason, setReason] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
    const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
    useEffect(() => { if (!sup) { setDocs(null); return; } setDocs(null); setDraft({});
      financeService.priceDocuments(sup).then(d => { const list = d.documents || []; setDocs(list); if (list.length === 1) setOpen({ [list[0].id]: true }); })
        .catch(e => setErr(e instanceof Error ? e.message : String(e))); }, [sup]);
    const changes = useMemo(() => changedPrices(docs || [], draft), [docs, draft]);
    const total = changes.reduce((a, x) => a + x.delta, 0); const increase = changes.reduce((a, x) => a + Math.max(x.delta, 0), 0);
    const steps = routeFor(approval, increase); const warns = priceWarnings(docs || [], draft, false);
    const blockers = [!sup && 'Chọn NCC', invalidPriceCount(docs || [], draft) > 0 && 'Sửa ô giá chốt gõ sai', !changes.length && 'Nhập giá chốt ít nhất một dòng', !date && 'Chọn ngày thỏa thuận', !reason.trim() && 'Ghi lý do đổi giá', !files.length && 'Đính kèm biên bản / email'].filter(Boolean) as string[];
    const save = async () => {
      setBusy(true); setErr(null);
      try {
        const r = await financeService.savePriceAgreement({ supplierId: sup, agreementNo: no.trim() || null, agreementDate: date, reason: reason.trim(), attachments: files,
          prices: changes.map(({ documentId, lineId, price }) => ({ documentId, lineId, price })) });
        onSaved(`Đã gửi duyệt chốt giá ${r.code}.`);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };
    return <Drawer label="Chốt giá theo biên bản" wide onClose={onClose}
      header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phải trả · chốt giá NCC</p><h2 className={`text-lg ${ENT}`}>Chốt giá theo biên bản</h2>
        <p className="text-sm text-muted-foreground">NCC đồng ý đổi đơn giá hàng đã giao. Nhập giá chốt ở dòng hàng; đơn hàng và phiếu kho giữ nguyên, công nợ và chi phí điều chỉnh phần chênh sau khi duyệt.</p></>}
      footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto basis-full text-xs text-amber-700 sm:basis-auto">{blockers.join(' · ')}</span>}
        <button type="button" onClick={onClose} className={`hidden sm:inline-flex ${secondaryBtn}`}>Huỷ</button>
        <button type="button" disabled={busy || blockers.length > 0} onClick={() => void save()} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Gửi duyệt giá</button></>}>
      <label className="block text-sm font-medium">Nhà cung cấp
        <SearchableSelect value={sup || null} options={suppliers} onChange={p => setSup(p?.id || '')} getOptionValue={p => p.id} getOptionLabel={p => p.name}
          getOptionSearchText={p => `${p.name} ${p.taxCode || ''}`} placeholder="Tìm theo tên hoặc mã số thuế…" ariaLabel="Nhà cung cấp" className="mt-1" /></label>
      {sup && <section className="overflow-hidden rounded-2xl border border-border">
        <h3 className="border-b border-border bg-muted/30 px-3 py-2 text-sm font-semibold">Hàng đã nhận — nhập giá chốt ở dòng có đổi giá</h3>
        {!docs ? <p className="px-3 py-4 text-sm text-muted-foreground"><Loader2 size={14} className="mr-1 inline animate-spin" />Đang tải chứng từ…</p>
          : docs.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">NCC này chưa có chứng từ nhận hàng nào để chốt giá.</p>
          : <ul className="divide-y divide-border text-sm">{docs.map(d => { const on = !!open[d.id]; const delta = docDelta(d, draft);
            return <li key={d.id}>
              <button type="button" onClick={() => setOpen(o => ({ ...o, [d.id]: !on }))} aria-expanded={on} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/40">
                {on ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
                <span className="min-w-0 flex-1"><b>{d.poNumber || d.documentNo || d.code}</b> <span className="text-xs text-muted-foreground">{d.documentNo && d.poNumber ? `${d.documentNo} · ` : ''}{d.projectCode || 'Kho Tổng'}{d.documentDate ? ` · ${viDate(d.documentDate)}` : ''} · {d.lines ? `${d.lines.length} dòng` : 'không có dòng giá'}</span>
                  <span className="block text-[11px] text-muted-foreground">Ghi nợ {money(d.recognized)} đ{d.invoiced > 0.5 ? ` · đã có hóa đơn ${money(d.invoiced)} đ` : ''}{d.paid > 0.5 ? ` · đã trả ${money(d.paid)} đ` : ''}</span></span>
                {Math.abs(delta) >= 0.5 && <b className={`tabular-nums ${delta < 0 ? 'text-leaf-700' : 'text-amber-700'}`}>{signed(delta)} đ</b>}
              </button>
              {on && <PriceLinesEditor doc={d} draft={draft} onChange={(k, v) => setDraft(x => ({ ...x, [k]: v }))} />}
            </li>; })}</ul>}
      </section>}
      {sup && <>
        <section className={`rounded-xl border p-3 text-sm ${changes.length ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'border-border bg-muted/30 text-muted-foreground'}`}>
          {changes.length ? <><p className="flex flex-wrap items-center gap-x-4 gap-y-1"><span>{changes.length} dòng đổi giá</span>
            <span>Công nợ + chi phí <b className="tabular-nums">{signed(total)} đ</b></span>{increase > 0.5 && Math.abs(total - increase) > 0.5 && <span className="text-xs">(trong đó tăng {money(increase)} đ)</span>}</p>
            {warns.length > 0 && <ul className="mt-2 space-y-1 text-xs">{warns.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>}</>
            : <p>Chưa đổi dòng nào. Mở chứng từ, nhập <b>Giá chốt</b> ở dòng NCC đổi giá; để trống = giữ giá đặt.</p>}
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium">Số biên bản / văn bản<input value={no} onChange={e => setNo(e.target.value)} placeholder="VD: 15/2026/BB-ĐA (không bắt buộc)" className={`mt-1 w-full ${inputCls}`} /></label>
          <label className="block text-sm font-medium">Ngày thỏa thuận<span className="text-rose-600"> *</span><input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
          <label className="block text-sm font-medium md:col-span-2">Lý do đổi giá<span className="text-rose-600"> *</span><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="VD: NCC giảm giá lưới thép theo đàm phán thanh toán ngày 08/10" className={`mt-1 w-full ${inputCls}`} /></label>
        </div>
        <AttachmentPicker supplierId={`price/${sup}`} value={files} onChange={setFiles} label="Biên bản thỏa thuận / email xác nhận của NCC" required />
        {changes.length > 0 && <RoutePreview steps={steps} increase={increase} />}
      </>}
    </Drawer>;
  };

/** Gắn hóa đơn điều chỉnh NCC xuất sau khi chốt giá (chứng từ đã có hóa đơn theo giá cũ). */
export const AdjustmentInvoiceDrawer: React.FC<{ s: PriceSettlement; onClose: () => void; onSaved: (m: string) => void }> = ({ s, onClose, onSaved }) => {
  const [no, setNo] = useState(''); const [date, setDate] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const blockers = [!no.trim() && 'Nhập số hóa đơn điều chỉnh', !date && 'Chọn ngày', !files.length && 'Đính kèm hóa đơn'].filter(Boolean) as string[];
  return <Drawer label="Gắn hóa đơn điều chỉnh" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phải trả · chốt giá NCC</p><h2 className={`text-lg ${ENT}`}>Hóa đơn điều chỉnh · {s.code}</h2>
      <p className="text-sm text-muted-foreground">{s.supplierName} xuất hóa đơn điều chỉnh {s.deltaGross < 0 ? 'giảm' : 'tăng'} {money(Math.abs(s.deltaGross))} đ cho phần đã chốt giá. Công nợ đã điều chỉnh từ lúc duyệt — bước này chỉ lưu chứng từ thuế.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto basis-full text-xs text-amber-700 sm:basis-auto">{blockers.join(' · ')}</span>}
      <button type="button" onClick={onClose} className={`hidden sm:inline-flex ${secondaryBtn}`}>Huỷ</button>
      <button type="button" disabled={busy || blockers.length > 0} className={primaryBtn} onClick={async () => {
        setBusy(true); setErr(null);
        try { await financeService.attachAdjustmentInvoice({ id: s.id, expectedRowVersion: s.rowVersion, number: no.trim(), date, attachments: files }); onSaved('Đã gắn hóa đơn điều chỉnh.'); }
        catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />}Gắn hóa đơn</button></>}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm font-medium">Số hóa đơn điều chỉnh<input value={no} onChange={e => setNo(e.target.value)} placeholder="VD: 0000123" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Ngày hóa đơn<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <AttachmentPicker supplierId={`price/${s.supplierId}`} value={files} onChange={setFiles} label="Hóa đơn điều chỉnh (PDF / XML)" required />
    <p className="text-xs text-muted-foreground">Đã chốt: {shortMoney(Math.abs(s.deltaGross))} {s.deltaGross < 0 ? 'giảm' : 'tăng'} · {s.lines.length} dòng · duyệt {viDate(s.decidedAt)}</p>
  </Drawer>;
};

/** NCC nợ lại (chốt giảm khi chứng từ đã trả): tự trừ vào công nợ kế tiếp cùng NCC + dự án, hoặc NCC hoàn tiền (người khác xác nhận). */
export const SupplierCreditsSection: React.FC<{ credits: SupplierCredit[]; canRecord: boolean; busy: string | null; onRefund: (c: SupplierCredit) => void;
  onDecide: (useId: string, action: 'confirm' | 'reject', reason?: string) => void }> = ({ credits, canRecord, busy, onRefund, onDecide }) => {
  const askReason = useReasonConfirm(); const confirm = useConfirm();
  if (!credits.length) return null;
  return <section className="overflow-hidden rounded-2xl border border-amber-300 bg-card shadow-sm dark:border-amber-900">
    <h3 className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <Wallet size={15} />NCC nợ lại ({credits.length})<span className="text-xs font-normal">— tự trừ vào công nợ kế tiếp cùng NCC + dự án, hoặc ghi NCC hoàn tiền</span></h3>
    <ul className="divide-y divide-border text-sm">{credits.map(c => {
      const pending = c.uses.filter(u => u.kind === 'refund' && u.status === 'submitted');
      const done = c.uses.filter(u => u.status === 'active' || u.status === 'confirmed');
      const pendingAmt = pending.reduce((a, u) => a + u.amount, 0);
      return <li key={c.id} className="px-4 py-3">
        <p className="flex flex-wrap items-start gap-2"><span className="min-w-[12rem] flex-1"><b className={ENT}>{c.supplierName}</b>
          <span className="block text-xs text-muted-foreground">{c.code} · từ chốt giá {c.settlementCode} · {c.projectCode || 'Kho Tổng'} · {viDate(c.createdAt)}</span></span>
          <span className="text-right"><b className="tabular-nums text-amber-700">{money(c.remaining + pendingAmt)} đ</b><span className="block text-[11px] text-muted-foreground">
            {pendingAmt > 0.5 ? `${money(pendingAmt)} đ chờ xác nhận hoàn` : 'còn nợ lại'} / {money(c.amount)} đ</span></span></p>
        {done.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{done.map(u => u.kind === 'offset' ? `trừ vào ${u.documentNo} ${money(u.amount)} đ` : `NCC hoàn ${money(u.amount)} đ (${u.documentRef})`).join(' · ')}</p>}
        {pending.map(u => <p key={u.id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950/20">
          <span className="flex-1">Phiếu thu NCC hoàn <b className="tabular-nums">{money(u.amount)} đ</b> · {u.documentRef} · {viDate(u.paymentDate)} · ghi: {u.createdByName} — <b>chờ xác nhận</b></span>
          {u.attachments.map(a => <button key={a.path} type="button" onClick={() => void financeService.openAttachment(a.path)} className="font-semibold text-teal-700 hover:underline"><FileText size={11} className="mr-0.5 inline" />{a.name}</button>)}
          {u.canDecide && <><button type="button" disabled={busy === u.id} className="font-semibold text-rose-700 hover:underline" onClick={async () => {
              const r = await askReason({ title: 'Trả lại phiếu NCC hoàn tiền', targetName: `${c.supplierName} · ${money(u.amount)} đ`, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' });
              if (r) onDecide(u.id, 'reject', r); }}>Trả lại</button>
            <button type="button" disabled={busy === u.id} className="font-semibold text-leaf-700 hover:underline" onClick={async () => {
              if (await confirm({ title: 'Xác nhận đã nhận tiền NCC hoàn?', targetName: `${c.supplierName} · ${money(u.amount)} đ`, confirmText: 'Xác nhận', actionLabel: 'Xác nhận', intent: 'success', countdownSeconds: 0,
                warningText: 'Ghi phiếu thu vào sổ thu chi và dòng tiền dự án.' })) onDecide(u.id, 'confirm'); }}><Check size={11} className="mr-0.5 inline" />Xác nhận</button></>}</p>)}
        {canRecord && c.remaining > 0.5 && <button type="button" onClick={() => onRefund(c)} className="mt-1.5 text-xs font-semibold text-teal-700 hover:underline"><Banknote size={11} className="mr-0.5 inline" />Ghi NCC hoàn tiền</button>}
      </li>; })}</ul>
  </section>;
};

/** Phiếu thu NCC hoàn tiền khoản nợ lại (người khác xác nhận mới vào sổ thu chi). */
export const CreditRefundDrawer: React.FC<{ c: SupplierCredit; onClose: () => void; onSaved: (m: string) => void }> = ({ c, onClose, onSaved }) => {
  const [amount, setAmount] = useState(moneyText(c.remaining)); const [account, setAccount] = useState(''); const [date, setDate] = useState(''); const [ref, setRef] = useState('');
  const [files, setFiles] = useState<FinanceAttachment[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const a = parseMoney(amount);
  const blockers = [!(a > 0) && 'Nhập số tiền', a > c.remaining + 0.5 && 'Vượt số còn nợ lại', !account && 'Chọn tài khoản nhận tiền', !date && 'Chọn ngày nhận', !ref.trim() && 'Nhập số chứng từ thu'].filter(Boolean) as string[];
  return <Drawer label="NCC hoàn tiền" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phải trả · NCC nợ lại</p><h2 className={`text-lg ${ENT}`}>NCC hoàn tiền · {c.code}</h2>
      <p className="text-sm text-muted-foreground">{c.supplierName} còn nợ lại {money(c.remaining)} đ. Ghi phiếu thu khi tiền về; người khác xác nhận mới vào sổ thu chi.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto basis-full text-xs text-amber-700 sm:basis-auto">{blockers.join(' · ')}</span>}
      <button type="button" onClick={onClose} className={`hidden sm:inline-flex ${secondaryBtn}`}>Huỷ</button>
      <button type="button" disabled={busy || blockers.length > 0} className={primaryBtn} onClick={async () => {
        setBusy(true); setErr(null);
        try { await financeService.saveCreditRefund({ creditId: c.id, amount: a, cashAccountId: account, paymentDate: date, documentRef: ref.trim(), attachments: files }); onSaved('Đã ghi phiếu thu — chờ người khác xác nhận.'); }
        catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Banknote size={15} />}Ghi phiếu thu</button></>}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm font-medium">Số tiền NCC hoàn<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
      <label className="block text-sm font-medium">Ngày nhận tiền<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
      <div className="md:col-span-2"><CashAccountSelect value={account} onChange={setAccount} label="Tài khoản nhận tiền" /></div>
      <label className="block text-sm font-medium md:col-span-2">Số chứng từ thu / UNC<input value={ref} onChange={e => setRef(e.target.value)} placeholder="VD: PT-1025 hoặc số giao dịch ngân hàng" className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
    <AttachmentPicker supplierId={`price/${c.supplierId}`} value={files} onChange={setFiles} label="Chứng từ (sao kê, phiếu thu)" />
  </Drawer>;
};
