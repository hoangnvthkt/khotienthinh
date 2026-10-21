// Lý do chậm ở Nhật ký (PR-3b, mockup chủ SP duyệt 16/10/2026): người tổng hợp điền sẵn, CHT xem lại và bắt buộc đủ
// lý do cho việc gây chậm khi Duyệt & công bố. Việc chậm theo việc trước tự lấy lý do việc trước.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Minus, Timer, Zap } from 'lucide-react';
import type { ProjectTask } from '../../../types';
import { StateBox } from '../../procurement/hub/hubUi';
import { taskService } from '../../../lib/projectService';
import { dailyLogWbsService, type ProjectDelayReasonsBundle } from '../../../lib/dailyLogWbsService';
import { computeScheduleVariance, type VarianceNode } from '../../../lib/projectScheduleVariance';
import {
  applyDelayReasonToTasks, DELAY_PARTIES, DELAY_PARTY_LABEL, delayReasonTargets, inheritedDelayReason, initialDelayReasonDraft, partyOfReason,
  tasksAfterDailyLog, type DelayParty, type DelayReasonEntry,
} from '../../../lib/projectDelayReasons';

export const DELAY_PARTY_CLS: Record<DelayParty, string> = {
  owner: 'bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800',
  company: 'bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800',
  objective: 'bg-zinc-200 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700',
};
export const DelayPartyPill: React.FC<{ party: DelayParty; children?: React.ReactNode }> = ({ party, children }) =>
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${DELAY_PARTY_CLS[party]}`}>{DELAY_PARTY_LABEL[party]}{children}</span>;

const sd = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
const lateBadge = (days: number) => <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">Chậm {days} ngày</span>;

type Draft = Record<string, DelayReasonEntry & { kept?: boolean }>;

/** Ô tick 44px cho chọn nhanh; `mixed` khi chỉ chọn một phần nhóm. */
const Tick: React.FC<{ checked: boolean; mixed?: boolean; label: string; onToggle: () => void }> = ({ checked, mixed, label, onToggle }) =>
  <button type="button" role="checkbox" aria-checked={mixed ? 'mixed' : checked} aria-label={label} onClick={onToggle}
    className="-my-2 -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted">
    <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-2 ${checked || mixed ? 'border-teal-700 bg-teal-700 text-white' : 'border-zinc-400 bg-card dark:border-zinc-500'}`}>
      {mixed ? <Minus size={12} strokeWidth={3} /> : checked && <Check size={12} strokeWidth={3} />}</span>
  </button>;
export interface DelayReasonsState { entries: DelayReasonEntry[]; missing: number; ready: boolean }

interface Props {
  projectId: string;
  constructionSiteId: string | null;
  dailyLogId: string | null;
  logDate: string;
  /** % chốt theo việc của bản tổng hợp (sẽ công bố). */
  progressByTask: Map<string, number>;
  /** Ghi chú dự kiến của kỹ sư theo việc (forecast_change_reason) để CHT tham khảo. */
  engineerNotes?: Map<string, string>;
  editable: boolean;
  mode: 'summarize' | 'review';
  onChange: (state: DelayReasonsState) => void;
}

