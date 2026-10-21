// Nhanh / chậm so với tiến độ tổng (PR-3, mockup chủ SP duyệt 15/10/2026): thẻ trả lời TGĐ + ngăn mốc khống chế.
import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Gauge, Info, Loader2, Plus, Route, Split, TriangleAlert, X } from 'lucide-react';
import type { ProjectTask } from '../../../types';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { viDate } from '../../finance/financeUi';
import {
  computeScheduleVariance, daysBetweenIso, varianceSlackDays, varianceStatus,
  type VarianceLink, type VarianceNode, type VarianceResult,
} from '../../../lib/projectScheduleVariance';
import {
  DELAY_PARTY_LABEL, delayPartyTally, delayReasonTargets, nodeDelayReasons, type DelayReasonEntry, type DelayReasonOption,
} from '../../../lib/projectDelayReasons';
import { DelayPartyPill } from './DelayReasonsSection';

/** Lý do chậm đã công bố từ Nhật ký (PR-3b). */
export interface VarianceDelayReasons { catalog: DelayReasonOption[]; latest: DelayReasonEntry[] }
interface ReasonCtx { map: Map<string, DelayReasonEntry>; labelOf: (code: string) => string }
const reasonCtxOf = (reasons?: VarianceDelayReasons | null): ReasonCtx | null => (reasons ? {
  map: new Map(reasons.latest.map(entry => [entry.taskId, entry])),
  labelOf: code => reasons.catalog.find(item => item.code === code)?.label || code,
} : null);

/** Dòng "Lý do: …" của một hạng mục / việc trên thẻ. */
const ReasonLine: React.FC<{ result: VarianceResult; nodeId: string; ctx: ReasonCtx }> = ({ result, nodeId, ctx }) => {
  const summary = nodeDelayReasons(result, nodeId, ctx.map);
  if (!summary) return null;
  return <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
    <span>Lý do:</span>
    {summary.items.map(item => <span key={`${item.reasonCode}|${item.responsibleParty}`} className="inline-flex items-center gap-1">
      <DelayPartyPill party={item.responsibleParty} /><span className="text-foreground">{ctx.labelOf(item.reasonCode)}</span>
      {!summary.inherited && item.count > 1 && <span>{item.count} việc</span>}</span>)}
    {summary.inherited && summary.items.length > 0 && <span>(theo việc trước)</span>}
    {!summary.inherited && summary.followCount > 0 && <span>· kéo theo {summary.followCount} việc</span>}
    {summary.missingCount > 0 && <span className="font-semibold text-rose-600">{summary.items.length ? '· ' : ''}{summary.missingCount} việc chưa ghi lý do</span>}
  </div>;
};

const sd = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
const pill = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold';
const label = (node: VarianceNode | undefined) => (node ? `${node.wbsCode ? `${node.wbsCode} ` : ''}${node.name}` : '—');

