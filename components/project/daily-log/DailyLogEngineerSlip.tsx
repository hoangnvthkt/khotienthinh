import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, Trash2 } from 'lucide-react';
import type { DailyLogCrewContract, DailyLogEntryMode, DailyLogPhoto, DailyLogSourceItemV2 } from '../../../types';
import { dailyLogWbsService, type DailyLogDocumentBundle, type SubmitDailyLogSourceInput } from '../../../lib/dailyLogWbsService';
import { deriveDailyLogEntry } from '../../../lib/dailyLogEntryRules';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';
import { formatDailyLogDate, formatDailyLogTime } from '../../../lib/dailyLogPresentation';
import { composeSlipNotes, normalizeBulletText } from '../../../lib/dailyLogItemNotes';
import { DailyLogDocumentHeader } from './DailyLogDocumentHeader';
import { DailyLogResourceEditor } from './DailyLogResourceEditor';
import { DailyLogSlipRows } from './DailyLogSlipRows';
import { copyFromArea, defaultEntryMode, defaultForecast, forecastProblem } from '../../../lib/dailyLogSlipRules';
import { DailyLogEngineerWorkTable, type DailyLogEngineerRow } from './DailyLogWorkItemTable';
import type { DailyLogContributionWorkEditorProps } from './DailyLogContributionWorkEditor';
import './daily-log-engineer.css';

const hydrateRow = (bundle: DailyLogDocumentBundle, item: DailyLogSourceItemV2): DailyLogEngineerRow => {
  const task = bundle.tasks.find(t => t.id === item.taskId);
  const work = bundle.workBoqItems.find(w => w.id === item.workBoqItemId);
  const snapshot = bundle.workItems.find(w => w.contributionId === bundle.contribution?.id && w.taskId === item.taskId);
  const readonly = bundle.contribution?.status === 'submitted' || bundle.contribution?.status === 'included';
  const plan = readonly && snapshot ? snapshot.areaPlannedQuantity ?? snapshot.plannedQuantity ?? null
    : item.areaPlannedQuantity ?? (Number(work?.plannedQty) || Number(task?.provisionalQuantity) || null);
  const unit = readonly && snapshot ? snapshot.unit ?? null : work?.unit?.trim() || task?.fallbackUnit?.trim() || null;
  const context = bundle.quantityBaselines?.[item.taskId];
  // A qualified prior snapshot with a different conversion basis is still unknown.
  const known = context?.state === 'known' && context.previousItem?.areaPlannedQuantitySnapshot === plan
    && context.previousItem?.unitSnapshot === unit;
  const state = readonly && snapshot ? snapshot.baselineQuantityDone == null ? 'unknown' : 'known'
    : context?.state === 'none' ? 'none' : known ? 'known' : 'unknown';
  return { ...item, baselineFingerprint: context?.fingerprint || item.baselineFingerprint,
    taskName: (readonly ? snapshot?.taskName : task?.name) || snapshot?.taskName || task?.name || 'Công việc không còn trong phạm vi',
    wbsCode: (readonly ? snapshot?.wbsCode : task?.wbsCode) || snapshot?.wbsCode || task?.wbsCode || '',
    unit, plannedQuantity: plan, baselineQuantityState: state,
    previousCumulativeQuantity: readonly && snapshot ? snapshot.baselineQuantityDone ?? null : known ? context!.previousItem!.cumulativeQuantityDone : null,
    allowOver100: context?.allowOver100 === true, scheduleFinishDate: task?.endDate || null,
    snapshot: readonly && snapshot ? { dailyQuantity: snapshot.dailyQuantityDone ?? null, cumulativeQuantity: snapshot.cumulativeQuantityDone ?? null,
      cumulativePercent: snapshot.cumulativeProgressPercent ?? null } : null };
};

/** New row for a WBS task: % or today's quantity by basis; past plan dates are not offered as the forecast. */
const newRow = (bundle: DailyLogDocumentBundle, taskId: string, clientKey: string, slipDate: string): DailyLogEngineerRow => {
  const work = bundle.workBoqItems.find(w => w.sourceTaskId === taskId);
  const context = bundle.quantityBaselines?.[taskId];
  const base = hydrateRow(bundle, { clientKey, taskId, workBoqItemId: work?.id, baselineFingerprint: context?.fingerprint || '',
    entryMode: 'percent', enteredValue: '', forecastFinishDate: defaultForecast(bundle.tasks.find(t => t.id === taskId)?.endDate, slipDate) });
  return { ...base, entryMode: defaultEntryMode(base) };
};

