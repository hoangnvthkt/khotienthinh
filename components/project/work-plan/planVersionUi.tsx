import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronsUpDown, FileText, GitCompare, History, Lock, Paperclip, Plus } from 'lucide-react';
import { Badge, money } from '../../procurement/hub/hubUi';
import { ENT, NUM, shortMoney } from '../../finance/financeUi';
import { useToast } from '../../../context/ToastContext';
import { CrewPill, fmt, GroupHeader } from './workPlanUi';
import {
  projectWorkPlanService, RESPONSIBLE_PARTY_LABELS,
  type PlanChangeReason, type ResponsibleParty, type WorkPlan, type WorkPlanAttachment, type WorkPlanImpact,
} from '../../../lib/projectWorkPlanService';
import { changeRefs, effEnd, effStart, expectedByToday, planPerformance, type ChangeRef, type PlanDiffRow } from '../../../lib/workPlanVersions';

// Giao diện phiên bản kế hoạch (bản gốc / hiện hành / điều chỉnh): dải phiên bản, so sánh, lý do, lịch sử.

export const TONE = {
  teal: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200',
  leaf: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-800 dark:bg-leaf-900/30 dark:text-leaf-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  slate: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  mint: 'border-mint-200 bg-mint-50 text-mint-800 dark:border-mint-800 dark:bg-mint-900/30 dark:text-mint-200',
};
// index.css cắt chữ .text-xs trong .grid > div trên mobile — ghi chú cần đọc đủ phải ép xuống dòng.
export const WRAP = '!whitespace-normal !overflow-visible';
export const PARTY_TONE: Record<ResponsibleParty, string> = { owner: TONE.violet, company: TONE.mint, vendor: TONE.sky, objective: TONE.slate };

