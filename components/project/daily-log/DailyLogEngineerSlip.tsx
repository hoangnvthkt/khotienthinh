import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { DailyLogEntryMode, DailyLogPhoto, DailyLogSourceItemV2 } from '../../../types';
import { dailyLogWbsService, type DailyLogDocumentBundle, type SubmitDailyLogSourceInput } from '../../../lib/dailyLogWbsService';
import { deriveDailyLogEntry } from '../../../lib/dailyLogEntryRules';
import { validateResourceProvider } from '../../../lib/dailyLogResourceRules';
import { formatDailyLogDate, formatDailyLogTime } from '../../../lib/dailyLogPresentation';
import { DailyLogDocumentHeader } from './DailyLogDocumentHeader';
import { DailyLogResourceEditor } from './DailyLogResourceEditor';
import { DailyLogWbsPicker } from './DailyLogWbsPicker';
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

export const DailyLogEngineerSlip: React.FC<DailyLogContributionWorkEditorProps & { bundle: DailyLogDocumentBundle }> = ({
  bundle, error, loading, denied, onReload, onSaved, onSubmitted, onClose, onUploadPhoto, onBusyChange,
}) => {
  const source = bundle.contribution!;
  const raw = source.sourceDraftPayload;
  const rawItems: DailyLogSourceItemV2[] = raw?.items ?? bundle.workItems.filter(w => w.contributionId === source.id && !w.dailyLogId).map(w => ({
    clientKey: w.id!, taskId: w.taskId, workBoqItemId: w.workBoqItemId, areaPlannedQuantity: w.areaPlannedQuantity,
    entryMode: 'percent', enteredValue: w.cumulativeProgressPercent, baselineFingerprint: bundle.baselineQuantityFingerprints?.[w.taskId] || '',
    forecastFinishDate: w.forecastFinishDate, forecastChangeReason: w.forecastChangeReason, note: w.note, attachments: w.attachments,
  }));
  const [rows, setRows] = useState(() => rawItems.map(item => hydrateRow(bundle, item)));
  const [labor, setLabor] = useState(raw?.labor || []);
  const [machines, setMachines] = useState(raw?.machines || []);
  const [content, setContent] = useState(raw?.content ?? source.content);
  const [issues, setIssues] = useState(raw?.issues ?? source.issues ?? '');
  const [photos, setPhotos] = useState<DailyLogPhoto[]>(raw?.photos ?? source.photos ?? []);
  const [areaName, setAreaName] = useState(raw?.workAreaName ?? source.workAreaName ?? '');
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'work' | 'history'>('work');
  const [busy, setBusy] = useState<'save' | 'submit' | 'photo' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<SubmitDailyLogSourceInput | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { onBusyChange?.(Boolean(busy || pendingSubmit)); }, [busy, pendingSubmit, onBusyChange]);
  const [saved, setSaved] = useState(false);
  const version = useRef(source.rowVersion ?? 1);
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
  const invalidRows = rows.filter(row => !deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue,
    plannedQuantity: row.plannedQuantity, unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity,
    baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 }).valid
    || (row.forecastFinishDate && row.forecastFinishDate !== row.scheduleFinishDate && !row.forecastChangeReason?.trim()));
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
      const receipt = await dailyLogWbsService.saveSourceDocument({ contributionId: source.id, expectedRowVersion: version.current,
        workAreaCode: source.workAreaCode!, workAreaName: areaName.trim(), content, issues, photos,
        items: rows.map(({ clientKey, taskId, workBoqItemId, areaPlannedQuantity, entryMode, enteredValue, baselineFingerprint,
          forecastFinishDate, forecastChangeReason, note, attachments }) => ({ clientKey, taskId, workBoqItemId, areaPlannedQuantity,
          entryMode, enteredValue, baselineFingerprint, forecastFinishDate, forecastChangeReason, note, attachments })), labor, machines });
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
  const patchRow = (key: string, patch: Partial<DailyLogEngineerRow>) => setRows(current => current.map(row => row.clientKey === key ? { ...row, ...patch } : row));
  const changeMode = (row: DailyLogEngineerRow, mode: DailyLogEntryMode) => {
    const result = deriveDailyLogEntry({ mode: row.entryMode, enteredValue: row.enteredValue, plannedQuantity: row.plannedQuantity,
      unit: row.unit, previousCumulativeQuantity: row.previousCumulativeQuantity, baselineQuantityState: row.baselineQuantityState, allowOver100: row.allowOver100 });
    const value = result.valid ? mode === 'percent' ? result.cumulativePercent : mode === 'daily_quantity' ? result.dailyQuantity : result.cumulativeQuantity : null;
    patchRow(row.clientKey, { entryMode: mode, enteredValue: value == null ? '' : String(value) });
  };
  const uploadPhoto = async (file: File, row?: DailyLogEngineerRow) => {
    if (!onUploadPhoto || frozen || busyRef.current) return;
    busyRef.current = true; setBusy('photo'); setLocalError(null);
    try { const photo = await onUploadPhoto(file);
      if (row) patchRow(row.clientKey, { attachments: [...(row.attachments || []), { ...photo, fileType: file.type }] });
      else setPhotos(current => [...current, photo]);
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Không thể tải ảnh.'); }
    finally { setBusy(null); busyRef.current = false; }
  };
  const photoList = (list: { name: string; url: string }[], remove: (index: number) => void, row?: DailyLogEngineerRow) => <div className="dl-slip-photos">
    {list.map((photo, index) => <figure key={`${photo.url}-${index}`}><a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.name} /></a><figcaption>{photo.name}</figcaption>
      {!frozen && <button type="button" onClick={() => remove(index)}>Bỏ ảnh {index + 1}</button>}</figure>)}
    {!frozen && onUploadPhoto && <label>Thêm ảnh<input type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file, row); event.target.value = ''; }} /></label>}
  </div>;
  if (loading) return <p role="status">Đang tải phiếu thi công…</p>;
  const disabledReason = !rows.length ? 'Chọn ít nhất một công việc trước khi gửi.' : invalidRows.length ? 'Hoàn thiện khối lượng và lý do thay đổi ngày hoàn thành ở các hạng mục.'
    : invalidResources.size ? 'Điền đủ số lượng, giờ và bên cung cấp ở dòng nguồn lực.' : !bundle.permissions.canSubmitSource ? 'Bạn chưa có quyền gửi phiếu.' : undefined;
  return <section ref={root} className="daily-log-engineer-slip" aria-label="Phiếu thi công ngày">
    <DailyLogDocumentHeader title="Phiếu thi công ngày" date={source.date} authorName={source.authorName || ''} areaName={areaName} mode="author"
      statusLabel={readonly ? 'Đã gửi để tổng hợp' : source.status === 'returned' ? 'Cần sửa' : 'Nháp'}
      statusTone={readonly ? 'pending' : source.status === 'returned' ? 'returned' : 'neutral'}
      busyAction={busy === 'submit' ? 'primary' : busy ? 'secondary' : null} closeDisabled={Boolean(pendingSubmit)} onClose={() => { if (!busyRef.current && !pendingSubmit) onClose?.(); }}
      secondaryAction={!readonly && !pendingSubmit ? { label: source.status === 'returned' ? 'Lưu chỉnh sửa' : 'Lưu nháp', disabled: !canSave, onClick: () => save(false) } : undefined}
      primaryAction={!readonly ? { label: pendingSubmit ? 'Thử gửi lại' : source.status === 'returned' ? 'Gửi lại tổng hợp' : 'Gửi tổng hợp',
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
      {saved && !pendingSubmit && !readonly && <p role="status">Đã lưu phiếu. Có thể tiếp tục ghi hoặc gửi tổng hợp.</p>}
      {tab === 'history' ? <dl className="dl-slip-history"><dt>Lập phiếu</dt><dd>{formatDailyLogDate(source.createdAt)} lúc {formatDailyLogTime(source.createdAt)}</dd>
        {source.submittedAt && <><dt>Gửi tổng hợp</dt><dd>{formatDailyLogDate(source.submittedAt)} lúc {formatDailyLogTime(source.submittedAt)}</dd></>}
        {source.returnedAt && <><dt>Yêu cầu sửa</dt><dd>{source.returnedByName || 'Chưa xác định'}, {formatDailyLogDate(source.returnedAt)} lúc {formatDailyLogTime(source.returnedAt)}<p>{source.returnReason}</p></dd></>}
        <dt>Phiên bản đang sửa</dt><dd>{version.current}</dd></dl> : <>
        {!readonly && <label className="dl-slip-area">Tên khu vực / mũi<input value={areaName} disabled={frozen} onChange={event => setAreaName(event.target.value)} /></label>}
        <div className="dl-slip-toolbar">{!readonly && <label><Search size={16} aria-hidden="true" /><input aria-label="Tìm hạng mục trên phiếu" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên hạng mục" /></label>}
          {!readonly && <button type="button" disabled={frozen || permissionDenied} onClick={() => setPicker(true)}><Plus size={16} />Chọn công việc</button>}</div>
        {!rows.length ? <p className="dl-slip-empty">Chưa có công việc. Chọn hạng mục thi công để ghi khối lượng, nhân công và máy.</p> : <DailyLogEngineerWorkTable
          rows={rows.filter(row => `${row.wbsCode} ${row.taskName}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))} labor={labor} machines={machines}
          readOnly={readonly} disabled={frozen || permissionDenied} invalidResourceWorkItemKeys={invalidResources}
          onChange={patchRow} onModeChange={changeMode} onRemove={key => { setRows(current => current.filter(row => row.clientKey !== key)); setLabor(current => current.filter(line => line.workItemClientKey !== key)); setMachines(current => current.filter(line => line.workItemClientKey !== key)); }}
          renderDetails={row => <>
            <DailyLogResourceEditor workItemClientKey={row.clientKey} resourceProviders={bundle.resourceProviders} labor={labor.filter(l => l.workItemClientKey === row.clientKey)} machines={machines.filter(m => m.workItemClientKey === row.clientKey)} readOnly={frozen || permissionDenied} reportOnly={readonly}
              onLaborChange={next => setLabor(current => [...current.filter(l => l.workItemClientKey !== row.clientKey), ...next])}
              onMachinesChange={next => setMachines(current => [...current.filter(m => m.workItemClientKey !== row.clientKey), ...next])} />
            <div className="dl-slip-detail-fields">{readonly ? <><p>Dự kiến hoàn thành: {row.forecastFinishDate ? formatDailyLogDate(row.forecastFinishDate) : 'Chưa ghi nhận'}</p><p>{row.forecastChangeReason}</p><p>{row.note}</p></> : <>
              <label>Dự kiến hoàn thành<input type="date" disabled={frozen} value={row.forecastFinishDate || ''} onChange={event => patchRow(row.clientKey, { forecastFinishDate: event.target.value })} /></label>
              <label>Lý do thay đổi ngày hoàn thành<input disabled={frozen} aria-invalid={Boolean(row.forecastFinishDate && row.forecastFinishDate !== row.scheduleFinishDate && !row.forecastChangeReason?.trim())} value={row.forecastChangeReason || ''} onChange={event => patchRow(row.clientKey, { forecastChangeReason: event.target.value })} /></label>
              <label>Ghi chú hạng mục<textarea disabled={frozen} value={row.note || ''} onChange={event => patchRow(row.clientKey, { note: event.target.value })} /></label></>}
            </div>{photoList(row.attachments || [], index => patchRow(row.clientKey, { attachments: row.attachments?.filter((_, i) => i !== index) }), row)}
          </>} />}
        {invalidResources.size > 0 && <p role="alert" className="dl-slip-error">Mỗi dòng nguồn lực cần tên, số lượng, thời gian và bên cung cấp hợp lệ.</p>}
        <section className="dl-slip-notes"><h3>Ghi chú và ảnh trong ngày</h3>{readonly ? <><p>{content || 'Chưa ghi nội dung bổ sung.'}</p><p>{issues || 'Chưa ghi sự cố.'}</p></> : <div className="dl-slip-detail-fields">
          <label>Nội dung trong ngày<textarea disabled={frozen || permissionDenied} value={content} onChange={event => setContent(event.target.value)} /></label>
          <label>Sự cố / vướng mắc<textarea disabled={frozen || permissionDenied} value={issues} onChange={event => setIssues(event.target.value)} /></label></div>}
          {photoList(photos, index => setPhotos(current => current.filter((_, i) => i !== index)))}
        </section>
      </>}
    </div>
    {picker && <DailyLogWbsPicker tasks={bundle.tasks} workBoqItems={bundle.workBoqItems} selectedTaskIds={new Set(rows.map(r => r.taskId))} recentTaskIds={[]} onClose={() => setPicker(false)} onConfirm={ids => {
      setRows(current => ids.map(taskId => current.find(row => row.taskId === taskId) || (() => {
        const work = bundle.workBoqItems.find(w => w.sourceTaskId === taskId);
        const context = bundle.quantityBaselines?.[taskId];
        const base = hydrateRow(bundle, { clientKey: crypto.randomUUID(), taskId, workBoqItemId: work?.id,
          baselineFingerprint: context?.fingerprint || '', entryMode: 'percent', enteredValue: '', forecastFinishDate: bundle.tasks.find(t => t.id === taskId)?.endDate || null });
        return { ...base, entryMode: base.unit && base.plannedQuantity ? base.baselineQuantityState === 'unknown' ? 'cumulative_quantity' : 'daily_quantity' : 'percent' };
      })()));
      const keys = new Set(rows.filter(r => ids.includes(r.taskId)).map(r => r.clientKey));
      setLabor(current => current.filter(l => keys.has(l.workItemClientKey))); setMachines(current => current.filter(m => keys.has(m.workItemClientKey))); setPicker(false);
    }} />}
  </section>;
};
