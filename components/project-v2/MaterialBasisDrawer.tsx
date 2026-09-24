import React from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { MaterialCandidateGroup } from '../../lib/projectV2/materialCandidateService';
import { formatProjectV2Quantity } from '../../lib/projectV2/presentation';

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
const display = (value: string | null, unit = '') => value === null ? 'Chưa xác định'
  : formatProjectV2Quantity({ state: 'known', value }, unit);

export function MaterialBasisDrawer({ group, onClose }: { group: MaterialCandidateGroup; onClose: () => void }) {
  return <div className="fixed inset-0 z-[120] bg-slate-950/50" role="presentation" onClick={onClose}>
    <aside role="dialog" aria-modal="true" aria-label="Cơ sở tính toán" onClick={event => event.stopPropagation()}
      className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7">
      <div className="flex items-start justify-between gap-4"><div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Cơ sở tính toán</p>
        <h2 className="mt-1 text-xl font-bold">{group.itemCode ? `${group.itemCode} · ` : ''}{group.itemName}</h2>
      </div><button type="button" aria-label="Đóng cơ sở tính toán" onClick={onClose}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
      <div className="mt-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        <p>Nhu cầu tính toán: {display(group.calculatedQty, group.unit ?? '')}</p>
        <p>Đã lập từ các công việc này: {display(group.alreadyPlannedQty, group.unit ?? '')}</p>
        <p>Còn có thể lập từ các công việc này: {display(group.availableQty, group.unit ?? '')}</p>
      </div>
      <div className="mt-5 space-y-4">{group.derivations.map(row => <article key={row.candidateId}
        className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
        <h3 className="font-semibold">{row.sourceWorkName}</h3>
        <Link to={`/project-v2/plans/${row.sourcePlanId}`} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-block text-teal-700 underline dark:text-teal-300">Xem kế hoạch thi công · bản {row.sourceRevision}</Link>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div><dt className="text-slate-500">Khối lượng công việc</dt><dd>{display(row.sourceWorkQuantity, row.sourceUnit ?? '')}</dd></div>
          <div><dt className="text-slate-500">Hao phí cho một đơn vị công việc</dt><dd>{display(row.normFactor, `${group.unit ?? 'đơn vị vật tư'}/${row.sourceUnit ?? 'đơn vị công việc'}`)}</dd></div>
          <div><dt className="text-slate-500">Vật tư cần cho công việc</dt><dd>{display(row.calculatedQty, group.unit ?? '')}</dd></div>
        </dl>
        <details className="mt-3 text-xs text-slate-600 dark:text-slate-300"><summary className="cursor-pointer font-medium">Xem hệ số và quy đổi</summary>
          <p className="mt-2">Hệ số: {display(row.coefficient)} · Quy đổi: {display(row.conversionNumerator)} / {display(row.conversionDenominator)}</p>
        </details>
        {row.diagnostics.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800 dark:text-amber-300">
          {row.diagnostics.map(code => <li key={code}>{diagnosticLabel[code] ?? 'Dữ liệu nguồn cần kiểm tra'}</li>)}
        </ul>}
      </article>)}</div>
    </aside>
  </div>;
}