const dm = (s?: string | null) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '—';
const pad = (n: number) => String(n).padStart(2, '0');
const dmt = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const span = (a: string, b: string) => `${dm(a)} – ${dm(b)}`;
const sgn = (n: number) => `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
const pct = (n: number) => `${fmt(n, 0)}%`;

export const reasonLabel = (reasons: PlanChangeReason[], code: string | null | undefined) => reasons.find(r => r.code === code)?.label || code || '—';

export const ReasonChip: React.FC<{ reasons: PlanChangeReason[]; code: string; party: ResponsibleParty | null }> = ({ reasons, code, party }) =>
  <span className="inline-flex flex-wrap items-center gap-1"><Badge className={TONE.slate}>{reasonLabel(reasons, code)}</Badge>
    {party && <Badge className={PARTY_TONE[party]}>{RESPONSIBLE_PARTY_LABELS[party]}</Badge>}</span>;

// ---------------------------------------------------------------------------- dải phiên bản
export type CompareMode = 'goc' | 'prev' | 'none';
export const versionTag = (v: WorkPlan, versions: WorkPlan[]): [string, string] => {
  const original = versions.filter(x => x.approvedAt).sort((a, b) => a.revisionNo - b.revisionNo)[0];
  if (original && v.id === original.id) return [v.status === 'approved' ? 'Gốc · hiện hành' : 'Gốc', TONE.teal];
  if (v.status === 'approved') return ['Hiện hành', TONE.leaf];
  if (v.status === 'submitted') return ['Chờ duyệt', TONE.amber];
  if (v.status === 'returned') return ['Bị trả lại', TONE.rose];
  if (v.status === 'draft') return ['Nháp', TONE.slate];
  return ['Bản cũ', TONE.slate];
};
const changeCount = (v: WorkPlan) => v.lines.filter(l => l.changeReasonCode).length + (v.removedLines || []).length;

export const VersionStrip: React.FC<{ versions: WorkPlan[]; reasons: PlanChangeReason[]; selected: string; onSelect: (id: string) => void }> = ({ versions, reasons, selected, onSelect }) =>
  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="tablist" aria-label="Phiên bản của kỳ">
    {versions.map((v, i) => {
      const [tag, tone] = versionTag(v, versions);
      const n = changeCount(v);
      return <button key={v.id} type="button" role="tab" aria-selected={selected === v.id} onClick={() => onSelect(v.id)}
        className={`relative rounded-xl border bg-card px-3 py-2.5 text-left transition hover:border-teal-400 ${selected === v.id ? 'border-teal-600 ring-2 ring-teal-500/30' : 'border-border'}`}>
        {i > 0 && <ArrowRight size={14} className="absolute -left-2.5 top-1/2 hidden -translate-y-1/2 rounded-full bg-background text-muted-foreground lg:block" aria-hidden="true" />}
        <span className="flex items-center gap-2"><span className="text-sm font-bold text-foreground">Bản {v.revisionNo}</span><Badge className={tone}>{tag === 'Gốc' || tag === 'Gốc · hiện hành' ? <Lock size={11} /> : null}{tag}</Badge></span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {v.approvedAt ? <>Duyệt {dmt(v.approvedAt)} · <span className={ENT}>{v.approvedByName}</span></>
            : v.submittedAt && v.status === 'submitted' ? <>Gửi {dmt(v.submittedAt)} · <span className={ENT}>{v.submittedByName}</span></>
              : <>Lập {dmt(v.createdAt)} · <span className={ENT}>{v.createdByName}</span></>}
        </span>
        <span className="mt-1 block text-xs text-foreground">{!v.supersedesPlanId ? `${v.lines.length} việc · bản lập đầu kỳ`
          : <>{n} thay đổi{v.changeReasonCode ? <> · {reasonLabel(reasons, v.changeReasonCode)}</> : null}</>}</span>
      </button>;
    })}
  </div>;

export const CompareControl: React.FC<{ value: CompareMode; onChange: (m: CompareMode) => void; isFirst: boolean; onlyChanged: boolean; onOnlyChanged: (b: boolean) => void }> = ({ value, onChange, isFirst, onlyChanged, onOnlyChanged }) =>
  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><GitCompare size={14} />So sánh với</span>
      <div className="inline-flex rounded-xl border border-border bg-muted/60 p-1" role="radiogroup" aria-label="So sánh với">
        {([['goc', 'Bản gốc'], ['prev', 'Bản trước'], ['none', 'Không so sánh']] as const).map(([k, label]) =>
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={isFirst && k !== 'none'} onClick={() => onChange(k)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${value === k ? 'bg-card text-teal-700 shadow-sm dark:text-teal-300' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
      </div>
      {isFirst && <span className="text-xs text-muted-foreground">Đây là bản gốc — chưa có bản để so.</span>}
    </div>
    {value !== 'none' && !isFirst && <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
      <input type="checkbox" checked={onlyChanged} onChange={e => onOnlyChanged(e.target.checked)} className="h-4 w-4 accent-teal-700" />Chỉ hiện việc thay đổi</label>}
  </div>;

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: string }> = ({ label, value, hint, tone = 'text-foreground' }) =>
  <div className="rounded-xl border border-border bg-background px-3 py-2.5">
    <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
    <div className={`mt-0.5 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
  </div>;

export const CompareSummary: React.FC<{ rows: PlanDiffRow[]; versions: WorkPlan[]; baseNo: number; curNo: number; label: string }> = ({ rows, versions, baseNo, curNo, label }) => {
  const added = rows.filter(r => r.kind === 'added').length;
  const removed = rows.filter(r => r.kind === 'removed').length;
  const changed = rows.filter(r => r.kind === 'changed');
  const up = changed.filter(r => (r.dQty ?? 0) > 0.0005).length; const down = changed.filter(r => (r.dQty ?? 0) < -0.0005).length;
  const later = changed.filter(r => r.dEnd > 0).length; const earlier = changed.filter(r => r.dEnd < 0).length;
  const faster = rows.filter(r => r.pace === 'faster').length; const slower = rows.filter(r => r.pace === 'slower').length;
  const parties = new Map<ResponsibleParty, number>();
  rows.filter(r => r.kind !== 'same').forEach(r => changeRefs(versions, r.taskId, baseNo, curNo).forEach(c => { if (c.party) parties.set(c.party, (parties.get(c.party) || 0) + 1); }));
  return <div className="space-y-2">
    <p className="text-sm text-foreground"><strong>{label}:</strong> <span className="text-leaf-700 dark:text-leaf-300">nhanh hơn ở {faster} việc</span> · <span className="text-amber-700 dark:text-amber-300">chậm hơn ở {slower} việc</span>.</p>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Tile label="Thêm vào kỳ" value={added} tone={added ? 'text-teal-700 dark:text-teal-300' : 'text-muted-foreground'} />
      <Tile label="Dời khỏi kỳ" value={removed} tone={removed ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} />
      <Tile label="Đổi khối lượng" value={<><span className="text-leaf-700 dark:text-leaf-300">↑{up}</span> <span className="text-amber-700 dark:text-amber-300">↓{down}</span></>} hint="tăng · giảm" />
      <Tile label="Đổi ngày kết thúc" value={<><span className="text-amber-700 dark:text-amber-300">+{later}</span> <span className="text-leaf-700 dark:text-leaf-300">−{earlier}</span></>} hint="muộn hơn · sớm hơn" />
    </div>
    {parties.size > 0 && <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">Bên chịu trách nhiệm:
      {Array.from(parties.entries()).map(([p, n]) => <Badge key={p} className={PARTY_TONE[p]}>{RESPONSIBLE_PARTY_LABELS[p]} · {n}</Badge>)}</p>}
  </div>;
};

