import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isoWeek, myBoardGroups, myDay, myNoDue, myOntime, myRangeDays, myShiftAnchor, mySource, myWeekDays, myWeekLabel, saturdayOf, vnDay } from "../work/workMyBoard";
import type { WorkMyTask } from "../work/workBoardService";

const migration = readFileSync("supabase/migrations/20261022150000_work_my_board.sql", "utf8");
const task = (id: string, x: Partial<WorkMyTask>): WorkMyTask => ({
  id, code: `VW-${id}`, title: id, status: "in_progress", level: "B", deadlineAt: null, progressPercent: 0, labels: [], lockVersion: 1, blockedReason: null,
  completedAt: null, createdAt: "2026-10-14T02:00:00Z", lastProgressAt: null, acknowledged: true, needsReview: true, createdBy: { id: "h", name: "Vương Thành Đô" },
  createdByMe: false, createdByHead: true, checklist: { done: 0, total: 0 }, origin: null,
  can: { acknowledge: false, start: false, block: true, unblock: false, submit: true }, ...x,
});

describe("Việc của tôi · nhóm theo hạn", () => {
  const now = new Date("2026-10-20T03:00:00Z"); // T3 20/10 10:00 giờ VN
  const tasks = [
    task("over", { deadlineAt: "2026-10-17T10:00:00Z", level: "A" }),
    task("review-late", { deadlineAt: "2026-10-17T10:00:00Z", status: "awaiting_review" }),
    task("today", { deadlineAt: "2026-10-20T10:00:00Z" }),
    task("today-late-night", { deadlineAt: "2026-10-20T16:00:00Z" }), // 23:00 VN cùng ngày
    task("week", { deadlineAt: "2026-10-24T10:00:00Z" }),
    task("sunday", { deadlineAt: "2026-10-25T10:00:00Z" }),
    task("later", { deadlineAt: "2026-10-27T10:00:00Z" }),
    task("nodue", {}),
    task("claim", { deadlineAt: "2026-10-17T10:00:00Z", origin: { origin: "oral_claim", claimStatus: "pending", giver: { id: "g", name: "Phó TGĐ" }, meeting: null } }),
    task("claim-ok", { deadlineAt: "2026-10-24T10:00:00Z", origin: { origin: "oral_claim", claimStatus: "confirmed", giver: { id: "g", name: "Phó TGĐ" }, meeting: null } }),
    task("done", { status: "completed", deadlineAt: "2026-10-19T10:00:00Z", completedAt: "2026-10-19T08:00:00Z" }),
  ];
  const g = myBoardGroups(tasks, "2026-10-20", "2026-10-25", now);
  it("quá hạn chỉ tính việc còn phải làm; việc đã nộp chờ duyệt xếp theo ngày", () => {
    expect(g.over.map((t) => t.id)).toEqual(["over"]);
    expect(g.today.map((t) => t.id)).toEqual(["review-late", "today", "today-late-night"]);
  });
  it("tuần này đến hết chủ nhật; sau tuần này gồm cả việc chưa có hạn (cuối)", () => {
    expect(g.week.map((t) => t.id)).toEqual(["week", "claim-ok", "sunday"]);
    expect(g.later.map((t) => t.id)).toEqual(["later", "nodue"]);
  });
  it("việc giao miệng chờ xác nhận tách riêng; xong tuần này riêng", () => {
    expect(g.confirm.map((t) => t.id)).toEqual(["claim"]);
    expect(g.done.map((t) => t.id)).toEqual(["done"]);
  });
  it("cùng hạn thì A trước", () => {
    const same = myBoardGroups([task("b", { deadlineAt: "2026-10-24T10:00:00Z", level: "B" }), task("a", { deadlineAt: "2026-10-24T10:00:00Z", level: "A" })], "2026-10-20", "2026-10-25", now);
    expect(same.week.map((t) => t.id)).toEqual(["a", "b"]);
  });
  it("ngày theo giờ Việt Nam", () => expect(vnDay("2026-10-20T17:30:00Z")).toBe("2026-10-21"));
  it("nhóm Đã xong chỉ lấy việc xong trong tuần (Lịch nhận thêm việc xong các tuần trước)", () => {
    const old = task("old-done", { status: "completed", deadlineAt: "2026-10-14T10:00:00Z", completedAt: "2026-10-14T08:00:00Z" });
    expect(myBoardGroups([...tasks, old], "2026-10-20", "2026-10-25", now, "2026-10-19").done.map((t) => t.id)).toEqual(["done"]);
  });
});

describe("Việc của tôi · nguồn việc", () => {
  it("chỉ đạo (người chỉ đạo · cuộc họp), giao trực tiếp, trưởng phòng / đơn vị, tự tạo, người khác", () => {
    expect(mySource(task("d", { origin: { origin: "directive", claimStatus: "not_needed", giver: { id: "t", name: "BLĐ" }, meeting: { title: "Giao ban 12/10", heldOn: "2026-10-12" } } })))
      .toEqual({ kind: "directive", text: "BLĐ · Giao ban 12/10" });
    expect(mySource(task("o", { origin: { origin: "oral_claim", claimStatus: "pending", giver: { id: "g", name: "Phó TGĐ" }, meeting: null } }))).toEqual({ kind: "oral", text: "Phó TGĐ giao trực tiếp 14/10" });
    expect(mySource(task("h", {}), "Phòng Quản lý dự án")).toEqual({ kind: "head", text: "Trưởng phòng giao" });
    expect(mySource(task("h", {}), "Ban chỉ huy SMB").text).toBe("Trưởng đơn vị giao");
    expect(mySource(task("s", { createdByMe: true, createdByHead: false }))).toEqual({ kind: "self", text: "Tự tạo" });
    expect(mySource(task("x", { createdByHead: false }))).toEqual({ kind: "other", text: "Vương Thành Đô giao" });
  });
});

