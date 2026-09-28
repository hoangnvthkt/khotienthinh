import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { DailyLogContribution, DailyLogSummarySource, DailyLogWorkItem, DailyLogPhoto } from '../../../types';
import { formatDailyLogQuantity, formatDailyLogTime, formatDailyLogDate } from '../../../lib/dailyLogPresentation';
import { DailyLogSourceDiff } from './DailyLogSourceDiff';
import { DailyLogWorkItemReadTable } from './DailyLogWorkItemReadTable';

export interface SummaryResourceLine {
  id?: string;
  dailyLogWorkItemId?: string;
  contributionId?: string;
  summarySourceId?: string;
  kind: 'labor' | 'machine';
  label: string;
  count: number | null;
  totalHours: number | null;
  providerEntryMode: 'catalog' | 'manual';
  providerName: string;
  providerType: string;
  raw: any;
}

export interface DailyLogAreaCardModel {
  contribution: DailyLogContribution;
  source: DailyLogSummarySource;
  sourceItems: DailyLogWorkItem[];
  editedItems: DailyLogWorkItem[];
  sourceResources: SummaryResourceLine[];
  resources: SummaryResourceLine[];
}

interface DailyLogAreaCardProps {
  card: DailyLogAreaCardModel;
  mode: 'summarize' | 'review' | 'verified';
  busy?: boolean;
  canRequestChange?: boolean;
  returnDisabledReason?: string;
  onProgressChange?: (sourceId: string, itemId: string, value: number, reason: string) => void;
  onRefresh?: (sourceId: string) => void;
  onRemove?: (sourceId: string) => void;
  onRequestChange?: (sourceId: string, comment: string) => void | Promise<void>;
}

const STATE_LABELS = { current: 'Nguồn khớp phiên bản', changed: 'Có phiếu gửi lại', returned: 'Đã trả lại', missing: 'Không còn nguồn' };
const REVIEW_LABELS = { draft: 'Chưa rà soát', ready: 'Sẵn sàng tổng hợp', change_requested: 'Cần sửa theo nhận xét', accepted: 'Đã rà soát', superseded: 'Đã thay thế' };
const fieldClass = 'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base sm:text-sm disabled:opacity-50';
const hasComparableDates = (item: DailyLogWorkItem) => [item.scheduleFinishDate,item.forecastFinishDate].every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && formatDailyLogDate(value) !== 'Chưa xác định');
export const hasAreaForecastDelay = (items: DailyLogWorkItem[]) => items.some(item => hasComparableDates(item) && item.forecastFinishDate! > item.scheduleFinishDate!);

