import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DailyLog, DailyLogContribution, DailyLogResourceProvider, DailyLogSummarySource, DailyLogWbsDecisionDraft, DailyLogWorkItem } from '../../../types';
import { aggregateAreaWorkItems } from '../../../lib/dailyLogWorkItemRules';
import { canPublishDailyLogSummary } from '../../../lib/dailyLogWorkflow';
import { dailyLogWbsService, type DailyLogWbsBundle, type DailyLogWorkSaveReceipt, type SaveDailyLogSummaryWorkInput } from '../../../lib/dailyLogWbsService';
import { DailyLogAreaCard, type DailyLogAreaCardModel, type SummaryResourceLine } from './DailyLogAreaCard';
import { DailyLogConsolidatedWbsTable, hasUnresolvedWbsDecision, type ConsolidatedTaskGroup } from './DailyLogConsolidatedWbsTable';
import { DailyLogSourcePicker } from './DailyLogSourcePicker';
import { DailyLogDocumentHeader } from './DailyLogDocumentHeader';
import { formatDailyLogDate, formatDailyLogTime, formatDailyLogQuantity, summarizeDailyLogPhysicalRows } from '../../../lib/dailyLogPresentation';
import { Link } from 'react-router-dom';

interface Props {
  bundle: DailyLogWbsBundle;
  mode: 'summarize' | 'review' | 'verified';
  ensureSummaryLog?: () => Promise<DailyLog>;
  onSaved?: (receipt?: DailyLogWorkSaveReceipt) => void | Promise<void>;
  onSubmit?: (receipt: DailyLogWorkSaveReceipt) => void | Promise<void>;
  onPublish?: () => void | Promise<void>;
  onReturnAll?: () => void | Promise<void>;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
  metadataForm?: React.ReactNode;
  metadataDirty?: boolean;
  canSendSummary?: boolean;
  sendDisabledReason?: string;
}

interface SummaryDraft {
  cards: DailyLogAreaCardModel[];
  groups: ConsolidatedTaskGroup[];
  decisions: Record<string, DailyLogWbsDecisionDraft>;
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
const physicalNumber = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value);

const asResource = (line: any, kind: 'labor' | 'machine'): SummaryResourceLine => ({
  id: line.id, dailyLogWorkItemId: line.dailyLogWorkItemId, contributionId: line.contributionId,
  summarySourceId: line.summarySourceId, kind,
  label: kind === 'labor' ? line.laborType || 'Nhân công' : line.machineType || line.machineName || 'Máy',
  count: physicalNumber(kind === 'labor' ? line.peopleCount : line.machineCount),
  totalHours: physicalNumber(kind === 'labor' ? line.totalLaborHours : line.totalMachineHours),
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
  const taskItems = items.filter(item => item.taskId === aggregate.taskId);
  const units = new Set(taskItems.map(item => item.unit?.trim()).filter(Boolean));
  const areas = new Set(taskItems.map(item => item.workAreaCode.trim().toUpperCase()));
  const allocated = taskItems.reduce((sum,item)=>sum+(item.areaPlannedQuantity || 0),0);
  const whole = Math.max(...taskItems.map(item=>item.plannedQuantity || 0));
  if (taskItems.length > 1 && (taskItems.some(item=>!item.unit?.trim()) || units.size !== 1 || areas.size < taskItems.length || allocated > whole + 0.0001)) {
    aggregate = { ...aggregate, officialCumulativePercent:null, cumulativeQuantity:null, dailyQuantity:null,
      conflicts:[...new Set([...aggregate.conflicts,'duplicate_daily_quantity' as const])] };
  }
  const forecasts = new Set(items.filter(item => item.taskId === aggregate.taskId).map(item => item.forecastFinishDate).filter(Boolean));
  return forecasts.size > 1 && !aggregate.conflicts.includes('forecast_mismatch')
    ? { ...aggregate, conflicts: [...aggregate.conflicts, 'forecast_mismatch' as const] }
    : aggregate;
});
const autoDecision = (group: ConsolidatedTaskGroup, dailyLogId=''): DailyLogWbsDecisionDraft => ({
  dailyLogId, taskId:group.aggregate.taskId, officialCumulativePercent:group.aggregate.officialCumulativePercent,
  officialCumulativeQuantity:group.aggregate.cumulativeQuantity,officialDailyQuantity:group.aggregate.dailyQuantity,
  aggregationMethod:group.items.length===1?'single_source':'weighted_area_allocation',dailyQuantityMethod:'sum_non_overlapping',
  includedSourceWorkItemIds:group.aggregate.sourceWorkItemIds,sourceFingerprint:'',forecastFinishDate:group.items[0]?.forecastFinishDate,
});
const sameSources = (left: string[],right: string[]) => JSON.stringify([...left].sort())===JSON.stringify([...right].sort());

