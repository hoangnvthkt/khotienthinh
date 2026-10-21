import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyTotals, directiveCounts, directiveSource, directivesDone, directivesOfUnit, prevRateOf, prevWeekStart, rateDelta, teamTotals, unitSections, weekRangeLabel } from "../work/workBoards";
import type { WorkCompanyUnit, WorkDirective, WorkTeamMember } from "../work/workBoardService";

const migration = readFileSync("supabase/migrations/20261022200000_work_dot1_boards.sql", "utf8");
const member = (x: Partial<WorkTeamMember>): WorkTeamMember => ({ userId: "u", name: "A", title: null, orgUnitId: "o", isHead: false, active: 0,
  levels: { A: 0, B: 0, C: 0 }, load: 0, overdue: 0, stale: 0, unack: 0, due: 0, ontime: 0, ...x });
const unit = (id: string, parent: string | null, x: Partial<WorkCompanyUnit>): WorkCompanyUnit => ({ id, code: id.toUpperCase(), name: id, type: "department",
  parent: parent ? { id: parent, code: null, name: parent } : null, people: 3, hasHead: true, active: 0, overdue: 0, stale: 0, due: 0, ontime: 0,
  directives: { open: 0, late: 0, doneThisMonth: 0 }, claimsPending: 0, ...x });
const dir = (bucket: WorkDirective["bucket"], x: Partial<WorkDirective> = {}): WorkDirective => ({ id: bucket, code: "VW", title: bucket, level: "A", status: "in_progress",
  deadlineAt: null, progressPercent: 0, completedAt: null, createdAt: "2026-10-14T03:00:00Z", lastProgressAt: null, origin: "directive", claimStatus: "not_needed",
  giver: { id: "t", name: "TGĐ" }, meeting: { title: "Giao ban tuần 43", heldOn: "2026-10-19" }, assignees: [{ name: "Đô", unit: "QLDA" }], canDecide: false, bucket, ...x });

describe("Phòng tôi / Toàn công ty · tổng hợp", () => {
  it("tổng đơn vị: đúng hạn theo tổng việc đến hạn; chưa có việc đến hạn thì null", () => {
    expect(teamTotals([member({ due: 7, ontime: 6, overdue: 1, stale: 1, unack: 1, active: 6 }), member({ due: 4, ontime: 3, active: 4 })]))
      .toMatchObject({ due: 11, ontime: 9, rate: 82, overdue: 1, stale: 1, unack: 1, active: 10 });
    expect(teamTotals([member({})]).rate).toBeNull();
    expect(rateDelta(82, 80)).toBe(2); expect(rateDelta(82, null)).toBeNull();
  });
  it("toàn công ty: số đơn vị chưa gán trưởng", () => {
    expect(companyTotals([unit("a", "K", { due: 10, ontime: 8, people: 5 }), unit("b", "K", { hasHead: false, overdue: 2 })]))
      .toMatchObject({ due: 10, ontime: 8, rate: 80, overdue: 2, people: 8, noHead: 1, units: 2 });
  });
  it("đơn vị theo khối / đúng hạn thấp (chưa có số xuống cuối) / quá hạn nhiều; lọc chưa gán trưởng", () => {
    const us = [unit("a", "Khối VP", { due: 10, ontime: 9 }), unit("b", "Khối CT", { due: 10, ontime: 5, overdue: 1 }), unit("c", "Khối VP", { hasHead: false, overdue: 4 })];
    expect(unitSections(us, "group").map((s) => [s.title, s.units.map((u) => u.id)])).toEqual([["Khối VP", ["a", "c"]], ["Khối CT", ["b"]]]);
    expect(unitSections(us, "rate")[0].units.map((u) => u.id)).toEqual(["b", "a", "c"]);
    expect(unitSections(us, "overdue")[0].units.map((u) => u.id)).toEqual(["c", "b", "a"]);
    expect(unitSections(us, "group", true).flatMap((s) => s.units.map((u) => u.id))).toEqual(["c"]);
  });
  it("Sổ chỉ đạo: đếm theo tab, lọc theo đơn vị, nguồn ngắn", () => {
    const list = [dir("late"), dir("doing"), dir("doing", { assignees: [{ name: "Hương", unit: "TCKT" }] }), dir("confirm"), dir("done")];
    expect(directiveCounts(list)).toEqual({ late: 1, doing: 2, confirm: 1, done: 1 });
    expect(directivesOfUnit(list, "TCKT")).toHaveLength(1);
    expect(directiveSource(list[0])).toBe("Giao ban tuần 43 · TGĐ");
    expect(directiveSource(dir("confirm", { origin: "oral_claim", meeting: null, giver: { id: "p", name: "Phó TGĐ" } }))).toBe("Phó TGĐ giao trực tiếp 14/10");
  });
  it("kỳ trước: gộp prevDue / prevOntime; máy chủ không trả kỳ trước thì null", () => {
    expect(teamTotals([member({ prevDue: 4, prevOntime: 3 }), member({ prevDue: 6, prevOntime: 4 })]).prevRate).toBe(70);
    expect(prevRateOf([member({}), member({ prevDue: null })])).toBeNull();
    expect(prevRateOf([member({ prevDue: 0, prevOntime: 0 })])).toBeNull();
    expect(companyTotals([unit("a", null, { prevDue: 5, prevOntime: 5 })]).prevRate).toBe(100);
    expect(directivesDone(unit("a", null, { directives: { open: 1, late: 0, doneThisMonth: 4, doneInPeriod: 2 } }))).toBe(2);
    expect(directivesDone(unit("a", null, { directives: { open: 1, late: 0, doneThisMonth: 4 } }))).toBe(4);
  });
  it("tuần", () => {
    expect(prevWeekStart("2026-10-19")).toBe("2026-10-12");
    expect(weekRangeLabel("2026-10-12")).toBe("Tuần 42 · 12–18/10");
  });
});

describe("PR-4 · hợp đồng migration", () => {
  it("quyền theo vai, xác nhận kèm sửa hạn, lọc chưa nhận việc", () => {
    expect(migration).toContain("(v_global or o.claimed_giver_user_id = v_actor or app_private.work_task_actor_can_view(t.id))");
    expect(migration).toContain("v_res := public.work_task_claim_decide_v1(p_task_id, p_decision, p_note);");
    expect(migration).toContain("when 'unack' then t.status = 'pending_acknowledgement'");
    expect(migration).toContain("where t.status = 'awaiting_review' and t.reviewer_user_id = v_actor");
  });
});
