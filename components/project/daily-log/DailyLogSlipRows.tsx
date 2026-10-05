import React, { useMemo, useState } from 'react';
import { AlertTriangle, Camera, ChevronDown, ChevronUp, Minus, Plus, Truck, Users, X } from 'lucide-react';
import type {
  BusinessPartner, DailyLogCrewContract, DailyLogEntryMode, DailyLogLaborInput, DailyLogMachineInput, DailyLogResourceProvider, ProjectTask, ProjectWorkBoqItem,
} from '../../../types';
import { deriveDailyLogEntry } from '../../../lib/dailyLogEntryRules';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';
import { formatDailyLogDate, formatDailyLogQuantity } from '../../../lib/dailyLogPresentation';
import { forecastProblem, providerName } from '../../../lib/dailyLogSlipRules';
import { DailyLogBulletTextarea } from './DailyLogBulletTextarea';
import { DailyLogInlineSearch, slipInputCls } from './DailyLogInlineSearch';
import { useDailyLogPhotoViewer } from './DailyLogPhotoViewer';
import type { DailyLogEngineerRow } from './DailyLogWorkItemTable';

// Phiếu kỹ sư v3: mỗi hạng mục một khối, mọi ô chọn bằng gõ tìm ngay tại chỗ, ⊕ thêm dòng ngay dưới, ⊖ bỏ dòng.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const MODES: Array<{ mode: DailyLogEntryMode; label: string; placeholder: string }> = [
  { mode: 'daily_quantity', label: 'Hôm nay', placeholder: 'Khối lượng hôm nay' },
  { mode: 'cumulative_quantity', label: 'Lũy kế', placeholder: 'Khối lượng lũy kế' },
  { mode: 'percent', label: '%', placeholder: '% lũy kế' },
];
const entryErrors: Record<string, string> = {
  entry_required: 'Nhập khối lượng hoặc lưu nháp để bổ sung sau.', negative_entry: 'Khối lượng không được âm.',
  unknown_baseline: 'Chưa xác định khối lượng trước ngày này. Chọn nhập lũy kế hoặc %.',
  quantity_basis_required: 'Chưa có cơ sở quy đổi; chọn nhập %.', progress_below_baseline: 'Lũy kế không được thấp hơn số đã xác nhận.',
  progress_above_allowed_maximum: 'Khối lượng vượt giới hạn của hạng mục.', invalid_baseline: 'Cần tải lại cơ sở khối lượng.',
};
const MANUAL_LABOR_TYPE: DailyLogResourceProvider['manualProviderType'] = 'free_crew';

type TaskFilter = 'active' | 'week' | 'all';
type CrewOption = { partnerId: string; code?: string | null; name: string; contract?: string | null };
export type MachineSuggestion = { machineType: string; provider: DailyLogResourceProvider };

export interface DailyLogSlipRowsProps {
  rows: DailyLogEngineerRow[];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
  tasks: ProjectTask[];
  workBoqItems: ProjectWorkBoqItem[];
  slipDate: string;
  resourceProviders: BusinessPartner[];
  crewContracts: DailyLogCrewContract[];
  machineSuggestions: MachineSuggestion[];
  disabled: boolean;
  onAddTask(taskId: string, afterKey: string | null): void;
  onChange(key: string, patch: Partial<DailyLogEngineerRow>): void;
  onModeChange(row: DailyLogEngineerRow, mode: DailyLogEntryMode): void;
  onRemove(key: string): void;
  onLaborChange(rowKey: string, lines: DailyLogLaborInput[]): void;
  onMachinesChange(rowKey: string, lines: DailyLogMachineInput[]): void;
  onUploadPhotos?(files: File[], row: DailyLogEngineerRow): void;
}

