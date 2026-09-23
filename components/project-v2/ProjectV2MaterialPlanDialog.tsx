import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { parseQuantity6 } from '../../lib/procurement/decimal';
import { materialCandidateService, groupMaterialCandidates, type MaterialCandidateGroup } from '../../lib/projectV2/materialCandidateService';
import { projectV2CommandService } from '../../lib/projectV2/commandService';
import { projectV2ReadService } from '../../lib/projectV2/readService';
import { MaterialPlanEditor, type MaterialEntry } from './MaterialPlanEditor';

type Detail = Awaited<ReturnType<typeof projectV2ReadService.getPlan>>;
interface Props { workspaceId: string; projectId: string; siteId: string | null; siteName: string;
  existing?: Detail; onClose: () => void; onSaved: (planId: string) => void; onReload?: () => void }
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800';
const quantity6 = (value: bigint) => `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`;
const emptyEntry = (siteId: string | null): MaterialEntry => ({ quantity: '', neededDate: '',
  destinationId: siteId ?? '', note: '', overrideReason: '' });
const different = (left: string, right: string | null): boolean => {
  if (right === null) return false;
  try { return parseQuantity6(left) !== parseQuantity6(right); } catch { return true; }
};

export function buildMaterialPlanLines(groups: MaterialCandidateGroup[], selectedKeys: string[], entries: Record<string, MaterialEntry>,
  existing?: Detail): Record<string, unknown>[] {
  const allocatedByCandidate = new Map<string, bigint>();
  return groups.filter(group => selectedKeys.includes(group.key)).map(group => {
    const entry = entries[group.key];
    if (existing && group.derivations.length === 0)
      throw new Error(`${group.itemName}: nguồn cũ đã đổi. Bỏ dòng này hoặc tải lại nguồn trước khi lưu.`);
    const requested = entry.quantity.trim() ? parseQuantity6(entry.quantity.trim()) : null;
    if (requested !== null && requested < 0n) throw new Error(`Số lượng ${group.itemName} không hợp lệ.`);
    const available = group.availableQty === null ? null : parseQuantity6(group.availableQty);
    if (requested !== null && available !== null && requested > available)
      throw new Error(`${group.itemName}: số lượng đề nghị vượt khả dụng ${group.availableQty}.`);
    if (requested !== null && group.calculatedQty !== null && different(entry.quantity, group.calculatedQty)
      && !entry.overrideReason.trim()) throw new Error(`${group.itemName}: nhập lý do điều chỉnh số lượng.`);
    let remaining = requested;
    const derivations = group.derivations.flatMap(row => {
      const rowAvailable = row.availableQty === null ? null : parseQuantity6(row.availableQty);
      const allocation = remaining === null || rowAvailable === null ? null
        : remaining < rowAvailable ? remaining : rowAvailable;
      if (allocation !== null) remaining = remaining! - allocation;
      if (allocation === 0n) return [];
      if (allocation !== null && rowAvailable !== null) {
        const total = (allocatedByCandidate.get(row.candidateId) ?? 0n) + allocation;
        if (total > rowAvailable) throw new Error(`${group.itemName}: cùng nguồn đã được phân bổ ở dòng khác.`);
        allocatedByCandidate.set(row.candidateId, total);
      }
      return [{ sourcePlanId: row.sourcePlanId, sourceRevision: row.sourceRevision,
        sourcePlanHash: row.sourcePlanHash, sourceLineId: row.sourceLineId,
        sourceWorkQuantity: row.sourceWorkQuantity, normResourceId: row.normResourceId,
        normRevision: row.normRevision, normFactor: row.normFactor, coefficient: row.coefficient,
        conversionNumerator: row.conversionNumerator, conversionDenominator: row.conversionDenominator,
        derivedQuantity: row.calculatedQty, allocatedQuantity: allocation === null ? null : quantity6(allocation) }];
    });
    if (remaining !== null && remaining > 0n) throw new Error(`${group.itemName}: nguồn không còn đủ số lượng.`);
    const existingSource = existing?.sources.find(source => {
      const raw = source as Record<string, unknown>;
      return group.derivations.some(row => raw.source_plan_line_id === row.sourceLineId
        && raw.norm_resource_id === row.normResourceId);
    }) as Record<string, unknown> | undefined;
    const existingLine = existing?.lines.find(line => line.id === group.key)
      ?? existing?.lines.find(line => line.id === existingSource?.target_line_id);
    return { id: existingLine?.id, itemId: group.itemId, unit: group.unit,
      quantity: requested === null ? null : quantity6(requested),
      calculatedQuantity: group.calculatedQty, overrideReason: entry.overrideReason.trim() || null,
      neededDate: entry.neededDate || null, destinationId: entry.destinationId || null,
      note: entry.note.trim() || null, derivations };
  });
}

