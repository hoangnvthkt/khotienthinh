import React, { useState } from 'react';
import type { MaterialCandidateGroup } from '../../lib/projectV2/materialCandidateService';
import { MaterialBasisDrawer } from './MaterialBasisDrawer';
import { parseQuantity6 } from '../../lib/procurement/decimal';
import { formatProjectV2Quantity } from '../../lib/projectV2/presentation';
import { MaterialBoqPositionSummary, type MaterialBoqReadState } from './MaterialBoqPositionSummary';

export interface MaterialEntry {
  quantity: string; neededDate: string; destinationId: string; note: string; overrideReason: string;
}
interface Props {
  groups: MaterialCandidateGroup[]; selectedKeys: string[]; entries: Record<string, MaterialEntry>;
  onSelect: (key: string, checked: boolean) => void;
  onChange: (key: string, patch: Partial<MaterialEntry>) => void;
  periodStart: string; periodEnd: string; siteName: string; siteId: string | null;
  boqState?: MaterialBoqReadState;
}
const inputClass = 'min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800';
const readable = (value: string | null) => value ?? 'Chưa xác định';
const readableQuantity = (value: string | null) => value === null ? 'Chưa xác định'
  : formatProjectV2Quantity({ state: 'known', value }, '');
const adjusted = (requested: string | undefined, calculated: string | null): boolean => {
  if (!requested || calculated === null) return false;
  try { return parseQuantity6(requested) !== parseQuantity6(calculated); } catch { return true; }
};

