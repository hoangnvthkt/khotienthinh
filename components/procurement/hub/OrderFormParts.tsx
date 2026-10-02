import React, { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { procurementInboxService, type ProcurementVendor } from '../../../lib/procurementInboxService';
import { inputCls } from './hubUi';

// Ô nhập dùng chung cho màn lập đơn từ nhu cầu và đơn chủ động.

export type VendorValue = { id: string; name: string } | null;

export const VendorPicker: React.FC<{ value: VendorValue; onChange: (v: VendorValue) => void; autoFocus?: boolean }> = ({ value, onChange, autoFocus = true }) => {
  const [query, setQuery] = useState('');
  const [vendors, setVendors] = useState<ProcurementVendor[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    setVendors(null);
    const t = setTimeout(() => { procurementInboxService.vendors(query).then(setVendors).catch(() => setVendors([])); }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  return <div className="relative">
    <label className="text-xs font-semibold text-muted-foreground" htmlFor="po-vendor">Nhà cung cấp</label>
    {value && !open
      ? <button id="po-vendor" type="button" onClick={() => { setOpen(true); setQuery(''); }} className={`mt-1 flex w-full items-center justify-between text-left ${inputCls}`}>
        <span className="truncate font-semibold text-mint-700 dark:text-mint-300">{value.name}</span><span className="text-xs text-teal-700 dark:text-teal-300">Đổi</span></button>
      : <div className="relative mt-1">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input id="po-vendor" autoFocus={autoFocus} value={query} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }} placeholder="Tìm tên hoặc mã số thuế NCC…" className={`w-full pl-8 ${inputCls}`} />
      </div>}
    {open && <ul role="listbox" className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
      {vendors == null && <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />Đang tìm NCC…</li>}
      {vendors?.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy NCC. Khai NCC mới ở Hợp đồng — Đối tác.</li>}
      {vendors?.map(v => <li key={v.id}><button type="button" role="option" aria-selected={value?.id === v.id}
        onClick={() => { onChange({ id: v.id, name: v.name }); setOpen(false); }}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
        <span className="truncate">{v.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{v.recentOrders ? `${v.recentOrders} đơn` : v.taxCode && v.taxCode !== '0' ? v.taxCode : ''}</span></button></li>)}
    </ul>}
  </div>;
};

const VAT_CHOICES = [0, 8, 10];

export const VatPicker: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) =>
  <div>
    <span className="text-xs font-semibold text-muted-foreground">Thuế VAT</span>
    <div className="mt-1 flex items-center gap-1">
      {VAT_CHOICES.map(v => <button key={v} type="button" aria-pressed={value === String(v)} onClick={() => onChange(String(v))}
        className={`rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${value === String(v) ? 'border-teal-600 bg-teal-700 text-white' : 'border-border hover:bg-muted'}`}>{v}%</button>)}
      <input aria-label="VAT khác (%)" inputMode="decimal" value={VAT_CHOICES.map(String).includes(value) ? '' : value} onChange={e => onChange(e.target.value)} placeholder="Khác" className={`w-16 ${inputCls}`} />
    </div>
  </div>;

export const DeliveryModePicker: React.FC<{ value: 'single' | 'multiple'; onChange: (v: 'single' | 'multiple') => void }> = ({ value, onChange }) =>
  <section role="radiogroup" aria-label="Hình thức giao" className="grid gap-2 md:grid-cols-2">
    {([['single', 'Giao 1 lần', 'Đặt đơn nào về đơn ấy. Duyệt xong có ngay phiếu nhập kho cho thủ kho.'],
      ['multiple', 'Giao nhiều đợt', 'Hàng về nhiều lần (VD thép tấm). Mua hàng lập từng đợt với SL, giá và VAT riêng.']] as const).map(([key, label, hint]) =>
      <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}
        className={`rounded-2xl border p-3 text-left transition ${value === key ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20 dark:bg-teal-950/20' : 'border-border bg-card hover:border-teal-300'}`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className={`h-3.5 w-3.5 rounded-full border-2 ${value === key ? 'border-teal-600 bg-teal-600' : 'border-muted-foreground'}`} />{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      </button>)}
  </section>;
