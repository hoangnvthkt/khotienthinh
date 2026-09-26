import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, Send } from 'lucide-react';
import type { DailyLogContribution, DailyLogLaborInput, DailyLogMachineInput, DailyLogResourceProvider } from '../../../types';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';
import { dailyLogWbsService, type DailyLogWbsBundle, type SaveDailyLogContributionWorkInput } from '../../../lib/dailyLogWbsService';
import { dailyLogContributionService } from '../../../lib/projectService';
import { DailyLogResourceEditor } from './DailyLogResourceEditor';
import { DailyLogWbsPicker } from './DailyLogWbsPicker';
import { DailyLogWorkItemTable, type DailyLogWorkItemEditorRow } from './DailyLogWorkItemTable';

export interface ContributionEditorDraft {
  workAreaCode: string;
  workAreaName: string;
  items: SaveDailyLogContributionWorkInput['items'];
  labor: DailyLogLaborInput[];
  machines: DailyLogMachineInput[];
}

interface DailyLogContributionWorkEditorProps {
  bundle: DailyLogWbsBundle | null;
  loading?: boolean;
  denied?: boolean;
  error?: string | null;
  onReload?: () => void;
  ensureContribution?: () => Promise<DailyLogContribution>;
  onSaved?: (receipt: Awaited<ReturnType<typeof dailyLogWbsService.saveContribution>>) => void;
  onSubmitted?: () => void;
}

const blankProvider = (): DailyLogResourceProvider => ({ entryMode: 'catalog' });

const providerFromBundleLine = (line: any): DailyLogResourceProvider => {
  if (line.providerEntryMode === 'manual') return {
    entryMode: 'manual', manualProviderType: line.manualProviderType,
    manualProviderName: line.manualProviderName, manualProviderNote: line.manualProviderNote,
  };
  if (line.partnerId) return {
    entryMode: 'catalog', partnerId: line.partnerId,
    providerCodeSnapshot: line.providerCodeSnapshot || line.catalogCode,
    providerNameSnapshot: line.providerNameSnapshot || line.partnerName,
  };
  return blankProvider();
};

export const buildContributionSaveInput = (
  contribution: DailyLogContribution,
  draft: ContributionEditorDraft,
): SaveDailyLogContributionWorkInput => ({
  contributionId: contribution.id,
  expectedRowVersion: contribution.rowVersion || 1,
  workAreaCode: draft.workAreaCode.trim(),
  workAreaName: draft.workAreaName.trim(),
  items: draft.items.map(item => ({ ...item })),
  labor: draft.labor.map(row => ({
    workItemClientKey: row.workItemClientKey,
    laborType: row.laborType,
    peopleCount: Number(row.peopleCount),
    hoursPerPerson: Number(row.hoursPerPerson),
    provider: { ...row.provider },
    ...(row.note?.trim() ? { note: row.note.trim() } : {}),
  })),
  machines: draft.machines.map(row => ({
    workItemClientKey: row.workItemClientKey,
    machineType: row.machineType,
    machineCount: Number(row.machineCount),
    hoursPerMachine: Number(row.hoursPerMachine),
    provider: { ...row.provider },
    ...(row.note?.trim() ? { note: row.note.trim() } : {}),
  })),
});

const isProviderValid = (provider: DailyLogResourceProvider) => validateResourceProvider(provider).valid;

