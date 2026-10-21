// Lý do chậm ghi ở Nhật ký (PR-3b, chủ SP duyệt mockup 16/10/2026).
//
// - Việc gây chậm = việc lá chưa xong, chậm quá 3 ngày so với tiến độ tổng (lib/projectScheduleVariance.ts) và không do
//   việc trước chậm → bắt buộc chọn lý do + bên chịu trách nhiệm khi CHT Duyệt & công bố.
// - Việc chậm theo việc trước không phải chọn: hiển thị lý do của việc trước (việc trước là nhóm thì lấy việc gây chậm
//   chậm nhất trong nhóm).
// - Lý do lưu theo việc + ngày nhật ký; hôm sau việc còn chậm thì giữ lý do đã ghi, chỉ hỏi việc mới chậm.
import type { ProjectTask } from '../types';
import { varianceStatus, type VarianceNode, type VarianceResult } from './projectScheduleVariance';

export type DelayParty = 'owner' | 'company' | 'objective';
export const DELAY_PARTY_LABEL: Record<DelayParty, string> = { owner: 'CĐT', company: 'Công ty', objective: 'Khách quan' };
export const DELAY_PARTIES: DelayParty[] = ['owner', 'company', 'objective'];

export interface DelayReasonOption { code: string; label: string; defaultParty: string; needsDocument?: boolean }

export interface DelayReasonEntry {
  taskId: string;
  reasonCode: string;
  responsibleParty: DelayParty;
  note?: string | null;
  lagDays?: number | null;
  logDate?: string | null;
  updatedByName?: string | null;
  status?: 'draft' | 'published';
}

/** Bên chịu trách nhiệm mặc định theo lý do; NCC tính Công ty. */
export const partyOfReason = (catalog: DelayReasonOption[], code: string): DelayParty => {
  const party = catalog.find(item => item.code === code)?.defaultParty;
  return party === 'owner' || party === 'objective' ? party : 'company';
};

const isLate = (node: VarianceNode) => node.isLeaf && !node.done && varianceStatus(node.lagDays) === 'late';

/** Việc gây chậm (phải có lý do) và việc chậm theo việc trước. */
export const delayReasonTargets = (result: VarianceResult) => {
  const late = [...result.nodes.values()].filter(isLate);
  const byWbs = (a: VarianceNode, b: VarianceNode) => (a.wbsCode || '').localeCompare(b.wbsCode || '', 'vi', { numeric: true });
  return {
    required: late.filter(node => node.blockerIds.length === 0).sort(byWbs),
    chained: late.filter(node => node.blockerIds.length > 0).sort(byWbs),
  };
};

const isUnder = (result: VarianceResult, id: string, ancestorId: string) => {
  let current: string | null | undefined = id;
  for (let guard = 0; current && guard < 30; guard += 1) {
    if (current === ancestorId) return true;
    current = result.nodes.get(current)?.parentId;
  }
  return false;
};

/** Lý do của việc chậm theo việc trước (đi ngược chuỗi việc trước tới việc gây chậm có lý do). */
export const inheritedDelayReason = (
  result: VarianceResult, id: string, reasons: Map<string, DelayReasonEntry>, seen = new Set<string>(),
): (DelayReasonEntry & { fromTaskId: string }) | null => {
  const node = result.nodes.get(id);
  if (!node) return null;
  for (const blockerId of node.blockerIds) {
    if (seen.has(blockerId)) continue;
    seen.add(blockerId);
    const own = reasons.get(blockerId);
    if (own) return { ...own, fromTaskId: blockerId };
    const inside = [...result.nodes.values()]
      .filter(item => isLate(item) && reasons.has(item.id) && isUnder(result, item.id, blockerId))
      .sort((a, b) => a.lagDays - b.lagDays)[0];
    if (inside) return { ...reasons.get(inside.id)!, fromTaskId: blockerId };
    for (const upstream of [...result.nodes.values()].filter(item => isLate(item) && item.blockerIds.length && isUnder(result, item.id, blockerId))) {
      const found = inheritedDelayReason(result, upstream.id, reasons, seen);
      if (found) return { ...found, fromTaskId: blockerId };
    }
  }
  return null;
};

export interface NodeDelayReasons {
  items: Array<{ reasonCode: string; responsibleParty: DelayParty; count: number }>;
  /** Lý do lấy theo việc trước (nhóm chỉ có việc chậm theo). */
  inherited: boolean;
  followCount: number;
  missingCount: number;
}