export const DelayReasonsSection: React.FC<Props> = ({ projectId, constructionSiteId, dailyLogId, logDate, progressByTask, engineerNotes, editable, mode, onChange }) => {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [bundle, setBundle] = useState<(ProjectDelayReasonsBundle & { later: DelayReasonEntry[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showKept, setShowKept] = useState(false);
  const [showChained, setShowChained] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<{ previous: Draft; label: string; count: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [dockOffset, setDockOffset] = useState(0);
  const picking = editable && selected.size > 0;

  // Thanh chọn nhanh dính đáy màn hình; trên điện thoại đứng trên thanh Duyệt & công bố (cố định đáy) của nhật ký.
  useEffect(() => {
    const bar = picking ? sectionRef.current?.closest('.daily-log-document')?.querySelector<HTMLElement>('.daily-log-document-actionbar') : null;
    if (!bar) { setDockOffset(0); return; }
    const measure = () => setDockOffset(getComputedStyle(bar).position === 'fixed' ? bar.offsetHeight : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [picking]);

  useEffect(() => {
    let alive = true;
    setError(null);
    // Phiếu cũ duyệt bù sau phiếu mới: lấy thêm lý do công bố gần nhất (mọi ngày) để điền sẵn việc chưa có lý do trước ngày đó.
    Promise.all([taskService.list(projectId, constructionSiteId), dailyLogWbsService.getDelayReasons({ projectId, constructionSiteId, dailyLogId }),
      dailyLogId ? dailyLogWbsService.getDelayReasons({ projectId, constructionSiteId }) : null])
      .then(([taskRows, reasons, overall]) => { if (alive) { setTasks(taskRows); setBundle({ ...reasons, later: overall?.latest || [] }); } })
      .catch(caught => { if (alive) setError(caught instanceof Error ? caught.message : 'Không tải được tiến độ tổng.'); });
    return () => { alive = false; };
  }, [constructionSiteId, dailyLogId, projectId, retry]);

  const progressKey = JSON.stringify([...progressByTask].sort());
  const result = useMemo(() => (tasks && logDate ? computeScheduleVariance(tasksAfterDailyLog(tasks, progressByTask, logDate), logDate) : null),
    [tasks, logDate, progressKey]);
  const targets = useMemo(() => (result ? delayReasonTargets(result) : { required: [], chained: [] }), [result]);

  useEffect(() => {
    if (!bundle || !result) return;
    setDraft(current => current || initialDelayReasonDraft(targets.required, bundle.draft, bundle.latest, bundle.later));
  }, [bundle, result, targets.required]);

  const entries = useMemo(() => targets.required.flatMap(node => {
    const entry = draft?.[node.id];
    return entry?.reasonCode ? [{ taskId: node.id, reasonCode: entry.reasonCode, responsibleParty: entry.responsibleParty,
      note: entry.note ?? null, lagDays: -node.lagDays }] : [];
  }), [draft, targets.required]);
  const missing = targets.required.length - entries.length;
  const ready = Boolean(result && draft);
  useEffect(() => { onChange({ entries, missing, ready }); }, [entries, missing, ready, onChange]);

  if (error) return <StateBox kind="error" title="Không tải được việc chậm" message={error} onRetry={() => setRetry(value => value + 1)} />;
  if (!result || !bundle || !draft) return <StateBox kind="loading" message="Đang tính việc chậm so với tiến độ tổng…" />;
  if (!targets.required.length && !targets.chained.length) return null;

  const catalog = bundle.catalog;
  const labelOf = (code: string) => catalog.find(item => item.code === code)?.label || code;
  const reasonMap = new Map(entries.map(entry => [entry.taskId, entry]));
  const kept = targets.required.filter(node => draft[node.id]?.kept);
  const fresh = targets.required.filter(node => !draft[node.id]?.kept);
  const groups = new Map<string, VarianceNode[]>();
  for (const node of fresh) {
    const parent = node.parentId ? result.nodes.get(node.parentId) : null;
    const key = parent ? `${parent.wbsCode ? `${parent.wbsCode} ` : ''}${parent.name}` : '';
    groups.set(key, [...(groups.get(key) || []), node]);
  }
  const tally = DELAY_PARTIES.map(party => [party, entries.filter(entry => entry.responsibleParty === party).length] as const).filter(([, count]) => count > 0);

  const missingIds = targets.required.filter(node => !draft[node.id]?.reasonCode).map(node => node.id);
  const toggle = (ids: string[]) => setSelected(current => {
    const next = new Set(current);
    const all = ids.every(id => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });
  const applyBulk = (code: string) => {
    const ids = targets.required.filter(node => selected.has(node.id)).map(node => node.id);
    if (!ids.length) return;
    setUndo({ previous: draft, label: labelOf(code), count: ids.length });
    setDraft(applyDelayReasonToTasks(draft, ids, catalog, code, engineerNotes));
    setSelected(new Set());
    setOpenId(null);
  };

  const patch = (id: string, value: Partial<DelayReasonEntry>) => setDraft(current => {
    const previous = current?.[id];
    const next = { taskId: id, reasonCode: '', responsibleParty: 'company' as DelayParty, note: engineerNotes?.get(id) ?? null, ...previous, ...value, kept: false };
    setUndo(null);
    return { ...current, [id]: next };
  });
  const applyToGroup = (node: VarianceNode) => {
    const source = draft[node.id];
    if (!source?.reasonCode) return;
    setUndo(null);
    setDraft(current => {
      const next = { ...current };
      for (const sibling of fresh.filter(item => item.parentId === node.parentId && !current?.[item.id]?.reasonCode)) {
        next[sibling.id] = { taskId: sibling.id, reasonCode: source.reasonCode, responsibleParty: source.responsibleParty, note: engineerNotes?.get(sibling.id) ?? null };
      }
      return next;
    });
    setOpenId(null);
  };

  const row = (node: VarianceNode) => {
    const entry = draft[node.id];
    const open = editable && openId === node.id;
    const note = engineerNotes?.get(node.id);
    const siblings = fresh.filter(item => item.parentId === node.parentId).length;
    const checked = selected.has(node.id);
    return <div key={node.id} className={`flex items-start gap-1 px-3 py-2.5 ${checked ? 'bg-teal-50 dark:bg-teal-950/30' : ''} ${entry?.reasonCode ? '' : 'shadow-[inset_4px_0_0_0_#f43f5e]'}`}>
      {editable && <Tick checked={checked} label={`Chọn ${node.wbsCode ? `${node.wbsCode} ` : ''}${node.name}`} onToggle={() => toggle([node.id])} />}
      <div className="min-w-0 flex-1">
      <button type="button" disabled={!editable} onClick={() => (picking ? toggle([node.id]) : setOpenId(open ? null : node.id))} className="block w-full text-left disabled:cursor-default">
        <div className="flex items-start justify-between gap-2 text-xs">
          <div className="min-w-0">{node.wbsCode && <span className="font-mono text-teal-700 dark:text-teal-300">{node.wbsCode} </span>}<b className="text-foreground">{node.name}</b></div>
          {lateBadge(-node.lagDays)}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground"><span className="tabular-nums">{node.progress}%</span> · KH xong {sd(node.planEnd)} · dự kiến {sd(node.forecastEnd)}
          {note && !entry?.reasonCode && <> · <span className="text-foreground/80">KS ghi: “{note}”</span></>}</div>
        {entry?.reasonCode && !open ? <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <DelayPartyPill party={entry.responsibleParty} /><b className="text-foreground">{labelOf(entry.reasonCode)}</b>
          {entry.note && <span className="text-muted-foreground">· {entry.note}</span>}
          {entry.kept && entry.logDate && <span className="text-muted-foreground">· ghi {sd(entry.logDate)}{entry.updatedByName ? ` · ${entry.updatedByName}` : ''}</span>}
          {editable && !picking && <span className="text-teal-700 hover:underline dark:text-teal-300">Sửa</span>}
        </div> : !open && <div className={`mt-1 text-xs font-semibold ${mode === 'review' ? 'text-rose-600' : 'text-amber-700 dark:text-amber-300'}`}>
          {editable && !picking ? 'Chưa chọn lý do — bấm để chọn' : 'Chưa chọn lý do'}</div>}
      </button>
      {open && <div className="mt-2 space-y-2 rounded-xl border-2 border-[#0d9488] bg-card p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Vì sao chậm?</div>
        <div className="flex flex-wrap gap-1.5">{catalog.map(option => <button key={option.code} type="button"
          onClick={() => patch(node.id, { reasonCode: option.code, responsibleParty: partyOfReason(catalog, option.code) })}
          className={`min-h-[36px] rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold ${entry?.reasonCode === option.code ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-500'}`}>{option.label}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bên chịu trách nhiệm</span>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Bên chịu trách nhiệm">{DELAY_PARTIES.map(party =>
            <button key={party} type="button" role="radio" aria-checked={entry?.responsibleParty === party && Boolean(entry?.reasonCode)} disabled={!entry?.reasonCode}
              onClick={() => patch(node.id, { responsibleParty: party })}
              className={`min-h-[32px] rounded-md px-3 text-xs font-bold disabled:opacity-40 ${entry?.reasonCode && entry.responsibleParty === party ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{DELAY_PARTY_LABEL[party]}</button>)}</div>
          {entry?.reasonCode && <span className="text-[11px] text-muted-foreground">Tự chọn theo lý do — sửa nếu khác</span>}
        </div>
        <input value={entry?.note ?? note ?? ''} maxLength={500} onChange={event => patch(node.id, { note: event.target.value })}
          placeholder="Ghi thêm (không bắt buộc)" aria-label={`Ghi chú lý do chậm ${node.name}`}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-teal-600" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {siblings > 1 ? <button type="button" disabled={!entry?.reasonCode} onClick={() => applyToGroup(node)}
            className="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-40 dark:text-teal-300">Dùng lý do này cho các việc chưa chọn trong nhóm ({siblings} việc)</button> : <span />}
          <button type="button" onClick={() => setOpenId(null)} className="min-h-[36px] rounded-lg bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800">Xong</button>
        </div>
      </div>}
      </div>
    </div>;
  };

  return <section ref={sectionRef} className="overflow-clip rounded-2xl border border-border bg-card" aria-label="Việc chậm quá 3 ngày">
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-200"><Timer size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black text-foreground">Việc chậm quá 3 ngày — ghi lý do</div>
        <div className="text-[11px] text-muted-foreground">So tiến độ tổng sau khi duyệt nhật ký {sd(logDate)}{mode === 'summarize' ? ' · điền sẵn để CHT xem lại' : ''}</div>
      </div>
      <div className="shrink-0 text-right">{missing > 0
        ? <><div className="text-xl font-black tabular-nums text-rose-600">{missing}</div><div className="text-[11px] text-muted-foreground">việc chưa có lý do</div></>
        : targets.required.length > 0 ? <><div className="text-sm font-black text-leaf-700 dark:text-leaf-300">Đủ lý do</div>
          <div className="mt-0.5 flex justify-end gap-1">{tally.map(([party, count]) => <DelayPartyPill key={party} party={party}> {count}</DelayPartyPill>)}</div></>
        : <div className="text-[11px] text-muted-foreground">không có việc gây chậm mới</div>}</div>
    </div>
    {editable && !picking && (missingIds.length > 0 || undo) && <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-teal-50/60 px-4 py-2 text-xs dark:bg-teal-950/20">
      {undo && <span role="status" className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground"><Check size={14} className="shrink-0 text-leaf-700 dark:text-leaf-300" />
        <span>Đã ghi <b>“{undo.label}”</b> cho {undo.count} việc.</span>
        <button type="button" onClick={() => { setDraft(undo.previous); setUndo(null); }} className="min-h-[32px] font-semibold text-teal-700 hover:underline dark:text-teal-300">Hoàn tác</button></span>}
      {missingIds.length > 0 && <button type="button" onClick={() => setSelected(new Set(missingIds))}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-teal-700 px-3 font-bold text-white hover:bg-teal-800">
        <Zap size={14} />{undo ? `Chọn nhanh ${missingIds.length} việc còn lại` : `Chọn nhanh lý do · ${missingIds.length} việc`}</button>}
    </div>}
    {kept.length > 0 && <>
      <button type="button" onClick={() => setShowKept(value => !value)} className="flex w-full items-center justify-between gap-2 border-b border-border bg-mint-50 px-4 py-2 text-left text-xs dark:bg-mint-950/30">
        <span><b className="text-mint-800 dark:text-mint-200">{kept.length} việc giữ lý do đã ghi</b> <span className="text-muted-foreground">— vẫn chậm, không cần chọn lại{editable ? '. Bấm để xem / đổi' : ''}.</span></span>
        {showKept ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {showKept && <div className="divide-y divide-border border-b border-border bg-muted/30">{kept.map(row)}</div>}
    </>}
    <div className="divide-y divide-border">
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi', { numeric: true })).map(([group, nodes]) => {
        const ids = nodes.map(node => node.id);
        const picked = ids.filter(id => selected.has(id)).length;
        return <div key={group || '-'}>
          {group && <div className="flex items-center gap-1 bg-muted/50 px-3 py-1.5 text-[11px]">
            {editable && <Tick checked={picked === ids.length} mixed={picked > 0 && picked < ids.length} label={`Chọn cả nhóm ${group}`} onToggle={() => toggle(ids)} />}
            <b className="min-w-0 flex-1 text-muted-foreground">{group}</b><span className="shrink-0 text-muted-foreground">{nodes.length} việc</span></div>}
          <div className="divide-y divide-border">{nodes.sort((a, b) => a.lagDays - b.lagDays).map(row)}</div>
        </div>;
      })}
    </div>
    {picking && <div style={dockOffset ? { bottom: dockOffset, paddingBottom: '0.75rem' } : undefined} className="sticky bottom-0 z-10 bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_20px_-8px_rgba(15,23,42,0.25)] ring-1 ring-border" aria-label="Chọn nhanh lý do">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span><b className="text-foreground">Đã chọn {selected.size} việc</b> <span className="text-muted-foreground">· bấm một lý do để ghi</span></span>
        {missingIds.some(id => !selected.has(id)) && <button type="button" onClick={() => setSelected(new Set(missingIds))}
          className="min-h-[32px] font-semibold text-teal-700 hover:underline dark:text-teal-300">Chọn hết việc chưa có lý do ({missingIds.length})</button>}
        <button type="button" onClick={() => setSelected(new Set())} className="ml-auto min-h-[32px] rounded-lg px-2 font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">Bỏ chọn</button>
      </div>
      <div className="relative -mx-3 sm:mx-0"><div className="mt-1 flex gap-1.5 overflow-x-auto px-3 pb-0.5 pr-8 sm:flex-wrap sm:overflow-visible sm:px-0">{catalog.map(option =>
        <button key={option.code} type="button" onClick={() => applyBulk(option.code)}
          className="min-h-[40px] shrink-0 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-left sm:min-h-[34px] text-xs font-semibold text-foreground hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-950/40">
          {option.label}<span className="ml-1 font-normal text-muted-foreground">· {DELAY_PARTY_LABEL[partyOfReason(catalog, option.code)]}</span></button>)}</div>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card sm:hidden" /></div>
    </div>}
    {targets.chained.length > 0 && <>
      <button type="button" onClick={() => setShowChained(value => !value)} className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-left text-xs hover:bg-muted/40">
        <span><b className="text-foreground">{targets.chained.length} việc chậm theo việc trước</b> <span className="text-muted-foreground">— tự lấy lý do của việc trước, không cần chọn</span></span>
        {showChained ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {showChained && <div className="max-h-[360px] divide-y divide-border overflow-y-auto border-t border-border bg-muted/30">{targets.chained.map(node => {
        const inherited = inheritedDelayReason(result, node.id, reasonMap);
        const blocker = result.nodes.get(node.blockerIds[0]);
        return <div key={node.id} className="px-3 py-2 text-xs">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0">{node.wbsCode && <span className="font-mono text-teal-700 dark:text-teal-300">{node.wbsCode} </span>}{node.name}</div>{lateBadge(-node.lagDays)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">Do chờ {blocker ? `${blocker.wbsCode ? `${blocker.wbsCode} ` : ''}${blocker.name}` : 'việc trước'}
            {inherited ? <> · <DelayPartyPill party={inherited.responsibleParty} /> {labelOf(inherited.reasonCode)}</> : <span className="text-rose-600"> · việc trước chưa có lý do</span>}</div>
        </div>;
      })}</div>}
    </>}
  </section>;
};
