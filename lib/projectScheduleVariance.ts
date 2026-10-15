// Nhanh / chậm so với tiến độ tổng (PR-3, chủ SP duyệt 15/10/2026).
//
// - Ngày xong dự kiến của việc lá lấy từ thực tế Nhật ký: xong rồi = ngày xong thật; đang làm = ngày có số liệu +
//   phần còn lại theo nhịp kế hoạch; đã quá ngày bắt đầu mà chưa làm = bắt đầu từ hôm sau ngày số liệu.
// - Việc nối tiếp: mốc khống chế CHT khai báo (phụ thuộc FS trên Gantt) + các việc liền nhau trong cùng nhóm mà kế hoạch
//   không chồng ngày (tự nối). Phụ thuộc khác FS giữa hai việc = "làm song song", bỏ nối tự động.
//   Việc trước chậm thì việc sau dời theo, trừ khoảng trống kế hoạch đã có giữa hai việc.
// - Hạng mục lớn chỉ chậm khi việc con xong muộn hơn kế hoạch kết thúc của hạng mục (gộp từ việc con); dự án tính y vậy.
//   Lệch trong ±3 ngày coi là đúng hạn.
import type { ProjectTask } from '../types';

export const VARIANCE_TOLERANCE_DAYS = 3;
export type VarianceStatus = 'late' | 'on_time' | 'early';
export const varianceStatus = (lagDays: number): VarianceStatus =>
  lagDays < -VARIANCE_TOLERANCE_DAYS ? 'late' : lagDays > VARIANCE_TOLERANCE_DAYS ? 'early' : 'on_time';

export interface VarianceNode {
  id: string;
  wbsCode: string | null;
  name: string;
  parentId: string | null;
  childIds: string[];
  isLeaf: boolean;
  progress: number;
  done: boolean;
  planStart: string;
  planEnd: string;
  forecastEnd: string;
  /** Kế hoạch kết thúc − dự kiến xong (ngày). Âm = chậm. */
  lagDays: number;
  /** Việc trước (mốc / nối tự động) đang làm việc này dời. */
  blockerIds: string[];
}

export interface VarianceLink {
  predId: string;
  succId: string;
  kind: 'manual' | 'auto';
  /** Khoảng trống kế hoạch giữa hai việc (âm = kế hoạch chồng ngày). */
  gapDays: number;
  /** Việc trước dự kiến xong muộn hơn kế hoạch bao nhiêu ngày. */
  predDelayDays: number;
  /** Việc sau phải dời bao nhiêu ngày vì mốc này. */
  succShiftDays: number;
}

export interface VarianceResult {
  dataDate: string;
  nodes: Map<string, VarianceNode>;
  rootIds: string[];
  projectPlanEnd: string | null;
  projectForecastEnd: string | null;
  projectLagDays: number;
  links: VarianceLink[];
  /** Cặp được đánh dấu làm song song (phụ thuộc khác FS). */
  parallelPairs: Array<[string, string]>;
  /** Khối lượng theo số ngày kế hoạch: thực tế / kế hoạch tới ngày số liệu (0–100). */
  volume: { actualPercent: number; plannedPercent: number } | null;
}

const DAY = 86_400_000;
const toDay = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const toIso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const validDate = (value: string | null | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value.slice(0, 10)));

export const daysBetweenIso = (from: string, to: string) => toDay(to) - toDay(from);