export function MaterialPlanEditor({ groups, selectedKeys, entries, onSelect, onChange,
  periodStart, periodEnd, siteName, siteId, boqState }: Props) {
  const [basis, setBasis] = useState<MaterialCandidateGroup | null>(null);
  return <section className="space-y-3" aria-label="Dòng kế hoạch vật tư">
    <div><h3 className="font-semibold text-slate-900 dark:text-white">Nhu cầu vật tư</h3>
      <p className="mt-1 text-sm text-slate-500">Chọn vật tư cần lập. Dòng thiếu dữ liệu được lưu dưới dạng nháp và phải hoàn thiện trước khi gửi duyệt.</p></div>
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 lg:block">
      <table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800"><tr>
        <th className="w-9 px-3 py-3"><span className="sr-only">Chọn</span></th>
        <th className="px-3 py-3">Mã và tên vật tư</th><th className="px-3 py-3">Đơn vị</th>
        <th className="px-3 py-3 text-right">Nhu cầu tính toán</th><th className="px-3 py-3">Số lượng đề nghị</th>
        <th className="px-3 py-3">Ngày cần tại công trường</th><th className="px-3 py-3">Điểm nhận</th><th className="px-3 py-3">Ghi chú</th>
      </tr></thead><tbody>{groups.map(group => {
        const selected = selectedKeys.includes(group.key); const entry = entries[group.key];
        return <React.Fragment key={group.key}><tr className="border-t border-slate-200 align-top dark:border-slate-700">
          <td className="px-3 py-3"><input type="checkbox" aria-label={`Chọn ${group.itemName}`} checked={selected}
            onChange={event => onSelect(group.key, event.target.checked)} className="mt-2 h-4 w-4 accent-teal-700" /></td>
          <td className="min-w-72 px-3 py-3"><strong>{group.itemCode && `${group.itemCode} · `}{group.itemName}</strong>
            {boqState && <MaterialBoqPositionSummary itemId={group.itemId} unit={group.unit} readState={boqState} />}
            <button type="button" onClick={() => setBasis(group)} className="mt-1 block text-xs font-semibold text-teal-700 underline">Cơ sở tính toán</button>
            {group.diagnostics.length > 0 && <span className="mt-1 block text-xs text-amber-700">Cần hoàn thiện dữ liệu nguồn</span>}</td>
          <td className="px-3 py-3">{readable(group.unit)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{readableQuantity(group.calculatedQty)}</td>
          <td className="min-w-32 px-3 py-3"><input aria-label={`Số lượng đề nghị ${group.itemName}`} inputMode="decimal"
            disabled={!selected} value={entry?.quantity ?? ''} onChange={event => onChange(group.key, { quantity: event.target.value })}
            className={inputClass} /></td>
          <td className="min-w-40 px-3 py-3"><input type="date" aria-label={`Ngày cần ${group.itemName}`}
            min={periodStart} max={periodEnd} disabled={!selected} value={entry?.neededDate ?? ''}
            onChange={event => onChange(group.key, { neededDate: event.target.value })} className={inputClass} /></td>
          <td className="min-w-36 px-3 py-3"><span className="block pt-2">{siteId ? siteName : 'Chưa xác định'}</span></td>
          <td className="min-w-40 px-3 py-3"><input aria-label={`Ghi chú ${group.itemName}`} disabled={!selected}
            value={entry?.note ?? ''} onChange={event => onChange(group.key, { note: event.target.value })} className={inputClass} /></td>
        </tr>{selected && adjusted(entry?.quantity, group.calculatedQty) &&
          <tr className="bg-amber-50/60"><td colSpan={8} className="px-3 pb-3 text-sm"><label className="font-medium">Lý do điều chỉnh số lượng
            <input value={entry?.overrideReason ?? ''} onChange={event => onChange(group.key, { overrideReason: event.target.value })}
              className={`${inputClass} mt-1 max-w-xl`} /></label></td></tr>}</React.Fragment>;
      })}</tbody></table>
    </div>
    <div className="space-y-3 lg:hidden">{groups.map(group => {
      const selected = selectedKeys.includes(group.key); const entry = entries[group.key];
      return <article key={group.key} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <label className="flex items-start gap-3"><input type="checkbox" checked={selected}
          onChange={event => onSelect(group.key, event.target.checked)} className="mt-1 h-4 w-4 accent-teal-700" />
          <span className="font-semibold">{group.itemCode && `${group.itemCode} · `}{group.itemName}</span></label>
        <div className="mt-2 pl-7 text-sm text-slate-600">{readable(group.unit)} · Nhu cầu tính toán: {readableQuantity(group.calculatedQty)}</div>
        {boqState && <div className="pl-7"><MaterialBoqPositionSummary itemId={group.itemId} unit={group.unit} readState={boqState} /></div>}
        <button type="button" onClick={() => setBasis(group)} className="mt-2 pl-7 text-xs font-semibold text-teal-700 underline">Cơ sở tính toán</button>
        {group.diagnostics.length > 0 && <p className="mt-2 pl-7 text-xs text-amber-700">Cần hoàn thiện dữ liệu nguồn</p>}
        {selected && <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs">Số lượng đề nghị<input inputMode="decimal" value={entry?.quantity ?? ''}
            onChange={event => onChange(group.key, { quantity: event.target.value })} className={`${inputClass} mt-1`} /></label>
          <label className="text-xs">Ngày cần tại công trường<input type="date" min={periodStart} max={periodEnd}
            value={entry?.neededDate ?? ''} onChange={event => onChange(group.key, { neededDate: event.target.value })}
            className={`${inputClass} mt-1`} /></label>
          <div className="text-xs">Điểm nhận<div className="mt-1 min-h-10 rounded-lg border border-slate-200 p-2 text-sm">{siteId ? siteName : 'Chưa xác định'}</div></div>
          <label className="text-xs">Ghi chú<input value={entry?.note ?? ''} onChange={event => onChange(group.key, { note: event.target.value })}
            className={`${inputClass} mt-1`} /></label>
          {adjusted(entry?.quantity, group.calculatedQty) &&
            <label className="text-xs sm:col-span-2">Lý do điều chỉnh số lượng<input value={entry?.overrideReason ?? ''}
              onChange={event => onChange(group.key, { overrideReason: event.target.value })} className={`${inputClass} mt-1`} /></label>}
        </div>}</article>;
    })}</div>
    {!groups.length && <p className="rounded-xl border border-dashed p-5 text-sm text-slate-500">Chưa có vật tư từ các kế hoạch thi công đã chọn.</p>}
    {basis && <MaterialBasisDrawer group={basis} onClose={() => setBasis(null)} />}
  </section>;
}
