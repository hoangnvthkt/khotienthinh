import React from 'react';
import type { DailyLogWorkItem } from '../../../types';
import type { SummaryResourceLine } from './DailyLogAreaCard';
import { formatDailyLogDate } from '../../../lib/dailyLogPresentation';

interface DailyLogSourceDiffProps {
  sourceItems: DailyLogWorkItem[];
  editedItems: DailyLogWorkItem[];
  sourceResources?: SummaryResourceLine[];
  editedResources?: SummaryResourceLine[];
}

const format = (value: unknown) => value == null || value === '' ? 'Chưa có' : String(value);

export const DailyLogSourceDiff: React.FC<DailyLogSourceDiffProps> = ({ sourceItems, editedItems, sourceResources = [], editedResources = [] }) => {
  const sourceById = new Map(sourceItems.map(item => [item.id, item]));
  const itemChanges = editedItems.flatMap(item => {
    const source = sourceById.get(item.sourceWorkItemId || item.id);
    if (!source) return [{label:`${item.wbsCode || item.taskName} - hạng mục`,before:'Chưa có trong nguồn',after:'Đã thêm vào bản sao'}];
    const prefix = item.wbsCode || item.taskName;
    const rows: Array<{ label: string; before: unknown; after: unknown }> = [];
    if (source.cumulativeProgressPercent !== item.cumulativeProgressPercent) rows.push({
      label: `${prefix} - % lũy kế`, before: source.cumulativeProgressPercent, after: item.cumulativeProgressPercent,
    });
    if ((source.forecastFinishDate || '') !== (item.forecastFinishDate || '')) rows.push({
      label: `${prefix} - dự kiến hoàn thành`, before: formatDailyLogDate(source.forecastFinishDate || ''), after: formatDailyLogDate(item.forecastFinishDate || ''),
    });
    if (source.cumulativeQuantityDone !== item.cumulativeQuantityDone) rows.push({label:`${prefix} - khối lượng lũy kế`,before:source.cumulativeQuantityDone,after:item.cumulativeQuantityDone});
    if (source.dailyQuantityDone !== item.dailyQuantityDone) rows.push({label:`${prefix} - khối lượng hôm nay`,before:source.dailyQuantityDone,after:item.dailyQuantityDone});
    if ((source.note || '') !== (item.note || '')) rows.push({label:`${prefix} - ghi chú`,before:source.note,after:item.note});
    if (JSON.stringify(source.attachments || []) !== JSON.stringify(item.attachments || [])) rows.push({label:`${prefix} - ảnh`,before:source.attachments?.map(photo=>photo.name).join(', ') || 'Chưa có',after:item.attachments?.map(photo=>photo.name).join(', ') || 'Đã bỏ'});
    return rows;
  });
  const sourceResourceById = new Map(sourceResources.map(line => [line.id, line]));
  const resourceChanges = editedResources.flatMap(line => {
    const sourceId = line.raw.sourceLaborLineId || line.raw.sourceMachineLineId || line.id;
    const source = sourceResourceById.get(sourceId);
    if (!source) return [{label:`${line.label} - nguồn lực`,before:'Chưa có',after:'Đã thêm vào bản sao'}];
    const before = `${source.count ?? 'Chưa xác định'} ${source.kind==='labor'?'người':'máy'} · ${source.totalHours ?? 'Chưa xác định'} giờ · ${source.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'} · ${source.providerType} · ${source.providerName}`;
    const after = `${line.count ?? 'Chưa xác định'} ${line.kind==='labor'?'người':'máy'} · ${line.totalHours ?? 'Chưa xác định'} giờ · ${line.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'} · ${line.providerType} · ${line.providerName}`;
    if (before === after) return [];
    return [{ label: `${line.label} - nguồn cung cấp`, before, after }];
  });
  const copiedIds=new Set(editedItems.map(item=>item.sourceWorkItemId || item.id));
  const copiedResourceIds=new Set(editedResources.map(line=>line.raw.sourceLaborLineId || line.raw.sourceMachineLineId || line.id));
  const removedItems=sourceItems.filter(item=>!copiedIds.has(item.id)).map(item=>({label:`${item.wbsCode || item.taskName} - hạng mục`,before:'Có trong nguồn',after:'Đã bỏ khỏi bản sao'}));
  const removedResources=sourceResources.filter(line=>!copiedResourceIds.has(line.id)).map(line=>({label:`${line.label} - nguồn lực`,before:`${line.count ?? 'Chưa xác định'} · ${line.totalHours ?? 'Chưa xác định'} giờ · ${line.providerName}`,after:'Đã bỏ khỏi bản sao'}));
  const changes = [...itemChanges, ...resourceChanges,...removedItems,...removedResources];

  if (changes.length === 0) return <p className="text-xs text-slate-500">Không có thay đổi số liệu so với phiếu nguồn.</p>;
  return <div className="space-y-2" aria-label="Thay đổi so với phiếu nguồn">
    <p className="text-sm text-muted-foreground">Phiếu nguồn → Bản sao đang giữ</p>
    {changes.map((change,index) => <div key={`${change.label}-${index}`} className="grid gap-1 rounded-md bg-amber-50 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto] dark:bg-amber-950/20">
      <span className="font-semibold text-slate-700 dark:text-slate-200">{change.label}</span>
      <span className="text-slate-500 line-through">{format(change.before)}</span>
      <span className="font-bold text-amber-800 dark:text-amber-200">{format(change.after)}</span>
    </div>)}
  </div>;
};
