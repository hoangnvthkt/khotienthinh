import React from 'react';
import { specKey } from '../../lib/materialLineDescription';
import type { SpecAllocation } from '../../lib/wmsCatalogService';
import { fmtQty } from './wmsUi';

// Chọn quy cách khi xuất (V2). Trống = tự lấy quy cách nhập trước. Chọn quy cách không đủ → phần thiếu tự lấy nhập trước.

const UNSPEC = '(chưa ghi quy cách)';

export const IssueSpecSelect: React.FC<{
  specs: SpecAllocation[] | undefined; value: string; onChange: (value: string) => void; qty?: number; unit?: string | null;
  className?: string; label?: string;
}> = ({ specs, value, onChange, qty, unit, className = '', label }) => {
  if (!specs?.some(s => s.specification)) return null;
  const first = specs[0];
  const picked = value ? specs.find(s => specKey(s.specification) === specKey(value)) : undefined;
  const pickedQty = Number(picked?.qty || 0);
  const short = value && qty != null && qty > pickedQty + 0.0000005;
  return <span className={`block ${className}`.trim()}>
    <select value={value} aria-label={label || 'Quy cách xuất'} onChange={e => onChange(e.target.value)}
      className="h-8 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <option value="">Tự lấy nhập trước — {first.specification || UNSPEC}</option>
      {specs.map(s => <option key={specKey(s.specification) || '-'} value={s.specification || ''} disabled={!s.specification}>
        {s.specification || UNSPEC} — còn {fmtQty(Number(s.qty))}{unit ? ` ${unit}` : ''}</option>)}
    </select>
    {short && <span className="mt-0.5 block text-[11px] leading-snug text-amber-700 dark:text-amber-300">
      “{value}” còn {fmtQty(pickedQty)}{unit ? ` ${unit}` : ''} — phần thiếu tự lấy quy cách nhập trước.</span>}
  </span>;
};