export const VarianceBadge: React.FC<{ node: VarianceNode }> = ({ node }) => {
  const status = varianceStatus(node.lagDays);
  if (node.done && status === 'late') return <span className={`${pill} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>Xong muộn {-node.lagDays} ngày</span>;
  if (status === 'late') return <span className={`${pill} bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200`}>Chậm {-node.lagDays} ngày</span>;
  if (status === 'early') return <span className={`${pill} bg-leaf-100 text-leaf-800 dark:bg-leaf-900/40 dark:text-leaf-200`}>{node.done ? 'Xong sớm' : 'Nhanh'} {node.lagDays} ngày</span>;
  return <span className={`${pill} bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200`}>{node.done ? 'Xong đúng hạn' : 'Đúng hạn'}</span>;
};

const lateChildren = (result: VarianceResult, node: VarianceNode) =>
  node.childIds.map(id => result.nodes.get(id)!).filter(child => child && varianceStatus(child.lagDays) === 'late' && !child.done);

/** Câu tóm tắt cho Ban lãnh đạo. */
export const varianceSummary = (result: VarianceResult, reasons?: VarianceDelayReasons | null): string => {
  const base = varianceSummaryBase(result);
  const ctx = reasonCtxOf(reasons);
  if (!ctx) return base;
  const worst = delayReasonTargets(result).required.filter(node => ctx.map.has(node.id)).sort((a, b) => a.lagDays - b.lagDays)[0];
  if (!worst) return base;
  const entry = ctx.map.get(worst.id)!;
  return `${base} Việc chậm nhiều nhất: ${label(worst)} ${-worst.lagDays} ngày — ${ctx.labelOf(entry.reasonCode)} (${DELAY_PARTY_LABEL[entry.responsibleParty]}).`;
};

const varianceSummaryBase = (result: VarianceResult): string => {
  const finish = viDate(result.projectForecastEnd);
  const roots = result.rootIds.map(id => result.nodes.get(id)!).filter(Boolean);
  const status = varianceStatus(result.projectLagDays);
  if (status === 'late') {
    const late = roots.filter(root => !root.done && varianceStatus(root.lagDays) === 'late').sort((a, b) => a.lagDays - b.lagDays);
    // Đi xuống nhánh chậm nhất tới việc gây chậm.
    let cause: VarianceNode | undefined = late[0];
    for (let guard = 0; cause && guard < 8; guard += 1) {
      if (cause.blockerIds.length) break;
      const next: VarianceNode | undefined = lateChildren(result, cause).sort((a, b) => a.lagDays - b.lagDays)[0];
      if (!next) break;
      cause = next;
    }
    const blocker = cause?.blockerIds[0] ? result.nodes.get(cause.blockerIds[0]) : undefined;
    const why = cause && cause !== late[0]
      ? ` ${label(cause)} chậm ${-cause.lagDays} ngày${blocker ? ` vì chờ ${label(blocker)} (chậm ${-blocker.lagDays} ngày)` : ''}.`
      : blocker ? ` Do chờ ${label(blocker)}.` : '';
    return `Dự kiến về đích ${finish}, chậm ${-result.projectLagDays} ngày. ${late.slice(0, 3).map(node => `${node.name} vượt mốc ${-node.lagDays} ngày`).join('; ')}.${why}`;
  }
  const withLate = roots.filter(root => !root.done && lateChildren(result, root).length > 0);
  const tight = roots.filter(root => !root.done)
    .map(root => ({ root, slack: varianceSlackDays(result, root.id) }))
    .filter(item => item.slack != null && item.slack <= 7)
    .sort((a, b) => (a.slack ?? 0) - (b.slack ?? 0))[0];
  const head = status === 'early' ? `Dự kiến về đích ${finish}, sớm ${result.projectLagDays} ngày.` : `Dự kiến về đích ${finish}, đúng hạn.`;
  const tail = withLate.length ? ` ${withLate.length} hạng mục có việc con chậm nhưng còn trong mốc.` : '';
  const close = tight ? ` Sát nhất: ${tight.root.name} (${tight.slack ? `còn dư ${tight.slack} ngày` : 'không còn dư'}).` : '';
  return head + tail + close;
};

const NodeRow: React.FC<{ result: VarianceResult; node: VarianceNode; depth: number; open: boolean; onToggle?: () => void; ctx: ReasonCtx | null }> = ({ result, node, depth, open, onToggle, ctx }) => {
  const status = varianceStatus(node.lagDays);
  const slack = varianceSlackDays(result, node.id);
  const lateKids = lateChildren(result, node);
  const blockers = node.blockerIds.map(id => result.nodes.get(id)).filter(Boolean) as VarianceNode[];
  const expandable = depth === 0 && node.childIds.length > 0;
  return <div className={depth === 0 && status === 'late' && !node.done ? 'border-l-4 border-l-rose-500' : ''}>
    <div className={`flex items-start gap-2 px-3 py-2.5 text-xs ${depth ? 'bg-muted/30 pl-8' : ''} ${expandable ? 'cursor-pointer hover:bg-muted/40' : ''}`}
      onClick={expandable ? onToggle : undefined} role={expandable ? 'button' : undefined} aria-expanded={expandable ? open : undefined}>
      <span className="mt-0.5 w-3 shrink-0 text-muted-foreground">{expandable ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">{node.wbsCode && <span className="font-mono text-teal-700 dark:text-teal-300">{node.wbsCode} </span>}<b className="text-foreground">{node.name}</b></div>
          <div className="shrink-0"><VarianceBadge node={node} /></div>
        </div>
        <div className="mt-0.5 text-muted-foreground">
          {node.done ? <>Xong {viDate(node.forecastEnd)} · KH {viDate(node.planEnd)}</>
            : <>KH xong {sd(node.planEnd)} · dự kiến {sd(node.forecastEnd)}
              {status !== 'late' && slack != null && depth === 0 && <> · <span className={slack <= 7 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{slack > 0 ? `dư ${slack} ngày` : 'không còn dư'}</span></>}
              {depth === 0 && status !== 'late' && lateKids.length > 0 && <> · <span className="text-amber-700 dark:text-amber-300">{lateKids.length} việc con chậm, còn trong mốc</span></>}</>}
        </div>
        {status === 'late' && !node.done && <div className="mt-0.5 text-[11px] text-muted-foreground">
          {blockers.length ? <>Do chờ {blockers.slice(0, 2).map(item => `${label(item)} (chậm ${-item.lagDays} ngày)`).join('; ')}</>
            : lateKids.length ? <>Việc chậm: {lateKids.sort((a, b) => a.lagDays - b.lagDays).slice(0, 2).map(item => `${label(item)} (${-item.lagDays} ngày)`).join('; ')}</>
            : ctx ? null : <span className="text-rose-600">Chưa ghi lý do</span>}
        </div>}
        {ctx && !node.done && <ReasonLine result={result} nodeId={node.id} ctx={ctx} />}
      </div>
    </div>
    {open && <div className="divide-y divide-border border-y border-border">{node.childIds.map(id => result.nodes.get(id)).filter(Boolean).map(child =>
      <NodeRow key={child!.id} result={result} node={child!} depth={1} open={false} ctx={ctx} />)}</div>}
  </div>;
};

export const VarianceHowTo: React.FC = () => <details className="rounded-xl border border-border bg-card text-xs">
  <summary className="cursor-pointer px-3 py-2 font-bold text-foreground">Cách tính</summary>
  <div className="space-y-1 px-3 pb-3 text-muted-foreground">
    <div>• <b>Ngày xong dự kiến</b> lấy từ Nhật ký đã duyệt: xong rồi = ngày xong thật; đang làm = ngày có số liệu + phần còn lại theo nhịp kế hoạch; quá ngày bắt đầu mà chưa làm = bắt đầu từ hôm sau.</div>
    <div>• <b>Hạng mục lớn</b> chỉ bị tính chậm khi việc con xong muộn hơn kế hoạch kết thúc của hạng mục; chậm = phần vượt nhiều nhất, nhanh = phần sớm ít nhất. Dự án tính y như vậy với ngày về đích.</div>
    <div>• <b>Việc nối tiếp:</b> mốc khống chế ("xong A mới làm B") + các việc liền nhau trong cùng nhóm mà kế hoạch không chồng ngày. A chậm thì B dời theo, trừ khoảng trống kế hoạch giữa hai việc.</div>
    <div>• Lệch trong ±3 ngày coi là đúng hạn. <b>Khối lượng</b> (theo số ngày kế hoạch) chỉ để tham khảo, không quyết định chậm / nhanh.</div>
  </div>
</details>;

/** Thẻ "Tiến độ tổng — đang tới đâu?" (Tổng quan dự án, tab Tiến độ). */
export const ScheduleVariancePanel: React.FC<{
  result: VarianceResult; today: string; authoritative: boolean; manualLinkCount: number;
  issues?: Array<{ date: string; text: string }>; versionLabel?: string | null;
  linksAction?: React.ReactNode; bare?: boolean;
  /** Lý do chậm đã công bố ở Nhật ký; null = chưa tải được (giữ cách hiện cũ). */
  delayReasons?: VarianceDelayReasons | null;
}> = ({ result, today, authoritative, manualLinkCount, issues = [], versionLabel, linksAction, bare, delayReasons }) => {
  const ctx = useMemo(() => reasonCtxOf(delayReasons), [delayReasons]);
  const tally = useMemo(() => (ctx ? delayPartyTally(result, ctx.map) : null), [ctx, result]);
  const [openId, setOpenId] = useState<string | null>(null);
  const roots = result.rootIds.map(id => result.nodes.get(id)).filter(Boolean) as VarianceNode[];
  const status = varianceStatus(result.projectLagDays);
  const stale = authoritative ? daysBetweenIso(result.dataDate, today) : 0;
  const lateRoots = roots.filter(root => !root.done && varianceStatus(root.lagDays) === 'late').length;
  const rootsWithLateKids = roots.filter(root => !root.done && lateChildren(result, root).length > 0).length;
  const body = <>
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><Gauge size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black text-foreground">Tiến độ tổng — đang tới đâu?</div>
        <div className="text-[11px] text-muted-foreground">{authoritative ? 'Theo Nhật ký đã duyệt tới' : 'Số liệu tới'} <b>{viDate(result.dataDate)}</b>{versionLabel ? ` · kế hoạch đang áp dụng: ${versionLabel}` : ''}</div>
      </div>
      {linksAction}
    </div>
    {stale > 1 && <div className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><TriangleAlert size={12} /> {stale} ngày chưa có nhật ký duyệt ({sd(result.dataDate)} → {sd(today)}).</div>}
    {manualLinkCount === 0 && <div className="flex items-center gap-1.5 border-b border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><Route size={12} /> Chưa khai báo mốc khống chế — "đúng hạn" có thể sai. CHT khai báo ở tab Tiến độ.</div>}
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
      <div className="col-span-2 bg-card p-3 md:col-span-1"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">So tiến độ tổng</div>
        <div className={`mt-1 text-2xl font-black ${status === 'late' ? 'text-rose-600' : status === 'early' ? 'text-leaf-700' : 'text-mint-700'}`}>
          {status === 'late' ? `Chậm ${-result.projectLagDays} ngày` : status === 'early' ? `Nhanh ${result.projectLagDays} ngày` : 'Đúng hạn'}</div>
        <div className="text-[11px] text-muted-foreground">{status === 'late' ? `${lateRoots} hạng mục vượt mốc` : 'chưa hạng mục nào vượt mốc'}</div></div>
      <div className="bg-card p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Về đích dự kiến</div>
        <div className={`text-xl font-black tabular-nums ${status === 'late' ? 'text-rose-600' : 'text-foreground'}`}>{viDate(result.projectForecastEnd)}</div>
        <div className="text-[11px] text-muted-foreground">KH {viDate(result.projectPlanEnd)}</div></div>
      <div className="bg-card p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Khối lượng</div>
        <div className="text-xl font-black tabular-nums text-foreground">{result.volume ? `${result.volume.actualPercent.toLocaleString('vi-VN')}%` : '—'}</div>
        <div className="text-[11px] text-muted-foreground">{result.volume ? `KH tới ${sd(result.dataDate)}: ${result.volume.plannedPercent.toLocaleString('vi-VN')}%` : 'chưa có số liệu'}</div></div>
      <div className="bg-card p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hạng mục vượt mốc</div>
        <div className={`text-xl font-black tabular-nums ${lateRoots ? 'text-rose-600' : 'text-foreground'}`}>{lateRoots} / {roots.filter(root => !root.done).length}</div>
        <div className="text-[11px] text-muted-foreground">{rootsWithLateKids} hạng mục có việc con chậm</div></div>
    </div>
    {ctx && tally && tally.total > 0 && <div className="border-b border-border px-4 py-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>Việc chậm do đâu</span><span className="font-normal normal-case tracking-normal">{tally.total} việc gây chậm · {tally.chained} việc chậm theo</span></div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">{tally.parties.map(item => <div key={item.party}
        className={item.party === 'owner' ? 'bg-sky-500' : item.party === 'company' ? 'bg-amber-500' : 'bg-zinc-400'} style={{ width: `${(item.count / tally.total) * 100}%` }} />)}</div>
      <div className="mt-2 grid gap-1.5 text-xs md:grid-cols-3">
        {tally.parties.map(item => <div key={item.party} className="rounded-lg border border-border px-2.5 py-1.5">
          <DelayPartyPill party={item.party} /> <b className="tabular-nums">{item.count} việc</b>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{item.reasonCodes.map(ctx.labelOf).join(', ')} · chậm nhất {item.maxLagDays} ngày</div></div>)}
        {tally.missing > 0 && <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <b className="tabular-nums">{tally.missing} việc</b> chưa ghi lý do<div className="mt-0.5 text-[11px]">CHT chọn khi duyệt Nhật ký</div></div>}
      </div>
    </div>}
    <div className="px-4 py-3 text-sm text-foreground"><b>Tóm lại:</b> {varianceSummary(result, delayReasons)}</div>
  </>;
  return <div className="space-y-3">
    {bare ? <div className="overflow-hidden rounded-2xl border border-border bg-card">{body}</div>
      : <section className="overflow-hidden rounded-2xl border border-border bg-card">{body}</section>}
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between bg-muted/50 px-3 py-2 text-xs"><span className="font-black text-foreground">Hạng mục lớn</span><span className="text-muted-foreground">bấm để xem việc con</span></div>
      {roots.map(root => <NodeRow key={root.id} result={result} node={root} depth={0} open={openId === root.id} ctx={ctx}
        onToggle={() => setOpenId(previous => (previous === root.id ? null : root.id))} />)}
    </div>
    {issues.length > 0 && status === 'late' && <div className="rounded-xl border border-border bg-card p-3 text-xs">
      <div className="mb-1 font-bold text-foreground">Vướng mắc gần đây trong Nhật ký</div>
      {issues.slice(0, 3).map(issue => <div key={`${issue.date}-${issue.text}`} className="text-muted-foreground"><span className="tabular-nums">{sd(issue.date)}</span> · {issue.text}</div>)}
    </div>}
    <VarianceHowTo />
  </div>;
};

// ---------------------------------------------------------------------------- mốc khống chế
// Không dùng class chứa "border-t" trong ngăn kéo: CSS điện thoại (index.css) biến các div đó thành thanh dính đáy.
const gapText = (gap: number) => (gap > 0 ? `KH trống ${gap} ngày` : gap >= -1 ? 'KH liền nhau' : 'KH làm song song');
const effectText = (link: VarianceLink, result: VarianceResult) => {
  const pred = result.nodes.get(link.predId);
  if (link.predDelayDays <= 0) return { text: 'đúng hạn', late: false };
  if (link.succShiftDays <= 0) return { text: `${pred?.name || 'việc trước'} chậm ${link.predDelayDays} ngày, còn trong khoảng trống`, late: false };
  return { text: `chậm ${link.predDelayDays} ngày → việc sau dời ${link.succShiftDays} ngày`, late: true };
};

export const ScheduleLinksDrawer: React.FC<{
  tasks: ProjectTask[]; result: VarianceResult; canEdit: boolean; busy: boolean;
  onAdd: (predId: string, succId: string) => void; onRemove: (predId: string, succId: string) => void;
  onSplit: (predId: string, succId: string) => void; onUnsplit: (predId: string, succId: string) => void; onClose: () => void;
}> = ({ tasks, result, canEdit, busy, onAdd, onRemove, onSplit, onUnsplit, onClose }) => {
  const [pred, setPred] = useState('');
  const [succ, setSucc] = useState('');
  const [showAuto, setShowAuto] = useState(false);
  const manual = result.links.filter(link => link.kind === 'manual');
  const auto = result.links.filter(link => link.kind === 'auto').sort((a, b) => b.succShiftDays - a.succShiftDays);
  const options = useMemo(() => {
    const depthOf = (task: ProjectTask) => { let depth = 0; let parent = task.parentId; const byId = new Map(tasks.map(item => [item.id, item])); while (parent && byId.has(parent) && depth < 8) { depth += 1; parent = byId.get(parent)?.parentId; } return depth; };
    return result.rootIds.length ? [...tasks].filter(task => result.nodes.has(task.id))
      .sort((a, b) => (a.wbsCode || '').localeCompare(b.wbsCode || '', 'vi', { numeric: true }))
      .map(task => ({ id: task.id, text: `${'  '.repeat(depthOf(task))}${task.wbsCode ? `${task.wbsCode} ` : ''}${task.name}` })) : [];
  }, [result, tasks]);
  const preview = useMemo(() => (pred && succ && pred !== succ ? computeScheduleVariance(tasks, result.dataDate, [[pred, succ]]) : null), [pred, result.dataDate, succ, tasks]);
  const previewLink = preview?.links.find(link => link.predId === pred && link.succId === succ && link.kind === 'manual');
  const invalid = pred && succ && (pred === succ || !previewLink) ? 'Hai việc phải khác nhau và không phải việc cha / con của nhau.' : null;
  const name = (id: string) => label(result.nodes.get(id));

  return <Drawer label="Mốc khống chế" wide onClose={onClose}
    header={<><div className="flex items-center gap-2 text-base font-black text-foreground"><Route size={16} className="text-teal-700" /> Mốc khống chế</div>
      <div className="text-xs text-muted-foreground">Khai báo "xong việc A mới làm được việc B". Không cần duyệt — không đổi ngày kế hoạch, chỉ để tính ngày về đích dự kiến.</div></>}>
    <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
      <div>Đã tự nối <b>{auto.length}</b> cặp việc liền nhau trong cùng nhóm (kế hoạch không chồng ngày). Hai việc thực tế làm song song thì bấm "Tách".</div>
    </div>
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {manual.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">Chưa có mốc khống chế. Thêm các mốc quyết định ngày về đích, ví dụ "móng phân đoạn xong → lắp kết cấu thép", "các nhà xong → bàn giao".</div>}
      {manual.map(link => {
        const effect = effectText(link, result);
        return <div key={`${link.predId}>${link.succId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
          <span className="min-w-[180px] flex-1 font-semibold text-foreground">{name(link.predId)}</span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="min-w-[180px] flex-1 font-semibold text-foreground">{name(link.succId)}</span>
          <span className="text-muted-foreground">{gapText(link.gapDays)}</span>
          <span className={effect.late ? 'font-semibold text-rose-600' : 'text-mint-700 dark:text-mint-300'}>{effect.text}</span>
          {canEdit && <button type="button" disabled={busy} onClick={() => onRemove(link.predId, link.succId)} aria-label="Bỏ mốc" title="Bỏ mốc" className="text-muted-foreground hover:text-rose-600 disabled:opacity-50"><X size={14} /></button>}
        </div>;
      })}
    </div>
    {canEdit && <div className="space-y-2 rounded-2xl border-2 border-[#0d9488] bg-card p-3 text-xs">
      <div className="text-sm font-black text-foreground">Thêm mốc</div>
      <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_1fr]">
        <select value={pred} onChange={event => setPred(event.target.value)} className={`${inputCls} w-full text-xs`} aria-label="Việc phải xong trước">
          <option value="">Việc phải xong trước…</option>
          {options.map(option => <option key={option.id} value={option.id}>{option.text}</option>)}
        </select>
        <span className="text-center text-muted-foreground">xong mới làm</span>
        <select value={succ} onChange={event => setSucc(event.target.value)} className={`${inputCls} w-full text-xs`} aria-label="Việc làm sau">
          <option value="">Việc làm sau…</option>
          {options.map(option => <option key={option.id} value={option.id}>{option.text}</option>)}
        </select>
      </div>
      {invalid && <div className="text-rose-600">{invalid}</div>}
      {preview && previewLink && <div className={`rounded-lg border px-3 py-2 ${preview.projectForecastEnd !== result.projectForecastEnd ? 'border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200' : 'border-border bg-muted/40 text-muted-foreground'}`}>
        {gapText(previewLink.gapDays)}. {effectText(previewLink, preview).text}. Về đích dự kiến <b>{sd(result.projectForecastEnd)} → {viDate(preview.projectForecastEnd)}</b>.
      </div>}
      <div className="flex justify-end gap-2">
        <button type="button" className={`${secondaryBtn} text-xs`} onClick={() => { setPred(''); setSucc(''); }}>Xóa chọn</button>
        <button type="button" className={`${primaryBtn} text-xs`} disabled={!previewLink || busy} onClick={() => { onAdd(pred, succ); setPred(''); setSucc(''); }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Lưu mốc
        </button>
      </div>
    </div>}
    <div className="overflow-hidden rounded-xl border border-border bg-card text-xs">
      <button type="button" onClick={() => setShowAuto(value => !value)} className="flex w-full items-center justify-between px-3 py-2 font-bold text-foreground">
        <span>Việc tự nối ({auto.length}){result.parallelPairs.length ? ` · đã tách ${result.parallelPairs.length}` : ''}</span>{showAuto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {showAuto && <div className="max-h-[420px] divide-y divide-border overflow-y-auto border-y border-border">
        {result.parallelPairs.map(([a, b]) => <div key={`p-${a}-${b}`} className="flex items-center gap-2 bg-muted/30 px-3 py-2">
          <span className="min-w-0 flex-1 truncate">{name(a)} ∥ {name(b)} <span className="text-muted-foreground">(làm song song)</span></span>
          {canEdit && <button type="button" disabled={busy} onClick={() => onUnsplit(a, b)} className="text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">Bỏ tách</button>}
        </div>)}
        {auto.map(link => {
          const effect = effectText(link, result);
          return <div key={`a-${link.predId}-${link.succId}`} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate">{name(link.predId)} → {name(link.succId)}</span>
            <span className={`shrink-0 ${effect.late ? 'text-rose-600' : 'text-muted-foreground'}`}>{link.succShiftDays > 0 ? `dời ${link.succShiftDays} ngày` : gapText(link.gapDays)}</span>
            {canEdit && <button type="button" disabled={busy} onClick={() => onSplit(link.predId, link.succId)} className="inline-flex shrink-0 items-center gap-1 text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300"><Split size={12} /> Tách</button>}
          </div>;
        })}
      </div>}
    </div>
    {!canEdit && <div className="text-[11px] text-muted-foreground">Chỉ người được giao lập điều chỉnh tiến độ mới thêm / bỏ mốc.</div>}
  </Drawer>;
};
