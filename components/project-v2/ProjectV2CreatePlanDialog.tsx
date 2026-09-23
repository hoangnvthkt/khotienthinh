import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { parseQuantity6 } from '../../lib/procurement/decimal';
import { projectV2CandidateService, type ConstructionCandidate, type MonthCandidate,
  type ProjectV2Crew } from '../../lib/projectV2/candidateService';
import { projectV2CommandService } from '../../lib/projectV2/commandService';
import { projectV2ReadService } from '../../lib/projectV2/readService';
import { validateSelectedSources } from '../../lib/projectV2/sourcePicker';
import { ProjectV2SourcePicker } from './ProjectV2SourcePicker';
import { MonthPlanEditor } from './MonthPlanEditor';
import { ConstructionPlanEditor, type ConstructionEntry } from './ConstructionPlanEditor';

interface Props { workspaceId: string; type: 'month' | 'construction';
  onClose: () => void; onCreated: (planId: string) => void;
  canUseBaselineException?: boolean;
  existing?: Awaited<ReturnType<typeof projectV2ReadService.getPlan>>;
  onReload?: () => void; actorNames?: Record<string, string> }
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800';

function initialEntries(existing?: Props['existing']) {
  const entries: Record<string, ConstructionEntry> = {};
  if (!existing) return entries;
  for (const source of existing.sources) {
    const raw = source as Record<string, unknown>;
    const line = existing.lines.find(item => item.id === raw.target_line_id);
    if (!line || typeof raw.source_plan_line_id !== 'string') continue;
    const lineRaw = line as Record<string, unknown>;
    entries[raw.source_plan_line_id] = { quantity: line.quantity ?? '',
      start: String(lineRaw.work_start ?? ''), end: String(lineRaw.work_end ?? ''),
      crewId: String(lineRaw.crew_id ?? '') };
  }
  return entries;
}

