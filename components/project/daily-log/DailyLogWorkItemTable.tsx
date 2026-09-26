import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, Users, Wrench } from 'lucide-react';
import type { DailyLogLaborInput, DailyLogMachineInput } from '../../../types';
import { deriveWorkItemProgress } from '../../../lib/dailyLogWorkItemRules';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';

export interface DailyLogWorkItemEditorRow {
  clientKey: string;
  taskId: string;
  wbsCode?: string | null;
  taskName: string;
  unit?: string | null;
  plannedQuantity: number | null;
  previousCumulativeQuantity: number | null;
  baselineProgressPercent: number;
  cumulativeProgressPercent: number;
  forecastFinishDate?: string | null;
}

interface DailyLogWorkItemTableProps {
  rows: DailyLogWorkItemEditorRow[];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
  invalidResourceWorkItemKeys?: ReadonlySet<string>;
  readOnly?: boolean;
  onProgressChange(clientKey: string, value: number): void;
  onForecastChange(clientKey: string, value: string): void;
  onRemove(clientKey: string): void;
  renderResources(row: DailyLogWorkItemEditorRow): React.ReactNode;
}

const formatQuantity = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 4 });

const ProgressCell: React.FC<{ row: DailyLogWorkItemEditorRow; readOnly?: boolean; onChange(value: number): void }> = ({ row, readOnly, onChange }) => {
  const derived = deriveWorkItemProgress({
    plannedQuantity: row.plannedQuantity,
    previousCumulativeQuantity: row.previousCumulativeQuantity,
    cumulativePercent: row.cumulativeProgressPercent,
  });
  return <div className="space-y-2">
    <label className="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
      % lũy kế
      <input aria-label="% lũy kế" type="number" min={row.baselineProgressPercent} step="0.01"
        value={row.cumulativeProgressPercent} disabled={readOnly}
        onChange={event => onChange(Number(event.target.value))}
        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-bold text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:disabled:bg-slate-800" />
    </label>
    <div className="text-xs text-slate-500 dark:text-slate-400">Trước ngày này: {formatQuantity(row.previousCumulativeQuantity || 0)}{row.unit ? ` ${row.unit}` : ''} ({row.baselineProgressPercent.toLocaleString('vi-VN')}%)</div>
    {derived.conversionStatus === 'ready' ? (
      <div className="text-xs font-bold text-teal-700 dark:text-teal-300">Khối lượng hôm nay: {formatQuantity(derived.dailyQuantity || 0)}{row.unit ? ` ${row.unit}` : ''}</div>
    ) : (
      <div className="text-xs font-bold text-amber-700 dark:text-amber-300">Chưa có cơ sở quy đổi</div>
    )}
  </div>;
};

