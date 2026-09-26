import React from 'react';
import type { DailyLogWorkItem } from '../../../types';
import type { SummaryResourceLine } from './DailyLogAreaCard';

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
    if (!source) return [];
    const prefix = item.wbsCode || item.taskName;
    const rows: Array<{ label: string; before: unknown; after: unknown }> = [];
    if (source.cumulativeProgressPercent !== item.cumulativeProgressPercent) rows.push({
      label: `${prefix} - % lũy kế`, before: source.cumulativeProgressPercent, after: item.cumulativeProgressPercent,
    });
    if ((source.forecastFinishDate || '') !== (item.forecastFinishDate || '')) rows.push({
      label: `${prefix} - dự kiến hoàn thành`, before: source.forecastFinishDate, after: item.forecastFinishDate,
    });
    return rows;
  });
  const sourceResourceById = new Map(sourceResources.map(line => [line.id, line]));
  const resourceChanges = editedResources.flatMap(line => {
    const sourceId = line.raw.sourceLaborLineId || line.raw.sourceMachineLineId || line.id;
    const source = sourceResourceById.get(sourceId);
    if (!source) return [];
    const before = `${source.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'} · ${source.providerType} · ${source.providerName}`;
    const after = `${line.providerEntryMode === 'catalog' ? 'Danh mục' : 'Nhập tay'} · ${line.providerType} · ${line.providerName}`;
    if (before === after) return [];
    return [{ label: `${line.label} - nguồn cung cấp`, before, after }];
  });
  const changes = [...itemChanges, ...resourceChanges];

  if (changes.length === 0) return <p className="text-xs text-slate-500">Không có thay đổi số liệu so với phiếu nguồn.</p>;
  return <div className="space-y-2" aria-label="Thay đổi so với phiếu nguồn">
    {changes.map(change => <div key={change.label} className="grid gap-1 rounded-lg bg-amber-50 px-3 py-2 text-xs sm:grid-cols-[1fr_auto_auto] dark:bg-amber-950/20">
      <span className="font-semibold text-slate-700 dark:text-slate-200">{change.label}</span>
      <span className="text-slate-500 line-through">{format(change.before)}</span>
      <span className="font-bold text-amber-800 dark:text-amber-200">{format(change.after)}</span>
    </div>)}
  </div>;
};
