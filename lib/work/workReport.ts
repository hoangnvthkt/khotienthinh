/** Vioo Work Đợt 2 PR-7: báo cáo kỳ để trình chiếu / in PDF. Kỳ đã chốt lấy đúng bản chốt (không đổi về sau); kỳ đang mở lấy số trực tiếp.
 * Tệp này gom dữ liệu và dựng danh sách slide (không vẽ) để kiểm thử được. */
import type { WorkBoardService, WorkCompanyUnit, WorkDirective, WorkOverviewTask, WorkTeamMember } from "./workBoardService";
import { ontimeRate } from "./workBoardService";
import { companyTotals, directiveCounts, rateDelta, teamTotals } from "./workBoards";
import type { WorkGoal, WorkGoalService } from "./workGoals";
import type { WorkPeriodQuery } from "./workPeriod";

export interface ReportRow { id: string; name: string; sub: string | null; due: number; ontime: number; late: number; overdue: number; rate: number | null }
export interface WorkReportData {
  scopeName: string; label: string; from: string; to: string; kind: "team" | "company";
  closed: null | { at: string; by: string; note: string | null };
  rate: number | null; prevRate: number | null; delta: number | null; due: number; ontime: number; overdue: number; stale: number;
  rows: ReportRow[]; directives: WorkDirective[]; goals: WorkGoal[]; lateTasks: WorkOverviewTask[];
}

const rowOfMember = (m: WorkTeamMember): ReportRow => ({ id: m.userId, name: m.name, sub: m.title, due: m.due, ontime: m.ontime,
  late: Math.max(0, m.due - m.ontime), overdue: m.overdue, rate: ontimeRate(m.ontime, m.due) });
const rowOfUnit = (u: WorkCompanyUnit): ReportRow => ({ id: u.id, name: u.name, sub: u.code, due: u.due, ontime: u.ontime,
  late: Math.max(0, u.due - u.ontime), overdue: u.overdue, rate: ontimeRate(u.ontime, u.due) });

/** Gom số báo cáo: bản chốt đúng kỳ nếu có, không thì số trực tiếp + việc đang quá hạn. */
export async function loadWorkReport(svc: {
  board: Pick<WorkBoardService, "teamBoard" | "companyBoard" | "directives" | "tasksOverview">; goals: WorkGoalService;
}, scope: { orgUnitId: string | null; unitCode: string | null; scopeName: string; label: string; from: string; to: string; query: WorkPeriodQuery }): Promise<WorkReportData> {
  const kind = scope.orgUnitId ? "team" : "company";
  const status = await svc.goals.status(scope.orgUnitId, scope.from, scope.to);
  if (status.close) {
    const d = await svc.goals.closeDetail(status.close.id);
    const s = d.snapshot;
    const members = "members" in s.board ? s.board.members : null;
    const units = "units" in s.board ? s.board.units : [];
    const tot = members ? teamTotals(members) : companyTotals(units);
    return { scopeName: scope.scopeName, label: d.label || scope.label, from: d.from, to: d.to, kind,
      closed: { at: d.closedAt, by: d.closedBy, note: d.note }, rate: tot.rate, prevRate: tot.prevRate, delta: rateDelta(tot.rate, tot.prevRate),
      due: tot.due, ontime: tot.ontime, overdue: tot.overdue, stale: members ? teamTotals(members).stale : 0,
      rows: members ? members.map(rowOfMember) : units.map(rowOfUnit), directives: s.directives || [], goals: s.goals || [], lateTasks: [] };
  }
  const [boardData, directives, goals, late] = await Promise.all([
    scope.orgUnitId ? svc.board.teamBoard(scope.orgUnitId, scope.query) : svc.board.companyBoard(scope.query),
    svc.board.directives(scope.orgUnitId, scope.query).catch(() => [] as WorkDirective[]),
    svc.goals.goals(scope.orgUnitId, scope.from, scope.to).then((g) => g.goals).catch(() => [] as WorkGoal[]),
    svc.board.tasksOverview({ unit: scope.unitCode, state: "overdue", limit: 12 }).then((r) => r.items || []).catch(() => [] as WorkOverviewTask[]),
  ]);
  const members = "members" in boardData ? boardData.members : null;
  const units = "units" in boardData ? boardData.units : [];
  const tot = members ? teamTotals(members) : companyTotals(units);
  return { scopeName: scope.scopeName, label: scope.label, from: scope.from, to: scope.to, kind, closed: null,
    rate: tot.rate, prevRate: tot.prevRate, delta: rateDelta(tot.rate, tot.prevRate), due: tot.due, ontime: tot.ontime, overdue: tot.overdue,
    stale: members ? teamTotals(members).stale : 0, rows: members ? members.map(rowOfMember) : units.map(rowOfUnit), directives, goals, lateTasks: late };
}

export type ReportSlide =
  | { kind: "cover" }
  | { kind: "rows"; rows: ReportRow[] }
  | { kind: "worst"; rows: ReportRow[] }
  | { kind: "goals"; goals: WorkGoal[]; page: number; pages: number }
  | { kind: "directives"; items: WorkDirective[] }
  | { kind: "late"; items: WorkOverviewTask[] }
  | { kind: "note"; note: string };

/** Xếp trễ nhiều nhất: (không đúng hạn trong kỳ + đang quá hạn) giảm dần, bỏ dòng = 0. */
export const worstRows = (rows: ReportRow[], n = 5) =>
  rows.filter((r) => r.late + r.overdue > 0).sort((a, b) => (b.late + b.overdue) - (a.late + a.overdue) || (a.rate ?? 101) - (b.rate ?? 101)).slice(0, n);

/** Danh sách slide; bỏ slide không có gì để xem. */
export function buildSlides(d: WorkReportData): ReportSlide[] {
  const slides: ReportSlide[] = [{ kind: "cover" }];
  const withDue = d.rows.filter((r) => r.due > 0 || r.overdue > 0);
  if (withDue.length) slides.push({ kind: "rows", rows: [...withDue].sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.overdue - a.overdue).slice(0, 14) });
  const worst = worstRows(d.rows);
  if (worst.length) slides.push({ kind: "worst", rows: worst });
  const pages = Math.ceil(d.goals.length / 3);
  for (let i = 0; i < pages; i++) slides.push({ kind: "goals", goals: d.goals.slice(i * 3, i * 3 + 3), page: i + 1, pages });
  const dirs = d.directives.filter((x) => x.bucket === "late" || x.bucket === "doing" || x.bucket === "confirm")
    .sort((a, b) => (a.bucket === "late" ? 0 : 1) - (b.bucket === "late" ? 0 : 1)).slice(0, 8);
  if (dirs.length) slides.push({ kind: "directives", items: dirs });
  if (d.lateTasks.length) slides.push({ kind: "late", items: d.lateTasks.slice(0, 8) });
  if (d.closed?.note) slides.push({ kind: "note", note: d.closed.note });
  return slides;
}

export const reportDirectiveCounts = (d: WorkReportData) => directiveCounts(d.directives);
export const reportGoalCounts = (d: WorkReportData) => ({
  total: d.goals.length, met: d.goals.filter((g) => g.status === "met").length,
  risk: d.goals.filter((g) => g.status === "at_risk" || g.status === "missed").length,
});