export const DailyLogAreaCard: React.FC<DailyLogAreaCardProps> = ({ card, mode, busy, canRequestChange = false, returnDisabledReason, onProgressChange, onRefresh, onRemove, onRequestChange }) => {
  const [comment, setComment] = React.useState('');
  const [reason, setReason] = React.useState(card.source.adjustmentReason || '');
  const state = card.source.sourceState || 'current';
  const blocked = mode !== 'verified' && (state !== 'current' || card.source.reviewStatus === 'change_requested');
  const [open, setOpen] = React.useState(blocked);
  React.useEffect(()=>{if(blocked)setOpen(true);},[blocked,state,card.source.reviewStatus]);
  // Never display newer source metadata as if it belonged to the saved copy.
  const snapshot = card.source.sourceSnapshot;
  const sourceTime = snapshot?.updatedAt || (mode !== 'verified' ? card.contribution.submittedAt || card.contribution.createdAt : null);
  const metadata = snapshot && Object.hasOwn(snapshot, 'content') ? snapshot : mode !== 'verified' && state === 'current' ? card.contribution : null;
  const photos = (metadata?.photos || []) as DailyLogPhoto[];
  const sourceId = card.source.id || '';
  const report = mode !== 'summarize';
  const labor = card.resources.filter(line => line.kind === 'labor');
  const machines = card.resources.filter(line => line.kind === 'machine');
  const laborHours = labor.length && labor.every(line => line.totalHours != null) ? labor.reduce((sum, line) => sum + line.totalHours!, 0) : null;
  const machineHours = machines.length && machines.every(line => line.totalHours != null) ? machines.reduce((sum, line) => sum + line.totalHours!, 0) : null;
  const laborEntries = labor.length && labor.every(line => line.count != null) ? labor.reduce((sum, line) => sum + line.count!, 0) : null;
  const datedItems = card.editedItems.filter(hasComparableDates);
  const delayLabel = hasAreaForecastDelay(card.editedItems)
    ? 'Có hạng mục dự kiến trễ theo ngày kế hoạch'
    : card.editedItems.length > 0 && datedItems.length === card.editedItems.length
      ? 'Chưa thấy trễ theo ngày kế hoạch' : 'Chưa đủ căn cứ đánh giá tiến độ mũi';
  return <article data-testid="daily-log-area-card" className="min-w-0 rounded-md border border-border bg-card text-sm text-foreground">
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 break-words"><h3 className="text-base font-semibold">{card.source.workAreaName || card.contribution.workAreaName || 'Chưa xác định khu vực'}</h3><p className="mt-1 text-muted-foreground">{card.source.sourceUserName || card.contribution.authorName || 'Chưa xác định người lập'}</p></div>
        <span className={`rounded px-2 py-1 text-xs ${blocked ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100' : 'bg-muted text-muted-foreground'}`}>{REVIEW_LABELS[card.source.reviewStatus || 'ready']}</span>
      </div>
      {report ? <>
        <p className="dl-area-delay text-xs">{delayLabel}</p>
        <dl className="dl-area-resource-strip grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div><dt>Nhân công theo hạng mục</dt><dd>{formatDailyLogQuantity(laborEntries, 'lượt người')}</dd></div>
          <div><dt>Giờ công</dt><dd>{formatDailyLogQuantity(laborHours, 'giờ công')}</dd></div>
          <div><dt>Giờ máy</dt><dd>{formatDailyLogQuantity(machineHours, 'giờ máy')}</dd></div>
        </dl>
        <div className="dl-area-work-highlights space-y-2"><p className="text-xs font-semibold">Khối lượng theo hạng mục</p>
          {card.editedItems.length ? card.editedItems.map(item => <div key={item.id || item.sourceWorkItemId} className="flex flex-wrap items-baseline justify-between gap-1 border-b border-border/60 pb-2 last:border-0 last:pb-0"><span>{item.wbsCode} {item.taskName}</span><strong className="tabular-nums">{formatDailyLogQuantity(item.dailyQuantityDone, item.unit)} hôm nay · {formatDailyLogQuantity(item.cumulativeProgressPercent, '%')} lũy kế</strong></div>) : <p className="text-muted-foreground">Chưa có hạng mục được lưu.</p>}
        </div>
      </> : <p className="text-muted-foreground">{new Set(card.editedItems.map(item => item.taskId)).size} hạng mục · Phiếu nguồn v{card.source.sourceVersion ?? '—'} · {formatDailyLogTime(sourceTime ? String(sourceTime) : '')}</p>}
      {card.source.hasAdjustments && <p className="text-teal-800 dark:text-teal-200">Đã điều chỉnh bản sao · {card.source.adjustmentReason || 'Chưa có lý do'}</p>}
      {card.source.reviewComment && <div className={`rounded border p-3 ${card.source.reviewStatus === 'change_requested' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100' : 'border-border bg-muted/30'}`}><p className="font-medium">{card.source.reviewStatus === 'change_requested' ? 'Nhận xét đã lưu' : 'Nhận xét trước đó'}</p><p className="mt-1 whitespace-pre-wrap break-words">{card.source.reviewComment}</p></div>}
    </div>
    <details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="border-t border-border">
      <summary className="min-h-11 cursor-pointer px-4 py-3 font-medium text-teal-800 dark:text-teal-200">Xem công việc, nguồn lực và ảnh</summary>
      <div className="space-y-4 p-4 pt-0">
        <p className="text-xs text-muted-foreground">{STATE_LABELS[state]} · {card.source.hasAdjustments ? 'Đang xem bản sao đã chỉnh' : 'Đang xem bản sao để tổng hợp'}</p>
        {state !== 'current' && mode !== 'verified' && <p className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{state === 'changed' ? 'Giữ nguyên bản sao đã lưu. Xem thay đổi trước khi cập nhật; cập nhật sẽ thay chỉnh sửa bằng phiếu gửi lại.' : 'Bản sao được giữ để truy vết. Bỏ khỏi bản tổng hợp hoặc chờ kỹ sư sửa và gửi lại trước khi gửi CHT.'}</p>}
        {mode !== 'summarize' ? <DailyLogWorkItemReadTable items={card.editedItems} resources={card.resources} mode={mode}/> : card.editedItems.map(item => <section key={item.id || item.sourceWorkItemId} data-work-item-id={item.sourceWorkItemId || item.id} className="space-y-3 border-b border-border pb-4 last:border-0">
          <h4 className="font-semibold">{item.wbsCode} {item.taskName}</h4>
          <dl className="grid grid-cols-2 gap-3 tabular-nums sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">Khối lượng hôm nay</dt><dd className="mt-1">{formatDailyLogQuantity(item.dailyQuantityDone, item.unit)}</dd></div><div><dt className="text-xs text-muted-foreground">Lũy kế</dt><dd className="mt-1">{formatDailyLogQuantity(item.cumulativeQuantityDone, item.unit)}</dd></div><div><dt className="text-xs text-muted-foreground">% lũy kế</dt><dd className="mt-1">{formatDailyLogQuantity(item.cumulativeProgressPercent, '%')}</dd></div></dl>
          {card.resources.filter(line => line.dailyLogWorkItemId === item.id || line.dailyLogWorkItemId === item.sourceWorkItemId).map((line, index) => <div key={line.id || index} data-resource-kind={line.kind} className="rounded border border-border p-3">
            <p className="font-medium">{line.label} · {formatDailyLogQuantity(line.count, line.kind === 'labor' ? 'người' : 'máy')} · {formatDailyLogQuantity(line.totalHours, 'giờ')}</p>
            <p className="mt-1 break-words">{line.providerName}</p><p className="mt-1 text-xs text-muted-foreground">{line.providerType} · {line.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'}</p>
          </div>)}
          {item.forecastFinishDate && <p>Dự kiến hoàn thành: {formatDailyLogDate(item.forecastFinishDate)}{item.forecastChangeReason && ` · ${item.forecastChangeReason}`}</p>}
          {item.note && <p className="whitespace-pre-wrap break-words">{item.note}</p>}
          {item.attachments?.length ? <div className="flex flex-wrap gap-3">{item.attachments.map(photo => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="break-words text-teal-800 underline dark:text-teal-200">{photo.name || 'Ảnh hạng mục'}</a>)}</div> : null}
        </section>)}
        {metadata ? <section className="space-y-2"><h4 className="font-medium">Ghi nhận theo phiếu</h4><p className="whitespace-pre-wrap break-words">{String(metadata.content || 'Chưa ghi nội dung')}</p>{metadata.issues && <p className="whitespace-pre-wrap break-words">Sự cố / vướng mắc: {String(metadata.issues)}</p>}{photos.length > 0 && <div className="flex flex-wrap gap-3">{photos.map((photo,index) => <a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" className="text-teal-800 underline dark:text-teal-200">{photo.name || 'Ảnh phiếu'}</a>)}</div>}</section> : <p className="text-muted-foreground">Chưa có nội dung phiên bản đã lưu; không lấy nội dung mới thay cho bản sao cũ.</p>}
        {mode !== 'verified' && (state === 'changed' || card.source.hasAdjustments) && <details><summary className="cursor-pointer py-2 font-medium">Xem thay đổi so với phiếu nguồn{state === 'changed' ? ' mới nhất' : ''}</summary><DailyLogSourceDiff sourceItems={card.sourceItems} editedItems={card.editedItems} sourceResources={card.sourceResources} editedResources={card.resources} />{state==='changed' && <section className="mt-3 space-y-2 rounded-md border border-border p-3"><h4 className="font-medium">Ghi nhận trong phiếu gửi lại · v{card.contribution.rowVersion ?? '—'}</h4><p className="whitespace-pre-wrap break-words">{card.contribution.content || 'Chưa ghi nội dung'}</p>{card.contribution.issues && <p className="whitespace-pre-wrap break-words">Sự cố / vướng mắc: {card.contribution.issues}</p>}<div className="flex flex-wrap gap-3">{card.contribution.photos?.map((photo,index)=><a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" className="break-words text-teal-800 underline dark:text-teal-200">{photo.name || 'Ảnh gửi lại'}</a>)}</div><p className="text-xs text-muted-foreground">Chỉ để so sánh. Bản sao phía trên chưa bị thay thế.</p></section>}</details>}
        {mode === 'summarize' && state === 'current' && onProgressChange && <details><summary className="cursor-pointer py-2 font-medium text-teal-800 dark:text-teal-200">Chỉnh số liệu trên bản sao</summary><div className="space-y-3 pt-2"><p className="text-muted-foreground">Không sửa phiếu gốc. Nhập lý do trước khi điều chỉnh; khối lượng chỉ quy đổi khi đủ cơ sở.</p><label className="block">Lý do chỉnh bản sao<input aria-label={`Lý do chỉnh ${card.source.workAreaName}`} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className={fieldClass} /></label>{card.editedItems.map(item => <label key={item.id} className="block">% lũy kế {item.wbsCode} {item.taskName}<input aria-label={`% lũy kế ${item.wbsCode || item.taskName}`} type="number" min={item.baselineProgressPercent} max="100" step="any" value={Number.isFinite(item.cumulativeProgressPercent) ? item.cumulativeProgressPercent : ''} disabled={busy || !reason.trim()} onChange={event => onProgressChange(sourceId, item.id || item.sourceWorkItemId || '', event.target.value === '' ? Number.NaN : Number(event.target.value), reason)} className={fieldClass} /></label>)}</div></details>}
        {mode === 'summarize' && <div className="flex flex-wrap gap-2">{state === 'changed' && <button type="button" disabled={busy} onClick={() => onRefresh?.(sourceId)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3"><RefreshCw size={16} />Cập nhật từ phiếu</button>}<button type="button" disabled={busy} onClick={() => onRemove?.(sourceId)} className="min-h-11 rounded-md border border-border px-3">Bỏ khỏi bản tổng hợp</button></div>}
        {mode !== 'verified' && canRequestChange && onRequestChange && <details><summary className="cursor-pointer py-2 font-medium text-amber-900 dark:text-amber-100">{mode === 'summarize' ? 'Trả phiếu cho kỹ sư' : 'Trả phiếu sửa'}</summary><div className="space-y-2 pt-2">{returnDisabledReason && <p className="text-muted-foreground">{returnDisabledReason}</p>}<label className="block">Lý do trả phiếu<textarea aria-label={`Nhận xét ${card.source.workAreaName || ''}`} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} className={`${fieldClass} py-2`} /></label><button type="button" disabled={busy || !comment.trim() || Boolean(returnDisabledReason)} onClick={() => onRequestChange(sourceId, comment.trim())} className="dl-return-source min-h-11 rounded-md border border-amber-300 px-3 text-amber-900 disabled:opacity-50 dark:text-amber-100">{mode === 'summarize' ? 'Trả phiếu cho kỹ sư' : 'Trả phiếu sửa'}</button></div></details>}
      </div>
    </details>
  </article>;
};
