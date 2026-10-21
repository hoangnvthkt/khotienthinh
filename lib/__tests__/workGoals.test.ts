import { describe, expect, it, vi } from "vitest";
import {
  achievedOf, closeDueLabel, closeDueOf, createWorkGoalService, formatGoalValue, goalCounts, goalPeriodOptions, goalStatusOf, goalTree, parseGoalNumber,
  periodReviewFacts, reviewKey, settingLabel, type WorkGoal,
} from "../work/workGoals";
import { workError } from "../work/workForm";

const goal = (x: Partial<WorkGoal>): WorkGoal => ({ id: "g", orgUnitId: "u", unit: null, periodKind: "month", periodStart: "2026-10-01", periodEnd: "2026-10-31",
  label: "Tháng 10/2026", parentGoalId: null, title: "Thu tiền SMB", criteria: null, targetValue: 5, measure: "tỷ", higherIsBetter: true, actualValue: 3.2,
  owner: null, assessment: null, solution: null, lockVersion: 1, updatedAt: "2026-10-21T00:00:00Z", tasks: { total: 3, done: 1, ontime: 1, late: 0, overdue: 0 },
  achievedPercent: 64, status: "on_track", ...x });

describe("Vioo Work PR-6 · mục tiêu", () => {
  it("đọc số kiểu Việt; rỗng → null, sai → NaN", () => {
    expect(parseGoalNumber("1.250,5")).toBe(1250.5);
    expect(parseGoalNumber("9,5")).toBe(9.5);
    expect(parseGoalNumber("1234.5")).toBe(1234.5);
    expect(parseGoalNumber("5 tỷ")).toBe(5);
    expect(parseGoalNumber("1.000")).toBe(1000);
    expect(parseGoalNumber("  ")).toBeNull();
    expect(parseGoalNumber("abc")).toBeNaN();
    expect(formatGoalValue(1250.5, "tỷ")).toBe("1.250,5 tỷ");
    expect(formatGoalValue(96, "%")).toBe("96%");
    expect(formatGoalValue(null, "tỷ")).toBe("—");
  });

  it("% đạt: càng cao / càng thấp càng tốt; thiếu số → null", () => {
    expect(achievedOf(5, 3.2, true)).toBe(64);
    expect(achievedOf(10, 8, false)).toBe(125);
    expect(achievedOf(10, 0, false)).toBe(100);
    expect(achievedOf(null, 3, true)).toBeNull();
    expect(achievedOf(5, null, true)).toBeNull();
    expect(achievedOf(0, 3, true)).toBeNull();
  });

  it("trạng thái giống máy chủ: kỳ đã qua đạt / chưa đạt, đang chạy rủi ro / đúng tiến độ", () => {
    const past = goal({ periodEnd: "2026-09-30" });
    expect(goalStatusOf(past, 5, "2026-10-21")).toBe("met");
    expect(goalStatusOf(past, 4, "2026-10-21")).toBe("missed");
    expect(goalStatusOf(goal({ periodEnd: "2026-09-30", targetValue: null, tasks: { total: 0, done: 0, ontime: 0, late: 0, overdue: 0 } }), null, "2026-10-21")).toBe("unknown");
    expect(goalStatusOf(goal({ periodEnd: "2026-09-30", targetValue: null, tasks: { total: 2, done: 2, ontime: 2, late: 0, overdue: 0 } }), null, "2026-10-21")).toBe("met");
    expect(goalStatusOf(goal({ periodEnd: "2026-09-30", targetValue: null, tasks: { total: 2, done: 2, ontime: 1, late: 1, overdue: 0 } }), null, "2026-10-21")).toBe("missed");
    expect(goalStatusOf(goal({}), 3.2, "2026-10-21")).toBe("on_track");
    expect(goalStatusOf(goal({ tasks: { total: 3, done: 1, ontime: 1, late: 0, overdue: 1 } }), 9, "2026-10-21")).toBe("at_risk");
    expect(goalStatusOf(goal({}), 6, "2026-10-21")).toBe("met");
  });

  it("quý kèm tháng con; tháng mồ côi đứng riêng; đếm trạng thái", () => {
    const list = [goal({ id: "q", periodKind: "quarter", status: "at_risk" }), goal({ id: "m", parentGoalId: "q", status: "met" }), goal({ id: "x", parentGoalId: "gone", status: "missed" })];
    expect(goalTree(list).map((t) => [t.goal.id, t.children.map((c) => c.id)])).toEqual([["q", ["m"]], ["x", []]]);
    expect(goalCounts(list)).toMatchObject({ met: 1, at_risk: 1, missed: 1 });
  });

  it("kỳ khi thêm mục tiêu: tháng này, tháng sau, quý này, quý sau", () => {
    expect(goalPeriodOptions("2026-12-15").map((o) => o.label)).toEqual(["Tháng 12/2026", "Tháng 1/2027", "Quý 4/2026", "Quý 1/2027"]);
    expect(goalPeriodOptions("2026-10-12")[2]).toMatchObject({ kind: "quarter", start: "2026-10-01" });
  });

  it("hạn chốt: thứ chốt cuối cùng trong kỳ", () => {
    const s = { closeDow: 6, closeTime: "17:00" };
    expect(closeDueOf(s, "2026-10-12", "2026-10-18")).toEqual({ day: "2026-10-17", time: "17:00" });
    expect(closeDueOf(s, "2026-10-01", "2026-10-31")).toEqual({ day: "2026-10-31", time: "17:00" });
    expect(closeDueOf({ closeDow: 5, closeTime: "16:00" }, "2026-10-01", "2026-10-31").day).toBe("2026-10-30");
    expect(closeDueLabel({ day: "2026-10-17", time: "17:00" })).toBe("T7 17/10 17:00");
    expect(settingLabel({ cadence: "week", closeDow: 6, closeTime: "17:00" })).toBe("Thứ 7 · 17:00 hằng tuần");
  });

  it("dữ liệu gửi AI: khóa ngắn M1.. thay id, đủ số máy tính", () => {
    const facts = periodReviewFacts({ scopeName: "QLDA", label: "Tuần 42", board: { due: 18, ontime: 13, overdue: 3, prevRate: 70 },
      directives: { open: 2, late: 1, done: 1 }, goals: [goal({ id: "uuid-1234" }), goal({ id: "uuid-5678", title: "Nghiệm thu" })],
      lateTasks: [{ title: "Bóc khối lượng PĐ3", people: "Tạ Minh Khôi", deadline: "Thứ 6 16/10/2026 (2026-10-16)" }] });
    expect(facts).toContain("Đúng hạn: 72% (13/18 việc đến hạn) · kỳ trước 70%");
    expect(facts).toContain("Mục tiêu [M1] Thu tiền SMB");
    expect(facts).toContain("Mục tiêu [M2] Nghiệm thu");
    expect(facts).not.toContain("uuid-1234");
    expect(facts).toContain("Việc trễ: Bóc khối lượng PĐ3 · Tạ Minh Khôi");
    expect(reviewKey(0)).toBe("M1");
  });

  it("gọi đúng RPC + tham số; lỗi có câu tiếng Việt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const s = createWorkGoalService({ rpc } as any);
    await s.status("u", "2026-10-12", "2026-10-18");
    await s.close({ orgUnitId: null, from: "2026-10-12", to: "2026-10-18", prevFrom: "2026-10-05", prevTo: "2026-10-11", label: "Tuần 42", note: "  ", reviews: [], aiRunId: null });
    await s.reopen("c", "  Sửa số thu tiền ");
    await s.saveSetting(null, { cadence: "month", closeDow: 5, closeTime: "16:00", reportDow: 1, reportTime: "08:00" });
    await s.setGoalTasks("g", ["t1"]);
    expect(rpc.mock.calls).toEqual([
      ["work_period_status_v1", { p_org_unit_id: "u", p_from: "2026-10-12", p_to: "2026-10-18" }],
      ["work_period_close_v1", { p_org_unit_id: null, p_from: "2026-10-12", p_to: "2026-10-18", p_prev_from: "2026-10-05", p_prev_to: "2026-10-11",
        p_label: "Tuần 42", p_note: null, p_goal_reviews: [], p_ai_run_id: null }],
      ["work_period_reopen_v1", { p_close_id: "c", p_reason: "Sửa số thu tiền" }],
      ["work_period_settings_save_v1", { p_org_unit_id: null, p_cadence: "month", p_close_dow: 5, p_close_time: "16:00", p_report_dow: 1, p_report_time: "08:00" }],
      ["work_goal_tasks_set_v1", { p_goal_id: "g", p_add: ["t1"], p_remove: [] }],
    ]);
    expect(workError({ message: "WORK_GOAL_SOLUTION_REQUIRED" })).toContain("Giải pháp");
    expect(workError({ code: "PT409", message: "WORK_VERSION_CONFLICT" })).toContain("cập nhật ở nơi khác");
  });
});
