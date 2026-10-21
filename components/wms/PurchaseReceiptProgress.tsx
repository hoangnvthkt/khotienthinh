import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, History, Loader2, PencilLine, RefreshCw, Truck, X } from 'lucide-react';
import { money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT } from '../finance/financeUi';
import { fmtQ } from '../../lib/receiptGuards';
import { parseQuantityInput, sanitizeQuantityInput } from '../../lib/quantityInput';
import type { PurchaseReceiptContext } from '../../lib/purchaseReceiptService';
import { GREY, TEAL, WARN, dateVi } from './wmsUi';

export type ReceiptContextState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: PurchaseReceiptContext };

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-slate-800 dark:text-slate-100' }) => (
  <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
    <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
    <div className={`truncate text-sm font-black tabular-nums ${tone}`}>{value}</div>
  </div>
);

/** Tiến độ đơn của đợt giao: kho thấy đơn đặt / đã nhận / đợt này / còn lại trước khi nhận, và lịch sử sửa số sau khi nhận. */
export const PurchaseReceiptProgress: React.FC<{
  state: ReceiptContextState;
  posted: boolean;
  itemName: (itemId: string) => string;
  onRetry: () => void;
  onCorrect?: () => void;
  correctDisabledReason?: string;
  onContinue?: () => void;
}> = ({ state, posted, itemName, onRetry, onCorrect, correctDisabledReason, onContinue }) => {
  if (state.kind === 'loading') {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900"><Loader2 size={14} className="animate-spin" />Đang tải tiến độ đơn…</div>;
  }
  if (state.kind === 'error') {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs font-bold ${WARN}`}>
        <span className="flex items-center gap-1.5"><AlertTriangle size={14} />Chưa tải được tiến độ đơn — {state.message}</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 underline"><RefreshCw size={12} />Thử lại</button>
      </div>
    );
  }
  const ctx = state.data;
  const shortNow = posted && ctx.batchStatus === 'received_short';
  return (
    <section className="space-y-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 dark:border-teal-900 dark:bg-teal-950/20" aria-label="Tiến độ đơn">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
          Đơn <span className={`${ENT} font-mono`}>{ctx.poNumber || '—'}</span> · đợt {ctx.deliveryNo}
        </div>
        <div className="flex flex-wrap gap-2">
          {shortNow && onContinue && <button type="button" onClick={onContinue} className={secondaryBtn}><Truck size={14} />NCC giao tiếp</button>}
          {posted && onCorrect && (
            <button type="button" onClick={onCorrect} disabled={!!correctDisabledReason} title={correctDisabledReason} className={secondaryBtn}><PencilLine size={14} />Sửa số nhận nhầm</button>
          )}
        </div>
      </div>
      {ctx.lines.map(line => {
        const unit = line.unit || '';
        const remaining = posted
          ? line.orderedQty - line.receivedQty
          : line.orderedQty - line.receivedQty - line.pendingOtherQty - line.plannedQty;
        return (
          <div key={line.deliveryLineId}>
            {ctx.lines.length > 1 && <div className="mb-1 text-xs font-bold text-slate-600">{itemName(line.itemId)}</div>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Đơn đặt" value={`${fmtQ(line.orderedQty)} ${unit}`} />
              <Stat label={posted ? 'Đã nhận (cả đơn)' : 'Đã nhận trước'} value={`${fmtQ(line.receivedQty)} ${unit}`} />
              <Stat label={posted ? 'Đợt này đã nhận' : 'Đợt này'} value={`${fmtQ(posted ? line.acceptedQty : line.plannedQty)} ${unit}`} />
              <Stat label={posted ? 'Đơn còn thiếu' : 'Còn sau đợt này'} value={`${fmtQ(Math.max(remaining, 0))} ${unit}`}
                tone={remaining < -1e-9 ? 'text-rose-700' : remaining > 1e-9 ? 'text-amber-700' : 'text-leaf-700'} />
            </div>
            {!posted && line.pendingOtherQty > 0 && <div className="mt-1 text-[11px] font-semibold text-slate-500">Đợt khác đang chờ nhận {fmtQ(line.pendingOtherQty)} {unit}</div>}
          </div>
        );
      })}
      {ctx.outsideImports.length > 0 && (
        <div className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${WARN}`}>
          <div className="flex items-center gap-1.5 font-bold"><AlertTriangle size={14} />Phiếu nhập ngoài đơn cùng vật tư — có thể là hàng của đơn này</div>
          <ul className="mt-1 space-y-0.5">
            {ctx.outsideImports.map(t => (
              <li key={t.transactionId}>{t.code || t.transactionId.slice(-6)} · {dateVi(t.date)} · {t.lines.map(l => `${fmtQ(l.qty)} ${itemName(l.itemId)}`).join(', ')}</li>
            ))}
          </ul>
        </div>
      )}
      {ctx.corrections.length > 0 && (
        <div className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${GREY}`}>
          <div className="flex items-center gap-1.5 font-bold"><History size={14} />Đã sửa số nhận</div>
          <ul className="mt-1 space-y-1">
            {ctx.corrections.map(c => (
              <li key={c.at}>
                {dateVi(c.at)} · {c.byName || '—'}: {c.lines.map(l => `${itemName(l.itemId)} ${fmtQ(l.before)} → ${fmtQ(l.after)} ${l.unit}`).join('; ')}
                {c.creditAmount > 0 && <> · công nợ giảm {money(c.creditAmount)}</>}
                {c.reason && <div className="text-slate-500">Lý do: {c.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

/** Sửa số nhận nhầm (chỉ giảm): kho giảm, công nợ giảm, đơn mở lại phần thiếu — ghi bằng phiếu điều chỉnh, không sửa đè phiếu gốc. */
export const ReceiptCorrectionDialog: React.FC<{
  context: PurchaseReceiptContext;
  itemName: (itemId: string) => string;
  onCancel: () => void;
  onSubmit: (input: { reason: string; lines: Array<{ deliveryLineId: string; correctQty: number; expectedQty: number }> }) => Promise<void>;
}> = ({ context, itemName, onCancel, onSubmit }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, saving]);

  const rows = useMemo(() => context.lines.map(line => {
    const raw = drafts[line.deliveryLineId] ?? '';
    const value = raw.trim() === '' ? Number.NaN : parseQuantityInput(raw);
    const changed = Number.isFinite(value) && Math.abs(value - line.acceptedQty) > 1e-9;
    const error = !Number.isFinite(value) || raw.trim() === '' ? null
      : value > line.acceptedQty + 1e-9 ? 'Lớn hơn số đã ghi nhận — ghi thiếu thì dùng "NCC giao tiếp"'
      : value < line.returnedQty - 1e-9 ? `Nhỏ hơn số đã trả NCC (${fmtQ(line.returnedQty)})` : null;
    const diff = changed && !error ? line.acceptedQty - value : 0;
    return { line, raw, value, changed, error, diff, amount: diff * line.unitPrice * (1 + context.vatRate / 100) };
  }), [context, drafts]);

  const valid = rows.some(r => r.changed && !r.error) && rows.every(r => !r.error) && reason.trim().length >= 5;
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({ reason: reason.trim(), lines: rows.filter(r => r.changed && !r.error).map(r => ({ deliveryLineId: r.line.deliveryLineId, correctQty: r.value, expectedQty: r.line.acceptedQty })) });
    } finally { setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-fix-title">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h3 id="receipt-fix-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">Sửa số nhận nhầm</h3>
            <div className="mt-0.5 text-xs font-semibold text-slate-500">{context.poNumber} · đợt {context.deliveryNo} — ghi phiếu điều chỉnh, phiếu gốc giữ nguyên</div>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="Đóng" className="text-slate-400 hover:text-slate-600"><X size={22} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          {rows.map(r => (
            <label key={r.line.deliveryLineId} className="block rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
                <span className="min-w-0 truncate">{itemName(r.line.itemId)}</span>
                <span className="shrink-0 text-xs text-slate-500">Đã ghi nhận <b className="tabular-nums text-slate-800 dark:text-slate-100">{fmtQ(r.line.acceptedQty)}</b> {r.line.unit}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Số đúng</span>
                <input type="text" inputMode="decimal" value={r.raw} placeholder={fmtQ(r.line.acceptedQty)}
                  onChange={event => setDrafts(prev => ({ ...prev, [r.line.deliveryLineId]: sanitizeQuantityInput(event.target.value, { previousValue: prev[r.line.deliveryLineId] ?? '' }) }))}
                  className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-right text-sm font-black tabular-nums focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950" />
                <span className="text-xs font-bold text-slate-400">{r.line.unit}</span>
              </div>
              {r.error && <div className="mt-1.5 text-[12px] font-bold text-rose-700">{r.error}</div>}
              {r.changed && !r.error && <div className="mt-1.5 text-[12px] font-bold text-amber-700">Kho và đơn giảm {fmtQ(r.diff)} {r.line.unit}</div>}
            </label>
          ))}
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">Lý do sửa *</span>
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} placeholder="Ví dụ: phiếu cân thực tế 21.000 kg; ô số bị trả về số phiếu khi duyệt"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950" />
          </label>
          {totalAmount > 0 && (
            <div className={`rounded-lg border px-3 py-2 text-[13px] font-semibold ${TEAL}`}>
              Sau khi ghi: tồn kho giảm, công nợ NCC giảm <b className="tabular-nums">{money(totalAmount)}</b>, đơn mở lại phần thiếu (NCC giao tiếp hoặc chốt thiếu).
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={saving} className={`${secondaryBtn} flex-1 sm:flex-none`}>Hủy</button>
          <button type="button" onClick={() => void submit()} disabled={!valid || saving}
            title={!valid ? 'Nhập số đúng nhỏ hơn số đã ghi nhận và lý do (ít nhất 5 ký tự)' : undefined} className={`${primaryBtn} flex-1 sm:flex-none`}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <PencilLine size={15} />}Ghi phiếu sửa số
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
