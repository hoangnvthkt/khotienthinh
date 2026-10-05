import React, { useEffect, useState } from 'react';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { emptyPurchaseNeed, type PurchaseNeedRow } from '../../lib/requestPurchaseNeed';
import { requestPurchaseService, type PurchaseNeedOptions } from '../../lib/requestPurchaseService';
import type { User } from '../../types';
import UserSearchSelect from '../common/UserSearchSelect';
const input = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white disabled:opacity-60';
export const RequestPurchaseNeedEditor: React.FC<{ value: unknown; onChange: (value: PurchaseNeedRow[]) => void; users: User[]; disabled?: boolean }> = ({ value, onChange, users, disabled }) => {
 const [options, setOptions] = useState<PurchaseNeedOptions | null>(null); const [error, setError] = useState('');
 const load = () => { setError(''); requestPurchaseService.options().then(setOptions).catch(e => setError(e.message)); };
 useEffect(load, []);
 const rows = Array.isArray(value) ? value as PurchaseNeedRow[] : [];
 const patch = (i: number, next: Partial<PurchaseNeedRow>) => onChange(rows.map((r, j) => i === j ? { ...r, ...next } : r));
 return <div className="space-y-3">
  <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100"><p className="flex items-center gap-2 font-semibold"><ShoppingCart size={16} />Duyệt xong sẽ chuyển sang Mua hàng</p><p className="mt-1 text-xs leading-5">Điền đúng kho nhận và ngày cần cho từng dòng. Tài sản chỉ được cấp phát sau khi nhận hàng và xác nhận bàn giao.</p></div>
  {error ? <p role="alert" className="text-sm text-rose-600">{error} <button type="button" onClick={load} className="underline">Thử lại</button></p> : !options ? <p role="status" className="text-sm text-slate-500">Đang tải kho và nhóm tài sản…</p> : null}
  {rows.map((row, i) => <details key={row._id} open className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
   <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{i + 1}. {row['Tên hàng'] || 'Dòng nhu cầu mới'} <span className="font-normal text-slate-500">{row['Số lượng'] && ` · ${row['Số lượng']} ${row['Đơn vị']}`}</span></summary>
   <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 dark:border-slate-800">
    {(['Tên hàng', 'Quy cách', 'Đơn vị', 'Số lượng'] as const).map(k => <label key={k} className="min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">{k}{k !== 'Quy cách' ? ' *' : ''}<input aria-label={`${k} dòng ${i + 1}`} className={`${input} mt-1`} value={row[k]} type={k === 'Số lượng' ? 'number' : 'text'} min={k === 'Số lượng' ? '0.001' : undefined} step={k === 'Số lượng' ? 'any' : undefined} disabled={disabled} onChange={e => patch(i, { [k]: e.target.value })} /></label>)}
    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Kho nhận *<select aria-label={`Kho nhận dòng ${i + 1}`} className={`${input} mt-1`} value={row._warehouseId} disabled={disabled || !options} onChange={e => patch(i, { _warehouseId: e.target.value, 'Kho nhận': options?.warehouses.find(w => w.id === e.target.value)?.name || '' })}><option value="">Chọn kho nhận</option>{options?.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Ngày cần *<input aria-label={`Ngày cần dòng ${i + 1}`} type="date" className={`${input} mt-1`} value={row['Ngày cần']} disabled={disabled} onChange={e => patch(i, { 'Ngày cần': e.target.value })} /></label>
    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Loại hàng *<select aria-label={`Loại hàng dòng ${i + 1}`} className={`${input} mt-1`} value={row['Loại hàng']} disabled={disabled} onChange={e => patch(i, { 'Loại hàng': e.target.value as PurchaseNeedRow['Loại hàng'], _categoryId: '', 'Nhóm tài sản': '' })}><option>Vật tư</option><option>Tài sản</option></select></label>
    {row['Loại hàng'] === 'Tài sản' && <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Nhóm tài sản *<select aria-label={`Nhóm tài sản dòng ${i + 1}`} className={`${input} mt-1`} value={row._categoryId} disabled={disabled || !options} onChange={e => patch(i, { _categoryId: e.target.value, 'Nhóm tài sản': options?.categories.find(c => c.id === e.target.value)?.name || '' })}><option value="">Chọn nhóm tài sản</option>{options?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {row['Loại hàng'] === 'Tài sản' && <div className="text-xs font-medium text-slate-600 sm:col-span-2 dark:text-slate-300"><p className="mb-1">Người dự kiến nhận · có thể chọn khi cấp phát</p><UserSearchSelect users={users} value={row._recipientId} disabled={disabled} onChange={id => patch(i, { _recipientId: id || '', 'Người dự kiến nhận': users.find(u => u.id === id)?.name || '' })} /></div>}
    <button type="button" disabled={disabled} onClick={() => onChange(rows.filter((_, j) => i !== j))} className="flex items-center gap-1.5 justify-self-start rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={14} />Xóa dòng {i + 1}</button>
   </div>
  </details>)}
  <button type="button" disabled={disabled || !options || rows.length >= 100} onClick={() => onChange([...rows, emptyPurchaseNeed()])} className="inline-flex items-center gap-2 rounded-lg border border-teal-200 px-3 py-2.5 text-sm font-semibold text-teal-700 disabled:opacity-40 dark:text-teal-300"><Plus size={16} />Thêm hàng cần mua</button>
 </div>;
};
