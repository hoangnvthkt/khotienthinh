import React from 'react';
import { formatProcurementQuantity } from '../../lib/procurement/presentation';
import type { ProcurementDemandDetailLine } from '../../types/procurementWorkbench';

const value = (amount: string | null, unit: string) => amount == null
  ? 'Chưa xác định'
  : `${formatProcurementQuantity(amount)} ${unit}`;

export const DemandBalanceBreakdown: React.FC<{ line: ProcurementDemandDetailLine }> = ({ line }) => {
  const values = [
    ['Được duyệt', line.balanceInput.approved, 'Nhu cầu được phép bố trí'],
    ['Đã đáp ứng ròng', line.balanceInput.fulfilled, 'Nhận/cấp đã được quy thuộc'],
    ['Đã đóng', line.balanceInput.closed, 'Phần không tiếp tục bố trí'],
    ['Đang giữ', line.balanceInput.reserved, 'Phương án chưa thành cam kết'],
    ['Đang cam kết', line.balanceInput.committed, 'PO/nguồn cung chưa đáp ứng'],
    ['Còn bố trí', line.balance.availableToPlan, 'Phần có thể lập phương án mới'],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {values.map(([label, amount, hint]) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
          <div className={`mt-1 text-base font-black ${amount == null ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>{value(amount, line.unit)}</div>
          <div className="mt-1 text-[11px] font-medium leading-4 text-slate-500">{hint}</div>
        </div>
      ))}
    </div>
  );
};