/** Tính nhanh / chậm. extraLinks: mốc chưa lưu (xem trước khi thêm). */
export const computeScheduleVariance = (
  tasks: ProjectTask[],
  dataDate: string,
  extraLinks: Array<[string, string]> = [],
): VarianceResult => {
  const usable = tasks.filter(task => validDate(task.startDate) && validDate(task.endDate));
  const byId = new Map(usable.map(task => [task.id, task]));
  const children = new Map<string, ProjectTask[]>();
  const roots: ProjectTask[] = [];
  for (const task of usable) {
    if (task.parentId && byId.has(task.parentId)) children.set(task.parentId, [...(children.get(task.parentId) || []), task]);
    else roots.push(task);
  }
  const ancestors = new Map<string, string[]>();
  const ancestorsOf = (id: string): string[] => {
    const cached = ancestors.get(id);
    if (cached) return cached;
    const out: string[] = [];
    let parent = byId.get(id)?.parentId;
    const seen = new Set<string>();
    while (parent && byId.has(parent) && !seen.has(parent)) { out.push(parent); seen.add(parent); parent = byId.get(parent)?.parentId; }
    ancestors.set(id, out);
    return out;
  };

  // Kế hoạch: việc lá theo ngày của việc, nhóm gộp từ việc con (ngày lưu trên việc cha có thể lệch).
  const planStart = new Map<string, number>();
  const planEnd = new Map<string, number>();
  const plan = (task: ProjectTask) => {
    const kids = children.get(task.id);
    if (!kids?.length) {
      planStart.set(task.id, toDay(task.startDate));
      planEnd.set(task.id, Math.max(toDay(task.startDate), toDay(task.endDate)));
      return;
    }
    kids.forEach(plan);
    planStart.set(task.id, Math.min(...kids.map(kid => planStart.get(kid.id)!)));
    planEnd.set(task.id, Math.max(...kids.map(kid => planEnd.get(kid.id)!)));
  };
  roots.forEach(plan);

  // Mốc khống chế và cặp làm song song từ phụ thuộc trên Gantt.
  const isRelated = (a: string, b: string) => ancestorsOf(a).includes(b) || ancestorsOf(b).includes(a);
  const manual = new Map<string, [string, string]>();
  const parallel = new Set<string>();
  const parallelPairs: Array<[string, string]> = [];
  const key = (a: string, b: string) => `${a}>${b}`;
  const addManual = (pred: string, succ: string) => {
    if (!byId.has(pred) || !byId.has(succ) || pred === succ || isRelated(pred, succ)) return;
    manual.set(key(pred, succ), [pred, succ]);
  };
  for (const task of usable) {
    for (const dependency of task.dependencies || []) {
      const predId = dependency?.taskId ?? (dependency as { task_id?: string } | undefined)?.task_id;
      if (!predId || !byId.has(predId)) continue;
      if ((dependency.type || 'FS') === 'FS') addManual(predId, task.id);
      else if (!parallel.has(key(predId, task.id))) {
        parallel.add(key(predId, task.id));
        parallel.add(key(task.id, predId));
        parallelPairs.push([predId, task.id]);
      }
    }
  }
  for (const [pred, succ] of extraLinks) addManual(pred, succ);

  // Nối tự động: trong cùng nhóm, việc bắt đầu sau khi việc kết thúc muộn nhất trước nó đã xong (kế hoạch không chồng ngày).
  const auto = new Map<string, [string, string]>();
  const autoGroup = (siblings: ProjectTask[]) => {
    const sorted = [...siblings].sort((a, b) => planStart.get(a.id)! - planStart.get(b.id)! || (a.order ?? 0) - (b.order ?? 0));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted.slice(0, index).reduce((best, item) => (planEnd.get(item.id)! > planEnd.get(best.id)! ? item : best));
      const current = sorted[index];
      if (planStart.get(current.id)! <= planEnd.get(previous.id)!) continue;
      if (parallel.has(key(previous.id, current.id)) || manual.has(key(previous.id, current.id))) continue;
      auto.set(key(previous.id, current.id), [previous.id, current.id]);
    }
  };
  autoGroup(roots);
  children.forEach(autoGroup);

  const preds = new Map<string, Array<{ id: string; kind: 'manual' | 'auto' }>>();
  for (const [pred, succ] of manual.values()) preds.set(succ, [...(preds.get(succ) || []), { id: pred, kind: 'manual' }]);
  for (const [pred, succ] of auto.values()) preds.set(succ, [...(preds.get(succ) || []), { id: pred, kind: 'auto' }]);

  // Ngày dự kiến: lặp tới khi ổn định (mốc giữa các nhánh).
  const dataDay = toDay(dataDate);
  let forecast = new Map<string, number>();
  const shiftOf = (id: string, current: Map<string, number>) => {
    let shift = 0;
    for (const node of [id, ...ancestorsOf(id)]) {
      for (const pred of preds.get(node) || []) {
        const delay = (current.get(pred.id) ?? planEnd.get(pred.id)!) - planEnd.get(pred.id)!;
        const gap = planStart.get(node)! - planEnd.get(pred.id)! - 1;
        shift = Math.max(shift, delay - Math.max(gap, 0));
      }
    }
    return shift;
  };
  for (let pass = 0; pass < 40; pass += 1) {
    const next = new Map<string, number>();
    const calc = (task: ProjectTask): number => {
      const kids = children.get(task.id);
      if (kids?.length) {
        const value = Math.max(...kids.map(calc));
        next.set(task.id, value);
        return value;
      }
      const start = planStart.get(task.id)!;
      const end = planEnd.get(task.id)!;
      const duration = end - start + 1;
      const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
      let value: number;
      if (progress >= 100) {
        value = validDate(task.actualEndDate) ? toDay(task.actualEndDate) : end;
      } else {
        const shift = shiftOf(task.id, forecast);
        if (progress > 0) value = Math.max(dataDay, start + shift - 1) + Math.ceil(duration * (1 - progress / 100));
        else value = Math.max(start + shift, dataDay + 1) + duration - 1;
      }
      next.set(task.id, value);
      return value;
    };
    roots.forEach(calc);
    const stable = next.size === forecast.size && [...next].every(([id, value]) => forecast.get(id) === value);
    forecast = next;
    if (stable) break;
  }

  const nodes = new Map<string, VarianceNode>();
  for (const task of usable) {
    const blockers: string[] = [];
    for (const node of [task.id, ...ancestorsOf(task.id)]) {
      for (const pred of preds.get(node) || []) {
        const delay = forecast.get(pred.id)! - planEnd.get(pred.id)!;
        const gap = planStart.get(node)! - planEnd.get(pred.id)! - 1;
        if (delay - Math.max(gap, 0) > 0 && !blockers.includes(pred.id)) blockers.push(pred.id);
      }
    }
    const kids = children.get(task.id) || [];
    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    nodes.set(task.id, {
      id: task.id, wbsCode: task.wbsCode || null, name: task.name, parentId: task.parentId && byId.has(task.parentId) ? task.parentId : null,
      childIds: kids.map(kid => kid.id), isLeaf: kids.length === 0, progress, done: progress >= 100,
      planStart: toIso(planStart.get(task.id)!), planEnd: toIso(planEnd.get(task.id)!), forecastEnd: toIso(forecast.get(task.id)!),
      lagDays: planEnd.get(task.id)! - forecast.get(task.id)!, blockerIds: blockers,
    });
  }

  const links: VarianceLink[] = [...manual.values(), ...auto.values()].map(([pred, succ]) => {
    const predDelay = forecast.get(pred)! - planEnd.get(pred)!;
    const gap = planStart.get(succ)! - planEnd.get(pred)! - 1;
    return { predId: pred, succId: succ, kind: manual.has(key(pred, succ)) ? 'manual' : 'auto', gapDays: gap,
      predDelayDays: predDelay, succShiftDays: Math.max(0, predDelay - Math.max(gap, 0)) };
  });

  const leaves = usable.filter(task => !children.get(task.id)?.length);
  let volume: VarianceResult['volume'] = null;
  if (leaves.length) {
    let weights = 0; let planned = 0; let actual = 0;
    for (const leaf of leaves) {
      const start = planStart.get(leaf.id)!; const end = planEnd.get(leaf.id)!;
      const weight = end - start + 1;
      weights += weight;
      planned += weight * Math.max(0, Math.min(1, (dataDay - start + 1) / weight));
      actual += weight * Math.max(0, Math.min(100, Number(leaf.progress) || 0)) / 100;
    }
    volume = { actualPercent: Math.round((actual / weights) * 1000) / 10, plannedPercent: Math.round((planned / weights) * 1000) / 10 };
  }

  const projectPlanEnd = roots.length ? Math.max(...roots.map(root => planEnd.get(root.id)!)) : null;
  const projectForecastEnd = roots.length ? Math.max(...roots.map(root => forecast.get(root.id)!)) : null;
  return {
    dataDate,
    nodes,
    rootIds: [...roots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || planStart.get(a.id)! - planStart.get(b.id)!).map(root => root.id),
    projectPlanEnd: projectPlanEnd == null ? null : toIso(projectPlanEnd),
    projectForecastEnd: projectForecastEnd == null ? null : toIso(projectForecastEnd),
    projectLagDays: projectPlanEnd == null || projectForecastEnd == null ? 0 : projectPlanEnd - projectForecastEnd,
    links,
    parallelPairs,
    volume,
  };
};