export const buildDailyLogSummaryDraft = (bundle: DailyLogWbsBundle, selectedIds = bundle.summarySources.map(source => source.contributionId)): SummaryDraft => {
  const sourceByContribution = new Map(bundle.summarySources.map(source => [source.contributionId, source]));
  const contributions = [...bundle.contributionsForSummary];
  bundle.summarySources.forEach(source => {
    if (!contributions.some(item => item.id === source.contributionId)) contributions.push({
      id: source.contributionId, date: bundle.summaryLog?.date || '', authorUserId: source.sourceUserId || '',
      authorName: source.sourceUserName, content: '', status: source.sourceState === 'returned' ? 'returned' : 'included',
      workAreaCode: source.workAreaCode, workAreaName: source.workAreaName, createdAt: source.createdAt || '', updatedAt: source.updatedAt,
    });
  });
  const cards = contributions.filter(contribution => selectedIds.includes(contribution.id)).map((contribution, index) => {
    const storedSource = sourceByContribution.get(contribution.id) || makeVirtualSource(contribution, index);
    const source: DailyLogSummarySource = contribution.status === 'returned'
      ? { ...storedSource, sourceState: 'returned' }
      : (storedSource.sourceVersion != null && storedSource.sourceVersion !== (contribution.rowVersion || 1))
        || (storedSource.sourceFingerprint != null && storedSource.sourceFingerprint !== (contribution.sourceFingerprint || ''))
        ? { ...storedSource, sourceState: 'changed' }
        : storedSource;
    const sourceItems = bundle.workItems.filter(item => item.contributionId === contribution.id && !item.dailyLogId);
    const copied = bundle.workItems.filter(item => item.summarySourceId === source.id && item.dailyLogId === bundle.summaryLog?.id);
    const hasCopy = Boolean(bundle.summaryLog && bundle.summarySources.some(source => source.contributionId === contribution.id));
    const historical = bundle.summaryLog?.status === 'verified';
    const editedItems = historical || copied.length > 0 || hasCopy && storedSource.hasAdjustments ? copied : sourceItems;
    const allLines = [...bundle.labor.map(line => asResource(line, 'labor')), ...bundle.machines.map(line => asResource(line, 'machine'))];
    const sourceResources = allLines.filter(line => line.contributionId === contribution.id && !line.summarySourceId);
    const copiedResources = allLines.filter(line => line.summarySourceId === source.id);
    return { contribution, source, sourceItems, editedItems, sourceResources, resources: historical || copied.length > 0 || hasCopy && storedSource.hasAdjustments ? copiedResources : sourceResources };
  });
  const activeItems = cards.flatMap(card => card.editedItems);
  const aggregates = addForecastConflicts(activeItems, aggregateAreaWorkItems(activeItems.map(item => ({
    id: item.sourceWorkItemId || item.id || `${item.taskId}-${item.workAreaCode}`,
    taskId: item.taskId, workAreaCode: item.workAreaCode,
    areaPlannedQuantity: item.areaPlannedQuantity ?? null,
    cumulativePercent: item.cumulativeProgressPercent, dailyQuantity: item.dailyQuantityDone ?? null,
  }))));
  const groups = aggregates.map(aggregate => ({ aggregate, items: activeItems.filter(item => item.taskId === aggregate.taskId) }));
  const existing = new Map(bundle.decisions.map(decision => [decision.taskId, decision]));
  const decisions = Object.fromEntries(groups.flatMap(group => {
    const {aggregate}=group;
    const saved = existing.get(aggregate.taskId);
    const auto = bundle.summaryLog?.status === 'verified'
      ? saved
      : saved && sameSources(saved.includedSourceWorkItemIds,aggregate.sourceWorkItemIds) ? saved : autoDecision(group,bundle.summaryLog?.id);
    return auto ? [[aggregate.taskId, auto]] : [];
  }));
  const sourceWarnings = cards.filter(card => card.source.sourceState && card.source.sourceState !== 'current').length;
  const taskWarnings = groups.filter(group => group.aggregate.conflicts.length > 0).length;
  const blockers = [
    ...cards.filter(card => ['missing', 'returned', 'changed'].includes(card.source.sourceState || '')).map(card => `source_${card.source.sourceState}`),
    ...groups.flatMap(group => group.aggregate.conflicts),
  ];
  return { cards, groups, decisions, warningCount: sourceWarnings + taskWarnings, blockers };
};