export const PerfRow: React.FC<{ label: string; hint: string; plan: WorkPlan; today: string; actualOf: (taskId: string) => number | null | undefined; strong?: boolean }> = ({ label, hint, plan, today, actualOf, strong }) => {
  const p = planPerformance(plan, today, actualOf);
  const w = (n: number) => `${(n / Math.max(p.total, 1)) * 100}%`;
  return <div className={`grid gap-2 rounded-xl border px-3 py-2.5 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center ${strong ? 'border-teal-300 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-950/20' : 'border-border bg-background'}`}>
    <div><p className="text-sm font-bold text-foreground">{label}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
    <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span className="bg-leaf-500" style={{ width: w(p.ok) }} /><span className="bg-amber-400" style={{ width: w(p.late) }} /><span className="bg-slate-300 dark:bg-slate-600" style={{ width: w(p.notYet) }} />
    </div>
    <p className={`text-xs ${WRAP}`}><span className="font-semibold text-leaf-700 dark:text-leaf-300">{p.ok} đúng/vượt</span> · <span className="font-semibold text-amber-700 dark:text-amber-300">{p.late} chậm</span> · <span className="text-muted-foreground">{p.notYet} chưa đến ngày</span>
      {p.unknown > 0 && <span className="text-muted-foreground"> · {p.unknown} chưa có số liệu</span>}{p.avgPct != null && <> · TB <span className={NUM}>{pct(p.avgPct)}</span></>}</p>
  </div>;
};

// ---------------------------------------------------------------------------- bảng so sánh
const DIFF_COLS = 'md:grid-cols-[52px_minmax(0,2.1fr)_minmax(0,1.45fr)_minmax(0,1.25fr)_minmax(0,1.3fr)_minmax(0,1.75fr)]';
const rowTone = (r: PlanDiffRow) => r.kind === 'added' ? 'bg-teal-50/50 dark:bg-teal-950/20' : r.kind === 'removed' ? 'bg-rose-50/40 dark:bg-rose-950/20' : r.kind === 'changed' ? 'bg-amber-50/40 dark:bg-amber-950/20' : '';
const MobileLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden">{children}</span>;
const qtyText = (q: number | null | undefined) => q == null ? 'Chưa có KL' : fmt(q);

