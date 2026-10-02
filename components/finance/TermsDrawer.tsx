import React, { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { financeService, type FinanceSupplierDetail } from '../../lib/financeService';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, FieldError } from './financeUi';

// Hạn thanh toán: HĐ → NCC → mặc định công ty. Đổi chỉ áp chứng từ mới, trừ khi chọn áp cho chứng từ đang mở.

export const TermsDrawer: React.FC<{ detail: FinanceSupplierDetail; onClose: () => void; onSaved: (message: string) => void }> = ({ detail, onClose, onSaved }) => {
  const [target, setTarget] = useState<string>('supplier');
  const contract = detail.contracts.find(c => c.id === target) || null;
  const [days, setDays] = useState(String(detail.supplier.terms?.paymentDays ?? ''));
  const [note, setNote] = useState(detail.supplier.terms?.note || '');
  const [requireInvoice, setRequireInvoice] = useState(false);
  const [applyToOpen, setApplyToOpen] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setTarget(id); setError(null);
    const c = detail.contracts.find(x => x.id === id);
    setDays(String((c ? c.paymentTermDays : detail.supplier.terms?.paymentDays) ?? ''));
    setRequireInvoice(Boolean(c?.requireInvoice));
  };
  const save = async () => {
    const n = days.trim() === '' ? null : Number(days);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 365)) { setError('Số ngày trả chậm phải là số nguyên 0–365 (để trống = bỏ khai).'); return; }
    if (!reason.trim()) { setError('Nhập lý do / căn cứ (VD: Điều 5 HĐ).'); return; }
    setBusy(true); setError(null);
    try {
      const r = contract
        ? await financeService.saveContractTerms({ contractId: contract.id, paymentDays: n, requireInvoice, applyToOpen, reason: reason.trim() })
        : await financeService.saveSupplierTerms({ supplierId: detail.supplier.id, paymentDays: n, note: note.trim() || undefined, applyToOpen, reason: reason.trim() });
      onSaved(`Đã lưu hạn thanh toán ${contract ? `HĐ ${contract.code}` : detail.supplier.name}${applyToOpen ? ` — tính lại hạn ${r.recomputed} chứng từ đang mở` : ' — áp cho chứng từ mới'}.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return <Drawer label="Khai hạn thanh toán" onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Khai hạn thanh toán</p>
      <h2 className={`mt-1 text-lg ${ENT}`}>{detail.supplier.name}</h2>
      <p className="text-sm text-muted-foreground">Thứ tự áp: theo HĐ → theo NCC → mặc định công ty ({detail.defaultPaymentDays} ngày), tính từ ngày ghi nợ.</p>
    </>}
    footer={<>
      <FieldError error={error} />
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}Lưu</button>
    </>}>
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={target === 'supplier'} onClick={() => pick('supplier')}
        className={`rounded-xl border px-3 py-1.5 text-sm font-semibold ${target === 'supplier' ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'border-border'}`}>
        Mặc định NCC <span className="font-normal text-muted-foreground">{detail.supplier.terms ? `${detail.supplier.terms.paymentDays} ngày` : 'chưa khai'}</span></button>
      {detail.contracts.map(c => <button key={c.id} type="button" aria-pressed={target === c.id} onClick={() => pick(c.id)}
        className={`rounded-xl border px-3 py-1.5 text-sm font-semibold ${target === c.id ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'border-border'}`}>
        HĐ <span className={ENT}>{c.code}</span> <span className="font-normal text-muted-foreground">{c.paymentTermDays != null ? `${c.paymentTermDays} ngày` : 'chưa khai'}</span></button>)}
    </div>
    {contract?.paymentTermsText && <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm"><span className="text-muted-foreground">Điều khoản ghi trên HĐ: </span>{contract.paymentTermsText}</p>}
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4">
      <label className="text-xs font-semibold text-muted-foreground">Số ngày trả chậm (để trống = bỏ khai, dùng mức sau)
        <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} className={`mt-1 w-32 text-right tabular-nums ${inputCls}`} /></label>
      {contract ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requireInvoice} onChange={e => setRequireInvoice(e.target.checked)} className="h-4 w-4 accent-teal-600" />
        Bắt buộc có hóa đơn trước khi chi (áp dụng từ K3b)</label>
        : <label className="text-xs font-semibold text-muted-foreground">Ghi chú<input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={applyToOpen} onChange={e => setApplyToOpen(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-600" />
        <span>Tính lại hạn cho chứng từ đang mở<span className="block text-xs text-muted-foreground">Bỏ chọn nếu chỉ áp cho chứng từ phát sinh sau. Chứng từ đã sửa hạn tay giữ nguyên.</span></span></label>
      <label className="text-xs font-semibold text-muted-foreground">Lý do / căn cứ <span className="text-rose-600">*</span>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Điều 5 HĐ — thanh toán 30 ngày sau khi nhận hóa đơn" className={`mt-1 w-full ${inputCls}`} /></label>
    </section>
  </Drawer>;
};