const expectedUpdatedAt = (log: DailyLog) => log.lastActionAt || log.createdAt;

export const adjustSummaryCardProgress = (card: DailyLogAreaCardModel, itemId: string, percent: number, reason: string): DailyLogAreaCardModel => {
  if (!reason.trim()) throw new Error('Cần nhập lý do chỉnh bản sao.');
  return { ...card, source: { ...card.source, hasAdjustments: true, adjustmentReason: reason.trim() }, editedItems: card.editedItems.map(item => {
    if ((item.id || item.sourceWorkItemId) !== itemId) return item;
    const quantity = Number.isFinite(percent) && item.unit?.trim() && item.areaPlannedQuantity != null && item.areaPlannedQuantity > 0
      ? Math.round(item.areaPlannedQuantity * percent * 100) / 10000 : null;
    return { ...item, cumulativeProgressPercent: percent, cumulativeQuantityDone: quantity,
      dailyQuantityDone: quantity != null && item.baselineQuantityDone != null ? Math.round((quantity - item.baselineQuantityDone) * 10000) / 10000 : null };
  }) };
};

export const DailyLogSummaryWorkspace: React.FC<Props> = ({ bundle, mode, ensureSummaryLog, onSaved, onSubmit, onPublish, onReturnAll, onClose = () => {}, onBusyChange, metadataForm, metadataDirty=false, canSendSummary=true, sendDisabledReason }) => {
  const initial = useMemo(() => buildDailyLogSummaryDraft(bundle), [bundle]);
  const [cards, setCards] = useState(initial.cards);
  const [pickerOpen, setPickerOpen] = useState(initial.cards.length === 0);
  const [savedDecisions, setDecisions] = useState(initial.decisions);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'primary' | 'secondary' | null>(null);
  const busyRef = useRef(false);
  const commandIds = useRef<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const items = cards.flatMap(card => card.editedItems);
    return addForecastConflicts(items, aggregateAreaWorkItems(items.map(item => ({ id: item.sourceWorkItemId || item.id || '', taskId: item.taskId, workAreaCode: item.workAreaCode, areaPlannedQuantity: item.areaPlannedQuantity ?? null, cumulativePercent: item.cumulativeProgressPercent, dailyQuantity: item.dailyQuantityDone ?? null }))))
      .map(aggregate => ({ aggregate, items: items.filter(item => item.taskId === aggregate.taskId) }));
  }, [cards]);
  const decisions = bundle.summaryLog?.status==='verified' ? savedDecisions : Object.fromEntries(groups.map(group=>[group.aggregate.taskId,savedDecisions[group.aggregate.taskId] || autoDecision(group,bundle.summaryLog?.id)]));
  const lines = cards.flatMap(card => card.resources);
  const physical = summarizeDailyLogPhysicalRows({ workItems: cards.flatMap(card => card.editedItems), labor: lines.filter(line => line.kind === 'labor').map(line => ({peopleCount:line.count,totalLaborHours:line.totalHours})), machines: lines.filter(line => line.kind === 'machine').map(line => ({machineCount:line.count,totalMachineHours:line.totalHours})) });
  const sourceBlockers = cards.filter(card => ['missing', 'returned', 'changed'].includes(card.source.sourceState || '') || card.source.reviewStatus === 'change_requested').length;
  const unresolved = groups.filter(group => hasUnresolvedWbsDecision(group.aggregate, decisions[group.aggregate.taskId])).length;
  const warningCount = sourceBlockers + unresolved;
  const verified = mode === 'verified' || bundle.summaryLog?.status === 'verified';
  const missingSavedCopies = verified && cards.some(card => card.editedItems.length === 0);
  const historicalQualityCount = cards.filter(card => card.editedItems.length === 0).length
    + cards.flatMap(card => card.editedItems).filter(item => !item.unit?.trim()).length
    + groups.filter(group => !decisions[group.aggregate.taskId]).length;
  const report = mode !== 'summarize';
  const periodLocked = bundle.periodState?.isLocked === true;
  const canReview = mode === 'review' && !verified && bundle.rollout.enabled && bundle.summaryLog?.status === 'submitted' && bundle.permissions.canApprove;
  const canSubmit = bundle.rollout.enabled && bundle.permissions.canSummarize && canSendSummary && sourceBlockers === 0 && unresolved === 0 && cards.length > 0 && groups.length > 0;
  const safeDraft = cards.every(card => card.editedItems.every(item => Number.isFinite(item.cumulativeProgressPercent) && item.cumulativeProgressPercent >= item.baselineProgressPercent && item.cumulativeProgressPercent <= 100)
    && (!card.source.hasAdjustments || Boolean(card.source.adjustmentReason?.trim()))) && lines.every(line => line.count != null && line.count > 0 && line.totalHours != null && line.totalHours > 0)
    && Object.values(decisions).every(decision => (decision.officialCumulativePercent == null || Number.isFinite(decision.officialCumulativePercent) && decision.officialCumulativePercent >= 0 && decision.officialCumulativePercent <= 100)
      && [decision.officialCumulativeQuantity,decision.officialDailyQuantity].every(value=>value==null || Number.isFinite(value) && value>=0));
  const editable = mode === 'summarize' && bundle.rollout.enabled && bundle.permissions.canSummarize && (!bundle.summaryLog || ['draft','rejected'].includes(bundle.summaryLog.status));
  const canSave = editable && safeDraft;
  const setWorking = (value: boolean, action: 'primary' | 'secondary' = 'secondary') => { busyRef.current = value; setBusy(value); setBusyAction(value ? action : null); onBusyChange?.(value); };

  const save = async (submit: boolean) => {
    if (busyRef.current || !canSave || submit && !canSubmit) return;
    setWorking(true, submit ? 'primary' : 'secondary'); setError(null); setNotice(null);
    try {
      const log = ensureSummaryLog ? await ensureSummaryLog() : bundle.summaryLog;
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
          summaryDocumentVersion: 2,
          contributionId: card.contribution.id, sourceVersion: card.contribution.rowVersion || card.source.sourceVersion,
          sourceFingerprint: card.contribution.sourceFingerprint || card.source.sourceFingerprint || '',
          includedText: true, includedPhotos: card.contribution.photos || [], sortOrder: index,
          hasAdjustments: Boolean(card.source.hasAdjustments), adjustmentReason: card.source.adjustmentReason || null,
          refreshSource: Boolean((card.source as DailyLogSummarySource & { refreshSource?: boolean }).refreshSource),
        })),
        items,
        decisions: groups.map(group => ({ ...decisions[group.aggregate.taskId], pending: hasUnresolvedWbsDecision(group.aggregate, decisions[group.aggregate.taskId]), dailyLogId: log.id, taskId: group.aggregate.taskId, includedSourceWorkItemIds: group.aggregate.sourceWorkItemIds })),
        labor: lines.filter(line => line.kind === 'labor').map((line, index) => ({
          workItemClientKey: keyByWorkItem.get(line.dailyLogWorkItemId) || '', laborType: line.raw.laborType,
          peopleCount: line.count!, hoursPerPerson: line.totalHours! / line.count!,
          provider: resourceProvider(line.raw), note: line.raw.note, sourceLaborLineId: line.raw.sourceLaborLineId || line.id, sourceIndex: index,
        })),
        machines: lines.filter(line => line.kind === 'machine').map((line, index) => ({
          workItemClientKey: keyByWorkItem.get(line.dailyLogWorkItemId) || '', machineType: line.raw.machineType || line.raw.machineName,
          machineCount: line.count!, hoursPerMachine: line.totalHours! / line.count!,
          provider: resourceProvider(line.raw), note: line.raw.note, sourceMachineLineId: line.raw.sourceMachineLineId || line.id, sourceIndex: index,
        })),
      };
      const receipt = await dailyLogWbsService.saveSummary(input);
      setDirty(false);
      await onSaved?.(receipt);
      if (submit) await onSubmit?.(receipt);
      else setNotice('Đã lưu bản tổng hợp. Các mục chưa chốt vẫn là nháp.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể lưu bản tổng hợp.'); }
    finally { setWorking(false); }
  };

  const publish = async () => {
    if (busyRef.current || !onPublish || !canReview || periodLocked || sourceBlockers || unresolved) return;
    setWorking(true,'primary'); setError(null);
    try { await onPublish(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể công bố tiến độ.'); }
    finally { setWorking(false); }
  };
  const returnSummary = async () => {
    if(busyRef.current || !canReview || !onReturnAll) return;
    setWorking(true,'secondary');setError(null);
    try{await onReturnAll();}catch(caught){setError(caught instanceof Error?caught.message:'Không thể trả bản tổng hợp.');}
    finally{setWorking(false);}
  };

  const selectSources = (ids: string[]) => {
    setDirty(true);
    const next = buildDailyLogSummaryDraft(bundle, ids);
    setCards(current => next.cards.map(card => current.find(old => old.contribution.id === card.contribution.id) || card));
    setDecisions(current=>Object.fromEntries(next.groups.map(group=>[group.aggregate.taskId,
      current[group.aggregate.taskId] && sameSources(current[group.aggregate.taskId].includedSourceWorkItemIds,group.aggregate.sourceWorkItemIds)
        ? current[group.aggregate.taskId] : next.decisions[group.aggregate.taskId]])));
    setNotice(null);
  };
  const updateProgress = (sourceId: string, itemId: string, value: number, reason: string) => {
    setDirty(true);
    const taskId=cards.find(card=>card.source.id===sourceId)?.editedItems.find(item=>(item.id||item.sourceWorkItemId)===itemId)?.taskId;
    setCards(current => current.map(card => card.source.id === sourceId ? adjustSummaryCardProgress(card, itemId, value, reason) : card));
    setDecisions(current => Object.fromEntries(Object.entries(current).filter(([id])=>id!==taskId)));
  };
  const requestChange = async (sourceId: string, comment: string) => {
    if (busyRef.current || !bundle.summaryLog || !comment.trim() || verified || periodLocked || (mode === 'review' ? !canReview : !editable || dirty || metadataDirty)) return;
    const card = cards.find(card => card.source.id === sourceId);
    if (!card) return;
    setWorking(true); setError(null);
    try {
      const key = `${sourceId}:${card.contribution.rowVersion}:${expectedUpdatedAt(bundle.summaryLog)}:${comment}`;
      const commandId = commandIds.current[key] ||= crypto.randomUUID();
      await dailyLogWbsService.returnSource({ commandId, dailyLogId: bundle.summaryLog.id, summarySourceId: sourceId,
        contributionId: card.contribution.id, expectedSummaryUpdatedAt: expectedUpdatedAt(bundle.summaryLog),
        expectedRowVersion: card.contribution.rowVersion || card.source.sourceVersion || 1, reason: comment });
      await onSaved?.();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể trả phiếu.'); }
    finally { setWorking(false); }
  };
  const date = bundle.summaryLog?.date || bundle.contributionsForSummary[0]?.date || '';
  const summaryAuthor = bundle.summaryLog?.summarizedByName || bundle.summaryLog?.createdBy || '';
  const publishAllowed = canReview && canPublishDailyLogSummary({log:bundle.summaryLog,canApprove:bundle.permissions.canApprove,canPublishProgress:bundle.permissions.canPublishProgress});
  const reopenUrl=`/da?${new URLSearchParams({projectId:bundle.summaryLog?.projectId || '',...(bundle.summaryLog?.constructionSiteId?{siteId:bundle.summaryLog.constructionSiteId}:{}),tab:'weekly_progress'})}`;
  return <section className="daily-log-document daily-log-summary min-w-0 text-foreground" aria-label="Workspace tổng hợp theo phiếu">
    {mode === 'summarize' && <DailyLogDocumentHeader title="Tổng hợp thi công ngày" date={date} authorName={summaryAuthor}
      statusLabel={bundle.summaryLog?.status === 'rejected' ? 'Cần sửa' : 'Nháp tổng hợp'} statusTone={bundle.summaryLog?.status === 'rejected' ? 'returned' : 'neutral'}
      mode="summarize" busyAction={busyAction} onClose={onClose} closeDisabled={busy}
      secondaryAction={{label:'Lưu tổng hợp',disabled:!canSave,onClick:()=>save(false),disabledReason:!safeDraft?'Kiểm tra số liệu vật lý và lý do chỉnh bản sao trước khi lưu.':!editable?'Bạn chưa có quyền chỉnh bản tổng hợp này.':undefined}}
      primaryAction={{label:'Gửi CHT',disabled:!canSave || !canSubmit,onClick:()=>save(true),disabledReason:!canSendSummary?sendDisabledReason || 'Hoàn thiện thông tin gửi trước khi gửi CHT.':!canSubmit?'Chọn phiếu và xử lý các mục còn vướng trước khi gửi CHT.':undefined}} />}
    {report && <DailyLogDocumentHeader title="Bản tổng hợp thi công ngày" date={date} authorName={summaryAuthor}
      mode={verified?'verified':'review'} statusLabel={verified?'Đã xác nhận':bundle.summaryLog?.status==='submitted'?'Chờ CHT duyệt':bundle.summaryLog?.status==='rejected'?'Cần sửa':'Nháp tổng hợp'}
      statusTone={verified?'verified':bundle.summaryLog?.status==='rejected'?'returned':'pending'}
      busyAction={busyAction} onClose={onClose} closeDisabled={busy}
      secondaryAction={canReview && onReturnAll?{label:'Trả bản tổng hợp',tone:'return',disabled:busy,onClick:returnSummary}:undefined}
      primaryAction={publishAllowed && !periodLocked && onPublish?{label:bundle.rollout.mode==='pilot'?'Đối chiếu thử nghiệm':'Duyệt & công bố',tone:bundle.rollout.mode==='pilot'?undefined:'approve',disabled:busy || Boolean(sourceBlockers || unresolved),disabledReason:sourceBlockers || unresolved?'Có phiếu hoặc quyết định chưa hoàn thiện. Trả đúng phiếu hoặc bản tổng hợp để sửa.':undefined,onClick:publish}:undefined}/>}
    <div className="daily-log-document-body space-y-5 p-4 sm:p-6">
      {report && verified && <dl className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Người duyệt</dt><dd className="mt-1">{bundle.summaryLog?.verifiedBy || 'Chưa xác định người duyệt'}</dd></div><div><dt className="text-muted-foreground">Thời điểm duyệt</dt><dd className="mt-1">{bundle.summaryLog?.verifiedAt?`${formatDailyLogDate(bundle.summaryLog.verifiedAt)} · ${formatDailyLogTime(bundle.summaryLog.verifiedAt)}`:'Chưa xác định thời điểm duyệt'}</dd></div></dl>}
      {report && !verified && bundle.rollout.mode==='pilot' && <p className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100">Chế độ thử nghiệm: chỉ đối chiếu dữ liệu, chưa công bố tiến độ chính thức. Bản tổng hợp vẫn chờ duyệt sau khi đối chiếu.</p>}
      {report && periodLocked && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Kỳ tiến độ đang khóa. <Link to={reopenUrl} className="inline-flex min-h-11 items-center font-medium underline">Mở Chốt tiến độ</Link> để mở kỳ trước khi xử lý.</p>}
      {missingSavedCopies && <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">Thiếu dữ liệu bản sao đã lưu. Tổng quan chưa xác định đầy đủ; không lấy số liệu nguồn mới để điền vào hồ sơ đã duyệt.</p>}
      <dl className="dl-summary-metrics grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm lg:grid-cols-5">
        <div><dt className="text-muted-foreground">Phiếu đã nhận / được chọn</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{bundle.contributionsForSummary.filter(source=>source.status==='submitted'||source.status==='included').length} / {cards.length}</dd><dd className="text-xs text-muted-foreground">{cards.length} khu vực</dd></div>
        <div><dt className="text-muted-foreground">WBS duy nhất</dt><dd className="mt-1 text-lg font-semibold">{formatDailyLogQuantity(missingSavedCopies?null:physical.uniqueWbsCount)}</dd></div>
        <div><dt className="text-muted-foreground">Giờ công</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatDailyLogQuantity(missingSavedCopies?null:physical.totalLaborHours)}</dd><dd className="text-xs text-muted-foreground">Lượt người theo hạng mục: {formatDailyLogQuantity(missingSavedCopies?null:physical.laborPersonEntries)}</dd></div>
        <div><dt className="text-muted-foreground">Giờ máy</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatDailyLogQuantity(missingSavedCopies?null:physical.totalMachineHours)}</dd><dd className="text-xs text-muted-foreground">Lượt máy theo hạng mục: {formatDailyLogQuantity(missingSavedCopies?null:physical.machineEntries)}</dd></div>
        <div><dt className="text-muted-foreground">{verified?'Chất lượng dữ liệu':'Cần xử lý'}</dt><dd className="mt-1 text-lg font-semibold">{verified?historicalQualityCount:warningCount} {verified?'ghi nhận':'cảnh báo'}</dd></div>
      </dl>
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">{notice}</p>}
      {mode === 'summarize' && <details className="rounded-md border border-border p-4" open={pickerOpen} onToggle={event=>setPickerOpen(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer text-base font-semibold">Chọn phiếu để tổng hợp · {cards.length} đã chọn</summary><fieldset disabled={busy || !editable} className="mt-3 min-w-0"><DailyLogSourcePicker sources={bundle.contributionsForSummary} selectedIds={cards.map(card=>card.contribution.id)} selectionMode="multiple" onChange={selectSources} /></fieldset><p className="mt-3 text-sm text-muted-foreground">Chọn đúng phiếu cần tổng hợp. Bỏ chọn không xóa hoặc sửa phiếu gốc.</p></details>}
      {metadataForm}
      {report && <section className="space-y-3 rounded-md border border-border p-4 text-sm"><h2 className="text-base font-semibold">Ghi nhận trong ngày</h2><p className="whitespace-pre-wrap break-words">{bundle.summaryLog?.description || 'Chưa có nội dung tổng hợp'}</p>{bundle.summaryLog?.issues && <p className="whitespace-pre-wrap break-words">Vấn đề / sự cố: {bundle.summaryLog.issues}</p>}{bundle.summaryLog?.nextDayPlan && <p className="whitespace-pre-wrap break-words">Kế hoạch ngày sau: {bundle.summaryLog.nextDayPlan}</p>}<div className="flex flex-wrap gap-3">{bundle.summaryLog?.photos?.map((photo,index)=><a key={`${photo.url}-${index}`} href={photo.url} target="_blank" rel="noreferrer" className="break-words text-teal-800 underline dark:text-teal-200">{photo.name || 'Ảnh nhật ký'}</a>)}</div></section>}
      <section className="space-y-3"><h2 className="text-base font-semibold">Phiếu được chọn</h2>
        {cards.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">{report?'Chưa có phiếu nguồn đã lưu.':'Chưa chọn phiếu. Mở “Chọn phiếu để tổng hợp” ở trên để bắt đầu.'}</p> : <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{cards.map(card => <DailyLogAreaCard key={card.contribution.id} card={card} mode={verified?'verified':mode} busy={busy}
          canRequestChange={!verified && !periodLocked && card.source.sourceState === 'current' && (mode === 'review' ? canReview : editable)}
          returnDisabledReason={mode === 'summarize' && (dirty || metadataDirty || !bundle.summaryLog || card.source.id?.startsWith('new-source-')) ? 'Lưu tổng hợp trước khi trả phiếu để giữ chỉnh sửa.' : undefined}
          onProgressChange={editable ? updateProgress : undefined}
          onRefresh={sourceId => {
            setDirty(true);
            setCards(current => current.map(value => value.source.id === sourceId ? { ...value, source: { ...value.source, sourceState: 'current', reviewStatus: 'ready', sourceVersion:value.contribution.rowVersion,sourceFingerprint:value.contribution.sourceFingerprint,hasAdjustments: false, adjustmentReason:null, sourceSnapshot:{content:value.contribution.content,issues:value.contribution.issues,photos:value.contribution.photos,updatedAt:value.contribution.updatedAt}, refreshSource: true } as DailyLogSummarySource & { refreshSource: boolean }, editedItems: value.sourceItems, resources: value.sourceResources } : value));
            setNotice('Đã lấy số liệu từ phiếu gửi lại. Lưu tổng hợp để giữ cập nhật này.');
            const changedTasks=cards.find(card=>card.source.id===sourceId)?.editedItems.map(item=>item.taskId) || [];
            setDecisions(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!changedTasks.includes(id))));
          }} onRemove={sourceId=>selectSources(cards.filter(value=>value.source.id!==sourceId).map(value=>value.contribution.id))} onRequestChange={requestChange} />)}</div>}
      </section>
      <DailyLogConsolidatedWbsTable groups={groups} decisions={decisions} readOnly={report} historical={verified} busy={busy} onDecisionChange={(taskId, patch) => {setDirty(true);setDecisions(current => ({ ...current, [taskId]: { ...decisions[taskId], ...patch, pending:false } }));}} />
      {warningCount > 0 && !verified && <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span>{report?'Có phiếu hoặc quyết định cần kiểm tra. Trả đúng phiếu hoặc bản tổng hợp cho người phụ trách để sửa.':<>{sourceBlockers > 0 ? 'Có phiếu cần sửa, gửi lại hoặc thiếu nguồn. Xử lý đúng phiếu trước khi gửi. ' : ''}{unresolved > 0 ? `${unresolved} WBS chưa chốt. Có thể lưu tổng hợp để tiếp tục sau; chưa thể gửi CHT.` : ''}</>}</span></p>}
    </div>
  </section>;
};
