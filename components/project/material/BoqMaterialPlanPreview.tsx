import React from 'react';
import { Eye, X } from 'lucide-react';
import type { BoqMaterialPlanPreview } from '../../../types/materialPlanning';

interface BoqMaterialPlanPreviewProps {
  preview: BoqMaterialPlanPreview;
  onClose: () => void;
}

export const BoqMaterialPlanPreviewPanel: React.FC<BoqMaterialPlanPreviewProps> = ({ preview, onClose }) => (
  <section aria-label="Preview kế hoạch vật tư" className="rounded-2xl border border-blue-200 bg-blue-50/40 shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-blue-100 px-4 py-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900"><Eye size={16} className="text-blue-600" /> Preview kế hoạch</h3>
        <p className="mt-1 text-[10px] font-bold text-slate-500">Nhóm theo đúng mã vật tư và đơn vị; allocation nguồn BOQ được giữ nguyên.</p>
      </div>
      <button type="button" aria-label="Đóng preview" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white"><X size={16} /></button>
    </div>
    <div className="space-y-3 p-4">
      {preview.groups.map(group => (
        <article key={group.key} className="rounded-xl border border-white bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-xs font-black text-slate-800">{group.itemName}</div>
              <div className="text-[10px] font-bold text-slate-400">{group.sku || group.itemId}</div>
            </div>
            <div className="text-sm font-black text-blue-700">{group.totalQty} {group.unit}</div>
          </div>
          <div className="mt-3 space-y-1.5">
            {group.allocations.map(allocation => (
              <div key={allocation.sourceBudgetLineId} className="grid gap-1 rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-600 sm:grid-cols-[1fr_auto_auto]">
                <span className="font-bold">BOQ {allocation.sourceBudgetLineId}</span>
                <span>{allocation.quantity} {group.unit}</span>
                <span>{allocation.neededDate} · {allocation.destination}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
      <div className="rounded-xl border border-dashed border-blue-300 bg-white px-4 py-3 text-center text-xs font-black text-blue-800">
        Chưa lưu kế hoạch / chưa tạo MR
      </div>
    </div>
  </section>
);
