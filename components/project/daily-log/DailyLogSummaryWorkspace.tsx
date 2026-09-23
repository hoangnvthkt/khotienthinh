import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save, Send } from 'lucide-react';
import type { DailyLog, DailyLogContribution, DailyLogResourceProvider, DailyLogSummarySource, DailyLogWbsDecision, DailyLogWorkItem } from '../../../types';
import { aggregateAreaWorkItems } from '../../../lib/dailyLogWorkItemRules';
import { canPublishDailyLogSummary } from '../../../lib/dailyLogWorkflow';
import { dailyLogWbsService, type DailyLogWbsBundle, type SaveDailyLogSummaryWorkInput } from '../../../lib/dailyLogWbsService';
import { DailyLogAreaCard, type DailyLogAreaCardModel, type SummaryResourceLine } from './DailyLogAreaCard';
import { DailyLogConsolidatedWbsTable, type ConsolidatedTaskGroup } from './DailyLogConsolidatedWbsTable';

interface Props {
  bundle: DailyLogWbsBundle;
  mode: 'summarize' | 'review';
  ensureSummaryLog?: () => Promise<DailyLog>;
  onSaved?: () => void;
  onSubmit?: () => void;
  onPublish?: () => void;
  onReturnAll?: () => void;
}

interface SummaryDraft {
  cards: DailyLogAreaCardModel[];
  groups: ConsolidatedTaskGroup[];
  decisions: Record<string, DailyLogWbsDecision>;
  warningCount: number;
  blockers: string[];
}

const resourceProvider = (line: any): DailyLogResourceProvider => line.providerEntryMode === 'manual'
  ? { entryMode: 'manual', manualProviderType: line.manualProviderType, manualProviderName: line.manualProviderName, manualProviderNote: line.manualProviderNote }
  : { entryMode: 'catalog', partnerId: line.partnerId, providerCodeSnapshot: line.providerCodeSnapshot || line.catalogCode, providerNameSnapshot: line.providerNameSnapshot || line.partnerName };

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  free_crew: 'Tổ đội tự do', day_labor: 'Nhân công nhật', unregistered_provider: 'Đơn vị ngoài danh mục',
  machine_owner: 'Chủ máy', unregistered_rental_provider: 'Đơn vị cho thuê ngoài danh mục', other: 'Khác',
};

const asResource = (line: any, kind: 'labor' | 'machine'): SummaryResourceLine => ({
  id: line.id, dailyLogWorkItemId: line.dailyLogWorkItemId, contributionId: line.contributionId,
  summarySourceId: line.summarySourceId, kind,
  label: kind === 'labor' ? line.laborType || 'Nhân công' : line.machineType || line.machineName || 'Máy',
  count: Number(kind === 'labor' ? line.peopleCount ?? line.count : line.machineCount ?? line.shifts) || 0,
  totalHours: Number(kind === 'labor' ? line.totalLaborHours ?? line.hours : line.totalMachineHours ?? line.hours) || 0,
  providerEntryMode: line.providerEntryMode === 'manual' ? 'manual' : 'catalog',
  providerName: line.providerEntryMode === 'manual' ? line.manualProviderName || 'Chưa rõ nguồn' : line.providerNameSnapshot || line.partnerName || 'Chưa rõ NCC',
  providerType: line.providerEntryMode === 'manual' ? PROVIDER_TYPE_LABELS[line.manualProviderType] || 'Nguồn nhập tay' : 'Đối tác đang hoạt động',
  raw: line,
});

const makeVirtualSource = (contribution: DailyLogContribution, index: number): DailyLogSummarySource => ({
  id: `new-source-${contribution.id}`, dailyLogId: '', contributionId: contribution.id,
  sourceUserId: contribution.authorUserId, sourceUserName: contribution.authorName,
  sourceVersion: contribution.rowVersion || 1, sourceFingerprint: contribution.sourceFingerprint || '',
  sourceState: contribution.status === 'returned' ? 'returned' : 'current', reviewStatus: 'ready',
  workAreaCode: contribution.workAreaCode, workAreaName: contribution.workAreaName,
  sortOrder: index, updatedAt: contribution.updatedAt || undefined,
});

const addForecastConflicts = (items: DailyLogWorkItem[], aggregates: ReturnType<typeof aggregateAreaWorkItems>) => aggregates.map(aggregate => {
  const forecasts = new Set(items.filter(item => item.taskId === aggregate.taskId).map(item => item.forecastFinishDate).filter(Boolean));
  return forecasts.size > 1 && !aggregate.conflicts.includes('forecast_mismatch')
    ? { ...aggregate, conflicts: [...aggregate.conflicts, 'forecast_mismatch' as const] }
    : aggregate;
});