export function ProjectV2MaterialPlanDialog({ workspaceId, projectId, siteId, siteName,
  existing, onClose, onSaved, onReload }: Props) {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState(existing?.plan.code ?? '');
  const [title, setTitle] = useState(existing?.plan.title ?? '');
  const [periodStart, setPeriodStart] = useState(existing?.plan.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(existing?.plan.periodEnd ?? '');
  const [sourcePlans, setSourcePlans] = useState<{ id: string; code: string; title: string }[] | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>(() => [...new Set(existing?.sources.map(
    source => String((source as Record<string, unknown>).source_plan_id)) ?? [])]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof materialCandidateService.list>> | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, MaterialEntry>>({});
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const keyRef = useRef(crypto.randomUUID());
  const previousHash = useRef(window.location.hash);
  const groups = useMemo(() => {
    if (!rows || !existing) return groupMaterialCandidates(rows ?? []);
    const used = new Set<string>();
    const preserved = existing.lines.map(line => {
      const links = existing.sources.filter(source =>
        (source as Record<string, unknown>).target_line_id === line.id);
      const matches = rows.filter(row => links.some(source => {
        const raw = source as Record<string, unknown>;
        return raw.source_plan_id === row.sourcePlanId && raw.source_plan_line_id === row.sourceLineId
          && raw.norm_resource_id === row.normResourceId;
      }));
      matches.forEach(row => used.add(row.candidateId));
      const grouped = groupMaterialCandidates(matches);
      if (grouped.length === 1 && grouped[0].derivations.length === matches.length)
        return { ...grouped[0], key: line.id };
      const raw = line as Record<string, unknown>;
      return { key: line.id, itemId: raw.inventory_item_id as string | null,
        itemCode: raw.displayCode as string | null, itemName: String(raw.displayName ?? 'Vật tư cần đối chiếu'),
        unit: raw.unit as string | null, calculatedQty: raw.calculated_quantity as string | null,
        alreadyPlannedQty: null, availableQty: null,
        diagnostics: ['source_revision_changed' as const], selectable: false, derivations: [] };
    });
    return [...preserved, ...groupMaterialCandidates(rows.filter(row => !used.has(row.candidateId)))];
  }, [rows, existing]);
  const change = () => { keyRef.current = crypto.randomUUID(); setDirty(true); setError(null); };

  useEffect(() => {
    let active = true;
    materialCandidateService.listSourcePlans(workspaceId).then(value => {
      if (active) setSourcePlans(value);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được kế hoạch thi công.'); });
    return () => { active = false; };
  }, [workspaceId]);
  useEffect(() => {
    if (!selectedPlanIds.length) { setRows([]); return; }
    let active = true; setRows(null); setLoading(true);
    materialCandidateService.list({ projectId, constructionSiteId: siteId,
      sourcePlanIds: selectedPlanIds, excludePlanId: existing?.plan.id ?? null })
      .then(value => { if (active) setRows(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được vật tư nguồn.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, siteId, selectedPlanIds, existing?.plan.id]);
  useEffect(() => {
    if (!rows || !existing || selectedKeys.length) return;
    const keys: string[] = []; const restored: Record<string, MaterialEntry> = {};
    for (const group of groups) {
      if (existing.lines.some(line => line.id === group.key)) {
        const line = existing.lines.find(item => item.id === group.key)!;
        const raw = line as Record<string, unknown>;
        keys.push(group.key);
        restored[group.key] = { quantity: line.quantity ?? '', neededDate: String(raw.needed_date ?? ''),
          destinationId: String(raw.destination_id ?? siteId ?? ''), note: String(raw.note ?? ''),
          overrideReason: String(raw.override_reason ?? '') };
        continue;
      }
      const source = existing.sources.find(item => {
        const raw = item as Record<string, unknown>;
        return group.derivations.some(row => raw.source_plan_line_id === row.sourceLineId
          && raw.norm_resource_id === row.normResourceId);
      }) as Record<string, unknown> | undefined;
      const line = existing.lines.find(item => item.id === source?.target_line_id);
      if (!line) continue;
      const raw = line as Record<string, unknown>;
      keys.push(group.key);
      restored[group.key] = { quantity: line.quantity ?? '', neededDate: String(raw.needed_date ?? ''),
        destinationId: String(raw.destination_id ?? siteId ?? ''), note: String(raw.note ?? ''),
        overrideReason: String(raw.override_reason ?? '') };
    }
    setSelectedKeys(keys); setEntries(restored);
  }, [rows, existing, selectedKeys.length, siteId, groups]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const onHashChange = () => {
      if (dirty && !window.confirm('Bỏ những thay đổi chưa lưu?')) window.location.hash = previousHash.current;
      else previousHash.current = window.location.hash;
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('hashchange', onHashChange);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', onHashChange); };
  }, [dirty]);
  const close = () => { if (!saving && (!dirty || window.confirm('Bỏ những thay đổi chưa lưu?'))) onClose(); };
  const select = (key: string, checked: boolean) => {
    change(); setSelectedKeys(previous => checked ? [...new Set([...previous, key])] : previous.filter(id => id !== key));
    if (checked) setEntries(previous => ({ ...previous, [key]: previous[key] ?? {
      ...emptyEntry(siteId), quantity: groups.find(item => item.key === key)?.availableQty ?? '' } }));
  };
  const save = async () => {
    if (saving) return;
    try {
      if (!code.trim() || !title.trim() || !periodStart || !periodEnd || periodEnd < periodStart)
        throw new Error('Điền mã, tên và khoảng thời gian hợp lệ.');
      if (!selectedPlanIds.length || !selectedKeys.length || !rows) throw new Error('Chọn kế hoạch thi công và ít nhất một vật tư.');
      if (rows.some(row => !selectedPlanIds.includes(row.sourcePlanId))) throw new Error('Nguồn thi công đã đổi. Tải lại trước khi lưu.');
      const currentRows = await materialCandidateService.list({ projectId, constructionSiteId: siteId,
        sourcePlanIds: selectedPlanIds, excludePlanId: existing?.plan.id ?? null });
      const currentById = new Map(currentRows.map(row => [row.candidateId, row]));
      for (const group of groups.filter(item => selectedKeys.includes(item.key))) {
        for (const row of group.derivations) {
          const current = currentById.get(row.candidateId);
          if (!current || current.sourceRevision !== row.sourceRevision
            || current.sourcePlanHash !== row.sourcePlanHash || current.normRevision !== row.normRevision
            || current.availableQty !== row.availableQty)
            throw new Error(`${group.itemName}: nguồn hoặc định mức đã đổi. Tải lại trước khi lưu.`);
        }
      }
      const lines = buildMaterialPlanLines(groups, selectedKeys, entries, existing);
      setSaving(true); setError(null);
      const response = await projectV2CommandService.save({ workspaceId, planId: existing?.plan.id ?? null,
        expectedVersion: existing?.plan.version ?? null, idempotencyKey: keyRef.current,
        planType: 'material', code: code.trim(), title: title.trim(), periodStart, periodEnd, lines }) as { planId?: unknown };
      if (typeof response.planId !== 'string') throw new Error('Phản hồi lưu kế hoạch không hợp lệ.');
      onSaved(response.planId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không lưu được kế hoạch.';
      if (message.includes('PROJECT_V2_VERSION_STALE') || message.includes('40001')) setConflict(true);
      else setError(message);
    } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-3 py-4 sm:px-6 sm:py-8" role="presentation">
    <div role="dialog" aria-modal="true" aria-labelledby="material-plan-title"
      className="mx-auto w-full max-w-7xl rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:p-6">
      <header className="flex items-start justify-between gap-4"><div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Bước {step}/2 · Dự án V2</p>
        <h2 id="material-plan-title" className="mt-1 text-xl font-bold">{existing ? 'Sửa' : 'Tạo'} kế hoạch vật tư</h2>
        <p className="mt-1 text-sm text-slate-500">Nhu cầu lấy từ công việc thi công đã duyệt và định mức có liên kết vật tư kho.</p>
      </div><button type="button" aria-label="Đóng" onClick={close} className="rounded-lg p-2 text-slate-500"><X size={20} /></button></header>
      {conflict && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        Kế hoạch đã đổi phiên bản. <button type="button" onClick={onReload} className="font-semibold underline">Tải lại</button></div>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <fieldset disabled={saving} className="mt-5 min-w-0 border-0 p-0">{step === 1 ?
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Mã kế hoạch<input value={code} onChange={event => { change(); setCode(event.target.value); }} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-medium">Tên kế hoạch<input value={title} onChange={event => { change(); setTitle(event.target.value); }} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-medium">Từ ngày<input type="date" value={periodStart} onChange={event => { change(); setPeriodStart(event.target.value); }} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-medium">Đến ngày<input type="date" min={periodStart} value={periodEnd} onChange={event => { change(); setPeriodEnd(event.target.value); }} className={`${inputClass} mt-1`} /></label>
        </div> : <div className="space-y-5">
          <section aria-label="Kế hoạch thi công nguồn"><h3 className="font-semibold">Chọn kế hoạch thi công đã duyệt</h3>
            {sourcePlans === null ? <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Đang tải nguồn…</p>
              : sourcePlans.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{sourcePlans.map(plan => <label key={plan.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <input type="checkbox" checked={selectedPlanIds.includes(plan.id)} onChange={event => {
                  change(); setSelectedPlanIds(previous => event.target.checked ? [...previous, plan.id]
                    : previous.filter(id => id !== plan.id)); setSelectedKeys([]); setEntries({}); }} className="mt-1 h-4 w-4 accent-teal-700" />
                <span><strong>{plan.code}</strong> · {plan.title}</span></label>)}</div>
                : <p className="mt-2 rounded-xl border border-dashed p-4 text-sm text-slate-500">Chưa có kế hoạch thi công đã duyệt.</p>}
          </section>
          {loading || rows === null && selectedPlanIds.length > 0 ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Đang tính nhu cầu…</p>
            : <MaterialPlanEditor groups={groups} selectedKeys={selectedKeys} entries={entries}
              onSelect={select} onChange={(key, patch) => { change(); setEntries(previous => ({ ...previous,
                [key]: { ...(previous[key] ?? emptyEntry(siteId)), ...patch } })); }}
              periodStart={periodStart} periodEnd={periodEnd} siteName={siteName} siteId={siteId} />}
        </div>}</fieldset>
      <footer className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <button type="button" onClick={step === 1 ? close : () => setStep(1)} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">{step === 1 ? 'Đóng' : 'Quay lại'}</button>
        {step === 1 ? <button type="button" onClick={() => { if (code && title && periodStart && periodEnd && periodEnd >= periodStart) setStep(2);
          else setError('Điền mã, tên và khoảng thời gian hợp lệ.'); }}
          className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white">Tiếp tục</button>
          : <button type="button" disabled={saving || loading} onClick={save}
            className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu bản nháp'}</button>}
      </footer>
    </div>
  </div>;
}