export const DailyLogWorkItemTable: React.FC<DailyLogWorkItemTableProps> = ({
  rows, labor, machines, invalidResourceWorkItemKeys, readOnly, onProgressChange, onForecastChange, onRemove, renderResources,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(
    [
      ...[...labor, ...machines]
        .filter(line => !validateResourceProvider(line.provider).valid)
        .map(line => line.workItemClientKey),
      ...(invalidResourceWorkItemKeys || []),
    ],
  ));
  const toggle = (key: string) => setExpandedKeys(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const resourceSummary = (row: DailyLogWorkItemEditorRow) => {
    const rowLabor = labor.filter(item => item.workItemClientKey === row.clientKey);
    const rowMachines = machines.filter(item => item.workItemClientKey === row.clientKey);
    const people = rowLabor.reduce((sum, item) => sum + Number(item.peopleCount || 0), 0);
    const laborHours = rowLabor.reduce((sum, item) => sum + Number(item.peopleCount || 0) * Number(item.hoursPerPerson || 0), 0);
    const machineCount = rowMachines.reduce((sum, item) => sum + Number(item.machineCount || 0), 0);
    const machineHours = rowMachines.reduce((sum, item) => sum + Number(item.machineCount || 0) * Number(item.hoursPerMachine || 0), 0);
    return { people, laborHours, machineCount, machineHours, rowLabor, rowMachines };
  };

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
    <div className="hidden max-h-[58dvh] overflow-auto md:block">
      <table className="min-w-[1040px] w-full border-collapse text-left">
        <thead className="sticky top-0 z-20 bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <tr><th className="sticky left-0 z-30 min-w-64 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">Hạng mục WBS</th><th className="min-w-64 border-b border-slate-200 px-4 py-3 dark:border-slate-700">Tiến độ đến ngày nhật ký</th><th className="min-w-48 border-b border-slate-200 px-4 py-3 dark:border-slate-700">Nhân công hôm nay</th><th className="min-w-48 border-b border-slate-200 px-4 py-3 dark:border-slate-700">Máy hôm nay</th><th className="min-w-44 border-b border-slate-200 px-4 py-3 dark:border-slate-700">Dự kiến hoàn thành</th><th className="w-20 border-b border-slate-200 px-3 py-3 dark:border-slate-700">Thao tác</th></tr>
        </thead>
        <tbody>{rows.map(row => {
          const summary = resourceSummary(row);
          const expanded = expandedKeys.has(row.clientKey);
          return <React.Fragment key={row.clientKey}>
            <tr className="align-top odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/40">
              <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-inherit px-4 py-3 dark:border-slate-700"><div className="font-bold text-slate-900 dark:text-slate-100">{[row.wbsCode, row.taskName].filter(Boolean).join(' ')}</div><div className="mt-1 text-xs text-slate-500">{row.plannedQuantity ? `Kế hoạch ${formatQuantity(row.plannedQuantity)} ${row.unit || ''}` : 'Chưa có khối lượng kế hoạch'}</div></td>
              <td className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"><ProgressCell row={row} readOnly={readOnly} onChange={value => onProgressChange(row.clientKey, value)} /></td>
              <td className="border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-700"><div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><Users size={16} className="text-teal-700" /> {summary.people || 0} người</div><div className="mt-1 text-xs text-slate-500">{summary.laborHours.toLocaleString('vi-VN')} giờ công, {summary.rowLabor.length} dòng</div></td>
              <td className="border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-700"><div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100"><Wrench size={16} className="text-teal-700" /> {summary.machineCount || 0} máy</div><div className="mt-1 text-xs text-slate-500">{summary.machineHours.toLocaleString('vi-VN')} giờ máy, {summary.rowMachines.length} dòng</div></td>
              <td className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"><label className="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Ngày hoàn thành<input type="date" value={row.forecastFinishDate || ''} disabled={readOnly} onChange={event => onForecastChange(row.clientKey, event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-teal-600 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-800" /></label></td>
              <td className="border-b border-slate-200 px-3 py-3 dark:border-slate-700"><div className="flex gap-1"><button type="button" onClick={() => toggle(row.clientKey)} aria-label={`${expanded ? 'Thu gọn' : 'Mở'} nguồn lực ${row.taskName}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/40">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>{!readOnly && <button type="button" onClick={() => onRemove(row.clientKey)} aria-label={`Bỏ ${row.taskName}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>}</div></td>
            </tr>
            {expanded && <tr><td colSpan={6} className="border-b border-slate-200 p-3 dark:border-slate-700">{renderResources(row)}</td></tr>}
          </React.Fragment>;
        })}</tbody>
      </table>
    </div>
    <div className="space-y-3 p-3 md:hidden">{rows.map(row => {
      const summary = resourceSummary(row);
      const expanded = expandedKeys.has(row.clientKey);
      const derived = deriveWorkItemProgress({ plannedQuantity: row.plannedQuantity, previousCumulativeQuantity: row.previousCumulativeQuantity, cumulativePercent: row.cumulativeProgressPercent });
      return <article key={row.clientKey} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <button type="button" onClick={() => toggle(row.clientKey)} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={expanded}>
          <div><h3 className="font-bold text-slate-900 dark:text-slate-100">{[row.wbsCode, row.taskName].filter(Boolean).join(' ')}</h3><p className="mt-1 text-xs text-slate-500">{row.cumulativeProgressPercent.toLocaleString('vi-VN')}% lũy kế{derived.dailyQuantity != null ? `, +${formatQuantity(derived.dailyQuantity)} ${row.unit || ''} hôm nay` : ', chưa có cơ sở quy đổi'}</p></div>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/70"><span>{summary.people} người, {summary.laborHours.toLocaleString('vi-VN')} giờ</span><span>{summary.machineCount} máy, {summary.machineHours.toLocaleString('vi-VN')} giờ</span></div>
        {expanded && <div className="mt-4 space-y-4"><ProgressCell row={row} readOnly={readOnly} onChange={value => onProgressChange(row.clientKey, value)} /><label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Dự kiến hoàn thành<input type="date" value={row.forecastFinishDate || ''} disabled={readOnly} onChange={event => onForecastChange(row.clientKey, event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label>{renderResources(row)}{!readOnly && <button type="button" onClick={() => onRemove(row.clientKey)} className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={15} /> Bỏ công việc</button>}</div>}
      </article>;
    })}</div>
  </div>;
};