export const buildDailyLogSummaryDraft = (bundle: DailyLogWbsBundle): SummaryDraft => {
  const sourceByContribution = new Map(bundle.summarySources.map(source => [source.contributionId, source]));
  const contributions = [...bundle.contributionsForSummary];
  bundle.summarySources.forEach(source => {
    if (!contributions.some(item => item.id === source.contributionId)) contributions.push({
      id: source.contributionId, date: bundle.summaryLog?.date || '', authorUserId: source.sourceUserId || '',
      authorName: source.sourceUserName, content: '', status: source.sourceState === 'returned' ? 'returned' : 'included',
      workAreaCode: source.workAreaCode, workAreaName: source.workAreaName, createdAt: source.createdAt || '', updatedAt: source.updatedAt,
    });
  });
  const cards = contributions.map((contribution, index) => {
    const storedSource = sourceByContribution.get(contribution.id) || makeVirtualSource(contribution, index);
    const source: DailyLogSummarySource = contribution.status === 'returned'
      ? { ...storedSource, sourceState: 'returned' }
      : (storedSource.sourceVersion != null && storedSource.sourceVersion !== (contribution.rowVersion || 1))
        || (storedSource.sourceFingerprint != null && storedSource.sourceFingerprint !== (contribution.sourceFingerprint || ''))
        ? { ...storedSource, sourceState: 'changed' }
        : storedSource;
    const sourceItems = bundle.workItems.filter(item => item.contributionId === contribution.id && !item.dailyLogId);
    const copied = bundle.workItems.filter(item => item.summarySourceId === source.id && item.dailyLogId === bundle.summaryLog?.id);
    const editedItems = copied.length > 0 ? copied : sourceItems;
    const allLines = [...bundle.labor.map(line => asResource(line, 'labor')), ...bundle.machines.map(line => asResource(line, 'machine'))];
    const sourceResources = allLines.filter(line => line.contributionId === contribution.id && !line.summarySourceId);
    const copiedResources = allLines.filter(line => line.summarySourceId === source.id);
    return { contribution, source, sourceItems, editedItems, sourceResources, resources: copiedResources.length > 0 ? copiedResources : sourceResources };
  });
  const activeItems = cards.flatMap(card => card.editedItems);
  const aggregates = addForecastConflicts(activeItems, aggregateAreaWorkItems(activeItems.map(item => ({
    id: item.id || item.sourceWorkItemId || `${item.taskId}-${item.workAreaCode}`,
    taskId: item.taskId, workAreaCode: item.workAreaCode,
    areaPlannedQuantity: item.areaPlannedQuantity ?? null,
    cumulativePercent: item.cumulativeProgressPercent, dailyQuantity: item.dailyQuantityDone ?? null,
  }))));
  const groups = aggregates.map(aggregate => ({ aggregate, items: activeItems.filter(item => item.taskId === aggregate.taskId) }));
  const existing = new Map(bundle.decisions.map(decision => [decision.taskId, decision]));
  const decisions = Object.fromEntries(groups.map(({ aggregate }) => {
    const saved = existing.get(aggregate.taskId);
    const auto: DailyLogWbsDecision = saved || {
      dailyLogId: bundle.summaryLog?.id || '', taskId: aggregate.taskId,
      officialCumulativePercent: aggregate.officialCumulativePercent as any,
      officialCumulativeQuantity: aggregate.cumulativeQuantity, officialDailyQuantity: aggregate.dailyQuantity,
      aggregationMethod: aggregate.sourceWorkItemIds.length === 1 ? 'single_source' : 'weighted_area_allocation',
      dailyQuantityMethod: 'sum_non_overlapping', includedSourceWorkItemIds: aggregate.sourceWorkItemIds,
      sourceFingerprint: '',
    };
    return [aggregate.taskId, auto];
  }));
  const sourceWarnings = cards.filter(card => card.source.sourceState && card.source.sourceState !== 'current').length;
  const taskWarnings = groups.filter(group => group.aggregate.conflicts.length > 0).length;
  const blockers = [
    ...cards.filter(card => ['missing', 'returned'].includes(card.source.sourceState || '')).map(card => `source_${card.source.sourceState}`),
    ...groups.flatMap(group => group.aggregate.conflicts),
  ];
  return { cards, groups, decisions, warningCount: sourceWarnings + taskWarnings, blockers };
};

const expectedUpdatedAt = (log: DailyLog) => log.lastActionAt || log.createdAt;

