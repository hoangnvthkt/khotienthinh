import React from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { MaterialCandidateGroup } from '../../lib/projectV2/materialCandidateService';

const diagnosticLabel: Record<string, string> = {
  missing_inventory_identity: 'Chưa liên kết vật tư kho',
  missing_norm_revision: 'Thiếu định mức hoặc phiên bản định mức',
  missing_conversion: 'Chưa xác nhận quy đổi đơn vị',
  missing_norm_factor: 'Chưa có hệ số định mức',
  ambiguous_mapping: 'Công việc có nhiều định mức đang hiệu lực',
  source_quantity_unknown: 'Khối lượng thi công chưa xác định',
  source_revision_changed: 'Kế hoạch thi công đã đổi phiên bản',
  already_allocated: 'Nguồn đã được phân bổ vượt mức',
  unit_mismatch: 'Đơn vị vật tư không khớp',
};
const display = (value: string | null) => value ?? 'Chưa xác định';

export function MaterialBasisDrawer({ group, onClose }: { group: MaterialCandidateGroup; onClose: () => void }) {
  return <div className="fixed inset-0 z-[120] bg-slate-950/50" role="presentation" onClick={onClose}>
    <aside role="dialog" aria-modal="true" aria-label="Cơ sở tính toán" onClick={event => event.stopPropagation()}
      className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7">
      <div className="flex items-start justify-between gap-4"><div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Cơ sở tính toán</p>
        <h2 className="mt-1 text-xl font-bold">{group.itemCode ? `${group.itemCode} · ` : ''}{group.itemName}</h2>
      </div><button type="button" aria-label="Đóng cơ sở tính toán" onClick={onClose}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
      <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Nhu cầu tính toán: {display(group.calculatedQty)} {group.unit ?? ''} · Đã lập: {display(group.alreadyPlannedQty)} · Còn khả dụng: {display(group.availableQty)}</p>
      <div className="mt-5 space-y-4">{group.derivations.map(row => <article key={row.candidateId}
        className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
        <h3 className="font-semibold">{row.sourceWorkName}</h3>
        <Link to={`/project-v2/plans/${row.sourcePlanId}`} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-block text-teal-700 underline dark:text-teal-300">Xem kế hoạch thi công · bản {row.sourceRevision}</Link>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div><dt className="text-slate-500">Khối lượng công việc</dt><dd>{display(row.sourceWorkQuantity)} {row.sourceUnit ?? ''}</dd></div>
          <div><dt className="text-slate-500">Tài nguyên định mức</dt><dd className="break-all">{display(row.normResourceId)}</dd></div>
          <div><dt className="text-slate-500">Phiên bản định mức</dt><dd className="break-all">{display(row.normRevision)}</dd></div>
          <div><dt className="text-slate-500">Định mức</dt><dd>{display(row.normFactor)}</dd></div>
          <div><dt className="text-slate-500">Hệ số</dt><dd>{display(row.coefficient)}</dd></div>
          <div><dt className="text-slate-500">Quy đổi</dt><dd>{display(row.conversionNumerator)} / {display(row.conversionDenominator)}</dd></div>
          <div><dt className="text-slate-500">Nhu cầu</dt><dd>{display(row.calculatedQty)}</dd></div>
          <div><dt className="text-slate-500">Đã lập</dt><dd>{display(row.alreadyPlannedQty)}</dd></div>
          <div><dt className="text-slate-500">Còn khả dụng</dt><dd>{display(row.availableQty)}</dd></div>
        </dl>
        {row.diagnostics.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800 dark:text-amber-300">
          {row.diagnostics.map(code => <li key={code}>{diagnosticLabel[code] ?? 'Dữ liệu nguồn cần kiểm tra'}</li>)}
        </ul>}
      </article>)}</div>
    </aside>
  </div>;
}
