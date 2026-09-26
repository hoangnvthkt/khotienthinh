import React from 'react';
import type { AggregatedDailyLogWorkItem, DailyLogWbsDecision, DailyLogWorkItem } from '../../../types';

export interface ConsolidatedTaskGroup {
  aggregate: AggregatedDailyLogWorkItem;
  items: DailyLogWorkItem[];
}

export const hasUnresolvedWbsDecision = (aggregate: AggregatedDailyLogWorkItem, decision?: DailyLogWbsDecision) =>
  (aggregate.conflicts.some(code => code !== 'forecast_mismatch')
    && (decision?.officialCumulativePercent == null || !decision.dailyQuantityMethod || !decision.resolutionReason?.trim()))
  || (aggregate.conflicts.includes('forecast_mismatch')
    && (!decision?.forecastFinishDate || !decision.forecastResolutionReason?.trim()));

interface Props {
  groups: ConsolidatedTaskGroup[];
  decisions: Record<string, DailyLogWbsDecision>;
  readOnly?: boolean;
  onDecisionChange(taskId: string, patch: Partial<DailyLogWbsDecision>): void;
}

export const DailyLogConsolidatedWbsTable: React.FC<Props> = ({ groups, decisions, readOnly, onDecisionChange }) => <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
  <div className="mb-3"><h2 className="font-black text-slate-900 dark:text-slate-100">Tiến độ WBS chính thức</h2><p className="mt-1 text-xs text-slate-500">Chốt một giá trị cho mỗi WBS trước khi gửi CHT.</p></div>
  <div className="space-y-3">{groups.map(({ aggregate, items }) => {
    const decision = decisions[aggregate.taskId];
    const ambiguous = aggregate.conflicts.length > 0;
    const unresolved = hasUnresolvedWbsDecision(aggregate, decision);
    return <article key={aggregate.taskId} className={`rounded-xl border p-3 ${ambiguous ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/10' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{items[0]?.wbsCode} {items[0]?.taskName}</h3><p className="mt-1 text-xs text-slate-500">{items.length} khu vực nguồn</p></div>{ambiguous && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{unresolved ? 'Cần quyết định' : 'Đã chốt quyết định'}</span>}</div>
      <div className="mt-3 space-y-1">{items.map(item => <div key={item.id} className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-600">{item.workAreaName}</span><span className="shrink-0 font-bold">{item.cumulativeProgressPercent}%</span></div>)}</div>
      {ambiguous ? <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-semibold">Cách xử lý<select disabled={readOnly} value={decision?.dailyQuantityMethod || ''} onChange={event => onDecisionChange(aggregate.taskId, { dailyQuantityMethod: event.target.value as DailyLogWbsDecision['dailyQuantityMethod'], aggregationMethod: event.target.value === 'manual_override' ? 'manual_override' : 'single_source' })} className="h-10 rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><option value="">Chọn cách xử lý</option><option value="sum_non_overlapping">Cộng các phạm vi không trùng</option><option value="keep_selected_sources">Chỉ giữ nguồn đã chọn</option><option value="manual_override">Nhập giá trị chính thức</option></select></label>
        <label className="grid gap-1 text-xs font-semibold">Nhập % lũy kế chính thức<input aria-label={`% chính thức ${items[0]?.wbsCode || aggregate.taskId}`} type="number" disabled={readOnly} value={decision?.officialCumulativePercent ?? ''} onChange={event => onDecisionChange(aggregate.taskId, { officialCumulativePercent: event.target.value === '' ? (null as any) : Number(event.target.value) })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label>
        <label className="grid gap-1 text-xs font-semibold">Lý do quyết định<input disabled={readOnly} value={decision?.resolutionReason || ''} onChange={event => onDecisionChange(aggregate.taskId, { resolutionReason: event.target.value })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label>
      </div> : <p className="mt-3 text-xs font-bold text-emerald-700">Lũy kế chính thức: {decision?.officialCumulativePercent ?? aggregate.officialCumulativePercent}%</p>}
      {ambiguous && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">Khối lượng lũy kế chính thức<input type="number" min="0" step="any" disabled={readOnly} placeholder="Chưa xác định" value={decision?.officialCumulativeQuantity ?? ''} onChange={event => onDecisionChange(aggregate.taskId, { officialCumulativeQuantity: event.target.value === '' ? null : Number(event.target.value) })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label>
        <label className="grid gap-1 text-xs font-semibold">Khối lượng trong ngày chính thức<input type="number" min="0" step="any" disabled={readOnly} placeholder="Chưa xác định" value={decision?.officialDailyQuantity ?? ''} onChange={event => onDecisionChange(aggregate.taskId, { officialDailyQuantity: event.target.value === '' ? null : Number(event.target.value) })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label>
        <p className="text-xs font-normal text-slate-500 sm:col-span-2">Đơn vị: {items[0]?.unit || 'chưa xác định'}. Để trống khi chưa đủ căn cứ; không tự cộng khối lượng các khu vực chồng lấn.</p>
      </div>}
      {aggregate.conflicts.includes('forecast_mismatch') && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">Ngày hoàn thành chính thức<input type="date" disabled={readOnly} value={decision?.forecastFinishDate || ''} onChange={event => onDecisionChange(aggregate.taskId, { forecastFinishDate: event.target.value })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label><label className="grid gap-1 text-xs font-semibold">Lý do chốt dự kiến<input disabled={readOnly} value={decision?.forecastResolutionReason || ''} onChange={event => onDecisionChange(aggregate.taskId, { forecastResolutionReason: event.target.value })} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label></div>}
    </article>;
  })}</div>
</section>;
