import React from 'react';
import type { AggregatedDailyLogWorkItem, DailyLogWbsDecisionDraft, DailyLogWorkItem } from '../../../types';
import { formatDailyLogDate, formatDailyLogQuantity } from '../../../lib/dailyLogPresentation';

export interface ConsolidatedTaskGroup {
  aggregate: AggregatedDailyLogWorkItem;
  items: DailyLogWorkItem[];
}

export const hasUnresolvedWbsDecision = (aggregate: AggregatedDailyLogWorkItem, decision?: DailyLogWbsDecisionDraft) =>
  !decision || decision.pending === true || decision.officialCumulativePercent == null || !Number.isFinite(decision.officialCumulativePercent)
  || decision.officialCumulativePercent < 0 || decision.officialCumulativePercent > 100
  || (decision.aggregationMethod === 'manual_override' && !decision.resolutionReason?.trim())
  || (aggregate.conflicts.some(code => code !== 'forecast_mismatch')
    && (decision?.officialCumulativePercent == null || !decision.dailyQuantityMethod || !decision.resolutionReason?.trim()))
  || (aggregate.conflicts.includes('forecast_mismatch')
    && (!decision?.forecastFinishDate || !decision.forecastResolutionReason?.trim()));

interface Props {
  groups: ConsolidatedTaskGroup[];
  decisions: Record<string, DailyLogWbsDecisionDraft>;
  readOnly?: boolean;
  historical?: boolean;
  busy?: boolean;
  onDecisionChange(taskId: string, patch: Partial<DailyLogWbsDecisionDraft>): void;
}