export function ProjectV2CreatePlanDialog({ workspaceId, type, onClose, onCreated,
  canUseBaselineException = false, existing, onReload, actorNames = {} }: Props) {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState(existing?.plan.code ?? '');
  const [title, setTitle] = useState(existing?.plan.title ?? '');
  const [periodStart, setPeriodStart] = useState(existing?.plan.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(existing?.plan.periodEnd ?? '');
  const [monthCandidates, setMonthCandidates] = useState<MonthCandidate[] | null>(null);
  const [constructionCandidates, setConstructionCandidates] = useState<ConstructionCandidate[] | null>(null);
  const [crews, setCrews] = useState<ProjectV2Crew[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => existing?.plan.planType === 'month'
    ? existing.lines.map(line => (line as Record<string, unknown>).contract_item_id).filter((id): id is string => typeof id === 'string')
    : existing?.sources.map(source => (source as Record<string, unknown>).source_plan_line_id)
      .filter((id): id is string => typeof id === 'string') ?? []);
  const [monthQuantities, setMonthQuantities] = useState<Record<string, string>>(() => Object.fromEntries(
    existing?.lines.map(line => [(line as Record<string, unknown>).contract_item_id, line.quantity ?? ''])
      .filter(([id]) => typeof id === 'string') ?? []));
  const [constructionEntries, setConstructionEntries] = useState<Record<string, ConstructionEntry>>(() => initialEntries(existing));
  const initialExceptions = existing?.lines.filter(line => Boolean((line as Record<string, unknown>).baseline_exception_reason)) ?? [];
  const [exceptionMode, setExceptionMode] = useState(initialExceptions.length > 0);
  const [exceptionCandidates, setExceptionCandidates] = useState<MonthCandidate[] | null>(null);
  const [exceptionSelectedIds, setExceptionSelectedIds] = useState<string[]>(() => initialExceptions
    .map(line => (line as Record<string, unknown>).work_item_id).filter((id): id is string => typeof id === 'string'));
  const [exceptionEntries, setExceptionEntries] = useState<Record<string, ConstructionEntry>>(() => Object.fromEntries(
    initialExceptions.map(line => { const raw = line as Record<string, unknown>;
      return [String(raw.work_item_id), { quantity: line.quantity ?? '', start: String(raw.work_start ?? ''),
        end: String(raw.work_end ?? ''), crewId: String(raw.crew_id ?? '') }]; })));
  const [exceptionReasons, setExceptionReasons] = useState<Record<string, string>>(() => Object.fromEntries(
    initialExceptions.map(line => { const raw = line as Record<string, unknown>;
      return [String(raw.work_item_id), String(raw.baseline_exception_reason ?? '')]; })));
  const [exceptionError, setExceptionError] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ updatedAt: string; actor: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const keyRef = useRef(crypto.randomUUID());
  const previousHash = useRef(window.location.hash);
  const dirty = existing ? touched :
    Boolean(code || title || periodStart || periodEnd || selectedIds.length || exceptionSelectedIds.length);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (type === 'month') {
          const rows = await projectV2CandidateService.listMonth(workspaceId, existing?.plan.id ?? null);
          if (active) setMonthCandidates(rows);
        } else {
          const [rows, crewRows] = await Promise.all([
            projectV2CandidateService.listConstruction(workspaceId, existing?.plan.id ?? null), projectV2CandidateService.listCrews(workspaceId),
          ]);
          if (active) { setConstructionCandidates(rows); setCrews(crewRows); }
          if (canUseBaselineException) {
            try { const baseline = await projectV2CandidateService.listMonth(workspaceId);
              if (active) setExceptionCandidates(baseline); }
            catch (cause) { if (active) setExceptionError(cause instanceof Error ? cause.message : 'Không tải được baseline'); }
          }
        }
      } catch (cause) { if (active) setLoadingError(cause instanceof Error ? cause.message : 'Không tải được nguồn'); }
    })();
    return () => { active = false; };
  }, [workspaceId, type, canUseBaselineException, existing?.plan.id]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const onHashChange = () => {
      if (dirty && !window.confirm('Bỏ kế hoạch chưa lưu?')) window.location.hash = previousHash.current;
      else previousHash.current = window.location.hash;
    };
    window.addEventListener('beforeunload', guard);
    window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('beforeunload', guard); window.removeEventListener('hashchange', onHashChange); };
  }, [dirty]);

  const change = () => { keyRef.current = crypto.randomUUID(); setError(null); setTouched(true); };
  const close = () => { if (!saving && (!dirty || window.confirm('Bỏ những thay đổi chưa lưu?'))) onClose(); };
  const selectedMonth = useMemo(() => monthCandidates?.filter(row => selectedIds.includes(row.contractItemId)) ?? [],
    [monthCandidates, selectedIds]);
  const selectedConstruction = useMemo(() => constructionCandidates?.filter(row => selectedIds.includes(row.sourceLineId)) ?? [],
    [constructionCandidates, selectedIds]);
  const selectedExceptions = useMemo(() => exceptionCandidates?.filter(row => exceptionSelectedIds.includes(row.contractItemId)) ?? [],
    [exceptionCandidates, exceptionSelectedIds]);
  const save = async () => {
    if (saving) return;
    setError(null);
    try {
      if (!code.trim() || !title.trim() || !periodStart || !periodEnd || periodEnd < periodStart)
        throw new Error('Điền mã, tên và khoảng thời gian hợp lệ.');
      if (!selectedIds.length && !exceptionSelectedIds.length) throw new Error('Chọn ít nhất một dòng nguồn.');
      if (type === 'month' && selectedMonth.length !== selectedIds.length ||
        type === 'construction' && selectedConstruction.length !== selectedIds.length ||
        selectedExceptions.length !== exceptionSelectedIds.length)
        throw new Error('Một số nguồn đã đổi hoặc không còn khả dụng. Tải lại nguồn trước khi lưu.');
      const lines: Record<string, unknown>[] = type === 'month' ? selectedMonth.map(row => {
        const quantity = monthQuantities[row.contractItemId] ?? '';
        if (!row.baselineRevision || row.baselineState !== 'verified') throw new Error(`Baseline ${row.code} chưa được xác nhận.`);
        if (!row.unit || !quantity || parseQuantity6(quantity) <= 0n) throw new Error(`Nhập khối lượng hợp lệ cho ${row.code}.`);
        if (row.availableQuantity === null) throw new Error(`Khối lượng khả dụng ${row.code} chưa xác định.`);
        if (parseQuantity6(quantity) > parseQuantity6(row.availableQuantity)) throw new Error(`Khối lượng ${row.code} vượt khả dụng ${row.availableQuantity}.`);
        const existingLine = existing?.lines.find(line => (line as Record<string, unknown>).contract_item_id === row.contractItemId);
        return { id: existingLine?.id, contractItemId: row.contractItemId, baselineRevision: row.baselineRevision,
          unit: row.unit, quantity };
      }) : selectedConstruction.map(row => {
        const entry = constructionEntries[row.sourceLineId];
        if (!entry?.quantity || parseQuantity6(entry.quantity) <= 0n || !row.sourceUnit)
          throw new Error(`Nhập khối lượng hợp lệ cho ${row.code}.`);
        if (!entry.start || !entry.end || entry.start < periodStart || entry.end > periodEnd || entry.end < entry.start)
          throw new Error(`Ngày thi công ${row.code} phải nằm trong kỳ kế hoạch.`);
        if (entry.crewId && !crews.some(crew => crew.id === entry.crewId)) throw new Error('Tổ đội không thuộc dự án.');
        const sourceLink = existing?.sources.find(source => (source as Record<string, unknown>).source_plan_line_id === row.sourceLineId);
        const existingLine = existing?.lines.find(line => line.id === (sourceLink as Record<string, unknown> | undefined)?.target_line_id);
        return { id: existingLine?.id, workItemId: row.workItemId ?? row.contractItemId ?? row.sourceLineId,
          unit: row.sourceUnit, quantity: entry.quantity, workStart: entry.start,
          workEnd: entry.end, crewId: entry.crewId || null,
          sources: [{ sourcePlanId: row.sourcePlanId, sourceRevision: row.sourceRevision,
            sourcePlanHash: row.sourcePlanHash, sourceLineId: row.sourceLineId,
            sourceQuantity: entry.quantity, sourceUnit: row.sourceUnit }] };
      });
      if (type === 'construction') for (const row of selectedExceptions) {
        const entry = exceptionEntries[row.contractItemId];
        const reason = exceptionReasons[row.contractItemId]?.trim();
        if (!canUseBaselineException || !row.baselineRevision || row.baselineState !== 'verified' || !reason)
          throw new Error(`Ngoại lệ baseline ${row.code} cần quyền và lý do rõ ràng.`);
        if (!row.unit || !entry?.quantity || parseQuantity6(entry.quantity) <= 0n ||
          row.availableQuantity === null || parseQuantity6(entry.quantity) > parseQuantity6(row.availableQuantity))
          throw new Error(`Khối lượng ngoại lệ ${row.code} không hợp lệ hoặc vượt khả dụng.`);
        if (!entry.start || !entry.end || entry.start < periodStart || entry.end > periodEnd || entry.end < entry.start)
          throw new Error(`Ngày thi công ${row.code} phải nằm trong kỳ kế hoạch.`);
        if (entry.crewId && !crews.some(crew => crew.id === entry.crewId)) throw new Error('Tổ đội không thuộc dự án.');
        const existingLine = initialExceptions.find(line => (line as Record<string, unknown>).work_item_id === row.contractItemId);
        lines.push({ id: existingLine?.id, workItemId: row.contractItemId, baselineRevision: row.baselineRevision,
          baselineExceptionReason: reason, unit: row.unit, quantity: entry.quantity,
          workStart: entry.start, workEnd: entry.end, crewId: entry.crewId || null,
          sources: [] });
      }
      if (type === 'construction') {
        for (const row of selectedConstruction) {
          const original = existing?.sources.find(source => (source as Record<string, unknown>).source_plan_line_id === row.sourceLineId) as Record<string, unknown> | undefined;
          if (original && (Number(original.source_plan_revision_no) !== row.sourceRevision ||
            original.source_plan_hash !== row.sourcePlanHash))
            throw new Error(`Nguồn ${row.code} đã đổi phiên bản. Chọn lại nguồn trước khi lưu.`);
        }
        const requested = Object.fromEntries(selectedConstruction.map(row => [row.sourceLineId, {
          revision: row.sourceRevision, hash: row.sourcePlanHash,
          quantity: constructionEntries[row.sourceLineId]?.quantity ?? '',
        }]));
        const issues = validateSelectedSources(constructionCandidates ?? [], selectedIds, workspaceId, requested);
        if (issues.length) throw new Error(issues.map(issue => issue.reason).join('; '));
      }
      setSaving(true);
      const response = await projectV2CommandService.save({ workspaceId,
        planId: existing?.plan.id ?? null, expectedVersion: existing?.plan.version ?? null,
        idempotencyKey: keyRef.current, planType: type, code: code.trim(), title: title.trim(),
        periodStart, periodEnd, lines }) as { planId?: unknown };
      if (typeof response.planId !== 'string') throw new Error('Phản hồi tạo kế hoạch không hợp lệ.');
      onCreated(response.planId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không lưu được kế hoạch.';
      if (existing && (message.includes('PROJECT_V2_VERSION_STALE') || message.includes('40001'))) {
        try {
          const [current, thread] = await Promise.all([projectV2ReadService.getPlan(existing.plan.id),
            projectV2ReadService.getDiscussion(existing.plan.id)]);
          const last = thread.events.at(-1);
          setConflict({ updatedAt: current.plan.updatedAt,
            actor: last ? actorNames[last.actorUserId] ?? 'Người dùng khác' : 'Người dùng khác' });
        } catch { setError('Kế hoạch đã đổi phiên bản. Tải lại trước khi lưu.'); }
      } else setError(message);
    }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-3 py-4 sm:px-6 sm:py-8" role="presentation">
    <div role="dialog" aria-modal="true" aria-labelledby="project-v2-create-title"
      className="mx-auto w-full max-w-6xl rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Bước {step}/2 · Dự án V2</p>
          <h2 id="project-v2-create-title" className="mt-1 text-xl font-bold text-slate-950 dark:text-white">{existing ? 'Sửa' : 'Tạo'} kế hoạch {type === 'month' ? 'tháng' : 'thi công'}</h2>
          <p className="mt-1 text-sm text-slate-500">{existing ? 'Bản nháp được lưu theo phiên bản hiện tại.' : 'Chứng từ chỉ được tạo khi anh lưu phần nguồn và khối lượng.'}</p></div>
        <button type="button" aria-label="Đóng" onClick={close} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </header>
      <fieldset disabled={saving} className="min-w-0 border-0 p-0">{step === 1 ? <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Mã kế hoạch<input className={`${inputClass} mt-1`} value={code} onChange={event => { change(); setCode(event.target.value); }} /></label>
        <label className="text-sm font-medium">Tên kế hoạch<input className={`${inputClass} mt-1`} value={title} onChange={event => { change(); setTitle(event.target.value); }} /></label>
        <label className="text-sm font-medium">Từ ngày<input type="date" className={`${inputClass} mt-1`} value={periodStart} onChange={event => { change(); setPeriodStart(event.target.value); }} /></label>
        <label className="text-sm font-medium">Đến ngày<input type="date" min={periodStart} className={`${inputClass} mt-1`} value={periodEnd} onChange={event => { change(); setPeriodEnd(event.target.value); }} /></label>
      </div> : <div className="mt-6 space-y-5">
        {loadingError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadingError}</p>
          : (type === 'month' ? monthCandidates === null : constructionCandidates === null)
            ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={17} /> Đang tải nguồn…</p>
            : <ProjectV2SourcePicker workspaceId={workspaceId} type={type} monthCandidates={monthCandidates ?? []}
              constructionCandidates={constructionCandidates ?? []} selectedIds={selectedIds}
              onChange={ids => { change(); setSelectedIds(ids); }} />}
        {selectedMonth.length > 0 && type === 'month' && <MonthPlanEditor rows={selectedMonth} quantities={monthQuantities}
          canViewPrice={selectedMonth.some(row => row.priceVisible === true)}
          onChange={(id, quantity) => { change(); setMonthQuantities(previous => ({ ...previous, [id]: quantity })); }} />}
        {selectedConstruction.length > 0 && type === 'construction' && <ConstructionPlanEditor rows={selectedConstruction}
          entries={constructionEntries} crews={crews} periodStart={periodStart} periodEnd={periodEnd}
          onChange={(id, entry) => { change(); setConstructionEntries(previous => ({ ...previous, [id]: entry })); }} />}
        {type === 'construction' && canUseBaselineException && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/20">
          <label className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <input type="checkbox" checked={exceptionMode} onChange={event => {
              change(); setExceptionMode(event.target.checked);
              if (!event.target.checked) setExceptionSelectedIds([]);
            }} />
            Lập ngoại lệ trực tiếp từ baseline</label>
          {exceptionMode && <><p className="text-xs text-amber-800 dark:text-amber-300">Chỉ dùng khi công việc chưa có kế hoạch tháng đã duyệt. Mỗi dòng cần lý do.</p>
            {exceptionError ? <p role="alert" className="text-sm text-red-700">{exceptionError}</p>
              : exceptionCandidates === null ? <p className="text-sm">Đang tải baseline…</p>
                : <ProjectV2SourcePicker workspaceId={workspaceId} type="month" monthCandidates={exceptionCandidates}
                  selectedIds={exceptionSelectedIds} onChange={ids => { change(); setExceptionSelectedIds(ids); }} />}
            {selectedExceptions.map(row => {
              const entry = exceptionEntries[row.contractItemId] ?? { quantity: '', start: periodStart, end: periodEnd, crewId: '' };
              const update = (patch: Partial<ConstructionEntry>) => { change(); setExceptionEntries(previous => ({ ...previous,
                [row.contractItemId]: { ...entry, ...patch } })); };
              return <div key={row.contractItemId} className="grid gap-3 rounded-xl bg-white p-3 sm:grid-cols-2 xl:grid-cols-5 dark:bg-slate-900">
                <strong className="sm:col-span-2 xl:col-span-5">{row.code} · {row.title}</strong>
                <label className="text-xs">Khối lượng<input aria-label={`Khối lượng ngoại lệ ${row.code}`} inputMode="decimal" value={entry.quantity}
                  onChange={event => update({ quantity: event.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs">Bắt đầu<input type="date" min={periodStart} max={periodEnd} value={entry.start}
                  onChange={event => update({ start: event.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs">Kết thúc<input type="date" min={periodStart} max={periodEnd} value={entry.end}
                  onChange={event => update({ end: event.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs">Tổ đội<select value={entry.crewId} onChange={event => update({ crewId: event.target.value })}
                  className={`${inputClass} mt-1`}><option value="">Chưa phân công</option>{crews.map(crew => <option key={crew.id} value={crew.id}>{crew.name}</option>)}</select></label>
                <label className="text-xs">Lý do ngoại lệ<input value={exceptionReasons[row.contractItemId] ?? ''}
                  onChange={event => { change(); setExceptionReasons(previous => ({ ...previous, [row.contractItemId]: event.target.value })); }}
                  className={`${inputClass} mt-1`} /></label>
              </div>;
            })}</>}
        </section>}
        {type === 'construction' && constructionCandidates?.length === 0 && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Chưa có kế hoạch tháng đã duyệt làm nguồn cho thi công.</p>}
      </div>}</fieldset>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {conflict && <div role="alert" className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        {conflict.actor} đã thay đổi kế hoạch lúc {new Date(conflict.updatedAt).toLocaleString('vi-VN')}. Bản đang mở sẽ không ghi đè.
        <button type="button" className="ml-2 font-semibold underline" onClick={() => {
          if (window.confirm('Bỏ thay đổi đang nhập và tải phiên bản mới?')) onReload?.();
        }}>Tải lại</button></div>}
      <footer className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <button type="button" disabled={saving} onClick={step === 1 ? close : () => setStep(1)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">{step === 1 ? 'Hủy' : 'Quay lại'}</button>
        {step === 1 ? <button type="button" onClick={() => {
          if (!code.trim() || !title.trim() || !periodStart || !periodEnd || periodEnd < periodStart)
            setError('Điền mã, tên và khoảng thời gian hợp lệ.');
          else { setError(null); setStep(2); }
        }} className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white">Chọn nguồn</button>
          : <button type="button" disabled={saving || Boolean(loadingError)} onClick={save}
            className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu bản nháp'}</button>}
      </footer>
    </div>
  </div>;
}
