import React from 'react';
import type { ProcurementV2Filter } from '../../types/procurementV2';

const inputClass = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

export const ProcurementV2Filters: React.FC<{
  filter: ProcurementV2Filter;
  projects: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<ProcurementV2Filter>) => void;
}> = ({ filter, projects, onChange }) => <section aria-label="Bộ lọc hồ sơ" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(280px,1.4fr)]">
  <label className="block sm:col-span-2 xl:col-span-1"><span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Tìm hồ sơ</span><input className={inputClass} value={filter.search || ''} onChange={event => onChange({ search: event.target.value || undefined })} placeholder="Mã hồ sơ, dự án…" /></label>
  <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Dự án</span><select className={inputClass} value={filter.projectId || ''} onChange={event => onChange({ projectId: event.target.value || undefined })}><option value="">Tất cả dự án</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
  <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Nguồn nhu cầu</span><select className={inputClass} value={filter.source || ''} onChange={event => onChange({ source: event.target.value as ProcurementV2Filter['source'] || undefined })}><option value="">Mọi nguồn</option><option value="material_plan">Kế hoạch vật tư</option><option value="project_material_request">Đề xuất vật tư</option></select></label>
  <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Trạng thái</span><select className={inputClass} value={filter.stage || ''} onChange={event => onChange({ stage: event.target.value as ProcurementV2Filter['stage'] || undefined })}><option value="">Mọi trạng thái</option><option value="plan_supply">Cần bố trí nguồn</option><option value="reconcile">Cần đối chiếu</option><option value="monitor_fulfillment">Theo dõi thực hiện</option><option value="withdrawn">Đã rút nhu cầu</option></select></label>
  <fieldset className="min-w-0"><legend className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Ngày cần</legend><div className="flex min-w-0 gap-2"><input aria-label="Từ ngày cần" type="date" className={inputClass} value={filter.neededFrom || ''} onChange={event => onChange({ neededFrom: event.target.value || undefined })} /><input aria-label="Đến ngày cần" type="date" className={inputClass} value={filter.neededTo || ''} onChange={event => onChange({ neededTo: event.target.value || undefined })} /></div></fieldset>
</section>;
