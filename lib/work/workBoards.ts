/** Phòng tôi / Toàn công ty / Sổ chỉ đạo (Đợt 1 PR-4): tổng hợp trên máy từ số RPC đã tính theo quyền. */
import type { WorkCompanyUnit, WorkDirective, WorkDirectiveBucket, WorkTeamMember } from "./workBoardService";
import { ontimeRate } from "./workBoardService";
import { ddmm, isoWeek } from "./workMyBoard";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const prevWeekStart = (weekStart: string) => addDays(weekStart, -7);
/** "Tuần 42 · 12–18/10". */
export const weekRangeLabel = (weekStart: string) => `Tuần ${isoWeek(weekStart)} · ${weekStart.slice(8, 10)}–${ddmm(addDays(weekStart, 6))}`;

/** Tỷ lệ đúng hạn kỳ trước từ prevDue / prevOntime; máy chủ không trả kỳ trước thì null. */
export function prevRateOf(rows: Array<{ prevDue?: number | null; prevOntime?: number | null }>): number | null {
  const has = rows.filter((r) => r.prevDue != null);
  if (!has.length) return null;
  return ontimeRate(has.reduce((n, r) => n + (r.prevOntime || 0), 0), has.reduce((n, r) => n + (r.prevDue || 0), 0));
}

export function teamTotals(members: WorkTeamMember[]) {
  const sum = (k: keyof Pick<WorkTeamMember, "due" | "ontime" | "overdue" | "stale" | "unack" | "active">) => members.reduce((n, m) => n + (m[k] || 0), 0);
  const due = sum("due"); const ontime = sum("ontime");
  return { due, ontime, rate: ontimeRate(ontime, due), prevRate: prevRateOf(members), overdue: sum("overdue"), stale: sum("stale"), unack: sum("unack"), active: sum("active") };
}
export function companyTotals(units: WorkCompanyUnit[]) {
  const sum = (f: (u: WorkCompanyUnit) => number) => units.reduce((n, u) => n + f(u), 0);
  const due = sum((u) => u.due); const ontime = sum((u) => u.ontime);
  return { due, ontime, rate: ontimeRate(ontime, due), prevRate: prevRateOf(units), overdue: sum((u) => u.overdue), people: sum((u) => u.people),
    noHead: units.filter((u) => !u.hasHead).length, units: units.length };
}
/** Chỉ đạo xong trong kỳ (máy chủ cũ chỉ có từ đầu tháng). */
export const directivesDone = (u: WorkCompanyUnit) => u.directives.doneInPeriod ?? u.directives.doneThisMonth;
/** Chênh điểm % so với kỳ trước; thiếu số thì null (không che bằng 0). */
export const rateDelta = (now: number | null, prev: number | null) => (now != null && prev != null ? now - prev : null);

export type UnitSort = "group" | "rate" | "overdue";
/** Đơn vị theo khối (đơn vị cha) hoặc xếp theo đúng hạn thấp / quá hạn nhiều; lọc đơn vị chưa gán trưởng. */
export function unitSections(units: WorkCompanyUnit[], sort: UnitSort, onlyNoHead = false): Array<{ title: string | null; units: WorkCompanyUnit[] }> {
  const list = units.filter((u) => !onlyNoHead || !u.hasHead);
  const rate = (u: WorkCompanyUnit) => ontimeRate(u.ontime, u.due) ?? 101;
  if (sort === "rate") return [{ title: null, units: [...list].sort((a, b) => rate(a) - rate(b) || b.overdue - a.overdue) }];
  if (sort === "overdue") return [{ title: null, units: [...list].sort((a, b) => b.overdue - a.overdue || rate(a) - rate(b)) }];
  const groups = new Map<string, WorkCompanyUnit[]>();
  for (const u of list) {
    const key = u.parent?.name || "Khác";
    groups.set(key, [...(groups.get(key) || []), u]);
  }
  return [...groups.entries()].map(([title, us]) => ({ title, units: us }));
}

export const DIRECTIVE_TABS: Array<{ id: WorkDirectiveBucket; label: string }> = [
  { id: "late", label: "Trễ" }, { id: "doing", label: "Đang làm" }, { id: "confirm", label: "Chờ xác nhận" }, { id: "done", label: "Xong" },
];
export function directiveCounts(list: WorkDirective[]) {
  const c: Record<WorkDirectiveBucket, number> = { late: 0, doing: 0, confirm: 0, done: 0 };
  for (const d of list) c[d.bucket] += 1;
  return c;
}
/** Chỉ đạo của một đơn vị (theo mã đơn vị người làm). */
export const directivesOfUnit = (list: WorkDirective[], unitCode: string | null) =>
  unitCode ? list.filter((d) => d.assignees.some((a) => a.unit === unitCode)) : [];
/** Nguồn chỉ đạo ngắn: "Giao ban tuần 43 · TGĐ" hoặc "TGĐ giao trực tiếp 14/10". */
export const directiveSource = (d: WorkDirective) => d.origin === "oral_claim"
  ? `${d.giver?.name || "Người giao"} giao trực tiếp ${ddmm(new Date(Date.parse(d.createdAt) + 7 * 3_600_000).toISOString().slice(0, 10))}`
  : [d.meeting?.title, d.giver?.name].filter(Boolean).join(" · ") || "Chỉ đạo";
