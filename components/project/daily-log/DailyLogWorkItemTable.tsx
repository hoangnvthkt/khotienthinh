import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, Users, Wrench } from 'lucide-react';
import type { DailyLogLaborInput, DailyLogMachineInput } from '../../../types';
import { deriveWorkItemProgress } from '../../../lib/dailyLogWorkItemRules';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';
import type { DailyLogBaselineQuantityState, DailyLogEntryMode, DailyLogSourceItemV2 } from '../../../types';
import { deriveDailyLogEntry } from '../../../lib/dailyLogEntryRules';
import { formatDailyLogQuantity } from '../../../lib/dailyLogPresentation';

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

export interface DailyLogEngineerRow extends DailyLogSourceItemV2 {
  taskName: string; wbsCode: string; unit: string | null; plannedQuantity: number | null;
  previousCumulativeQuantity: number | null; baselineQuantityState: DailyLogBaselineQuantityState;
  allowOver100: boolean; scheduleFinishDate: string | null;
  snapshot: { dailyQuantity: number | null; cumulativeQuantity: number | null; cumulativePercent: number | null } | null;
}

interface DailyLogEngineerWorkTableProps {
  rows: DailyLogEngineerRow[]; labor: DailyLogLaborInput[]; machines: DailyLogMachineInput[];
  readOnly: boolean; disabled: boolean; invalidResourceWorkItemKeys: ReadonlySet<string>;
  onChange(key: string, patch: Partial<DailyLogEngineerRow>): void;
  onModeChange(row: DailyLogEngineerRow, mode: DailyLogEntryMode): void;
  onRemove(key: string): void;
  renderDetails(row: DailyLogEngineerRow): React.ReactNode;
}
const entryLabels = { daily_quantity: 'Khối lượng hôm nay', cumulative_quantity: 'Khối lượng lũy kế', percent: '% lũy kế' };
const entryErrors: Record<string, string> = {
  entry_required: 'Nhập khối lượng hoặc lưu nháp để bổ sung sau.', negative_entry: 'Khối lượng không được âm.',
  unknown_baseline: 'Chưa xác định khối lượng trước ngày này. Chọn nhập lũy kế hoặc %.',
  quantity_basis_required: 'Chưa có cơ sở quy đổi; chọn nhập %.', progress_below_baseline: 'Lũy kế không được thấp hơn số đã xác nhận.',
  progress_above_allowed_maximum: 'Khối lượng vượt giới hạn của hạng mục.', invalid_baseline: 'Cần tải lại cơ sở khối lượng.',
};
export const DailyLogEngineerWorkTable: React.FC<DailyLogEngineerWorkTableProps> = ({ rows, labor, machines, readOnly, disabled,
  invalidResourceWorkItemKeys, onChange, onModeChange, onRemove, renderDetails }) => {
  const [expanded, setExpanded] = useState(new Set(invalidResourceWorkItemKeys));
  const toggle = (key: string) => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const derive = (row: DailyLogEngineerRow) => readOnly && row.snapshot ? { ...row.snapshot, valid: true, errorCode: null }
    : deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue, plannedQuantity: row.plannedQuantity,
      unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity, baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 });
  const modePicker = (row: DailyLogEngineerRow) => !readOnly && <label className="dl-slip-mode">Cách nhập khối lượng<select aria-label="Cách nhập khối lượng" value={row.entryMode} disabled={disabled} onChange={event => onModeChange(row, event.target.value as DailyLogEntryMode)}>
    <option value="daily_quantity" disabled={!row.unit || !row.plannedQuantity || row.baselineQuantityState === 'unknown'}>Khối lượng hôm nay</option>
    <option value="cumulative_quantity" disabled={!row.unit || !row.plannedQuantity}>Khối lượng lũy kế</option><option value="percent">% lũy kế</option>
  </select></label>;
  const input = (row: DailyLogEngineerRow) => {
    const result = derive(row);
    return <label className="dl-slip-entry">{entryLabels[row.entryMode]}<input aria-label={entryLabels[row.entryMode]} type="text" inputMode="decimal" disabled={disabled} value={row.enteredValue ?? ''}
      aria-invalid={!result.valid} onChange={event => onChange(row.clientKey, { enteredValue: event.target.value })} />
      {!result.valid && <span className="dl-slip-field-error">{entryErrors[result.errorCode || ''] || 'Chưa có số liệu hợp lệ.'}</span>}</label>;
  };
  const qty = (row: DailyLogEngineerRow, mode: DailyLogEntryMode) => {
    if (!readOnly && row.entryMode === mode) return input(row);
    const result = derive(row);
    return <span className="dl-slip-quantity">{formatDailyLogQuantity(mode === 'daily_quantity' ? result.dailyQuantity : mode === 'cumulative_quantity' ? result.cumulativeQuantity : result.cumulativePercent, mode === 'percent' ? '%' : row.unit)}</span>;
  };
  const resources = (row: DailyLogEngineerRow, kind: 'labor' | 'machine') => {
    const lines = kind === 'labor' ? labor.filter(l => l.workItemClientKey === row.clientKey) : machines.filter(m => m.workItemClientKey === row.clientKey);
    const count = lines.reduce((sum, line) => sum + Number('peopleCount' in line ? line.peopleCount : line.machineCount), 0);
    const valid = lines.every(line => 'peopleCount' in line ? line.peopleCount > 0 && line.hoursPerPerson > 0 : line.machineCount > 0 && line.hoursPerMachine > 0);
    const hours = lines.reduce((sum, line) => sum + ('peopleCount' in line ? line.peopleCount * line.hoursPerPerson : line.machineCount * line.hoursPerMachine), 0);
    return <div><span>{lines.length ? `${formatQuantity(count)} ${kind === 'labor' ? 'lượt người' : 'lượt máy'}` : 'Chưa ghi nhận'}</span>
      {lines.length > 0 && <small>{valid ? formatQuantity(hours) : 'Chưa xác định'} {kind === 'labor' ? 'giờ công' : 'giờ máy'}</small>}</div>;
  };
  const detailsButton = (row: DailyLogEngineerRow) => <button type="button" aria-expanded={expanded.has(row.clientKey)} onClick={() => toggle(row.clientKey)}>{expanded.has(row.clientKey) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}Chi tiết</button>;
  const baseline = (row: DailyLogEngineerRow) => <small>{!row.unit || !row.plannedQuantity ? 'Chưa có cơ sở quy đổi' : row.baselineQuantityState === 'unknown' ? 'Chưa xác định khối lượng trước ngày này'
    : `Trước ngày này: ${formatDailyLogQuantity(row.baselineQuantityState === 'none' ? 0 : row.previousCumulativeQuantity, row.unit)}`}</small>;
  const title = (row: DailyLogEngineerRow) => <><strong>{row.wbsCode} {row.taskName}</strong><small>{row.unit && row.plannedQuantity ? `Kế hoạch ${formatDailyLogQuantity(row.plannedQuantity, row.unit)}` : 'Chưa có cơ sở quy đổi'}</small>{baseline(row)}</>;
  return <div className="dl-slip-work">
    <div className="dl-slip-table-scroll"><table><thead><tr><th rowSpan={2}>Hạng mục thi công</th><th rowSpan={2}>ĐVT</th><th colSpan={3}>Khối lượng thi công</th><th rowSpan={2}>Nhân công</th><th rowSpan={2}>Máy</th><th rowSpan={2}>Thao tác</th></tr><tr><th>Hôm nay</th><th>Lũy kế</th><th>% lũy kế</th></tr></thead>
      <tbody>{rows.map(row => <React.Fragment key={row.clientKey}><tr>
        <td className="dl-slip-task">{title(row)}{modePicker(row)}</td><td>{row.unit || 'Chưa có'}</td>
        <td>{qty(row, 'daily_quantity')}</td><td>{qty(row, 'cumulative_quantity')}</td><td>{qty(row, 'percent')}</td>
        <td>{resources(row, 'labor')}</td><td>{resources(row, 'machine')}</td><td>{detailsButton(row)}{!readOnly && <button type="button" disabled={disabled} aria-label={`Bỏ ${row.taskName}`} onClick={() => onRemove(row.clientKey)}><Trash2 size={16} /></button>}</td>
      </tr>{expanded.has(row.clientKey) && <tr><td colSpan={8} className="dl-slip-details">{renderDetails(row)}</td></tr>}</React.Fragment>)}</tbody>
    </table></div>
    <div className="dl-slip-mobile-work">{rows.map(row => <article key={row.clientKey}>
      <h3>{row.wbsCode} {row.taskName}</h3><div>{baseline(row)}</div>{modePicker(row)}{!readOnly && input(row)}
      <dl><div><dt>Hôm nay</dt><dd>{formatDailyLogQuantity(derive(row).dailyQuantity, row.unit)}</dd></div><div><dt>Lũy kế</dt><dd>{formatDailyLogQuantity(derive(row).cumulativeQuantity, row.unit)}</dd></div><div><dt>% lũy kế</dt><dd>{formatDailyLogQuantity(derive(row).cumulativePercent, '%')}</dd></div></dl>
      <div className="dl-slip-resource-summary">{resources(row, 'labor')}{resources(row, 'machine')}</div>
      {detailsButton(row)}{expanded.has(row.clientKey) && <div className="dl-slip-details">{renderDetails(row)}{!readOnly && <button disabled={disabled} type="button" onClick={() => onRemove(row.clientKey)}>Bỏ công việc</button>}</div>}
    </article>)}</div>
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