/** Còn dư bao nhiêu ngày trước khi làm chậm việc sau (mốc ra ngoài nhánh), hoặc tới về đích nếu không có việc sau. */
export const varianceSlackDays = (result: VarianceResult, id: string): number | null => {
  const node = result.nodes.get(id);
  if (!node || node.done) return null;
  const outgoing = result.links.filter(link => link.predId === id);
  if (outgoing.length) {
    return Math.max(0, Math.min(...outgoing.map(link => {
      const succ = result.nodes.get(link.succId)!;
      return daysBetweenIso(node.forecastEnd, succ.planStart) - 1;
    })));
  }
  return result.projectPlanEnd ? Math.max(0, daysBetweenIso(node.forecastEnd, result.projectPlanEnd)) : null;
};

/** Ngày số liệu: dự án dùng Nhật ký chính thức → ngày nhật ký tổng hợp được duyệt gần nhất (không quá hôm nay). */
export const varianceDataDate = (input: {
  today: string;
  authoritative: boolean;
  logs: Array<{ date: string; status?: string | null; summarySourceType?: string | null; supersededByDailyLogId?: string | null }>;
}): string => {
  if (!input.authoritative) return input.today;
  const approved = input.logs
    .filter(log => log.status === 'verified' && log.summarySourceType === 'member_contributions' && !log.supersededByDailyLogId)
    .map(log => log.date.slice(0, 10))
    .filter(date => date <= input.today)
    .sort();
  return approved.at(-1) || input.today;
};

/** Vướng mắc ghi trong nhật ký tổng hợp đã duyệt (mới nhất trước). */
export const recentDailyLogIssues = (
  logs: Array<{ date: string; status?: string | null; issues?: string | null; supersededByDailyLogId?: string | null }>,
  limit = 3,
): Array<{ date: string; text: string }> => logs
  .filter(log => log.status === 'verified' && !log.supersededByDailyLogId && log.issues && log.issues.trim().length > 3
    && !/^\s*(-\s*)?([^:]{0,40}:\s*)?(không|khong|ko)\s*\.?\s*$/iu.test(log.issues))
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, limit)
  .map(log => ({ date: log.date.slice(0, 10), text: log.issues!.replace(/\s+/g, ' ').trim().slice(0, 220) }));
