import React from 'react';
import type { ProjectV2MaterialBoqPositionRow } from '../../lib/projectV2/materialBoqPositionService';
import { formatProjectV2Quantity } from '../../lib/projectV2/presentation';
import { formatDecimal6, parseDecimal6 } from '../../lib/procurement/decimal';

export type MaterialBoqReadState = {
  status: 'loading' | 'ready' | 'error';
  positions: Map<string, ProjectV2MaterialBoqPositionRow>;
};

interface Props {
  itemId: string | null;
  unit: string | null;
  readState: MaterialBoqReadState;
}

const quantity = (value: string | null, unit: string | null): string => {
  if (value === null) return 'Chưa xác định';
  if (!value.startsWith('-')) return formatProjectV2Quantity({ state: 'known', value }, unit ?? '');
  const [whole, fraction] = formatDecimal6(parseDecimal6(value)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}${fraction ? `,${fraction}` : ''} ${unit ?? ''}`.trim();
};

export function MaterialBoqPositionSummary({ itemId, unit, readState }: Props) {
  if (!itemId) return <p className="mt-2 text-xs text-amber-700">Chưa liên kết vật tư trong kho để đối chiếu BOQ.</p>;
  if (readState.status === 'loading') return <p className="mt-2 text-xs text-slate-500">Đang tải cân đối BOQ…</p>;
  if (readState.status === 'error') return <p className="mt-2 text-xs text-amber-700">Không tải được cân đối BOQ. Thử tải lại kế hoạch.</p>;

  const position = readState.positions.get(itemId);
  const matched = position && position.unit && unit && position.unit.toLocaleLowerCase('vi') === unit.toLocaleLowerCase('vi');
  const boq = matched && position?.state !== 'outside_boq' ? quantity(position.boqQuantity, unit)
    : matched && position?.state === 'outside_boq' ? 'Ngoài BOQ' : 'Chưa xác định';
  const received = matched ? quantity(position.receivedQuantity, unit) : 'Chưa xác định';
  const remaining = matched && position?.state === 'known' ? quantity(position.remainingQuantity, unit)
    : matched && position?.state === 'outside_boq' ? 'Chưa áp dụng' : 'Chưa xác định';
  const pending = matched ? quantity(position.pendingQuantity, unit) : 'Chưa xác định';

  return <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800" aria-label="Cân đối BOQ công trình">
    <dl className="grid grid-cols-3 gap-2">
      <div><dt className="text-slate-500">Định mức</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{boq}</dd></div>
      <div><dt className="text-slate-500">Đã nhập kho</dt><dd className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{received}</dd></div>
      <div><dt className="text-slate-500">Còn lại</dt><dd className={`mt-0.5 font-semibold tabular-nums ${position?.state === 'known' && position.remainingQuantity?.startsWith('-')
        ? 'text-red-700 dark:text-red-300' : 'text-teal-800 dark:text-teal-300'}`}>{remaining}</dd></div>
    </dl>
    <p className="mt-1.5 text-slate-500">Đang đặt hoặc chuyển: {pending}</p>
    {matched && position?.state === 'unknown' && <p className="mt-1 text-amber-700">Có số liệu cần đối chiếu.</p>}
  </div>;
}
