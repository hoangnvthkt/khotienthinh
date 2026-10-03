import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { procurementContractService, type ContractDetail } from '../../../lib/procurementContractService';
import { parseQty, qtyInput } from '../../project/work-plan/workPlanUi';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from './hubUi';
import { VendorPicker, type VendorValue } from './OrderFormParts';

// Khai / sửa HĐ nguyên tắc ngay trong Mua hàng (dùng chung dữ liệu với module Hợp đồng — Đối tác).

const STATUS: Array<[NonNullable<ContractDetail['status']>, string]> = [['signed', 'Đã ký · đang dùng'], ['draft', 'Nháp'], ['completed', 'Hoàn thành · ngừng gọi hàng']];

export const ContractForm: React.FC<{
  contract?: ContractDetail | null;
  projects: Array<{ id: string; code: string | null; name: string | null }>;
  onClose: () => void;
  onSaved: (contractId: string) => void;
}> = ({ contract = null, projects, onClose, onSaved }) => {
  const toast = useToast();
  const [vendor, setVendor] = useState<VendorValue>(contract?.supplierId ? { id: contract.supplierId, name: contract.supplierName || '' } : null);
  const [f, setF] = useState({
    code: contract?.code || '', name: contract?.name || '', projectId: contract?.projectId || '',
    signedDate: contract?.signedDate || '', effectiveDate: contract?.effectiveDate || '', expiryDate: contract?.expiryDate || '',
    value: contract?.value ? qtyInput(contract.value) : '', paymentTermDays: contract?.paymentTermDays != null ? String(contract.paymentTermDays) : '',
    paymentTerms: contract?.paymentTerms || '', status: (contract?.status === 'draft' || contract?.status === 'completed' ? contract.status : 'signed') as 'signed' | 'draft' | 'completed',
    note: contract?.note || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF(cur => ({ ...cur, ...p }));
  // Đã phát sinh giao nhận / đơn: NCC và dự án khóa (chứng từ cũ gắn theo HĐ).
  const locked = !!contract && (contract.deliveries.length > 0 || contract.orders.length > 0);

  const save = async () => {
    setError(null);
    if (!f.code.trim() || !f.name.trim()) { setError('Nhập số và tên hợp đồng.'); return; }
    if (!vendor) { setError('Chọn nhà cung cấp.'); return; }
    const value = f.value.trim() ? parseQty(f.value) : null;
    const days = f.paymentTermDays.trim() ? Number(f.paymentTermDays) : null;
    if (value != null && (Number.isNaN(value) || value < 0)) { setError('Giá trị HĐ không hợp lệ.'); return; }
    if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) { setError('Hạn thanh toán từ 0 đến 365 ngày.'); return; }
    if (f.effectiveDate && f.expiryDate && f.expiryDate < f.effectiveDate) { setError('Ngày hết hạn phải sau ngày hiệu lực.'); return; }
    setSaving(true);
    try {
      const r = await procurementContractService.saveContract({ contractId: contract?.id, code: f.code.trim(), name: f.name.trim(), supplierId: vendor.id,
        projectId: f.projectId || null, signedDate: f.signedDate || null, effectiveDate: f.effectiveDate || null, expiryDate: f.expiryDate || null,
        value, paymentTermDays: days, paymentTerms: f.paymentTerms.trim(), status: f.status, note: f.note.trim() });
      toast.success(contract ? `Đã lưu HĐ ${r.code}` : `Đã khai HĐ ${r.code}`, contract ? undefined : 'Tiếp theo: khai bảng giá để gọi hàng tự tính tiền.');
      onSaved(r.contractId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };

  const label = 'text-xs font-semibold text-muted-foreground';
  return <Drawer label={contract ? `Sửa HĐ ${contract.code}` : 'Khai HĐ nguyên tắc'} onClose={onClose}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{contract ? 'Sửa hợp đồng nguyên tắc' : 'Khai hợp đồng nguyên tắc'}</p>
      <h2 className="mt-1 text-lg font-bold text-foreground">{contract ? contract.code : 'HĐ mới'}</h2>
      <p className="text-sm text-muted-foreground">Lưu chung với module Hợp đồng — Đối tác. Khai xong thì khai bảng giá để gọi hàng.</p>
    </>}
    footer={<>
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
      <button type="button" disabled={saving} onClick={() => void save()} className={primaryBtn}>{saving && <Loader2 size={15} className="animate-spin" />}{contract ? 'Lưu HĐ' : 'Khai HĐ'}</button>
    </>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={label}>Số hợp đồng<input value={f.code} onChange={e => set({ code: e.target.value })} placeholder="VD 01.10.2026/HĐKT/TT-HT" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className={label}>Tên hợp đồng<input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="VD Cung cấp bulong" className={`mt-1 w-full ${inputCls}`} /></label>
      {locked ? <div><span className={label}>Nhà cung cấp</span><p className={`mt-1 ${inputCls} bg-muted font-semibold text-mint-700 dark:text-mint-300`}>{vendor?.name}</p></div>
        : <VendorPicker value={vendor} onChange={setVendor} autoFocus={false} />}
      <label className={label}>Dự án
        <select value={f.projectId} disabled={locked} onChange={e => set({ projectId: e.target.value })} className={`mt-1 w-full ${inputCls}`}>
          <option value="">Dùng chung nhiều dự án (cả Kho Tổng)</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select></label>
      {locked && <p className="text-xs text-muted-foreground sm:col-span-2">HĐ đã có giao nhận / đơn gọi hàng nên không đổi NCC hay dự án.</p>}
      <label className={label}>Ngày ký<input type="date" value={f.signedDate} onChange={e => set({ signedDate: e.target.value })} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className={label}>Trạng thái
        <select value={f.status} onChange={e => set({ status: e.target.value as typeof f.status })} className={`mt-1 w-full ${inputCls}`}>
          {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className={label}>Hiệu lực từ<input type="date" value={f.effectiveDate} onChange={e => set({ effectiveDate: e.target.value })} className={`mt-1 w-full ${inputCls}`} /></label>
      <label className={label}>Hiệu lực đến<input type="date" value={f.expiryDate} onChange={e => set({ expiryDate: e.target.value })} className={`mt-1 w-full ${inputCls}`} />
        <span className="mt-0.5 block font-normal">Để trống = không giới hạn. Ngoài thời hạn thì không gọi hàng được.</span></label>
      <label className={label}>Giá trị / hạn mức HĐ (đ, trước VAT)<input inputMode="decimal" value={f.value} onChange={e => set({ value: e.target.value })} placeholder="Để trống = không hạn mức" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} />
        <span className="mt-0.5 block font-normal">Gọi hàng vượt giá trị này phải có Mua hàng duyệt.</span></label>
      <label className={label}>Hạn thanh toán (ngày sau ghi nợ)<input inputMode="numeric" value={f.paymentTermDays} onChange={e => set({ paymentTermDays: e.target.value })} placeholder="VD 30" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className={`${label} sm:col-span-2`}>Điều khoản thanh toán<input value={f.paymentTerms} onChange={e => set({ paymentTerms: e.target.value })} placeholder="VD Thanh toán 30 ngày sau đối soát tháng" className={`mt-1 w-full ${inputCls}`} /></label>
      <label className={`${label} sm:col-span-2`}>Ghi chú<textarea value={f.note} onChange={e => set({ note: e.target.value })} rows={2} className={`mt-1 w-full ${inputCls}`} /></label>
    </div>
  </Drawer>;
};

export default ContractForm;