export const DailyLogSummaryWorkspace: React.FC<Props> = ({ bundle, mode, ensureSummaryLog, onSaved, onSubmit, onPublish, onReturnAll }) => {
  const initial = useMemo(() => buildDailyLogSummaryDraft(bundle), [bundle]);
  const [cards, setCards] = useState(initial.cards);
  const [decisions, setDecisions] = useState(initial.decisions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const items = cards.flatMap(card => card.editedItems);
    return addForecastConflicts(items, aggregateAreaWorkItems(items.map(item => ({ id: item.id || item.sourceWorkItemId || '', taskId: item.taskId, workAreaCode: item.workAreaCode, areaPlannedQuantity: item.areaPlannedQuantity ?? null, cumulativePercent: item.cumulativeProgressPercent, dailyQuantity: item.dailyQuantityDone ?? null }))))
      .map(aggregate => ({ aggregate, items: items.filter(item => item.taskId === aggregate.taskId) }));
  }, [cards]);
  const people = cards.flatMap(card => card.resources).filter(row => row.kind === 'labor').reduce((sum, row) => sum + row.count, 0);
  const sourceBlockers = cards.filter(card => ['missing', 'returned'].includes(card.source.sourceState || '')).length;
  const unresolved = groups.filter(group => {
    if (group.aggregate.conflicts.length === 0) return false;
    const decision = decisions[group.aggregate.taskId];
    const progressUnresolved = group.aggregate.conflicts.some(code => code !== 'forecast_mismatch')
      && (!decision || decision.officialCumulativePercent == null || !decision.dailyQuantityMethod || !decision.resolutionReason?.trim());
    const forecastUnresolved = group.aggregate.conflicts.includes('forecast_mismatch')
      && (!decision?.forecastFinishDate || !decision.forecastResolutionReason?.trim());
    return progressUnresolved || forecastUnresolved;
  }).length;
  const warningCount = cards.filter(card => card.source.sourceState && card.source.sourceState !== 'current').length + groups.filter(group => group.aggregate.conflicts.length > 0).length;
  const canSubmit = sourceBlockers === 0 && unresolved === 0 && cards.length > 0;

  const save = async (submit: boolean) => {
    if (submit && !canSubmit) return;
    setBusy(true); setError(null);
    try {
      const log = bundle.summaryLog || await ensureSummaryLog?.();
      if (!log) throw new Error('Chưa tạo được bản nhật ký tổng hợp.');
      const items = cards.flatMap(card => card.editedItems.map((item, index) => ({
        clientKey: `summary-${card.contribution.id}-${item.sourceWorkItemId || item.id}`,
        contributionId: card.contribution.id, summarySourceId: card.source.id?.startsWith('new-source-') ? null : card.source.id,
        sourceWorkItemId: item.sourceWorkItemId || item.id, taskId: item.taskId,
        cumulativeProgressPercent: item.cumulativeProgressPercent, cumulativeQuantityDone: item.cumulativeQuantityDone,
        dailyQuantityDone: item.dailyQuantityDone, forecastFinishDate: item.forecastFinishDate,
        forecastChangeReason: item.forecastChangeReason, note: item.note, attachments: item.attachments, sourceIndex: index,
      })));
      const keyByWorkItem = new Map<string | undefined, string>();
      cards.forEach(card => card.editedItems.forEach(item => {
        const key = `summary-${card.contribution.id}-${item.sourceWorkItemId || item.id}`;
        keyByWorkItem.set(item.id, key);
        keyByWorkItem.set(item.sourceWorkItemId, key);
      }));
      const lines = cards.flatMap(card => card.resources);
      const input: SaveDailyLogSummaryWorkInput = {
        dailyLogId: log.id, expectedUpdatedAt: expectedUpdatedAt(log),
        sources: cards.map((card, index) => ({
          contributionId: card.contribution.id, sourceVersion: card.contribution.rowVersion || card.source.sourceVersion,
          sourceFingerprint: card.contribution.sourceFingerprint || card.source.sourceFingerprint || '',
          includedText: true, includedPhotos: card.contribution.photos || [], sortOrder: index,
          hasAdjustments: Boolean(card.source.hasAdjustments), adjustmentReason: card.source.adjustmentReason || null,
          refreshSource: Boolean((card.source as DailyLogSummarySource & { refreshSource?: boolean }).refreshSource),
        })),
        items,
        decisions: groups.map(group => ({ ...decisions[group.aggregate.taskId], dailyLogId: log.id, taskId: group.aggregate.taskId, includedSourceWorkItemIds: group.aggregate.sourceWorkItemIds })),
        labor: lines.filter(line => line.kind === 'labor').map((line, index) => ({
          workItemClientKey: keyByWorkItem.get(line.dailyLogWorkItemId) || '', laborType: line.raw.laborType,
          peopleCount: line.count, hoursPerPerson: line.count > 0 ? line.totalHours / line.count : 0,
          provider: resourceProvider(line.raw), note: line.raw.note, sourceLaborLineId: line.id, sourceIndex: index,
        })),
        machines: lines.filter(line => line.kind === 'machine').map((line, index) => ({
          workItemClientKey: keyByWorkItem.get(line.dailyLogWorkItemId) || '', machineType: line.raw.machineType || line.raw.machineName,
          machineCount: line.count, hoursPerMachine: line.count > 0 ? line.totalHours / line.count : 0,
          provider: resourceProvider(line.raw), note: line.raw.note, sourceMachineLineId: line.id, sourceIndex: index,
        })),
      };
      await dailyLogWbsService.saveSummary(input);
      onSaved?.();
      if (submit) onSubmit?.();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể lưu bản tổng hợp.'); }
    finally { setBusy(false); }
  };

  const updateProgress = (itemId: string, value: number) => setCards(current => current.map(card => ({ ...card, source: { ...card.source, hasAdjustments: true, adjustmentReason: card.source.adjustmentReason || 'Điều chỉnh khi tổng hợp' }, editedItems: card.editedItems.map(item => (item.id || item.sourceWorkItemId) === itemId ? { ...item, cumulativeProgressPercent: value } : item) })));
  return <section className="space-y-4" aria-label="Workspace tổng hợp theo khu vực">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="text-xs text-slate-500">Phạm vi</div><div className="mt-1 text-lg font-black">{cards.length} khu vực</div></div><div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="text-xs text-slate-500">Nhân công</div><div className="mt-1 text-lg font-black">{people} người</div></div><div className={`col-span-2 rounded-xl border p-3 sm:col-span-1 ${warningCount ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50'}`}><div className="text-xs text-slate-500">Cần xử lý</div><div className="mt-1 text-lg font-black">{warningCount} cảnh báo</div></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {cards.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Chưa có phiếu nguồn đã gửi để tổng hợp.</div> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{cards.map(card => <DailyLogAreaCard key={card.contribution.id} card={card} mode={mode} onProgressChange={updateProgress} onRefresh={sourceId => setCards(current => current.map(value => value.source.id === sourceId ? { ...value, source: { ...value.source, sourceState: 'current', hasAdjustments: false, refreshSource: true } as DailyLogSummarySource & { refreshSource: boolean }, editedItems: value.sourceItems, resources: value.sourceResources } : value))} onRemove={sourceId => setCards(current => current.filter(value => value.source.id !== sourceId))} onRequestChange={async (sourceId, comment) => { if (!bundle.summaryLog) return; setBusy(true); try { await dailyLogWbsService.requestSourceChange({ dailyLogId: bundle.summaryLog.id, summarySourceId: sourceId, comment, expectedUpdatedAt: expectedUpdatedAt(bundle.summaryLog) }); onSaved?.(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể yêu cầu sửa khu vực.'); } finally { setBusy(false); } }} />)}</div>}
    <DailyLogConsolidatedWbsTable groups={groups} decisions={decisions} readOnly={mode === 'review'} onDecisionChange={(taskId, patch) => setDecisions(current => ({ ...current, [taskId]: { ...current[taskId], ...patch } }))} />
    {(sourceBlockers > 0 || unresolved > 0) && <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{sourceBlockers > 0 ? 'Có nguồn bị thiếu hoặc đã trả lại. ' : ''}{unresolved > 0 ? `${unresolved} WBS chưa có quyết định chính thức và lý do.` : ''}</span></div>}
    {mode === 'summarize' ? <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur sm:flex-row sm:justify-end dark:border-slate-700 dark:bg-slate-900/95"><button type="button" disabled={busy || !canSubmit} onClick={() => save(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-teal-700 px-5 text-sm font-bold text-teal-800 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Lưu tổng hợp</button><button type="button" disabled={busy || !canSubmit} onClick={() => save(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Gửi CHT</button></div> : <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-3 sm:flex-row sm:justify-end dark:border-slate-700 dark:bg-slate-900/95"><button type="button" onClick={onReturnAll} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-700"><RotateCcw size={15} /> Trả lại toàn bộ</button>{canPublishDailyLogSummary({ log: bundle.summaryLog, canApprove: bundle.permissions.canApprove, canPublishProgress: bundle.permissions.canPublishProgress }) && <button type="button" onClick={onPublish} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white"><CheckCircle2 size={16} /> Duyệt & công bố</button>}</div>}
  </section>;
};