const Stepper: React.FC<{ value: number; label: string; disabled: boolean; onChange(value: number): void }> = ({ value, label, disabled, onChange }) =>
  <span className="inline-flex shrink-0 items-center rounded-lg border border-border bg-background">
    <button type="button" disabled={disabled || value <= 1} aria-label={`Bớt 1 ${label}`} onClick={() => onChange(Math.max(1, value - 1))}
      className="grid h-8 w-7 place-items-center text-muted-foreground hover:text-rose-600 disabled:opacity-40"><Minus size={13} /></button>
    <input aria-label={`Số ${label}`} inputMode="decimal" value={Number.isFinite(value) ? String(value).replace('.', ',') : ''} disabled={disabled}
      onChange={event => { const next = Number(event.target.value.replace(',', '.')); onChange(Number.isFinite(next) ? next : 0); }}
      className="h-8 w-9 bg-transparent text-center text-sm font-semibold tabular-nums text-leaf-700 focus:outline-none dark:text-leaf-300" />
    <button type="button" disabled={disabled} aria-label={`Thêm 1 ${label}`} onClick={() => onChange(Math.floor(value) + 1)}
      className="grid h-8 w-7 place-items-center text-muted-foreground hover:text-leaf-700 disabled:opacity-40"><Plus size={13} /></button>
  </span>;

const Hours: React.FC<{ value: number; label: string; disabled: boolean; onChange(value: number): void }> = ({ value, label, disabled, onChange }) =>
  <label className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={label}>
    <input aria-label={label} inputMode="decimal" value={Number.isFinite(value) ? String(value).replace('.', ',') : ''} disabled={disabled}
      onChange={event => { const next = Number(event.target.value.replace(',', '.')); onChange(Number.isFinite(next) ? next : 0); }}
      className="h-8 w-10 rounded-lg border border-border bg-background text-center text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/40" />giờ
  </label>;