export const DailyLogContributionWorkEditor: React.FC<DailyLogContributionWorkEditorProps> = ({
  bundle, loading, denied, error, onReload, ensureContribution, onSaved, onSubmitted,
}) => {
  const contribution = bundle?.contribution || null;
  const initialRows = useMemo<DailyLogWorkItemEditorRow[]>(() => (bundle?.workItems || [])
    .filter(item => contribution && item.contributionId === contribution.id && !item.dailyLogId)
    .map(item => {
      const task = bundle?.tasks.find(candidate => candidate.id === item.taskId);
      const previous = bundle?.previousProgressRows.find(row => row.taskId === item.taskId);
      return {
        clientKey: item.id || `work-${item.taskId}`,
        taskId: item.taskId,
        wbsCode: item.wbsCode || task?.wbsCode,
        taskName: item.taskName || task?.name || 'Công việc WBS',
        unit: item.unit || task?.fallbackUnit,
        plannedQuantity: item.areaPlannedQuantity ?? item.plannedQuantity ?? (Number(task?.provisionalQuantity || 0) > 0 ? Number(task?.provisionalQuantity) : null),
        previousCumulativeQuantity: previous?.quantityDone ?? item.baselineQuantityDone ?? null,
        baselineProgressPercent: previous?.progressPercent ?? item.baselineProgressPercent ?? 0,
        cumulativeProgressPercent: item.cumulativeProgressPercent,
        forecastFinishDate: item.forecastFinishDate,
      };
    }), [bundle, contribution]);
  const initialLabor = useMemo<DailyLogLaborInput[]>(() => (bundle?.labor || []).filter(line => contribution && line.contributionId === contribution.id).map((line: any) => ({
    workItemClientKey: line.dailyLogWorkItemId || initialRows.find(row => row.taskId === line.taskId)?.clientKey || '',
    laborType: line.laborType || '', peopleCount: Number(line.peopleCount ?? line.count ?? 0),
    hoursPerPerson: Number(line.hoursPerPerson ?? 0), note: line.note,
    provider: providerFromBundleLine(line),
  })).filter(line => line.workItemClientKey), [bundle, initialRows, contribution]);
  const initialMachines = useMemo<DailyLogMachineInput[]>(() => (bundle?.machines || []).filter(line => contribution && line.contributionId === contribution.id).map((line: any) => ({
    workItemClientKey: line.dailyLogWorkItemId || initialRows.find(row => row.taskId === line.taskId)?.clientKey || '',
    machineType: line.machineType || line.machineName || '', machineCount: Number(line.machineCount ?? 0),
    hoursPerMachine: Number(line.hoursPerMachine ?? 0), note: line.note,
    provider: providerFromBundleLine(line),
  })).filter(line => line.workItemClientKey), [bundle, initialRows, contribution]);

  const [rows, setRows] = useState(initialRows);
  const [labor, setLabor] = useState(initialLabor);
  const [machines, setMachines] = useState(initialMachines);
  const [workAreaCode, setWorkAreaCode] = useState(contribution?.workAreaCode || '');
  const [workAreaName, setWorkAreaName] = useState(contribution?.workAreaName || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'submit' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const readOnly = contribution?.status === 'submitted' || contribution?.status === 'included';
  const providerInvalid = [...labor, ...machines].some(line => {
    if (!isProviderValid(line.provider)) return true;
    if (line.provider.entryMode !== 'catalog') return false;
    return !bundle?.resourceProviders.some(provider => provider.id === line.provider.partnerId && provider.isActive !== false);
  });
  const invalidResourceWorkItemKeys = new Set([...labor, ...machines]
    .filter(line => {
      if (!isProviderValid(line.provider)) return true;
      return line.provider.entryMode === 'catalog'
        && !bundle?.resourceProviders.some(provider => provider.id === line.provider.partnerId && provider.isActive !== false);
    })
    .map(line => line.workItemClientKey));
  const physicalInvalid = labor.some(line => !(line.peopleCount > 0 && line.hoursPerPerson > 0))
    || machines.some(line => !(line.machineCount > 0 && line.hoursPerMachine > 0));
  const canSave = !readOnly && !denied && rows.length > 0 && workAreaCode.trim() !== '' && workAreaName.trim() !== ''
    && !providerInvalid && !physicalInvalid && !busyAction;

  if (loading) return <div className="space-y-3" aria-live="polite"><div className="h-10 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" /><div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/70" /><p className="text-sm text-slate-500">Đang tải công việc WBS...</p></div>;
  if (denied) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><h3 className="font-bold">Bạn chưa có quyền sửa phiếu nguồn</h3><p className="mt-1">Hãy liên hệ quản trị dự án để được cấp quyền Nhật ký công trường phù hợp.</p></div>;
  if (!bundle) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Không thể tải dữ liệu WBS.</div>;

  const selectedTaskIds = new Set(rows.map(row => row.taskId));
  const save = async (submit: boolean) => {
    if (!canSave) return;
    setBusyAction(submit ? 'submit' : 'save');
    setLocalError(null);
    try {
      const targetContribution = contribution || await ensureContribution?.();
      if (!targetContribution) throw new Error('Chưa tạo được phiếu nguồn cho ngày đã chọn.');
      const draft: ContributionEditorDraft = {
        workAreaCode, workAreaName,
        items: rows.map(row => ({
          clientKey: row.clientKey, taskId: row.taskId,
          cumulativeProgressPercent: row.cumulativeProgressPercent,
          forecastFinishDate: row.forecastFinishDate || null,
        })),
        labor, machines,
      };
      const receipt = await dailyLogWbsService.saveContribution(buildContributionSaveInput(targetContribution, draft));
      onSaved?.(receipt);
      if (submit) {
        await dailyLogContributionService.submit({ contribution: {
          ...targetContribution, workAreaCode, workAreaName,
          rowVersion: receipt.rowVersion, sourceFingerprint: receipt.sourceFingerprint,
        } });
        onSubmitted?.();
      }
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Không thể lưu phiếu nguồn.');
    } finally {
      setBusyAction(null);
    }
  };

  return <section className="space-y-4" aria-label="Nội dung công việc WBS">
    {(error || localError) && <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><span>{localError || error}</span><button type="button" onClick={onReload} disabled={!onReload} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-red-300 px-3 font-semibold hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:hover:bg-red-950"><RefreshCw size={14} /> Tải dữ liệu mới</button></div>}
    {contribution?.status === 'returned' && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><strong>Phiếu đã được trả lại.</strong>{contribution.returnReason ? ` ${contribution.returnReason}` : ' Vui lòng bổ sung nội dung trước khi gửi lại.'}</div>}
    {readOnly && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">Phiếu đã gửi, dữ liệu đang ở chế độ chỉ đọc.</div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">Mã khu vực/mũi thi công<input value={workAreaCode} onChange={event => setWorkAreaCode(event.target.value)} disabled={readOnly} placeholder="Ví dụ: A1" className="h-10 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-800" /></label>
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">Tên khu vực/mũi thi công<input value={workAreaName} onChange={event => setWorkAreaName(event.target.value)} disabled={readOnly} placeholder="Ví dụ: Khu móng trục A-D" className="h-10 rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-800" /></label>
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Nội dung công việc</h2><p className="mt-1 text-sm text-slate-500">Ghi lũy kế đến ngày lập phiếu. Hệ thống tự tính phần tăng trong ngày.</p></div>
      {!readOnly && <button type="button" onClick={() => setPickerOpen(true)} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-teal-700 px-4 text-sm font-bold text-teal-800 hover:bg-teal-50 active:translate-y-px dark:text-teal-300 dark:hover:bg-teal-950/40"><Plus size={16} /> Chọn WBS</button>}
    </div>
    {rows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><h3 className="font-bold text-slate-800 dark:text-slate-100">Chưa có WBS để ghi nhận</h3><p className="mt-2 text-sm text-slate-500">Tạo hoặc đồng bộ cây tiến độ, sau đó chọn công việc lá cho phiếu nguồn.</p>{bundle.tasks.length > 0 && !readOnly && <button type="button" onClick={() => setPickerOpen(true)} className="mt-4 h-10 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800">Chọn công việc</button>}</div> : <DailyLogWorkItemTable
      rows={rows} labor={labor} machines={machines} invalidResourceWorkItemKeys={invalidResourceWorkItemKeys} readOnly={readOnly}
      onProgressChange={(clientKey, value) => setRows(current => current.map(row => row.clientKey === clientKey ? { ...row, cumulativeProgressPercent: value } : row))}
      onForecastChange={(clientKey, value) => setRows(current => current.map(row => row.clientKey === clientKey ? { ...row, forecastFinishDate: value } : row))}
      onRemove={clientKey => { setRows(current => current.filter(row => row.clientKey !== clientKey)); setLabor(current => current.filter(line => line.workItemClientKey !== clientKey)); setMachines(current => current.filter(line => line.workItemClientKey !== clientKey)); }}
      renderResources={row => <DailyLogResourceEditor workItemClientKey={row.clientKey} resourceProviders={bundle.resourceProviders}
        labor={labor.filter(line => line.workItemClientKey === row.clientKey)} machines={machines.filter(line => line.workItemClientKey === row.clientKey)} readOnly={readOnly}
        onLaborChange={next => setLabor(current => [...current.filter(line => line.workItemClientKey !== row.clientKey), ...next])}
        onMachinesChange={next => setMachines(current => [...current.filter(line => line.workItemClientKey !== row.clientKey), ...next])} />}
    />}
    {(providerInvalid || physicalInvalid) && <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>Mỗi dòng nhân công và máy cần đủ số lượng, thời gian và nguồn cung cấp.</span></div>}
    {!readOnly && <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:flex-row sm:justify-end dark:border-slate-700 dark:bg-slate-900/95"><button type="button" disabled={!canSave} onClick={() => save(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-teal-700 px-5 text-sm font-bold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40">{busyAction === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Lưu nháp</button><button type="button" disabled={!canSave} onClick={() => save(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px">{busyAction === 'submit' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Gửi tổng hợp</button></div>}
    {pickerOpen && <DailyLogWbsPicker tasks={bundle.tasks} workBoqItems={bundle.workBoqItems} selectedTaskIds={selectedTaskIds} recentTaskIds={bundle.workItems.map(item => item.taskId)} onClose={() => setPickerOpen(false)} onConfirm={taskIds => {
      const selected = new Set(taskIds);
      const nextRows = rows.filter(row => selected.has(row.taskId));
      taskIds.forEach(taskId => {
        if (nextRows.some(row => row.taskId === taskId)) return;
        const task = bundle.tasks.find(candidate => candidate.id === taskId);
        if (!task) return;
        const boq = bundle.workBoqItems.find(item => item.sourceTaskId === taskId);
        const previous = bundle.previousProgressRows.find(item => item.taskId === taskId);
        nextRows.push({ clientKey: `work-${taskId}`, taskId, wbsCode: task.wbsCode, taskName: task.name,
          unit: boq?.unit || task.fallbackUnit, plannedQuantity: Number(boq?.plannedQty || task.provisionalQuantity || 0) || null,
          previousCumulativeQuantity: previous?.quantityDone ?? null, baselineProgressPercent: previous?.progressPercent || 0,
          cumulativeProgressPercent: previous?.progressPercent || 0, forecastFinishDate: task.endDate || null });
      });
      setRows(nextRows); setPickerOpen(false);
    }} />}
  </section>;
};