const fieldClass = 'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm';
export const DailyLogConsolidatedWbsTable: React.FC<Props> = ({ groups, decisions, readOnly, historical, busy, onDecisionChange }) => <section className="rounded-md border border-border bg-card p-4 text-sm">
  <h2 className="text-base font-semibold">Tiến độ theo hạng mục</h2>
  <p className="mt-1 text-muted-foreground">{readOnly ? 'Mỗi hạng mục một kết quả đã chốt; mở chi tiết để xem căn cứ.' : 'Chốt các mục còn vướng trước khi gửi CHT. Không cộng % giữa các phiếu.'}</p>
  {groups.length===0 && <p className="mt-4 text-muted-foreground">Chưa có công việc trong các phiếu được chọn.</p>}
  <div className="mt-4 space-y-3">{groups.map(({ aggregate, items }) => {
    const decision = decisions[aggregate.taskId];
    const unresolved = hasUnresolvedWbsDecision(aggregate, decision);
    const units=new Set(items.map(item=>item.unit?.trim()).filter(Boolean));
    const unit=units.size===1?items[0]?.unit:null;
    const number=(value:string)=>value===''?null:Number(value);
    const patch=(values:Partial<DailyLogWbsDecisionDraft>)=>onDecisionChange(aggregate.taskId,values);
    return <article key={aggregate.taskId} className={`rounded-md border p-4 ${unresolved?'border-amber-300 bg-amber-50 dark:bg-amber-950/20':'border-border bg-card'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{items[0]?.wbsCode} {items[0]?.taskName}</h3><p className="mt-1 text-xs text-muted-foreground">{items.length} mũi báo cáo</p></div>
        <span className={`rounded px-2 py-1 text-xs ${unresolved && !historical?'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100':'bg-muted text-muted-foreground'}`}>{historical && unresolved?'Thiếu căn cứ đã lưu':unresolved?'Cần quyết định':'Đã chốt số liệu'}</span></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">% hoàn thành (đã chốt)</dt><dd className="mt-1 font-medium">{formatDailyLogQuantity(decision?.officialCumulativePercent,'%')}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Khối lượng hôm nay</dt><dd className="mt-1 font-medium">{formatDailyLogQuantity(decision?.officialDailyQuantity,unit)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Khối lượng lũy kế</dt><dd className="mt-1 font-medium">{formatDailyLogQuantity(decision?.officialCumulativeQuantity,unit)}</dd></div>
      </dl>
      <details open={unresolved && !readOnly} className="mt-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">{historical?'Xem cách chốt':unresolved?'Cần xử lý trước khi gửi':'Xem cách chốt và lý do'}</summary>
        <div className="my-3 space-y-2">{items.map(item=><p key={item.id || item.sourceWorkItemId} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words text-muted-foreground">{item.workAreaName}</span><span className="tabular-nums">{formatDailyLogQuantity(item.cumulativeProgressPercent,'%')}</span></p>)}</div>
        {readOnly ? <dl className="space-y-3"><div><dt className="text-muted-foreground">Cách chốt</dt><dd>{!decision || decision.pending?'Chưa xác định căn cứ đã lưu':decision.aggregationMethod==='manual_override'?historical?'Chốt thủ công theo hồ sơ':'Nhập giá trị chính thức':decision.aggregationMethod==='single_source'?'Theo một phiếu':'Theo phân bổ các mũi'}</dd></div>
          <div><dt className="text-muted-foreground">Lý do</dt><dd className="whitespace-pre-wrap break-words">{decision?.resolutionReason || 'Không có điều chỉnh'}</dd></div>
          {decision?.forecastFinishDate && <div><dt className="text-muted-foreground">Dự kiến hoàn thành</dt><dd>{formatDailyLogDate(decision.forecastFinishDate)} · {decision.forecastResolutionReason || 'Theo phiếu kỹ sư'}</dd></div>}
        </dl> : <fieldset disabled={busy} className="min-w-0 space-y-3">
          {(aggregate.conflicts.length>0 || unresolved) && <><p className="text-muted-foreground">Kiểm tra phạm vi, đơn vị và nguồn trước khi chốt. Hai phiếu cùng 30% không tự thành 60%.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-2">Cách xử lý<select aria-label={`Cách xử lý ${items[0]?.wbsCode || aggregate.taskId}`} value={decision?.dailyQuantityMethod || ''} onChange={event=>patch({dailyQuantityMethod:event.target.value as DailyLogWbsDecisionDraft['dailyQuantityMethod'],aggregationMethod:event.target.value==='manual_override'?'manual_override':'single_source'})} className={fieldClass}><option value="">Chọn cách xử lý</option><option value="sum_non_overlapping">Cộng các phạm vi không trùng</option><option value="keep_selected_sources">Chỉ giữ nguồn đã chọn</option><option value="manual_override">Nhập giá trị chính thức</option></select></label>
              <label className="grid gap-2">Nhập % lũy kế chính thức<input aria-label={`% chính thức ${items[0]?.wbsCode || aggregate.taskId}`} type="number" min="0" max="100" step="any" value={decision?.officialCumulativePercent ?? ''} onChange={event=>patch({officialCumulativePercent:number(event.target.value)})} className={fieldClass} /></label>
              <label className="grid gap-2 sm:col-span-2">Lý do quyết định<textarea aria-label={`Lý do quyết định ${items[0]?.wbsCode || aggregate.taskId}`} value={decision?.resolutionReason || ''} onChange={event=>patch({resolutionReason:event.target.value})} className={`${fieldClass} py-2`} /></label>
              <label className="grid gap-2">Khối lượng lũy kế chính thức<input type="number" min="0" step="any" placeholder="Chưa xác định" value={decision?.officialCumulativeQuantity ?? ''} onChange={event=>patch({officialCumulativeQuantity:number(event.target.value)})} className={fieldClass} /></label>
              <label className="grid gap-2">Khối lượng trong ngày chính thức<input type="number" min="0" step="any" placeholder="Chưa xác định" value={decision?.officialDailyQuantity ?? ''} onChange={event=>patch({officialDailyQuantity:number(event.target.value)})} className={fieldClass} /></label>
            </div><p className="text-xs text-muted-foreground">Đơn vị: {unit || 'chưa xác định hoặc khác nhau'}. Để trống khi chưa đủ căn cứ; không tự cộng khối lượng các khu vực chồng lấn.</p>
          </>}
          {aggregate.conflicts.includes('forecast_mismatch') && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="grid gap-2">Ngày hoàn thành chính thức<input type="date" value={decision?.forecastFinishDate || ''} onChange={event=>patch({forecastFinishDate:event.target.value})} className={fieldClass} /></label><label className="grid gap-2">Lý do chốt dự kiến<input value={decision?.forecastResolutionReason || ''} onChange={event=>patch({forecastResolutionReason:event.target.value})} className={fieldClass} /></label></div>}
          {!unresolved && decision?.resolutionReason && <p className="whitespace-pre-wrap break-words">{decision.resolutionReason}</p>}
        </fieldset>}
      </details>
    </article>;
  })}</div>
</section>;
