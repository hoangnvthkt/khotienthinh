// Lý do chậm ở Nhật ký (PR-3b, mockup chủ SP duyệt 16/10/2026): người tổng hợp điền sẵn, CHT xem lại và bắt buộc đủ
// lý do cho việc gây chậm khi Duyệt & công bố. Việc chậm theo việc trước tự lấy lý do việc trước.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Timer } from 'lucide-react';
import type { ProjectTask } from '../../../types';
import { StateBox } from '../../procurement/hub/hubUi';
import { taskService } from '../../../lib/projectService';
import { dailyLogWbsService, type ProjectDelayReasonsBundle } from '../../../lib/dailyLogWbsService';
import { computeScheduleVariance, type VarianceNode } from '../../../lib/projectScheduleVariance';
import {
  DELAY_PARTIES, DELAY_PARTY_LABEL, delayReasonTargets, inheritedDelayReason, initialDelayReasonDraft, partyOfReason,
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
  const [bundle, setBundle] = useState<ProjectDelayReasonsBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showKept, setShowKept] = useState(false);
  const [showChained, setShowChained] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([taskService.list(projectId, constructionSiteId), dailyLogWbsService.getDelayReasons({ projectId, constructionSiteId, dailyLogId })])
      .then(([taskRows, reasons]) => { if (alive) { setTasks(taskRows); setBundle(reasons); } })
      .catch(caught => { if (alive) setError(caught instanceof Error ? caught.message : 'Không tải được tiến độ tổng.'); });
    return () => { alive = false; };
  }, [constructionSiteId, dailyLogId, projectId, retry]);

  const progressKey = JSON.stringify([...progressByTask].sort());
  const result = useMemo(() => (tasks && logDate ? computeScheduleVariance(tasksAfterDailyLog(tasks, progressByTask, logDate), logDate) : null),
    [tasks, logDate, progressKey]);
  const targets = useMemo(() => (result ? delayReasonTargets(result) : { required: [], chained: [] }), [result]);

  useEffect(() => {
    if (!bundle || !result) return;
    setDraft(current => current || initialDelayReasonDraft(targets.required, bundle.draft, bundle.latest));
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

  const patch = (id: string, value: Partial<DelayReasonEntry>) => setDraft(current => {
    const previous = current?.[id];
    const next = { taskId: id, reasonCode: '', responsibleParty: 'company' as DelayParty, note: engineerNotes?.get(id) ?? null, ...previous, ...value, kept: false };
    return { ...current, [id]: next };
  });
  const applyToGroup = (node: VarianceNode) => {
    const source = draft[node.id];
    if (!source?.reasonCode) return;
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
    return <div key={node.id} className={`px-3 py-2.5 ${entry?.reasonCode ? '' : 'shadow-[inset_4px_0_0_0_#f43f5e]'}`}>
      <button type="button" disabled={!editable} onClick={() => setOpenId(open ? null : node.id)} className="block w-full text-left disabled:cursor-default">
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
          {editable && <span className="text-teal-700 hover:underline dark:text-teal-300">Sửa</span>}
        </div> : !open && <div className={`mt-1 text-xs font-semibold ${mode === 'review' ? 'text-rose-600' : 'text-amber-700 dark:text-amber-300'}`}>
          {editable ? 'Chưa chọn lý do — bấm để chọn' : 'Chưa chọn lý do'}</div>}
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
    </div>;
  };

  return <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Việc chậm quá 3 ngày">
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
    {kept.length > 0 && <>
      <button type="button" onClick={() => setShowKept(value => !value)} className="flex w-full items-center justify-between gap-2 border-b border-border bg-mint-50 px-4 py-2 text-left text-xs dark:bg-mint-950/30">
        <span><b className="text-mint-800 dark:text-mint-200">{kept.length} việc giữ lý do đã ghi</b> <span className="text-muted-foreground">— vẫn chậm, không cần chọn lại{editable ? '. Bấm để xem / đổi' : ''}.</span></span>
        {showKept ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {showKept && <div className="divide-y divide-border border-b border-border bg-muted/30">{kept.map(row)}</div>}
    </>}
    <div className="divide-y divide-border">
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi', { numeric: true })).map(([group, nodes]) => <div key={group || '-'}>
        {group && <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-[11px]"><b className="text-muted-foreground">{group}</b><span className="text-muted-foreground">{nodes.length} việc</span></div>}
        <div className="divide-y divide-border">{nodes.sort((a, b) => a.lagDays - b.lagDays).map(row)}</div>
      </div>)}
    </div>
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