export const DailyLogEngineerSlip: React.FC<DailyLogContributionWorkEditorProps & { bundle: DailyLogDocumentBundle }> = ({
  bundle, error, loading, denied, onReload, onSaved, onSubmitted, onClose, onUploadPhoto, onBusyChange, onDeleted, onWithdrawn, recentAreas,
}) => {
  const source = bundle.contribution!;
  const raw = source.sourceDraftPayload;
  const rawItems: DailyLogSourceItemV2[] = raw?.items ?? bundle.workItems.filter(w => w.contributionId === source.id && !w.dailyLogId).map(w => ({
    clientKey: w.id!, taskId: w.taskId, workBoqItemId: w.workBoqItemId, areaPlannedQuantity: w.areaPlannedQuantity,
    entryMode: 'percent', enteredValue: w.cumulativeProgressPercent, baselineFingerprint: bundle.baselineQuantityFingerprints?.[w.taskId] || '',
    forecastFinishDate: w.forecastFinishDate, forecastChangeReason: w.forecastChangeReason, note: w.note, attachments: w.attachments,
  }));
  const [rows, setRows] = useState(() => rawItems.map(item => hydrateRow(bundle, item)));
  // Slips written before per-item notes kept one free text; keep it until the author removes it.
  const [legacyNotes, setLegacyNotes] = useState(() => {
    const derived = composeSlipNotes(rows);
    const pick = (text: string | null | undefined, own: string) => (text || '').trim() && (text || '').trim() !== own ? (text || '').trim() : '';
    return { content: pick(raw?.content ?? source.content, derived.content), issues: pick(raw?.issues ?? source.issues, derived.issues) };
  });
  const [labor, setLabor] = useState(raw?.labor || []);
  const [machines, setMachines] = useState(raw?.machines || []);
  const [photos, setPhotos] = useState<DailyLogPhoto[]>(raw?.photos ?? source.photos ?? []);
  const [areaName, setAreaName] = useState(raw?.workAreaName ?? source.workAreaName ?? '');
  const [tab, setTab] = useState<'work' | 'history'>('work');
  const [busy, setBusy] = useState<'save' | 'submit' | 'photo' | 'withdraw' | 'delete' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<SubmitDailyLogSourceInput | null>(null);
  const [sent, setSent] = useState(false);
  const [crewContracts, setCrewContracts] = useState<DailyLogCrewContract[]>([]);
  useEffect(() => {
    if (!source.projectId) return;
    let active = true;
    dailyLogWbsService.getCrewContracts({ projectId: source.projectId, constructionSiteId: source.constructionSiteId })
      .then(rows => { if (active) setCrewContracts(rows || []); })
      .catch(() => { if (active) setCrewContracts([]); });
    return () => { active = false; };
  }, [source.projectId, source.constructionSiteId]);
  useEffect(() => { onBusyChange?.(Boolean(busy || pendingSubmit)); }, [busy, pendingSubmit, onBusyChange]);
  const [saved, setSaved] = useState(false);
  const version = useRef(source.rowVersion ?? 1);
  // Reused only when the previous attempt's outcome is unknown (no server code).
  const authorCommand = useRef<{ operation: 'withdraw' | 'delete'; commandId: string } | null>(null);
  const busyRef = useRef(false);
  const root = useRef<HTMLElement>(null);
  const readonly = sent || source.status === 'submitted' || source.status === 'included';
  const frozen = readonly || Boolean(pendingSubmit) || Boolean(busy);
  const permissionDenied = denied || !bundle.permissions.canEditSource;
  const invalidResources = new Set([...labor, ...machines].filter(line => {
    const physical = 'peopleCount' in line ? line.peopleCount > 0 && line.hoursPerPerson > 0 && line.laborType.trim()
      : line.machineCount > 0 && line.hoursPerMachine > 0 && line.machineType.trim();
    return !physical || !validateResourceProvider(line.provider).valid || (line.provider.entryMode === 'catalog'
      && !bundle.resourceProviders.some(p => p.id === line.provider.partnerId && p.isActive !== false));
  }).map(line => line.workItemClientKey));
  const entryOf = (row: DailyLogEngineerRow) => deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue,
    plannedQuantity: row.plannedQuantity, unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity,
    baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 });
  // Owner 04/10: an unfinished item past its plan date needs a new forecast date and a reason before sending.
  const forecastIssues = rows.filter(row => forecastProblem({ scheduleFinishDate: row.scheduleFinishDate, forecastFinishDate: row.forecastFinishDate,
    forecastChangeReason: row.forecastChangeReason, cumulativePercent: entryOf(row).cumulativePercent, slipDate: source.date }));
  const invalidRows = rows.filter(row => !entryOf(row).valid || forecastIssues.includes(row));
  const canSave = !readonly && !permissionDenied && !frozen && !invalidResources.size && Boolean(areaName.trim());
  const canSubmit = canSave && bundle.permissions.canSubmitSource && rows.length > 0 && invalidRows.length === 0;
  const focusError = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus());
  const submit = async (input: SubmitDailyLogSourceInput) => {
    const receipt = await dailyLogWbsService.submitSource(input);
    version.current = receipt.rowVersion; setPendingSubmit(null); setSent(true); onSubmitted?.();
  };
  const save = async (send: boolean) => {
    if (busyRef.current || !(send ? canSubmit : canSave)) return;
    busyRef.current = true; setBusy(send ? 'submit' : 'save'); setLocalError(null);
    try {
      const cleanRows = rows.map(row => ({ ...row, note: normalizeBulletText(row.note), issues: normalizeBulletText(row.issues) }));
      // Slip-level content/issues are derived from the items so the summary keeps one text per area.
      const derived = composeSlipNotes(cleanRows);
      const content = [derived.content, legacyNotes.content].filter(Boolean).join('\n');
      const issues = [derived.issues, legacyNotes.issues].filter(Boolean).join('\n');
      const receipt = await dailyLogWbsService.saveSourceDocument({ contributionId: source.id, expectedRowVersion: version.current,
        workAreaCode: source.workAreaCode!, workAreaName: areaName.trim(), content, issues, photos,
        items: cleanRows.map(({ clientKey, taskId, workBoqItemId, areaPlannedQuantity, entryMode, enteredValue, baselineFingerprint,
          forecastFinishDate, forecastChangeReason, note, issues, attachments }) => ({ clientKey, taskId, workBoqItemId, areaPlannedQuantity,
          entryMode, enteredValue, baselineFingerprint, forecastFinishDate, forecastChangeReason, note, issues, attachments })), labor, machines });
      version.current = receipt.rowVersion; setSaved(true);
      if (send) {
        const input = { commandId: crypto.randomUUID(), contributionId: source.id, expectedRowVersion: receipt.rowVersion };
        setPendingSubmit(input); await submit(input);
      } else onSaved?.(receipt);
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Không thể lưu hoặc gửi phiếu.'); focusError(); }
    finally { setBusy(null); busyRef.current = false; }
  };
  const retrySubmit = async () => {
    if (!pendingSubmit || busyRef.current) return;
    busyRef.current = true; setBusy('submit'); setLocalError(null);
    try { await submit(pendingSubmit); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Chưa xác định được kết quả gửi.'); focusError(); }
    finally { setBusy(null); busyRef.current = false; }
  };
  const runAuthorCommand = async (operation: 'withdraw' | 'delete') => {
    if (busyRef.current) return;
    const area = areaName.trim() || source.workAreaName || 'chưa đặt tên';
    const question = operation === 'withdraw'
      ? 'Rút phiếu về để sửa?\nNgười tổng hợp sẽ được báo phiếu đang tạm rút. Sửa xong, bấm "Gửi lại tổng hợp".'
      : `Xóa phiếu nháp "${area}" ngày ${formatDailyLogDate(source.date)}?\nToàn bộ nội dung đã ghi trên phiếu sẽ bị xóa và không khôi phục được.`;
    if (!window.confirm(question)) return;
    if (authorCommand.current?.operation !== operation) authorCommand.current = { operation, commandId: crypto.randomUUID() };
    const input = { commandId: authorCommand.current.commandId, contributionId: source.id, expectedRowVersion: version.current };
    busyRef.current = true; setBusy(operation); setLocalError(null);
    try {
      if (operation === 'withdraw') { await dailyLogWbsService.withdrawSource(input); authorCommand.current = null; onWithdrawn?.(); }
      else { await dailyLogWbsService.deleteSource(input); authorCommand.current = null; onDeleted?.(area); }
    } catch (caught) {
      const known = caught as { code?: string; cause?: { code?: string } };
      if (known.code || known.cause?.code) authorCommand.current = null;
      setLocalError(caught instanceof Error ? caught.message : operation === 'withdraw' ? 'Chưa rút được phiếu.' : 'Chưa xóa được phiếu.');
      focusError();
    } finally { setBusy(null); busyRef.current = false; }
  };
  const canWithdraw = !sent && source.status === 'submitted' && bundle.permissions.canWithdrawSource === true;
  const inSummary = !sent && source.status === 'submitted' && bundle.permissions.sourceInSummary === true;
  const canDelete = !readonly && source.status === 'draft' && bundle.permissions.canDeleteSource === true;
  const patchRow = (key: string, patch: Partial<DailyLogEngineerRow>) => setRows(current => current.map(row => row.clientKey === key ? { ...row, ...patch } : row));
  const changeMode = (row: DailyLogEngineerRow, mode: DailyLogEntryMode) => {
    const result = deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue, plannedQuantity: row.plannedQuantity,
      unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity, baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 });
    const value = result.valid ? mode === 'percent' ? result.cumulativePercent : mode === 'daily_quantity' ? result.dailyQuantity : result.cumulativeQuantity : null;
    patchRow(row.clientKey, { entryMode: mode, enteredValue: value == null ? '' : String(value) });
  };
  const uploadPhoto = async (file: File, row?: DailyLogEngineerRow) => uploadPhotos([file], row);
  const uploadPhotos = async (files: File[], row?: DailyLogEngineerRow) => {
    if (!onUploadPhoto || frozen || busyRef.current) return;
    busyRef.current = true; setBusy('photo'); setLocalError(null);
    try {
      for (const file of files) {
        const photo = await onUploadPhoto(file);
        if (row) setRows(current => current.map(item => item.clientKey === row.clientKey
          ? { ...item, attachments: [...(item.attachments || []), { ...photo, fileType: file.type }] } : item));
        else setPhotos(current => [...current, photo]);
      }
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Không thể tải ảnh.'); }
    finally { setBusy(null); busyRef.current = false; }
  };
  const addTask = (taskId: string, afterKey: string | null) => setRows(current => {
    if (current.some(row => row.taskId === taskId)) return current;
    const row = newRow(bundle, taskId, crypto.randomUUID(), source.date);
    const index = afterKey ? current.findIndex(item => item.clientKey === afterKey) : -1;
    return index < 0 ? [...current, row] : [...current.slice(0, index + 1), row, ...current.slice(index + 1)];
  });
  const removeRow = (key: string) => { setRows(current => current.filter(row => row.clientKey !== key));
    setLabor(current => current.filter(line => line.workItemClientKey !== key)); setMachines(current => current.filter(line => line.workItemClientKey !== key)); };
  const leafTaskIds = new Set(bundle.tasks.filter(task => !bundle.tasks.some(child => child.parentId === task.id)).map(task => task.id));
  const lastArea = (recentAreas || []).find(area => area.code === source.workAreaCode && area.lastDate && area.lastDate.slice(0, 10) < source.date
    && area.items.some(item => leafTaskIds.has(item.taskId)));
  const copyLast = () => {
    if (!lastArea) return;
    const copied = copyFromArea({ area: lastArea, slipDate: source.date, taskIds: leafTaskIds, newKey: () => crypto.randomUUID() });
    setRows(copied.items.map(item => ({ ...newRow(bundle, item.taskId, item.clientKey, source.date),
      ...(item.forecastFinishDate ? { forecastFinishDate: item.forecastFinishDate, forecastChangeReason: item.forecastChangeReason } : {}) })));
    setLabor(copied.labor); setMachines(copied.machines);
  };
  const machineSuggestions = (recentAreas || []).flatMap(area => area.machines.map(line => ({ machineType: line.machineType, provider: line.provider })));
  const people = labor.reduce((sum, line) => sum + Number(line.peopleCount || 0), 0);
  const photoCount = photos.length + rows.reduce((sum, row) => sum + (row.attachments?.length || 0), 0);
  const photoList = (list: { name: string; url: string }[], remove: (index: number) => void, row?: DailyLogEngineerRow) => <div className="dl-slip-photos">
    {list.map((photo, index) => <figure key={`${photo.url}-${index}`}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.name} /></a><figcaption>{photo.name}</figcaption>
      {!frozen && <button type="button" onClick={() => remove(index)}>Bỏ ảnh {index + 1}</button>}</figure>)}
    {!frozen && onUploadPhoto && <label>Thêm ảnh<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file, row); event.target.value = ''; }} /></label>}
  </div>;
  if (loading) return <p role="status">Đang tải phiếu thi công…</p>;
  const disabledReason = !rows.length ? 'Chọn ít nhất một công việc trước khi gửi.'
    : forecastIssues.length ? 'Hạng mục quá ngày kế hoạch cần ngày dự kiến xong mới và lý do đổi ngày.'
    : invalidRows.length ? 'Hoàn thiện khối lượng và lý do thay đổi ngày hoàn thành ở các hạng mục.'
    : invalidResources.size ? 'Điền đủ số lượng, giờ và bên cung cấp ở dòng nguồn lực.' : !bundle.permissions.canSubmitSource ? 'Bạn chưa có quyền gửi phiếu.' : undefined;
  return <section ref={root} className="daily-log-engineer-slip" aria-label="Phiếu thi công ngày">
    <DailyLogDocumentHeader title="Phiếu thi công ngày" date={source.date} authorName={source.authorName || ''} areaName={readonly ? areaName : undefined} mode="author"
      statusLabel={readonly ? source.status === 'included' ? 'Đã tổng hợp' : inSummary ? 'Đang được tổng hợp' : 'Đã gửi để tổng hợp' : source.status === 'returned' ? 'Cần sửa' : 'Nháp'}
      statusTone={readonly ? 'pending' : source.status === 'returned' ? 'returned' : 'neutral'}
      busyAction={busy === 'submit' ? 'primary' : busy === 'delete' ? null : busy ? 'secondary' : null} closeDisabled={Boolean(pendingSubmit)} onClose={() => { if (!busyRef.current && !pendingSubmit) onClose?.(); }}
      secondaryAction={canWithdraw ? { label: 'Rút về sửa', tone: 'return', disabled: Boolean(busy), onClick: () => runAuthorCommand('withdraw') }
        : !readonly && !pendingSubmit ? { label: source.status === 'returned' ? 'Lưu chỉnh sửa' : 'Lưu nháp', disabled: !canSave, onClick: () => save(false) } : undefined}
      primaryAction={!readonly ? { label: pendingSubmit ? 'Thử gửi lại' : source.status === 'returned' || source.submittedAt ? 'Gửi lại tổng hợp' : 'Gửi tổng hợp',
        disabled: pendingSubmit ? Boolean(busy) : !canSubmit, disabledReason: pendingSubmit ? undefined : disabledReason,
        onClick: pendingSubmit ? retrySubmit : () => save(true) } : undefined} />
    <div className="dl-slip-tabs" role="tablist" aria-label="Nội dung phiếu">
      <button type="button" role="tab" aria-selected={tab === 'work'} onClick={() => setTab('work')}>Nội dung công việc</button>
      <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Lịch sử</button>
    </div>
    <div className="daily-log-document-body dl-slip-body">
      {(error || localError) && <div role="alert" tabIndex={-1} className="dl-slip-error"><p>{localError || error}</p>
        {pendingSubmit && <p>Phiếu đã lưu. Kết quả gửi chưa được xác nhận; thử lại cùng yêu cầu, không lưu lần nữa.</p>}
        {!pendingSubmit && onReload && <button type="button" onClick={() => { if (window.confirm('Tải dữ liệu mới sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) onReload(); }}>Tải dữ liệu mới</button>}</div>}
      {permissionDenied && !readonly && <p role="alert" className="dl-slip-error">Bạn chưa có quyền sửa phiếu nguồn.</p>}
      {source.status === 'returned' && !sent && <aside className="dl-slip-return"><strong>Phiếu cần chỉnh sửa</strong><p>{source.returnReason || 'Chưa có lý do trả sửa được ghi nhận.'}</p>
        <p>{source.returnedByName || 'Chưa xác định người yêu cầu'}{source.returnedAt ? `, ${formatDailyLogDate(source.returnedAt)} lúc ${formatDailyLogTime(source.returnedAt)}` : ''}</p></aside>}
      {canWithdraw && <aside className="dl-slip-info"><strong>Phiếu đã gửi, chờ người tổng hợp</strong>
        <p>Cần sửa thì bấm "Rút về sửa" khi người tổng hợp chưa đưa phiếu vào bản tổng hợp.</p></aside>}
      {inSummary && <aside className="dl-slip-info"><strong>Phiếu đã được đưa vào bản tổng hợp</strong>
        <p>Không tự rút được nữa. Cần sửa thì nhờ người tổng hợp trả phiếu kèm lý do.</p></aside>}
      {saved && !pendingSubmit && !readonly && <p role="status">Đã lưu phiếu. Có thể tiếp tục ghi hoặc gửi tổng hợp.</p>}
      {tab === 'history' ? <dl className="dl-slip-history"><dt>Lập phiếu</dt><dd>{formatDailyLogDate(source.createdAt)} lúc {formatDailyLogTime(source.createdAt)}</dd>
        {source.submittedAt && <><dt>Gửi tổng hợp</dt><dd>{formatDailyLogDate(source.submittedAt)} lúc {formatDailyLogTime(source.submittedAt)}</dd></>}
        {source.returnedAt && <><dt>Yêu cầu sửa</dt><dd>{source.returnedByName || 'Chưa xác định'}, {formatDailyLogDate(source.returnedAt)} lúc {formatDailyLogTime(source.returnedAt)}<p>{source.returnReason}</p></dd></>}
        <dt>Phiên bản đang sửa</dt><dd>{version.current}</dd></dl> : <>
        {!readonly && <label className="dl-slip-area">Tên khu vực / mũi<input value={areaName} disabled={frozen} onChange={event => setAreaName(event.target.value)} /></label>}
        {readonly ? !rows.length ? <p className="dl-slip-empty">Phiếu không có công việc.</p> : <DailyLogEngineerWorkTable
          rows={rows} labor={labor} machines={machines} readOnly disabled invalidResourceWorkItemKeys={invalidResources}
          onChange={patchRow} onModeChange={changeMode} onRemove={removeRow}
          renderDetails={row => <>
            <DailyLogResourceEditor workItemClientKey={row.clientKey} resourceProviders={bundle.resourceProviders} crewContracts={crewContracts} labor={labor.filter(l => l.workItemClientKey === row.clientKey)} machines={machines.filter(m => m.workItemClientKey === row.clientKey)} readOnly reportOnly
              onLaborChange={() => undefined} onMachinesChange={() => undefined} />
            {photoList(row.attachments || [], () => undefined, row)}
          </>} /> : <>
          {!rows.length && lastArea && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mint-200 bg-mint-50 px-3 py-2 text-sm dark:border-mint-900 dark:bg-mint-950/30">
            <span>Phiếu gần nhất của <b className="text-mint-700 dark:text-mint-300">{lastArea.name}</b>: ngày <b>{formatDailyLogDate(lastArea.lastDate!)}</b>
              {lastArea.lastAuthorName ? <> ({lastArea.lastAuthorName})</> : null} · <b className="text-leaf-700 dark:text-leaf-300">{lastArea.items.length}</b> hạng mục. Chép hạng mục, tổ đội và máy sang phiếu này rồi chỉ sửa số?</span>
            <button type="button" disabled={frozen || permissionDenied} onClick={copyLast}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted"><Copy size={15} aria-hidden />Chép từ phiếu {formatDailyLogDate(lastArea.lastDate!).slice(0, 5)}</button>
          </div>}
          {!rows.length && <p className="dl-slip-empty">Chưa có công việc. Gõ mã hoặc tên hạng mục ở ô dưới để thêm; nhân công, máy, ảnh ghi ngay trên dòng.</p>}
          <DailyLogSlipRows rows={rows} labor={labor} machines={machines} tasks={bundle.tasks} workBoqItems={bundle.workBoqItems} slipDate={source.date}
            resourceProviders={bundle.resourceProviders} crewContracts={crewContracts} machineSuggestions={machineSuggestions}
            disabled={frozen || permissionDenied} onAddTask={addTask} onChange={patchRow} onModeChange={changeMode} onRemove={removeRow}
            onLaborChange={(key, next) => setLabor(current => [...current.filter(l => l.workItemClientKey !== key), ...next])}
            onMachinesChange={(key, next) => setMachines(current => [...current.filter(m => m.workItemClientKey !== key), ...next])}
            onUploadPhotos={onUploadPhoto ? (files, row) => { void uploadPhotos(files, row); } : undefined} />
          {rows.length > 0 && <p className="text-sm text-muted-foreground"><b className="text-leaf-700 dark:text-leaf-300">{rows.length}</b> hạng mục · <b className="text-leaf-700 dark:text-leaf-300">{people.toLocaleString('vi-VN')}</b> người · <b className="text-leaf-700 dark:text-leaf-300">{machines.length}</b> máy · <b className="text-leaf-700 dark:text-leaf-300">{photoCount}</b> ảnh{busy === 'photo' ? ' · đang tải ảnh…' : ''}</p>}
          {rows.length > 0 && !labor.length && <p className="flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />Chưa ghi nhân công cho hạng mục nào — CHT sẽ không biết hôm nay ai làm. Vẫn gửi được, nhưng nên thêm tổ đội ở từng dòng.</p>}
          {forecastIssues.length > 0 && <p role="alert" className="dl-slip-error">{forecastIssues.length} hạng mục đã quá ngày kế hoạch: ghi ngày dự kiến xong mới và lý do đổi ngày trước khi gửi.</p>}
        </>}
        {invalidResources.size > 0 && <p role="alert" className="dl-slip-error">Mỗi dòng nguồn lực cần tên, số lượng, thời gian và bên cung cấp hợp lệ.</p>}
        <section className="dl-slip-notes"><h3>Ảnh chung trong ngày</h3><p className="dl-slip-notes-hint">Công tác, sự cố và ảnh riêng của hạng mục ghi ngay trên dòng hạng mục phía trên.</p>
          {(legacyNotes.content || legacyNotes.issues) && <aside className="dl-slip-legacy-notes"><strong>Ghi chú chung đã nhập trước đây</strong>
            {legacyNotes.content && <p>{legacyNotes.content}</p>}{legacyNotes.issues && <p>Sự cố: {legacyNotes.issues}</p>}
            {!readonly && <button type="button" disabled={frozen || permissionDenied} onClick={() => { if (window.confirm('Bỏ ghi chú chung này khỏi phiếu?')) setLegacyNotes({ content: '', issues: '' }); }}>Bỏ ghi chú chung</button>}</aside>}
          {photoList(photos, index => setPhotos(current => current.filter((_, i) => i !== index)))}
        </section>
        {canDelete && <section className="dl-slip-danger" aria-label="Xóa phiếu nháp">
          <div><strong>Không cần phiếu này nữa?</strong>
            <p>Phiếu chưa gửi nên xóa được. Khu vực "{areaName.trim() || source.workAreaName}" sẽ được bỏ khỏi ngày {formatDailyLogDate(source.date)}.</p></div>
          <button type="button" disabled={frozen} onClick={() => { void runAuthorCommand('delete'); }}>
            <Trash2 size={16} aria-hidden="true" />{busy === 'delete' ? 'Đang xóa…' : 'Xóa phiếu nháp'}</button>
        </section>}
      </>}
    </div>
  </section>;
};