/** Lý do gộp cho một hạng mục / việc trên thẻ Tiến độ tổng. */
export const nodeDelayReasons = (result: VarianceResult, nodeId: string, reasons: Map<string, DelayReasonEntry>): NodeDelayReasons | null => {
  const { required, chained } = delayReasonTargets(result);
  const own = required.filter(node => isUnder(result, node.id, nodeId));
  const follow = chained.filter(node => isUnder(result, node.id, nodeId));
  if (!own.length && !follow.length) return null;
  const picked = own.length
    ? own.map(node => reasons.get(node.id)).filter(Boolean) as DelayReasonEntry[]
    : follow.map(node => inheritedDelayReason(result, node.id, reasons)).filter(Boolean) as DelayReasonEntry[];
  const counts = new Map<string, NodeDelayReasons['items'][number]>();
  for (const entry of picked) {
    const key = `${entry.reasonCode}|${entry.responsibleParty}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { reasonCode: entry.reasonCode, responsibleParty: entry.responsibleParty, count: 1 });
  }
  return {
    items: [...counts.values()].sort((a, b) => b.count - a.count),
    inherited: own.length === 0,
    followCount: follow.length,
    missingCount: own.length ? own.filter(node => !reasons.has(node.id)).length : (picked.length ? 0 : follow.length),
  };
};

/** "Việc chậm do đâu": đếm việc gây chậm theo bên chịu trách nhiệm. */
export const delayPartyTally = (result: VarianceResult, reasons: Map<string, DelayReasonEntry>) => {
  const { required, chained } = delayReasonTargets(result);
  const parties = DELAY_PARTIES.map(party => {
    const nodes = required.filter(node => reasons.get(node.id)?.responsibleParty === party);
    return { party, count: nodes.length, maxLagDays: nodes.length ? Math.max(...nodes.map(node => -node.lagDays)) : 0,
      reasonCodes: [...new Set(nodes.map(node => reasons.get(node.id)!.reasonCode))] };
  }).filter(item => item.count > 0);
  return { parties, total: required.length, missing: required.filter(node => !reasons.has(node.id)).length, chained: chained.length };
};

/** Tiến độ sau khi công bố bản tổng hợp: % chốt theo việc, việc đạt 100% lấy ngày nhật ký làm ngày xong nếu chưa có. */
export const tasksAfterDailyLog = (tasks: ProjectTask[], progressByTask: Map<string, number>, logDate: string): ProjectTask[] =>
  tasks.map(task => {
    const progress = progressByTask.get(task.id);
    if (progress == null || !Number.isFinite(progress)) return task;
    return { ...task, progress, actualEndDate: progress >= 100 ? task.actualEndDate || logDate : task.actualEndDate };
  });

type DelayReasonDraft = Record<string, DelayReasonEntry & { kept?: boolean }>;

/** Dòng chọn lý do ban đầu: nháp của bản tổng hợp; nếu không có thì giữ lý do đã công bố gần nhất trước ngày nhật ký,
 *  không có nữa thì lấy lý do công bố sau ngày đó (duyệt bù phiếu cũ sau phiếu mới). */
export const initialDelayReasonDraft = (
  required: VarianceNode[], drafts: DelayReasonEntry[], latest: DelayReasonEntry[], later: DelayReasonEntry[] = [],
): DelayReasonDraft => {
  const draftBy = new Map(drafts.map(entry => [entry.taskId, entry]));
  const latestBy = new Map(latest.map(entry => [entry.taskId, entry]));
  const laterBy = new Map(later.map(entry => [entry.taskId, entry]));
  const out: DelayReasonDraft = {};
  for (const node of required) {
    const draft = draftBy.get(node.id);
    const previous = latestBy.get(node.id) || laterBy.get(node.id);
    if (draft) out[node.id] = { ...draft, kept: Boolean(previous && previous.reasonCode === draft.reasonCode && previous.responsibleParty === draft.responsibleParty) };
    else if (previous) out[node.id] = { ...previous, kept: true };
  }
  return out;
};

/** Chọn nhanh: gán một lý do cho nhiều việc; bên chịu trách nhiệm theo lý do, giữ ghi chú đã có (hoặc ghi chú kỹ sư). */
export const applyDelayReasonToTasks = (
  draft: DelayReasonDraft, taskIds: Iterable<string>, catalog: DelayReasonOption[], reasonCode: string, notes?: Map<string, string>,
): DelayReasonDraft => {
  const responsibleParty = partyOfReason(catalog, reasonCode);
  const next = { ...draft };
  for (const taskId of taskIds) {
    next[taskId] = { ...draft[taskId], taskId, reasonCode, responsibleParty, note: draft[taskId]?.note ?? notes?.get(taskId) ?? null, kept: false };
  }
  return next;
};