export const DiffTable: React.FC<{
  rows: PlanDiffRow[]; compare: boolean; onlyChanged: boolean; today: string; reasons: PlanChangeReason[];
  basePlan: WorkPlan | null; curPlan: WorkPlan; original: WorkPlan | null; curLabel: string; refsOf: (r: PlanDiffRow) => ChangeRef[];
}> = ({ rows, compare, onlyChanged, today, reasons, basePlan, curPlan, original, curLabel, refsOf }) => {
  const shown = compare && onlyChanged ? rows.filter(r => r.kind !== 'same') : rows;
  const groups = useMemo(() => {
    const map = new Map<string, PlanDiffRow[]>();
    shown.forEach(r => map.set(r.groupName, [...(map.get(r.groupName) || []), r]));
    return Array.from(map.entries());
  }, [shown]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const originalLines = new Map((original?.lines || []).map(l => [l.taskId, l]));
  if (!shown.length) return <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{compare ? 'Hai bản giống nhau — không có việc nào thay đổi.' : 'Bản này chưa có công việc.'}</div>;
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{groups.length} hạng mục · {shown.length} việc{compare && onlyChanged ? ' thay đổi' : ''}</span>
      <button type="button" onClick={() => setClosed(closed.size ? new Set() : new Set(groups.map(([g]) => g)))} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 font-semibold text-foreground hover:bg-muted">
        <ChevronsUpDown size={13} />{closed.size ? 'Mở rộng hết' : 'Thu gọn hết'}</button>
    </div>
    <div className="overflow-hidden rounded-xl border border-border">
      <div className={`hidden gap-3 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 md:grid ${DIFF_COLS}`}>
        <span>Chỉ mục</span><span>Công việc</span><span>Khối lượng{compare ? ' (so sánh → bản này)' : ''}</span><span>Thời gian</span><span>Đã làm đến {dm(today)}</span><span>Lý do thay đổi</span>
      </div>
      {groups.map(([group, items], gi) => {
        const open = !closed.has(group);
        const changedN = items.filter(r => r.kind !== 'same').length;
        return <div key={group}>
          <GroupHeader index={gi + 1} name={group} open={open} count={items.length} tone="bg-teal-50 border-l-teal-600 text-teal-950 dark:bg-teal-950/40 dark:border-l-teal-500 dark:text-teal-100"
            onToggle={() => setClosed(c => { const n = new Set(c); if (n.has(group)) n.delete(group); else n.add(group); return n; })}>
            {compare && changedN > 0 && <Badge className={TONE.amber}>{changedN} thay đổi</Badge>}
          </GroupHeader>
          {open && items.map((r, li) => {
            const unit = r.unit || '';
            const l = r.cur || r.base!;
            const bPeriod = basePlan || curPlan;
            const done = r.cur?.actualQty ?? r.base?.actualQty ?? null;
            const goc = originalLines.get(r.taskId);
            const exp = r.cur ? expectedByToday(r.cur, curPlan, today) : null;
            const late = exp != null && done != null ? exp - done : 0;
            const refs = compare ? refsOf(r) : [];
            const sameQty = !compare || r.kind === 'same' || (r.kind === 'changed' && (r.dQty == null || Math.abs(r.dQty) <= 0.0005));
            const sameDate = !compare || r.kind === 'same' || (r.kind === 'changed' && !r.dStart && !r.dEnd);
            return <div key={r.taskId} className={`grid grid-cols-1 gap-x-3 gap-y-2 border-t border-border px-3 py-2.5 text-sm md:items-start ${DIFF_COLS} ${rowTone(r)}`}>
              <span className="hidden pt-0.5 text-xs tabular-nums text-muted-foreground md:block">{gi + 1}.{li + 1}</span>
              <div className="min-w-0">
                <p className={r.kind === 'removed' ? 'text-muted-foreground line-through decoration-rose-400' : 'text-foreground'}>{r.wbsCode && <span className="mr-1.5 text-muted-foreground">{r.wbsCode}</span>}{r.taskName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {compare && r.kind === 'added' && <Badge className={TONE.teal}><Plus size={11} />Thêm vào kỳ</Badge>}
                  {compare && r.kind === 'removed' && <Badge className={TONE.rose}>Dời khỏi kỳ</Badge>}
                  {compare && r.kind === 'changed' && r.pace && <Badge className={r.pace === 'faster' ? TONE.leaf : TONE.amber}>{r.pace === 'faster' ? 'Nhanh hơn' : 'Chậm hơn'}</Badge>}
                  {l.crewLabel && <CrewPill name={l.crewLabel} />}
                </div>
              </div>
              <div><MobileLabel>Khối lượng</MobileLabel>
                {sameQty ? <><span className={NUM}>{qtyText(l.plannedQty)}</span> {unit}{compare && <span className="ml-1 text-xs text-muted-foreground">không đổi</span>}</>
                  : <><span className="tabular-nums"><span className={r.kind === 'added' ? 'text-muted-foreground' : 'text-muted-foreground line-through'}>{r.base ? qtyText(r.base.plannedQty) : '—'}</span>
                    <ArrowRight size={12} className="mx-1 inline text-muted-foreground" /><span className={NUM}>{r.cur ? qtyText(r.cur.plannedQty) : '0'}</span> {unit}</span>
                    {r.dQty != null && Math.abs(r.dQty) > 0.0005 && <span className="mt-1 block"><Badge className={r.dQty > 0 ? TONE.leaf : TONE.amber}>{sgn(r.dQty)} {unit}</Badge></span>}</>}
              </div>
              <div><MobileLabel>Thời gian</MobileLabel>
                {r.kind === 'removed' ? <><span className="whitespace-nowrap tabular-nums text-muted-foreground line-through">{span(effStart(r.base!, bPeriod), effEnd(r.base!, bPeriod))}</span><span className="mt-1 block text-xs font-semibold text-rose-700 dark:text-rose-300">sang kỳ sau</span></>
                  : sameDate ? <span className="whitespace-nowrap tabular-nums">{span(effStart(l, curPlan), effEnd(l, curPlan))}</span>
                    : r.kind === 'added' ? <span className="whitespace-nowrap tabular-nums">{span(effStart(r.cur!, curPlan), effEnd(r.cur!, curPlan))}</span>
                      : <><span className="tabular-nums"><span className="whitespace-nowrap text-muted-foreground line-through">{span(effStart(r.base!, bPeriod), effEnd(r.base!, bPeriod))}</span><ArrowRight size={12} className="mx-1 inline text-muted-foreground" /><span className="whitespace-nowrap">{span(effStart(r.cur!, curPlan), effEnd(r.cur!, curPlan))}</span></span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {r.dStart !== 0 && <Badge className={r.dStart > 0 ? TONE.amber : TONE.leaf}>bắt đầu {r.dStart > 0 ? '+' : '−'}{Math.abs(r.dStart)} ngày</Badge>}
                          {r.dEnd !== 0 && <Badge className={r.dEnd > 0 ? TONE.amber : TONE.leaf}>xong {r.dEnd > 0 ? 'muộn' : 'sớm'} {Math.abs(r.dEnd)} ngày</Badge>}
                        </span></>}
              </div>
              <div><MobileLabel>Đã làm đến {dm(today)}</MobileLabel>
                {done == null ? <span className="text-xs text-muted-foreground">Chưa có số liệu</span> : <><span className={NUM}>{fmt(done)}</span> <span className="text-muted-foreground">{unit}</span></>}
                {done != null && !(r.cur && today < effStart(r.cur, curPlan) && done === 0) && <span className={`mt-0.5 block text-xs text-muted-foreground ${WRAP}`}>{goc?.plannedQty ? <>Gốc <b className="text-foreground">{pct(done / goc.plannedQty * 100)}</b></> : original ? 'Không có trong gốc' : ''}
                  {r.cur?.plannedQty && !(original && original.revisionNo === curPlan.revisionNo) ? <>{goc?.plannedQty || original ? ' · ' : ''}{curLabel} <b className="text-foreground">{pct(done / r.cur.plannedQty * 100)}</b></> : null}</span>}
                {r.cur && today >= effStart(r.cur, curPlan) && late > 0.0005 && <span className={`mt-0.5 block text-xs font-semibold text-amber-700 dark:text-amber-300 ${WRAP}`}>Chậm {fmt(late)} {unit} so với lịch</span>}
                {r.cur && today < effStart(r.cur, curPlan) && <span className="mt-0.5 block text-xs text-muted-foreground">Chưa đến ngày</span>}
              </div>
              <div className="min-w-0"><MobileLabel>Lý do</MobileLabel>
                {refs.length === 0 ? <span className="text-muted-foreground">—</span> : <div className="space-y-1.5">{refs.map(c => <div key={c.revisionNo}>
                  <div className="flex flex-wrap items-center gap-1"><span className="text-[11px] font-bold text-muted-foreground">Bản {c.revisionNo}</span><ReasonChip reasons={reasons} code={c.reasonCode} party={c.party} /></div>
                  {c.note && <p className={`mt-0.5 text-xs text-muted-foreground ${WRAP}`}>{c.note}</p>}</div>)}</div>}
              </div>
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
};

// ---------------------------------------------------------------------------- văn bản, tác động, lịch sử
export const AttachmentList: React.FC<{ files: WorkPlanAttachment[]; onRemove?: (path: string) => void }> = ({ files, onRemove }) => {
  const toast = useToast();
  if (!files.length) return null;
  return <div className="flex flex-wrap gap-1.5">{files.map(f => <span key={f.path} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs">
    <button type="button" onClick={() => projectWorkPlanService.openAttachment(f.path).catch(e => toast.error('Không mở được tệp', e instanceof Error ? e.message : ''))}
      className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"><FileText size={12} className="shrink-0 text-muted-foreground" /><span className="truncate">{f.name}</span></button>
    {onRemove && <button type="button" aria-label={`Bỏ ${f.name}`} onClick={() => onRemove(f.path)} className="text-muted-foreground hover:text-rose-600">×</button>}
  </span>)}</div>;
};

export const ImpactBlock: React.FC<{ rows: PlanDiffRow[]; impact: WorkPlanImpact | null; loading: boolean; title?: string }> = ({ rows, impact, loading, title = 'Tác động (hệ thống tự tính)' }) => {
  const changed = rows.filter(r => r.kind !== 'same');
  const priced = (impact?.materials || []).filter(m => m.unitPrice != null);
  const up = priced.reduce((s, m) => s + Math.max(m.deltaQty, 0) * (m.unitPrice || 0), 0);
  const down = priced.reduce((s, m) => s + Math.min(m.deltaQty, 0) * (m.unitPrice || 0), 0);
  const unknown = (impact?.materials || []).filter(m => m.unitPrice == null).length;
  return <div className="space-y-3 rounded-xl border border-border bg-background p-3">
    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
    <ul className="space-y-1 text-sm">
      {changed.map(r => <li key={r.taskId} className="flex gap-2"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.pace === 'faster' ? 'bg-leaf-500' : 'bg-amber-500'}`} />
        <span><b className="text-foreground">{r.taskName}</b>{r.kind === 'removed' ? ' — dời khỏi kỳ' : r.kind === 'added' ? ` — thêm ${qtyText(r.cur?.plannedQty)} ${r.unit || ''}` : <>
          {r.dQty != null && Math.abs(r.dQty) > 0.0005 && <> — {qtyText(r.base?.plannedQty)} → {qtyText(r.cur?.plannedQty)} {r.unit || ''} ({sgn(r.dQty)})</>}
          {r.dStart !== 0 && <>, bắt đầu {dm(r.base?.plannedStart)} → {dm(r.cur?.plannedStart)}</>}{r.dEnd !== 0 && <>, xong {r.dEnd > 0 ? 'muộn' : 'sớm'} {Math.abs(r.dEnd)} ngày</>}</>}</span></li>)}
      {!changed.length && <li className="text-muted-foreground">Chưa có thay đổi so với bản đang áp dụng.</li>}
    </ul>
    <div className="grid gap-2 md:grid-cols-3">
      <div className="rounded-lg border border-border px-3 py-2 text-xs"><p className="font-semibold text-foreground">Vật tư kéo theo</p>
        {loading ? <p className="text-muted-foreground">Đang tính…</p> : !impact ? <p className="text-muted-foreground">Chưa tính được.</p> : <>
          <p className="text-muted-foreground">{impact.materials.length} dòng đổi{up ? ` · +${shortMoney(up)}` : ''}{down ? ` · −${shortMoney(-down)}` : ''}{unknown ? ` · ${unknown} dòng chưa có đơn giá` : ''}</p>
          <p className={`mt-1 text-muted-foreground ${WRAP}`}>{impact.materials.slice(0, 4).map(m => `${m.itemName} ${m.deltaQty > 0 ? '+' : '−'}${fmt(Math.abs(m.deltaQty))} ${m.unit}`).join(' · ')}{impact.materials.length > 4 ? '…' : ''}</p></>}</div>
      <div className="rounded-lg border border-border px-3 py-2 text-xs"><p className="font-semibold text-foreground">Kế hoạch tuần bị ảnh hưởng</p>
        {loading ? <p className="text-muted-foreground">Đang tính…</p> : !impact?.weeks.length ? <p className="text-muted-foreground">Không có.</p>
          : <p className={`text-muted-foreground ${WRAP}`}>{impact.weeks.map(w => `tuần ${dm(w.periodStart)}${w.createdByName ? ` (${w.createdByName})` : ''}`).join(', ')} — người lập nhận thông báo xem lại khi bản này được duyệt.</p>}</div>
      <div className="rounded-lg border border-border px-3 py-2 text-xs"><p className="font-semibold text-foreground">Kế hoạch vật tư của kỳ</p>
        {loading ? <p className="text-muted-foreground">Đang tính…</p> : !impact?.materialPlans.length ? <p className="text-muted-foreground">Chưa lập.</p>
          : <p className={`text-muted-foreground ${WRAP}`}>Sẽ được đánh dấu cần tính lại khi bản này được duyệt.</p>}</div>
    </div>
    {impact && priced.length > 0 && <p className="text-[11px] text-muted-foreground">Tiền ước tính theo đơn giá dự toán, không có thì giá mua gần nhất{up ? ` · tăng ${money(up)} đ` : ''}{down ? ` · giảm ${money(-down)} đ` : ''}.</p>}
  </div>;
};

export const VersionHistory: React.FC<{ versions: WorkPlan[]; reasons: PlanChangeReason[]; onView: (id: string, mode: CompareMode) => void }> = ({ versions, reasons, onView }) => {
  const [open, setOpen] = useState(false);
  return <section className="rounded-2xl border border-border bg-card">
    <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><History size={15} className="text-muted-foreground" />Lịch sử phiên bản của kỳ <span className="font-normal text-muted-foreground">({versions.length} bản)</span></span>
      <ChevronDown size={16} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <ol className="border-t border-border px-4 py-3">
      {[...versions].reverse().map((v, i, arr) => {
        const [tag, tone] = versionTag(v, versions);
        const lines = v.lines.filter(l => l.changeReasonCode);
        return <li key={v.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < arr.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-border" aria-hidden="true" />}
          <span className={`z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${tone}`}>{v.revisionNo}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-foreground">Bản {v.revisionNo}</span><Badge className={tone}>{tag}</Badge>
              <span className="text-xs text-muted-foreground">Lập <span className={ENT}>{v.createdByName}</span> {dmt(v.createdAt)}{v.submittedAt ? ` · gửi ${dmt(v.submittedAt)}` : ''}{v.approvedAt ? <> · duyệt <span className={ENT}>{v.approvedByName}</span> {dmt(v.approvedAt)}</> : null}</span></div>
            {(v.changeSummary || v.note) && <p className="text-sm text-foreground">{v.changeSummary || v.note}</p>}
            {v.changeReasonCode && <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">Lý do chính: <ReasonChip reasons={reasons} code={v.changeReasonCode} party={v.responsibleParty} /></p>}
            {(lines.length > 0 || (v.removedLines || []).length > 0) && <div className="flex flex-wrap gap-x-3 gap-y-1">
              {lines.map(l => <span key={l.taskId} className="inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span className="font-semibold">{l.wbsCode || l.taskName}</span><ReasonChip reasons={reasons} code={l.changeReasonCode!} party={l.responsibleParty ?? null} /></span>)}
              {(v.removedLines || []).map(l => <span key={l.taskId} className="inline-flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span className="font-semibold line-through">{l.wbsCode || l.taskName}</span>{l.changeReasonCode && <ReasonChip reasons={reasons} code={l.changeReasonCode} party={l.responsibleParty} />}</span>)}
            </div>}
            {v.attachments.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><Paperclip size={12} className="text-muted-foreground" /><AttachmentList files={v.attachments} /></div>}
            {v.returnReason && v.status === 'returned' && <p className="text-xs text-rose-700 dark:text-rose-300">Bị trả lại: {v.returnReason}</p>}
            <div className="flex flex-wrap gap-3 pt-0.5">
              <button type="button" onClick={() => onView(v.id, v.supersedesPlanId ? 'prev' : 'none')} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">Xem bản này{v.supersedesPlanId ? ' so với bản trước' : ''}</button>
              {v.supersedesPlanId && <button type="button" onClick={() => onView(v.id, 'goc')} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">So với gốc</button>}
            </div>
          </div>
        </li>;
      })}
    </ol>}
  </section>;
};
