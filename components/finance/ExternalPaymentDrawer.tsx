import React, { useMemo, useState } from 'react';
import { Banknote, Loader2 } from 'lucide-react';
import { financeService, type FinanceAttachment, type FinanceSupplierDetail } from '../../lib/financeService';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, viDate } from './financeUi';

// Ghi khoản đã trả NCC ngoài Vioo (trước khi có đề nghị chi K3b). Người khác xác nhận mới trừ công nợ.

export const ExternalPaymentDrawer: React.FC<{
  detail: FinanceSupplierDetail; initialDocumentId?: string | null; onClose: () => void; onSaved: (message: string) => void;
}> = ({ detail, initialDocumentId, onClose, onSaved }) => {
  const payable = detail.documents.filter(d => d.outstanding - d.pendingExternal > 0.5);
  const projects = Array.from(new Map(payable.map(d => [d.projectId || '', d.projectCode || 'Không gắn dự án'])).entries());
  const initialDoc = payable.find(d => d.id === initialDocumentId);
  const [projectId, setProjectId] = useState(initialDoc?.projectId || projects[0]?.[0] || '');
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    initialDoc ? { [initialDoc.id]: moneyInput(initialDoc.outstanding - initialDoc.pendingExternal) } : {});
  const [date, setDate] = useState(detail.today);
  const [method, setMethod] = useState<'bank_transfer' | 'cash' | 'other'>('bank_transfer');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docs = payable.filter(d => (d.projectId || '') === projectId);
  const total = useMemo(() => docs.reduce((s, d) => { const v = parseMoney(amounts[d.id] || ''); return s + (Number.isFinite(v) && v > 0 ? v : 0); }, 0), [docs, amounts]);

  const save = async () => {
    setError(null);
    const allocations = docs.filter(d => amounts[d.id]?.trim()).map(d => ({ documentId: d.id, amount: parseMoney(amounts[d.id]) }));
    if (!allocations.length) { setError('Tick chứng từ đã trả và nhập số tiền.'); return; }
    const bad = allocations.find(a => !Number.isFinite(a.amount) || a.amount <= 0);
    if (bad) { setError('Số tiền phải lớn hơn 0.'); return; }
    const over = allocations.find(a => { const d = docs.find(x => x.id === a.documentId)!; return a.amount > d.outstanding - d.pendingExternal + 0.5; });
    if (over) { setError('Có dòng lớn hơn phần còn nợ.'); return; }
    if (!ref.trim()) { setError('Nhập số UNC / phiếu chi.'); return; }
    if (!files.length) { setError('Đính kèm UNC / phiếu chi.'); return; }
    if (date > detail.today) { setError('Ngày chi không được sau hôm nay.'); return; }
    setSaving(true);
    try {
      const r = await financeService.saveExternalPayment({ supplierId: detail.supplier.id, projectId, paymentDate: date, method, documentRef: ref.trim(),
        note: note.trim() || undefined, attachments: files, allocations });
      onSaved(`Đã ghi ${money(r.amount)} đ chi ngoài hệ thống (${ref.trim()}) — chờ người khác xác nhận rồi mới trừ công nợ.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  return <Drawer wide label="Ghi chi ngoài hệ thống" onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Ghi chi ngoài hệ thống</p>
      <h2 className={`mt-1 text-lg ${ENT}`}>{detail.supplier.name}</h2>
      <p className="text-sm text-muted-foreground">Khoản đã chuyển cho NCC ngoài Vioo (UNC ngân hàng, phiếu chi tiền mặt). Một người khác có quyền Xác nhận kiểm tra UNC rồi mới trừ công nợ.</p>
    </>}
    footer={<>
      <FieldError error={error} />
      <span className="text-sm text-muted-foreground">Tổng <b className={NUM}>{money(total)} đ</b></span>
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Banknote size={15} />}Gửi xác nhận</button>
    </>}>
    {payable.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">NCC này không còn chứng từ nào cần trả.</p> : <>
      <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-muted-foreground">Dự án
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setAmounts({}); }} className={`mt-1 w-full ${inputCls}`}>
            {projects.map(([id, code]) => <option key={id} value={id}>{code}</option>)}
          </select></label>
        <label className="text-xs font-semibold text-muted-foreground">Ngày chi thật (theo UNC)
          <input type="date" value={date} max={detail.today} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
        <label className="text-xs font-semibold text-muted-foreground">Số UNC / phiếu chi <span className="text-rose-600">*</span>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="VD: UNC 0925-01 Vietcombank" className={`mt-1 w-full ${inputCls} ${!ref.trim() ? 'border-amber-400' : ''}`} /></label>
        <div className="text-xs font-semibold text-muted-foreground">Hình thức
          <div className="mt-1 flex flex-wrap gap-1">{([['bank_transfer', 'Chuyển khoản'], ['cash', 'Tiền mặt'], ['other', 'Khác']] as const).map(([k, l]) =>
            <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${method === k ? 'border-teal-600 bg-teal-700 text-white' : 'border-border hover:bg-muted'}`}>{l}</button>)}</div></div>
        <div className="md:col-span-2"><AttachmentPicker supplierId={detail.supplier.id} value={files} onChange={setFiles} label="UNC / phiếu chi (ảnh hoặc PDF)" required /></div>
        <label className="text-xs font-semibold text-muted-foreground md:col-span-2">Ghi chú
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: trả theo đề nghị ngày 20/09 của chị Hương" className={`mt-1 w-full ${inputCls}`} /></label>
      </section>
      <section>
        <h3 className="mb-1 font-semibold text-foreground">Chứng từ đã trả</h3>
        <p className="mb-2 text-xs text-muted-foreground">Tick chứng từ và nhập số đã trả (mặc định trả hết phần còn nợ). Có thể trả một phần.</p>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{docs.map(d => {
          const left = d.outstanding - d.pendingExternal; const on = amounts[d.id] != null;
          const v = parseMoney(amounts[d.id] || ''); const bad = on && amounts[d.id] !== '' && (!Number.isFinite(v) || v <= 0 || v > left + 0.5);
          return <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card px-3 py-2 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input type="checkbox" checked={on} className="h-4 w-4 accent-teal-600"
                onChange={() => setAmounts(cur => { const n = { ...cur }; if (on) delete n[d.id]; else n[d.id] = moneyInput(left); return n; })} />
              <span className={ENT}>{d.documentNo}</span><span className="text-xs text-muted-foreground">{viDate(d.documentDate)} · còn nợ {money(left)} đ{d.pendingExternal > 0 ? ` (đang chờ xác nhận ${money(d.pendingExternal)} đ)` : ''}</span>
            </label>
            {on && <input inputMode="numeric" value={amounts[d.id]} onChange={e => setAmounts(cur => ({ ...cur, [d.id]: e.target.value }))} aria-label={`Số đã trả ${d.documentNo}`}
              className={`w-36 text-right tabular-nums ${inputCls} ${bad ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} />}
          </li>;
        })}</ul>
      </section>
    </>}
  </Drawer>;
};
