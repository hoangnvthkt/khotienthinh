import React from 'react';
import type { MonthCandidate } from '../../lib/projectV2/candidateService';
import { formatDecimal6, parseQuantity6 } from '../../lib/procurement/decimal';

function amount(quantity: string | undefined, price: string | null | undefined): string {
  if (!quantity || price === null || price === undefined) return 'Chưa xác định';
  try { return formatDecimal6((parseQuantity6(quantity) * parseQuantity6(price) + 500_000n) / 1_000_000n); }
  catch { return 'Chưa xác định'; }
}
const display = (value: string | null) => {
  if (value === null) return 'Chưa xác định';
  try { return formatDecimal6(parseQuantity6(value)); } catch { return 'Chưa xác định'; }
};

export function MonthPlanEditor({ rows, quantities, onChange, canViewPrice = false }: {
  rows: MonthCandidate[]; quantities: Record<string, string>;
  onChange: (id: string, quantity: string) => void; canViewPrice?: boolean;
}) {
  return <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
    <p className="px-3 py-2 text-xs text-slate-500 sm:hidden">Vuốt ngang để xem và nhập đủ các cột.</p><div className="w-full overflow-x-auto">
    <table className="w-full min-w-[760px] border-collapse text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr>
        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 dark:bg-slate-800">Công việc</th><th className="px-3 py-3">Đơn vị</th>
        <th className="px-3 py-3 text-right">Khối lượng hợp đồng</th>
        <th className="px-3 py-3 text-right">Đã lập trước kỳ</th>
        <th className="px-3 py-3">Kế hoạch kỳ này</th>
        {canViewPrice && <><th className="px-3 py-3 text-right">Đơn giá hợp đồng</th><th className="px-3 py-3 text-right">Thành tiền</th></>}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.contractItemId} className="border-t border-slate-100 dark:border-slate-700">
        <td className="sticky left-0 z-10 bg-white px-3 py-3 dark:bg-slate-900"><strong className="block text-slate-900 dark:text-white">{row.code} · {row.title}</strong>
          {row.isGroup && <span className="text-xs text-slate-500">Nhóm tổng hợp · không nhập khối lượng</span>}
        </td>
        <td className="px-3 py-3">{row.unit ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{display(row.contractQuantity)}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{display(row.previousPlannedQuantity)}</td>
        <td className="px-3 py-3"><input aria-label={`Kế hoạch kỳ này ${row.code}`} type="text" inputMode="decimal"
          disabled={row.isGroup} value={quantities[row.contractItemId] ?? ''}
          onChange={event => onChange(row.contractItemId, event.target.value)}
          className="w-32 rounded-lg border border-slate-300 px-2 py-2 tabular-nums dark:border-slate-600 dark:bg-slate-800" /></td>
        {canViewPrice && <><td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{display(row.unitPrice ?? null)}</td>
          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{amount(quantities[row.contractItemId], row.unitPrice)}</td></>}
      </tr>)}</tbody>
    </table>
  </div></div>;
}
