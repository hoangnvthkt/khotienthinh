import React from 'react';
import { AlertTriangle, Clock3, RefreshCw, Users, Wrench } from 'lucide-react';
import type { DailyLogContribution, DailyLogSummarySource, DailyLogWorkItem } from '../../../types';
import { DailyLogSourceDiff } from './DailyLogSourceDiff';

export interface SummaryResourceLine {
  id?: string;
  dailyLogWorkItemId?: string;
  contributionId?: string;
  summarySourceId?: string;
  kind: 'labor' | 'machine';
  label: string;
  count: number;
  totalHours: number;
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
  mode: 'summarize' | 'review';
  canRequestChange?: boolean;
  onProgressChange?: (itemId: string, value: number) => void;
  onRefresh?: (sourceId: string) => void;
  onRemove?: (sourceId: string) => void;
  onRequestChange?: (sourceId: string, comment: string) => void;
}

const STATE_LABELS: Record<string, string> = {
  current: 'Hiện hành', changed: 'Nguồn đã thay đổi', returned: 'Đã trả lại', missing: 'Không còn nguồn',
};

export const DailyLogAreaCard: React.FC<DailyLogAreaCardProps> = ({
  card, mode, canRequestChange = false, onProgressChange, onRefresh, onRemove, onRequestChange,
}) => {
  const [comment, setComment] = React.useState('');
  const people = card.resources.filter(row => row.kind === 'labor').reduce((sum, row) => sum + row.count, 0);
  const machineHours = card.resources.filter(row => row.kind === 'machine').reduce((sum, row) => sum + row.totalHours, 0);
  const sourceState = card.source.sourceState || 'current';
  return <article data-testid="daily-log-area-card" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div className="border-b border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-slate-900 dark:text-slate-100">{card.source.workAreaName || card.contribution.workAreaName || 'Khu vực chưa đặt tên'}</h3>
          <p className="mt-1 text-xs font-medium text-slate-500">{card.source.sourceUserName || card.contribution.authorName || 'Không rõ người lập'}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${sourceState === 'current' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{STATE_LABELS[sourceState]}</span>
          {card.source.hasAdjustments && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">Đã điều chỉnh</span>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span>{card.editedItems.length} WBS</span><span className="flex items-center gap-1"><Users size={13} /> {people} người</span><span className="flex items-center gap-1"><Wrench size={13} /> {machineHours.toLocaleString('vi-VN')} giờ máy</span>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><Clock3 size={11} /> {card.source.updatedAt || card.contribution.updatedAt || card.contribution.createdAt}</p>
    </div>
    <details className="group" open>
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold text-teal-700 lg:hidden">Xem nội dung khu vực</summary>
      <div className="space-y-4 p-4 pt-2 lg:pt-4">
        {(sourceState === 'missing' || sourceState === 'returned') && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><AlertTriangle size={15} className="shrink-0" /> Snapshot vẫn được giữ để truy vết, nhưng phải bỏ card hoặc chờ nguồn hợp lệ trước khi gửi.</div>}
        <div className="space-y-2">{card.editedItems.map(item => <div key={item.id || item.sourceWorkItemId} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_8rem] dark:bg-slate-800/70">
          <div><div className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.wbsCode} {item.taskName}</div><div className="mt-1 text-xs text-slate-500">{item.unit || 'Chưa có đơn vị'} · {item.dailyQuantityDone == null ? 'Chưa xác định khối lượng ngày' : `${item.dailyQuantityDone.toLocaleString('vi-VN')} ${item.unit || ''} hôm nay`}</div></div>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">% lũy kế<input aria-label={`% lũy kế ${item.wbsCode || item.taskName}`} type="number" value={item.cumulativeProgressPercent} disabled={mode === 'review'} onChange={event => onProgressChange?.(item.id || item.sourceWorkItemId || '', Number(event.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-2 font-bold disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950" /></label>
        </div>)}</div>
        {card.resources.length > 0 && <div className="space-y-2"><h4 className="text-xs font-black uppercase text-slate-500">Nguồn lực vật lý</h4>{card.resources.map((line, index) => <div key={line.id || `${line.kind}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"><span className="font-bold text-slate-800 dark:text-slate-100">{line.label}</span><span>{line.count.toLocaleString('vi-VN')} {line.kind === 'labor' ? 'người' : 'máy'}</span><span>{line.totalHours.toLocaleString('vi-VN')} giờ</span><span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-800">{line.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'}</span><span className="text-slate-500">{line.providerType}</span><span className="font-semibold text-teal-700 dark:text-teal-300">{line.providerName}</span></div>)}</div>}
        {card.source.hasAdjustments && <DailyLogSourceDiff sourceItems={card.sourceItems} editedItems={card.editedItems} sourceResources={card.sourceResources} editedResources={card.resources} />}
        <div className="flex flex-wrap justify-end gap-2">
          {mode === 'summarize' && sourceState === 'changed' && <button type="button" onClick={() => onRefresh?.(card.source.id || '')} className="flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-800"><RefreshCw size={13} /> Cập nhật từ phiếu</button>}
          {mode === 'summarize' && <button type="button" onClick={() => onRemove?.(card.source.id || '')} className="h-9 rounded-lg px-3 text-xs font-bold text-red-600 hover:bg-red-50">Bỏ card</button>}
        </div>
        {mode === 'review' && canRequestChange && <div className="flex flex-col gap-2 sm:flex-row"><input aria-label={`Nhận xét ${card.source.workAreaName || ''}`} value={comment} onChange={event => setComment(event.target.value)} placeholder="Nhận xét bắt buộc khi yêu cầu sửa" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /><button type="button" disabled={!comment.trim()} onClick={() => onRequestChange?.(card.source.id || '', comment.trim())} className="h-10 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-800 disabled:opacity-50">Yêu cầu sửa khu vực</button></div>}
      </div>
    </details>
  </article>;
};