const LineButtons: React.FC<{ what: string; disabled: boolean; onAdd(): void; onRemove(): void }> = ({ what, disabled, onAdd, onRemove }) =>
  <span className="inline-flex shrink-0 gap-1">
    <button type="button" disabled={disabled} onClick={onAdd} aria-label={`Thêm hạng mục ngay dưới ${what}`} title="Thêm hạng mục ngay dưới dòng này"
      className="grid h-8 w-8 place-items-center rounded-full border border-leaf-300 bg-leaf-50 text-leaf-700 hover:bg-leaf-100 disabled:opacity-40 dark:border-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-300"><Plus size={15} /></button>
    <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Bỏ ${what}`} title="Bỏ hạng mục này"
      className="grid h-8 w-8 place-items-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><Minus size={15} /></button>
  </span>;

const RemoveLine: React.FC<{ label: string; disabled: boolean; onClick(): void }> = ({ label, disabled, onClick }) =>
  <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}
    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-950/40"><Minus size={14} /></button>;

const FooterButton: React.FC<{ onPick(): void; children: React.ReactNode }> = ({ onPick, children }) =>
  <button type="button" onMouseDown={event => { event.preventDefault(); onPick(); }}
    className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300"><Plus size={14} />{children}</button>;

const Section: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode; className?: string }> = ({ icon, label, children, className = '' }) =>
  <section className={`min-w-0 ${className}`}><h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{icon}{label}</h4>{children}</section>;

export const DailyLogSlipRows: React.FC<DailyLogSlipRowsProps> = props => {
  const { rows, labor, machines, tasks, workBoqItems, slipDate, disabled } = props;
  const [slots, setSlots] = useState<Array<{ key: string; after: string | null }>>([]);
  const [focusSlot, setFocusSlot] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('active');
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const [issuesOpen, setIssuesOpen] = useState<Set<string>>(new Set());
  const photoViewer = useDailyLogPhotoViewer();
  const flip = (set: Set<string>, key: string) => { const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); return next; };

  const parentIds = useMemo(() => new Set(tasks.map(task => task.parentId).filter(Boolean) as string[]), [tasks]);
  const parentName = useMemo(() => new Map(tasks.map(task => [task.id, task.name])), [tasks]);
  const boqByTask = useMemo(() => new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.sourceTaskId!, item])), [workBoqItems]);
  const used = new Set(rows.map(row => row.taskId));
  const weekEnd = useMemo(() => { const [y, m, d] = slipDate.split('-').map(Number); const end = new Date(y, m - 1, d + 7); return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`; }, [slipDate]);
  const leafTasks = useMemo(() => tasks.filter(task => !parentIds.has(task.id)).sort((a, b) => Number(a.order || 0) - Number(b.order || 0)), [tasks, parentIds]);
  const taskOptions = leafTasks.filter(task => !used.has(task.id) && (filter === 'all'
    || (filter === 'active' ? Number(task.progress || 0) < 100 && (Number(task.progress || 0) > 0 || (task.startDate || '') <= slipDate)
      : (task.startDate || '') <= weekEnd && (task.endDate || '9999') >= slipDate)));

  const crewOptions: CrewOption[] = useMemo(() => {
    const crews = props.crewContracts.map(crew => ({ partnerId: crew.partnerId, code: crew.partnerCode, name: crew.partnerName,
      contract: crew.contracts.map(contract => contract.code).filter(Boolean).join(', ') || null }));
    const ids = new Set(crews.map(crew => crew.partnerId));
    return [...crews, ...props.resourceProviders.filter(partner => partner.isActive !== false && !ids.has(partner.id))
      .map(partner => ({ partnerId: partner.id, code: partner.code, name: partner.name, contract: null }))];
  }, [props.crewContracts, props.resourceProviders]);
  const partnerOptions = useMemo(() => props.resourceProviders.filter(partner => partner.isActive !== false), [props.resourceProviders]);
  const machineOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...props.machineSuggestions, ...machines.map(line => ({ machineType: line.machineType, provider: line.provider }))]
      .filter(option => option.machineType.trim() && validateResourceProvider(option.provider).valid)
      .filter(option => { const key = `${option.machineType}|${providerName(option.provider)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }, [props.machineSuggestions, machines]);

  const addTask = (slotKey: string, after: string | null, taskId: string) => {
    props.onAddTask(taskId, after);
    setSlots(current => current.filter(slot => slot.key !== slotKey));
  };
  const addSlot = (after: string) => { const key = `slot-${Math.random().toString(36).slice(2)}`; setSlots(current => [...current, { key, after }]); setFocusSlot(key); };

  const derive = (row: DailyLogEngineerRow) => deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue, plannedQuantity: row.plannedQuantity,
    unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity, baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 });
  const previousPercent = (row: DailyLogEngineerRow) => row.baselineQuantityState === 'known' && row.plannedQuantity && row.previousCumulativeQuantity != null
    ? row.previousCumulativeQuantity / row.plannedQuantity * 100 : row.baselineQuantityState === 'none' ? 0 : null;

  const taskSearch = (slotKey: string, after: string | null) => <DailyLogInlineSearch<ProjectTask>
    label="Thêm hạng mục thi công" placeholder="Gõ mã hoặc tên hạng mục để thêm…" items={taskOptions} disabled={disabled} autoFocus={focusSlot === slotKey}
    text={task => `${task.wbsCode || ''} ${task.name} ${task.parentId ? parentName.get(task.parentId) || '' : ''}`}
    onPick={task => addTask(slotKey, after, task.id)}
    header={<div className="flex flex-wrap gap-1 border-b border-border bg-muted/50 px-2 py-1.5">
      {([['active', 'Đang / đến hạn thi công'], ['week', 'Kế hoạch 7 ngày tới'], ['all', 'Tất cả']] as const).map(([key, label]) =>
        <button key={key} type="button" onMouseDown={event => { event.preventDefault(); setFilter(key); }} aria-pressed={filter === key}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${filter === key ? 'bg-teal-600 text-white' : 'bg-card text-muted-foreground'}`}>{label}</button>)}
    </div>}
    render={task => { const boq = boqByTask.get(task.id); const plan = Number(boq?.plannedQty) || Number(task.provisionalQuantity) || 0;
      return <span className="flex items-start justify-between gap-3"><span className="min-w-0">
        <b className="text-mint-700 dark:text-mint-300">{task.wbsCode}</b> <span className="font-semibold">{task.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{task.parentId ? parentName.get(task.parentId) : ''}{task.endDate ? ` · KH xong ${formatDailyLogDate(task.endDate)}` : ''}{plan ? ` · ${formatDailyLogQuantity(plan, boq?.unit || task.fallbackUnit)}` : ''}</span></span>
        <span className={`shrink-0 text-xs ${NUM}`}>{Number(task.progress || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</span></span>; }}
    footer={(query, close) => filter !== 'all' && query ? <FooterButton onPick={() => { setFilter('all'); close(); }}>Tìm "{query}" trong tất cả hạng mục</FooterButton> : null} />;

  const quantity = (row: DailyLogEngineerRow) => {
    const result = derive(row);
    const noBasis = !row.unit || !row.plannedQuantity;
    const disabledMode = (mode: DailyLogEntryMode) => mode === 'daily_quantity' ? noBasis || row.baselineQuantityState === 'unknown' : mode === 'cumulative_quantity' ? noBasis : false;
    const current = MODES.find(mode => mode.mode === row.entryMode) || MODES[2];
    return <div className="flex flex-col gap-1">
      <span role="group" aria-label="Cách nhập khối lượng" className="inline-flex w-fit shrink-0 overflow-hidden rounded-md border border-border text-xs font-semibold">
          {MODES.map(mode => <button key={mode.mode} type="button" aria-pressed={row.entryMode === mode.mode} disabled={disabled || disabledMode(mode.mode)}
            onClick={() => props.onModeChange(row, mode.mode)}
            className={`px-2 py-1 ${row.entryMode === mode.mode ? 'bg-teal-600 text-white' : 'bg-card text-muted-foreground hover:bg-muted disabled:opacity-40'}`}>{mode.label}</button>)}
        </span>
      <div className="flex items-center gap-1.5">
        <input aria-label={current.placeholder} inputMode="decimal" value={row.enteredValue ?? ''} disabled={disabled} placeholder={current.placeholder}
          aria-invalid={!result.valid} onChange={event => props.onChange(row.clientKey, { enteredValue: event.target.value })}
          className={`${slipInputCls} w-28 text-right font-semibold tabular-nums text-leaf-700 dark:text-leaf-300 ${!result.valid && String(row.enteredValue ?? '').trim() ? 'border-rose-400' : ''}`} />
        <span className="shrink-0 text-xs text-muted-foreground">{row.entryMode === 'percent' ? '%' : row.unit}</span>
      </div>
      {result.valid ? <p className="text-xs text-muted-foreground">Lũy kế <b className="text-foreground">{result.cumulativeQuantity != null ? formatDailyLogQuantity(result.cumulativeQuantity, row.unit) : '—'}</b>
        {result.cumulativePercent != null && <> · <b className={NUM}>{formatDailyLogQuantity(result.cumulativePercent, '%')}</b></>}
        {row.entryMode !== 'daily_quantity' && result.dailyQuantity != null && <> · hôm nay <b className={NUM}>+{formatDailyLogQuantity(result.dailyQuantity, row.unit)}</b></>}</p>
        : String(row.enteredValue ?? '').trim() ? <p className="text-xs text-rose-700 dark:text-rose-300">{entryErrors[result.errorCode || ''] || 'Chưa có số liệu hợp lệ.'}</p> : null}
      <p className="text-xs text-muted-foreground">{noBasis ? 'Chưa có cơ sở quy đổi — nhập % lũy kế' : row.baselineQuantityState === 'unknown' ? 'Chưa xác định khối lượng trước ngày này'
        : `Trước ngày này: ${formatDailyLogQuantity(row.baselineQuantityState === 'none' ? 0 : row.previousCumulativeQuantity, row.unit)}`}</p>
    </div>;
  };

  const forecast = (row: DailyLogEngineerRow) => {
    const result = derive(row);
    const percent = result.valid ? result.cumulativePercent : previousPercent(row);
    const problem = forecastProblem({ scheduleFinishDate: row.scheduleFinishDate, forecastFinishDate: row.forecastFinishDate,
      forecastChangeReason: row.forecastChangeReason, cumulativePercent: percent, slipDate });
    const planned = row.scheduleFinishDate?.slice(0, 10);
    const overdue = Boolean(planned && planned < slipDate && Number(percent ?? 0) < 100);
    const changed = Boolean(row.forecastFinishDate && row.forecastFinishDate !== row.scheduleFinishDate);
    return <div className="space-y-1 text-xs">
      <input type="date" aria-label={`Dự kiến hoàn thành ${row.taskName}`} value={row.forecastFinishDate || ''} disabled={disabled} min={overdue ? slipDate : undefined}
        aria-invalid={problem === 'new_date_required'} onChange={event => props.onChange(row.clientKey, { forecastFinishDate: event.target.value || null })}
        className={`${slipInputCls} ${problem === 'new_date_required' ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20' : ''}`} />
      {changed && <input aria-label="Lý do thay đổi ngày hoàn thành" placeholder="Lý do đổi ngày (bắt buộc)" value={row.forecastChangeReason || ''} disabled={disabled}
        aria-invalid={problem === 'reason_required'} onChange={event => props.onChange(row.clientKey, { forecastChangeReason: event.target.value })}
        className={`${slipInputCls} ${problem === 'reason_required' ? 'border-amber-400' : ''}`} />}
      {problem === 'new_date_required' && <p className="font-semibold text-amber-700 dark:text-amber-300">Đã quá kế hoạch: ghi ngày dự kiến xong mới.</p>}
    </div>;
  };

  const planLine = (row: DailyLogEngineerRow) => {
    const result = derive(row);
    const percent = result.valid ? result.cumulativePercent : previousPercent(row);
    const planned = row.scheduleFinishDate?.slice(0, 10);
    const overdueDays = planned && planned < slipDate && Number(percent ?? 0) < 100
      ? Math.round((Date.parse(`${slipDate}T00:00:00Z`) - Date.parse(`${planned}T00:00:00Z`)) / 86_400_000) : 0;
    return <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
      <span>{row.unit && row.plannedQuantity ? <>Khối lượng KH <b className="font-semibold tabular-nums text-foreground">{formatDailyLogQuantity(row.plannedQuantity, row.unit)}</b></> : 'Chưa có cơ sở quy đổi'}</span>
      <span>{planned ? <>Xong theo KH <b className="font-semibold text-foreground">{formatDailyLogDate(planned)}</b></> : 'Chưa có ngày theo tiến độ'}
        {overdueDays > 0 && <b className="font-semibold text-rose-700 dark:text-rose-300"> · đã qua {overdueDays} ngày</b>}</span>
    </p>;
  };

  const laborCell = (row: DailyLogEngineerRow) => {
    const lines = labor.filter(line => line.workItemClientKey === row.clientKey);
    const set = (next: DailyLogLaborInput[]) => props.onLaborChange(row.clientKey, next);
    const patch = (index: number, value: Partial<DailyLogLaborInput>) => set(lines.map((line, i) => i === index ? { ...line, ...value } : line));
    const add = (provider: DailyLogResourceProvider, name: string) => set([...lines, { workItemClientKey: row.clientKey, laborType: name, peopleCount: 1, hoursPerPerson: 8, provider }]);
    return <div className="space-y-1.5">
      {lines.map((line, index) => {
        const key = `${row.clientKey}:labor:${index}`;
        const name = providerName(line.provider);
        const crew = props.crewContracts.find(item => item.partnerId === line.provider.partnerId);
        const contractLines = crew?.contracts.flatMap(contract => contract.lines.map(item => ({ ...item, contractCode: contract.code }))) || [];
        const valid = validateResourceProvider(line.provider).valid && line.laborType.trim() && line.peopleCount > 0 && line.hoursPerPerson > 0;
        const open = openLines.has(key) || !line.laborType.trim();
        return <div key={key} className={`rounded-lg border bg-card p-1.5 ${valid ? 'border-border' : 'border-amber-400'}`}>
          <div className="flex items-center gap-1.5">
            <span className={`min-w-0 flex-1 truncate text-sm ${ENT}`} title={`${name}${line.laborType && line.laborType !== name ? ` · ${line.laborType}` : ''}`}>{name || 'Chưa chọn tổ đội'}</span>
            {line.provider.entryMode === 'manual' && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title="Chờ gắn hợp đồng: QS sẽ ghép khi tổ có hợp đồng">chờ HĐ</span>}
            <RemoveLine label={`Bỏ nhân công ${name}`} disabled={disabled} onClick={() => set(lines.filter((_, i) => i !== index))} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Stepper value={line.peopleCount} label="người" disabled={disabled} onChange={value => patch(index, { peopleCount: value })} />
            <span className="text-xs text-muted-foreground">người ×</span>
            <Hours value={line.hoursPerPerson} label="Giờ mỗi người" disabled={disabled} onChange={value => patch(index, { hoursPerPerson: value })} />
            <button type="button" aria-expanded={open} onClick={() => setOpenLines(current => flip(current, key))}
              className="ml-auto inline-flex items-center gap-0.5 rounded-md px-1 text-xs font-semibold text-muted-foreground hover:bg-muted">{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}Chi tiết</button>
          </div>
          {open && <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            <label className="text-xs font-semibold text-muted-foreground">Nhóm nhân công
              <input value={line.laborType} disabled={disabled} placeholder="vd: Thợ nề, Thợ sắt" onChange={event => patch(index, { laborType: event.target.value })} className={`mt-0.5 ${slipInputCls}`} /></label>
            {crew && <label className="text-xs font-semibold text-muted-foreground">Dòng công việc theo hợp đồng
              <select value={line.contractItemId || ''} disabled={disabled} className={`mt-0.5 ${slipInputCls}`}
                onChange={event => { const item = contractLines.find(entry => entry.id === event.target.value);
                  patch(index, { contractItemId: event.target.value || null, laborType: item?.name && (!line.laborType.trim() || line.laborType === name) ? item.name : line.laborType }); }}>
                <option value="">Không tính công nhật</option>
                {contractLines.map(item => <option key={item.id} value={item.id}>{[item.contractCode, item.code, item.name].filter(Boolean).join(' · ')}{item.unit ? ` (${item.unit})` : ''}</option>)}
              </select></label>}
          </div>}
          {!valid && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Điền nhóm nhân công, số người và giờ.</p>}
        </div>;
      })}
      <DailyLogInlineSearch<CrewOption> label={`Thêm tổ đội cho ${row.taskName}`} placeholder="Thêm tổ đội — gõ tên" items={crewOptions} disabled={disabled}
        text={option => `${option.code || ''} ${option.name} ${option.contract || ''}`}
        render={option => <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className={ENT}>{option.name}</span>
          {option.contract ? <span className="block text-xs text-muted-foreground">HĐ {option.contract}</span> : option.code && <span className="block text-xs text-muted-foreground">{option.code}</span>}</span>
          {option.contract && <span className="shrink-0 rounded-full bg-leaf-50 px-1.5 text-[11px] font-semibold text-leaf-800 dark:bg-leaf-950/40 dark:text-leaf-200">có HĐ</span>}</span>}
        onPick={option => add({ entryMode: 'catalog', partnerId: option.partnerId, providerCodeSnapshot: option.code || null, providerNameSnapshot: option.name }, option.name)}
        footer={(query, close) => query ? <FooterButton onPick={() => { add({ entryMode: 'manual', manualProviderType: MANUAL_LABOR_TYPE, manualProviderName: query }, query); close(); }}>
          Thêm "{query}" (gõ tay, chờ gắn hợp đồng)</FooterButton> : null} />
    </div>;
  };

  const machineCell = (row: DailyLogEngineerRow) => {
    const lines = machines.filter(line => line.workItemClientKey === row.clientKey);
    const set = (next: DailyLogMachineInput[]) => props.onMachinesChange(row.clientKey, next);
    const patch = (index: number, value: Partial<DailyLogMachineInput>) => set(lines.map((line, i) => i === index ? { ...line, ...value } : line));
    const add = (machineType: string, provider: DailyLogResourceProvider) => set([...lines, { workItemClientKey: row.clientKey, machineType, machineCount: 1, hoursPerMachine: 8, provider }]);
    return <div className="space-y-1.5">
      {lines.map((line, index) => {
        const valid = validateResourceProvider(line.provider).valid;
        const owner = providerName(line.provider);
        return <div key={`${row.clientKey}:machine:${index}`} className={`rounded-lg border bg-card p-1.5 ${valid && line.machineType.trim() ? 'border-border' : 'border-amber-400'}`}>
          <div className="flex items-center gap-1.5">
            <input aria-label="Loại máy" value={line.machineType} disabled={disabled} placeholder="Loại máy" onChange={event => patch(index, { machineType: event.target.value })}
              className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 text-sm font-semibold text-sky-800 hover:border-border focus:border-border focus:outline-none dark:text-sky-200" />
            <RemoveLine label={`Bỏ máy ${line.machineType}`} disabled={disabled} onClick={() => set(lines.filter((_, i) => i !== index))} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Stepper value={line.machineCount} label="máy" disabled={disabled} onChange={value => patch(index, { machineCount: value })} />
            <span className="text-xs text-muted-foreground">máy ×</span>
            <Hours value={line.hoursPerMachine} label="Giờ mỗi máy" disabled={disabled} onChange={value => patch(index, { hoursPerMachine: value })} />
          </div>
          {valid ? <p className="mt-0.5 flex items-center gap-1 px-1 text-xs text-muted-foreground">của <span className={ENT}>{owner}</span>
            {!disabled && <button type="button" onClick={() => patch(index, { provider: { entryMode: 'catalog' } })} className="ml-1 font-semibold text-teal-700 hover:underline dark:text-teal-300">đổi</button>}</p>
            : <div className="mt-1"><DailyLogInlineSearch<BusinessPartner> label={`Đơn vị cho máy ${line.machineType}`} placeholder="Đơn vị cho máy — gõ NCC hoặc chủ máy" invalid
              items={partnerOptions} disabled={disabled} text={partner => `${partner.code || ''} ${partner.name}`}
              render={partner => <span><span className={ENT}>{partner.name}</span>{partner.code && <span className="block text-xs text-muted-foreground">{partner.code}</span>}</span>}
              onPick={partner => patch(index, { provider: { entryMode: 'catalog', partnerId: partner.id, providerCodeSnapshot: partner.code || null, providerNameSnapshot: partner.name } })}
              footer={(query, close) => query ? <FooterButton onPick={() => { patch(index, { provider: { entryMode: 'manual', manualProviderType: 'machine_owner', manualProviderName: query } }); close(); }}>
                Dùng "{query}" (chủ máy, gõ tay)</FooterButton> : null} /></div>}
        </div>;
      })}
      <DailyLogInlineSearch<MachineSuggestion> label={`Thêm máy cho ${row.taskName}`} placeholder="Thêm máy — gõ tên máy" items={machineOptions} disabled={disabled}
        text={option => `${option.machineType} ${providerName(option.provider)}`}
        render={option => <span><span className="font-semibold text-sky-800 dark:text-sky-200">{option.machineType}</span>
          <span className="block text-xs text-muted-foreground">của <span className={ENT}>{providerName(option.provider)}</span></span></span>}
        onPick={option => add(option.machineType, option.provider)}
        footer={(query, close) => query ? <FooterButton onPick={() => { add(query, { entryMode: 'catalog' }); close(); }}>Thêm máy "{query}"</FooterButton> : null} />
    </div>;
  };

  const photos = (row: DailyLogEngineerRow) => {
    const list = row.attachments || [];
    return <div className="flex flex-wrap items-center gap-1.5">
      {list.map((photo, index) => <span key={`${photo.url}-${index}`} className="relative">
        <button type="button" title={photo.name} onClick={() => photoViewer.open(list.map((item, i) => ({ url: item.url, name: `${row.wbsCode} ${row.taskName} · ảnh ${i + 1}` })), index)}
          className="block h-10 w-10 overflow-hidden rounded-lg border border-border bg-muted hover:ring-2 hover:ring-teal-500/40">
          <img src={photo.url} alt={photo.name || `Ảnh ${index + 1}`} loading="lazy" className="h-full w-full object-cover" /></button>
        {!disabled && <button type="button" aria-label={`Bỏ ảnh ${index + 1}`} onClick={() => props.onChange(row.clientKey, { attachments: list.filter((_, i) => i !== index) })}
          className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-white"><X size={11} /></button>}
      </span>)}
      {!disabled && props.onUploadPhotos && <label title="Chụp / chọn ảnh" className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border border-dashed border-teal-400 text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40">
        <Camera size={16} aria-hidden /><span className="sr-only">Thêm ảnh cho {row.taskName}</span>
        <input type="file" accept="image/*" multiple className="sr-only" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) props.onUploadPhotos!(files, row); }} /></label>}
      {!list.length && (disabled || !props.onUploadPhotos) && <span className="text-xs text-muted-foreground">Chưa có ảnh</span>}
    </div>;
  };

  const slotFor = (after: string | null) => slots.filter(slot => slot.after === after).map(slot =>
    <div key={slot.key} className="flex items-center gap-2 rounded-2xl border border-dashed border-mint-300 bg-mint-50/40 px-3 py-2.5 dark:border-mint-800 dark:bg-mint-950/10">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-mint-400 text-mint-700"><Plus size={14} /></span>
      <div className="min-w-0 flex-1 md:max-w-xl">{taskSearch(slot.key, after)}</div>
      <RemoveLine label="Bỏ dòng trống" disabled={false} onClick={() => setSlots(current => current.filter(item => item.key !== slot.key))} />
    </div>);

  return <div className="dl-v3 space-y-3">
    {rows.map((row, index) => {
      const lineIssues = Boolean(row.issues?.trim()) || issuesOpen.has(row.clientKey);
      return <React.Fragment key={row.clientKey}>
        <article aria-label={`${row.wbsCode} ${row.taskName}`} className="rounded-2xl border border-border bg-card shadow-sm">
          <header className="flex items-start gap-3 border-b border-border/70 px-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mint-100 text-xs font-bold text-mint-800 dark:bg-mint-950 dark:text-mint-200">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold leading-snug text-foreground"><span className="text-mint-700 dark:text-mint-300">{row.wbsCode}</span> {row.taskName}</h3>
              {planLine(row)}
            </div>
            <LineButtons what={row.taskName} disabled={disabled} onAdd={() => addSlot(row.clientKey)} onRemove={() => props.onRemove(row.clientKey)} />
          </header>
          <div className="grid gap-x-4 gap-y-3 px-3 py-3 md:grid-cols-2 xl:grid-cols-4">
            <Section icon={<span className="h-1.5 w-1.5 rounded-full bg-leaf-500" aria-hidden />} label="Làm được">{quantity(row)}</Section>
            <Section icon={<span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden />} label="Bao giờ xong">{forecast(row)}</Section>
            <Section icon={<Users size={12} className="text-mint-600" aria-hidden />} label="Nhân công">{laborCell(row)}</Section>
            <Section icon={<Truck size={12} className="text-sky-600" aria-hidden />} label="Máy">{machineCell(row)}</Section>
          </div>
          <div className="grid gap-x-4 gap-y-3 border-t border-border/70 px-3 py-3 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="min-w-0 space-y-1.5">
              <DailyLogBulletTextarea label="Công tác thực hiện" value={row.note} disabled={disabled} emptyText="Chưa ghi công tác."
                placeholder="- Lắp kèo sàn deck trục 3–5" onChange={note => props.onChange(row.clientKey, { note })} />
              {lineIssues ? <DailyLogBulletTextarea label="Sự cố / vướng mắc" tone="warning" value={row.issues} disabled={disabled} emptyText="Không có sự cố."
                placeholder="- Máy ép hỏng thủy lực, dừng 2 giờ" onChange={issues => props.onChange(row.clientKey, { issues })} />
                : <button type="button" disabled={disabled} onClick={() => setIssuesOpen(current => flip(current, row.clientKey))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-300"><AlertTriangle size={12} aria-hidden />Ghi sự cố / vướng mắc</button>}
            </div>
            <Section icon={<Camera size={12} className="text-teal-600" aria-hidden />} label="Ảnh hạng mục">{photos(row)}</Section>
          </div>
        </article>
        {slotFor(row.clientKey)}
      </React.Fragment>;
    })}
    {slotFor(null)}
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-leaf-300 bg-card px-3 py-2.5 dark:border-leaf-800">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-700 dark:bg-leaf-950 dark:text-leaf-300"><Plus size={14} /></span>
      <div className="min-w-0 flex-1 md:max-w-xl">{taskSearch('tail', rows.at(-1)?.clientKey ?? null)}</div>
    </div>
    {photoViewer.viewer}
  </div>;
};
