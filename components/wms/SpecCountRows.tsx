import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { inputCls } from '../procurement/hub/hubUi';
import { specKey } from '../../lib/materialLineDescription';
import { formatQuantityInput, parseQuantityInput } from '../../lib/quantityInput';
import { SpecInput } from '../material/SpecInput';

// V4 Kiểm kê theo quy cách: mỗi quy cách một ô đếm; số đếm của mã = cộng các quy cách (đếm đủ mọi quy cách mới tính là xong).
// Cỡ chữ 12px thay text-xs: index.css ép text-xs trong khung lưới thành một dòng trên mobile.

export interface SpecCountRow { specification: string | null; value: string; snapshotQty?: number | null; added?: boolean }

const qtyFmt = (n: number | null | undefined) => n == null ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);

/** '' khi còn quy cách chưa đếm hoặc có số không hợp lệ. */
export const specCountTotal = (rows: SpecCountRow[]): string => {
  if (!rows.length || rows.some(r => r.value.trim() === '')) return '';
  const nums = rows.map(r => parseQuantityInput(r.value));
  if (nums.some(n => !(n >= 0))) return '';
  return formatQuantityInput(Math.round(nums.reduce((s, n) => s + n, 0) * 1e6) / 1e6);
};
export const specCountInvalid = (rows: SpecCountRow[]) => rows.some(r => r.value.trim() !== '' && !(parseQuantityInput(r.value) >= 0));

export const SpecCountRows: React.FC<{
  rows: SpecCountRow[]; editable: boolean; systemVisible: boolean; unit: string | null; itemId: string; itemName: string;
  onChange: (rows: SpecCountRow[]) => void;
}> = ({ rows, editable, systemVisible, unit, itemId, itemName, onChange }) => {
  const [adding, setAdding] = useState<string | null>(null);
  const dup = adding != null && rows.some(r => specKey(r.specification) === specKey(adding));
  const add = () => {
    const name = (adding || '').trim();
    if (!name || dup) return;
    onChange([...rows, { specification: name, value: '', snapshotQty: 0, added: true }]);
    setAdding(null);
  };
  return <div className="mt-1.5 space-y-1 rounded-lg border border-border bg-muted/30 p-1.5">
    {rows.map((r, i) => <div key={`${specKey(r.specification)}-${i}`} className="flex items-center gap-2">
      <span className={`min-w-0 flex-1 text-[12px] ${r.specification ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        {r.specification || 'Chưa ghi quy cách'}{r.added && r.specification && <span className="ml-1 font-normal text-amber-700">· mới khi đếm</span>}
        {systemVisible && r.snapshotQty != null && <span className="block font-normal text-muted-foreground">sổ {qtyFmt(r.snapshotQty)}{unit ? ` ${unit}` : ''}</span>}</span>
      {editable
        ? <input inputMode="decimal" value={r.value} placeholder="—" aria-label={`Số đếm ${itemName} — ${r.specification || 'chưa ghi quy cách'}`}
          onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
          className={`${inputCls} w-24 py-1 text-right tabular-nums text-leaf-800`} />
        : <span className="text-[12px] font-semibold tabular-nums">{r.value || '—'}</span>}
    </div>)}
    {editable && (adding == null
      ? <button type="button" onClick={() => setAdding('')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:underline dark:text-teal-300">
        <Plus size={13} />Quy cách khác (đếm thấy)</button>
      : <div className="flex flex-wrap items-start gap-1.5">
        <span className="min-w-[10rem] flex-1"><SpecInput autoFocus itemId={itemId} itemName={itemName} value={adding} onChange={setAdding} maxLength={80}
          placeholder="Quy cách đếm thấy" aria-label={`Quy cách mới ${itemName}`} className={`w-full py-1 ${inputCls}`}
          onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(null); }} /></span>
        <button type="button" onClick={add} disabled={!adding.trim() || dup} className="rounded-lg border border-border bg-card px-2 py-1 text-[12px] font-semibold disabled:opacity-50">Thêm</button>
        <button type="button" onClick={() => setAdding(null)} className="px-1 py-1 text-[12px] text-muted-foreground">Hủy</button>
        {dup && <span className="w-full text-[11px] text-rose-700">Quy cách này đã có trong dòng.</span>}
      </div>)}
  </div>;
};
