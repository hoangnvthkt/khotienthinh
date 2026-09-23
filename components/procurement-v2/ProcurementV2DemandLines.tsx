import React from 'react';
import type { ProcurementV2DossierLine } from '../../types/procurementV2';
import type { ProcurementDocumentRef } from '../../types/procurementWorkbench';
import { formatDecimal6, parseQuantity6 } from '../../lib/procurement/decimal';

const display = (value: bigint) => {
  const [integer, fraction] = formatDecimal6(value).split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction ? `,${fraction}` : ''}`;
};
const qty = (value: string | null, unit: string) => value === null ? 'Chưa rõ'
  : `${display(parseQuantity6(value))} ${unit}`;
const date = (value: string | null) => value
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString('vi-VN', { timeZone: 'UTC' }) : 'Chưa rõ';

export const ProcurementV2DemandLines: React.FC<{
  lines: ProcurementV2DossierLine[];
  onOpenDocument?: (ref: ProcurementDocumentRef) => void;
}> = ({ lines, onOpenDocument }) =>
  <div className="grid gap-3">
    {lines.map(line => {
      const arranged = line.reservedQty !== null && line.committedQty !== null
        ? `${display(parseQuantity6(line.reservedQty) + parseQuantity6(line.committedQty))} ${line.unit}`
        : 'Chưa rõ';
      return <article key={line.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="font-semibold text-slate-900 dark:text-white">{line.title}</h3><p className="text-xs text-slate-500">ĐVT: {line.unit}</p></div>
          {!line.balanceKnown && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">Cần đối chiếu</span>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div><dt className="text-slate-500">Nhu cầu đã duyệt</dt><dd className="mt-1 font-semibold">{qty(line.approvedQty, line.unit)}</dd></div>
          <div><dt className="text-slate-500">Đã bố trí</dt><dd className="mt-1 font-semibold">{arranged}</dd></div>
          <div><dt className="text-slate-500">Còn phải bố trí</dt><dd className="mt-1 font-semibold text-emerald-800 dark:text-emerald-300">{qty(line.availableToPlanQty, line.unit)}</dd></div>
          <div><dt className="text-slate-500">Ngày cần</dt><dd className="mt-1 font-semibold">{date(line.neededDate)}</dd></div>
          <div><dt className="text-slate-500">Điểm nhận</dt><dd className="mt-1 font-semibold">{line.destinationId || 'Chưa rõ'}</dd></div>
          <div><dt className="text-slate-500">Bước tiếp theo</dt><dd className="mt-1 font-semibold">{!line.balanceKnown ? 'Đối chiếu dữ liệu' : line.availableToPlanQty && parseQuantity6(line.availableToPlanQty) > 0n ? 'Bố trí nguồn cung' : 'Theo dõi thực hiện'}</dd></div>
        </dl>
        {line.diagnostics.length > 0 && <details className="mt-3 text-xs text-amber-800 dark:text-amber-300"><summary className="cursor-pointer">Vì sao cần đối chiếu?</summary><p className="mt-1">Dữ liệu nguồn hoặc chứng từ thực hiện chưa khớp. Kiểm tra hồ sơ trước khi mua thêm.</p></details>}
        {line.documentRefs.length > 0 && <details className="mt-3 text-sm text-slate-600 dark:text-slate-300"><summary className="cursor-pointer font-medium">Chứng từ liên quan ({line.documentRefs.length})</summary><div className="mt-2 flex flex-wrap gap-2">{line.documentRefs.map(ref => <button type="button" key={`${ref.type}:${ref.id}`} onClick={() => onOpenDocument?.(ref)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-700 dark:hover:bg-slate-800">{ref.label || (ref.type === 'purchase_order' ? 'Đơn mua' : 'Chứng từ')} · Mở chi tiết</button>)}</div></details>}
      </article>;
    })}
  </div>;
