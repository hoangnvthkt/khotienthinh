import { describe, expect, it, vi } from "vitest";
import { buildSlides, loadWorkReport, worstRows, type ReportRow, type WorkReportData } from "../work/workReport";

const row = (id: string, x: Partial<ReportRow>): ReportRow => ({ id, name: id, sub: null, due: 0, ontime: 0, late: 0, overdue: 0, rate: null, ...x });
const data = (x: Partial<WorkReportData>): WorkReportData => ({ scopeName: "QLDA", label: "Tuần 42", from: "2026-10-12", to: "2026-10-18", kind: "team",
  closed: null, rate: 72, prevRate: 72, delta: 0, due: 18, ontime: 13, overdue: 3, stale: 3, rows: [], directives: [], goals: [], lateTasks: [], ...x });
const member = (userId: string, x: object) => ({ userId, name: userId, title: null, orgUnitId: "u", isHead: false, active: 1, levels: { A: 0, B: 0, C: 1 }, load: 1,
  overdue: 0, stale: 0, unack: 0, due: 0, ontime: 0, prevDue: 0, prevOntime: 0, ...x });

describe("Vioo Work PR-7 · báo cáo kỳ", () => {
  it("trễ nhiều nhất: (không đúng hạn + quá hạn) giảm dần, bỏ dòng 0", () => {
    const rows = [row("a", { late: 1, overdue: 0, rate: 80 }), row("b", { late: 2, overdue: 3, rate: 40 }), row("c", {}), row("d", { late: 1, overdue: 0, rate: 50 })];
    expect(worstRows(rows).map((r) => r.id)).toEqual(["b", "d", "a"]);
  });

  it("slide: chỉ có bìa khi chưa có gì; đủ slide khi có dữ liệu, mục tiêu 3 cái / slide, nhận xét khi đã chốt", () => {
    expect(buildSlides(data({})).map((s) => s.kind)).toEqual(["cover"]);
    const goals = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, status: "met" } as never));
    const d = data({ rows: [row("a", { due: 5, ontime: 2, late: 3, overdue: 1, rate: 40 })], goals,
      directives: [{ id: "x", bucket: "done" } as never, { id: "y", bucket: "doing" } as never, { id: "z", bucket: "late" } as never],
      lateTasks: [{ id: "t" } as never], closed: { at: "2026-10-18T10:00:00Z", by: "Vương Thành Đô", note: "Tuần ổn" } });
    const s = buildSlides(d);
    expect(s.map((x) => x.kind)).toEqual(["cover", "rows", "worst", "goals", "goals", "directives", "late", "note"]);
    expect(s.find((x) => x.kind === "directives")).toMatchObject({ items: [{ id: "z" }, { id: "y" }] });
  });

  it("kỳ đã chốt: lấy bản chốt, không gọi số trực tiếp", async () => {
    const board = { teamBoard: vi.fn(), companyBoard: vi.fn(), directives: vi.fn(), tasksOverview: vi.fn() };
    const goals = {
      status: vi.fn().mockResolvedValue({ close: { id: "c1" } }),
      closeDetail: vi.fn().mockResolvedValue({ id: "c1", from: "2026-10-12", to: "2026-10-18", label: "Tuần 42 · 12–18/10", closedAt: "2026-10-18T10:00:00Z",
        closedBy: "Vương Thành Đô", note: "Ổn", snapshot: { board: { members: [member("a", { due: 4, ontime: 3, overdue: 1, prevDue: 2, prevOntime: 1 })] }, directives: [], goals: [] } }),
    } as never;
    const r = await loadWorkReport({ board: board as never, goals }, { orgUnitId: "u", unitCode: "QLDA", scopeName: "QLDA", label: "x", from: "2026-10-12", to: "2026-10-18",
      query: { from: "2026-10-12", to: "2026-10-18", prevFrom: "2026-10-05", prevTo: "2026-10-11" } });
    expect(r).toMatchObject({ closed: { by: "Vương Thành Đô", note: "Ổn" }, rate: 75, prevRate: 50, delta: 25, overdue: 1, label: "Tuần 42 · 12–18/10" });
    expect(board.teamBoard).not.toHaveBeenCalled();
  });

  it("kỳ chưa chốt: số trực tiếp + việc quá hạn; lỗi phụ không làm hỏng báo cáo", async () => {
    const board = {
      teamBoard: vi.fn(), tasksOverview: vi.fn().mockRejectedValue(new Error("x")), directives: vi.fn().mockResolvedValue([]),
      companyBoard: vi.fn().mockResolvedValue({ units: [{ id: "u1", code: "QLDA", name: "QLDA", due: 10, ontime: 8, overdue: 2, prevDue: 10, prevOntime: 9, directives: {} }] }),
    };
    const goals = { status: vi.fn().mockResolvedValue({ close: null }), goals: vi.fn().mockResolvedValue({ goals: [] }) } as never;
    const r = await loadWorkReport({ board: board as never, goals }, { orgUnitId: null, unitCode: null, scopeName: "Toàn công ty", label: "Tháng 9/2026",
      from: "2026-09-01", to: "2026-09-30", query: { from: "2026-09-01", to: "2026-09-30", prevFrom: "2026-08-01", prevTo: "2026-08-31" } });
    expect(r).toMatchObject({ kind: "company", closed: null, rate: 80, prevRate: 90, delta: -10, lateTasks: [], rows: [{ id: "u1", late: 2, rate: 80 }] });
  });
});