describe("Việc của tôi · số tuần", () => {
  it("đúng hạn tuần gần nhất + chênh so với tuần trước nữa", () => {
    const o = myOntime([{ weekStart: "2026-10-12", due: 7, ontime: 6 }, { weekStart: "2026-10-05", due: 6, ontime: 5 }, { weekStart: "2026-09-28", due: 0, ontime: 0 }, { weekStart: "2026-09-21", due: 4, ontime: 2 }]);
    expect(o).toMatchObject({ week: 42, rate: 86, ontime: 6, due: 7, delta: 3, prevWeek: 41 });
    expect(o.trend).toEqual([50, null, 83, 86]);
  });
  it("chưa có việc đến hạn thì không ra 0%", () => {
    expect(myOntime([{ weekStart: "2026-10-12", due: 0, ontime: 0 }]).rate).toBeNull();
    expect(myOntime([]).rate).toBeNull();
  });
  it("tuần ISO, nhãn tuần, thứ 7 chốt tuần, 7 ngày có việc", () => {
    expect(isoWeek("2026-10-19")).toBe(43);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(myWeekLabel({ weekStart: "2026-10-19", weekEnd: "2026-10-25" })).toBe("Tuần 43 · 19–25/10");
    expect(saturdayOf("2026-10-19")).toBe("2026-10-24");
    const days = myWeekDays("2026-10-19", [task("t", { deadlineAt: "2026-10-24T10:00:00Z" })]);
    expect(days.map((d) => d.label)).toEqual(["T2", "T3", "T4", "T5", "T6", "T7", "CN"]);
    expect(days[5].tasks.map((t) => t.id)).toEqual(["t"]);
  });
});

describe("Việc của tôi · hợp đồng RPC", () => {
  it("chỉ việc của chính mình, đúng hạn cùng định nghĩa Phòng tôi, quyền gọi", () => {
    expect(migration).toContain("where a.user_id = v_actor and a.ended_at is null and t.status <> 'draft'");
    expect(migration).toContain("and (x.origin <> 'oral_claim' or x.claim_status = 'confirmed')");
    expect(migration).toContain("'submit', m.live and m.accepted and m.status in ('in_progress', 'changes_requested')");
    expect(migration).toMatch(/grant execute on function public\.work_my_board_v1\(date\) to authenticated;/);
  });
});

describe("Việc của tôi · Lịch", () => {
  const now = new Date("2026-10-20T03:00:00Z");
  it("khoảng: tuần / 2 tuần / tháng luôn đủ tuần, bắt đầu thứ 2", () => {
    const w = myRangeDays("week", "2026-10-22");
    expect([w.from, w.to, w.days.length, w.label]).toEqual(["2026-10-19", "2026-10-25", 7, "Tuần 43 · 19/10–25/10"]);
    const two = myRangeDays("2weeks", "2026-10-20");
    expect([two.from, two.to, two.days.length, two.label]).toEqual(["2026-10-19", "2026-11-01", 14, "Tuần 43–44 · 19/10–01/11"]);
    const m = myRangeDays("month", "2026-10-20");
    expect([m.from, m.to, m.days.length % 7, m.label]).toEqual(["2026-09-28", "2026-11-01", 0, "Tháng 10/2026"]);
  });
  it("lùi / tiến theo đúng khoảng", () => {
    expect(myShiftAnchor("week", "2026-10-20", 1)).toBe("2026-10-27");
    expect(myShiftAnchor("2weeks", "2026-10-20", -1)).toBe("2026-10-06");
    expect(myShiftAnchor("month", "2026-10-20", 1)).toBe("2026-11-01");
    expect(myShiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
  it("ô ngày: số việc, % trung bình (xong = 100), màu đỏ trễ > cam vướng / lâu chưa cập nhật > xanh xong hết", () => {
    const late = myDay("2026-10-17", [task("a", { deadlineAt: "2026-10-17T10:00:00Z", progressPercent: 60 })], now);
    expect([late.count, late.percent, late.state]).toEqual([1, 60, "late"]);
    const warn = myDay("2026-10-24", [task("b", { deadlineAt: "2026-10-24T10:00:00Z", status: "blocked", progressPercent: 40 }),
      task("c", { deadlineAt: "2026-10-24T09:00:00Z", status: "completed", progressPercent: 100 })], now);
    expect([warn.count, warn.open, warn.percent, warn.state]).toEqual([2, 1, 70, "warn"]);
    const stale = myDay("2026-10-24", [task("s", { deadlineAt: "2026-10-24T10:00:00Z", lastProgressAt: "2026-10-17T03:00:00Z" })], now);
    expect(stale.state).toBe("warn");
    const done = myDay("2026-10-19", [task("d", { deadlineAt: "2026-10-19T10:00:00Z", status: "completed" })], now);
    expect([done.state, done.percent]).toEqual(["done", 100]);
    expect(myDay("2026-10-22", [], now)).toMatchObject({ count: 0, percent: null, state: "none" });
    expect(myDay("2026-10-24", [task("o", { deadlineAt: "2026-10-24T10:00:00Z", lastProgressAt: "2026-10-20T01:00:00Z" })], now).state).toBe("open");
  });
  it("việc chưa có hạn gom riêng (không có ô ngày)", () => {
    expect(myNoDue([task("n", {}), task("x", { status: "completed" }), task("y", { deadlineAt: "2026-10-24T10:00:00Z" })]).map((t) => t.id)).toEqual(["n"]);
  });
});

