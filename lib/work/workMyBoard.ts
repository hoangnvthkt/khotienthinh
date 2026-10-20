/** Việc của tôi (mockup v1, chủ SP 20/10/2026): nhóm việc theo hạn, nguồn việc, số tuần — tính trên máy từ work_my_board_v1. */
import type { WorkMyBoard, WorkMyTask } from "./workBoardService";

export type MyGroupId = "over" | "today" | "week" | "later" | "confirm";
export interface MyGroups { over: WorkMyTask[]; today: WorkMyTask[]; week: WorkMyTask[]; later: WorkMyTask[]; confirm: WorkMyTask[]; done: WorkMyTask[] }
export const MY_GROUP_LABELS: Record<MyGroupId, string> = {
  over: "Quá hạn", today: "Hôm nay", week: "Tuần này", later: "Sau tuần này", confirm: "Chờ người giao xác nhận",
};

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) của một thời điểm. */
export const vnDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
export const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Số tuần ISO (tuần bắt đầu thứ 2). */
export function isoWeek(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

const isClaimPending = (t: WorkMyTask) => t.origin?.origin === "oral_claim" && t.origin.claimStatus === "pending";
const LATE_STATES = new Set(["pending_acknowledgement", "clarification_requested", "not_started", "in_progress", "blocked", "changes_requested"]);
const LEVEL_ORDER = { A: 0, B: 1, C: 2 } as const;
const byDue = (a: WorkMyTask, b: WorkMyTask) =>
  (a.deadlineAt ? Date.parse(a.deadlineAt) : Infinity) - (b.deadlineAt ? Date.parse(b.deadlineAt) : Infinity) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];

/** Nhóm như mockup: xong (trong tuần) · chờ người giao xác nhận · quá hạn (việc còn phải làm) · hôm nay · tuần này (đến chủ nhật) · sau tuần này / chưa có hạn. */
export function myBoardGroups(tasks: WorkMyTask[], today: string, weekEnd: string, now: Date = new Date(), weekStart: string | null = null): MyGroups {
  const g: MyGroups = { over: [], today: [], week: [], later: [], confirm: [], done: [] };
  for (const t of tasks) {
    if (t.status === "completed") { if (!weekStart || (t.completedAt && vnDay(t.completedAt) >= weekStart)) g.done.push(t); }
    else if (t.status === "cancelled") continue;
    else if (isClaimPending(t)) g.confirm.push(t);
    else if (t.deadlineAt && LATE_STATES.has(t.status) && Date.parse(t.deadlineAt) < now.getTime()) g.over.push(t);
    else if (!t.deadlineAt) g.later.push(t);
    else {
      const day = vnDay(t.deadlineAt);
      (day <= today ? g.today : day <= weekEnd ? g.week : g.later).push(t);
    }
  }
  for (const list of Object.values(g)) list.sort(byDue);
  return g;
}

/** Nguồn việc trên dòng: chỉ đạo (cuộc họp) · giao trực tiếp chờ xác nhận · trưởng đơn vị giao · tự tạo · người khác giao. */
export function mySource(t: WorkMyTask, unitName: string | null = null): { kind: "directive" | "oral" | "head" | "self" | "other"; text: string } {
  if (t.origin?.origin === "directive") {
    return { kind: "directive", text: [t.origin.giver?.name || "Chỉ đạo", t.origin.meeting?.title].filter(Boolean).join(" · ") };
  }
  if (t.origin?.origin === "oral_claim") {
    return { kind: "oral", text: `${t.origin.giver?.name || "Người giao"} giao trực tiếp ${ddmm(vnDay(t.createdAt))}` };
  }
  if (t.createdByMe) return { kind: "self", text: "Tự tạo" };
  if (t.createdByHead) return { kind: "head", text: /^phòng/i.test(unitName || "") ? "Trưởng phòng giao" : "Trưởng đơn vị giao" };
  return { kind: "other", text: `${t.createdBy?.name || "Người khác"} giao` };
}

/** Đúng hạn tuần gần nhất + chênh so với tuần trước nữa; chưa có việc đến hạn thì null (không che bằng 0). */
export function myOntime(weeks: WorkMyBoard["weeks"]) {
  const rate = (w?: { due: number; ontime: number }) => (w && w.due > 0 ? Math.round((w.ontime / w.due) * 100) : null);
  const last = weeks[0];
  const now = rate(last); const prev = rate(weeks[1]);
  return { week: last ? isoWeek(last.weekStart) : null, rate: now, ontime: last?.ontime ?? 0, due: last?.due ?? 0,
    delta: now != null && prev != null ? now - prev : null, prevWeek: weeks[1] ? isoWeek(weeks[1].weekStart) : null,
    trend: [...weeks].reverse().map(rate) };
}

/** 7 ngày của tuần (thứ 2 → chủ nhật) + việc đến hạn từng ngày. */
export function myWeekDays(weekStart: string, tasks: WorkMyTask[]) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    return { day, label: i === 6 ? "CN" : `T${i + 2}`, date: Number(day.slice(8, 10)),
      tasks: tasks.filter((t) => t.deadlineAt && vnDay(t.deadlineAt) === day && t.status !== "cancelled") };
  });
}

/** "Tuần 43 · 19–25/10". */
export const myWeekLabel = (b: Pick<WorkMyBoard, "weekStart" | "weekEnd">) =>
  `Tuần ${isoWeek(b.weekStart)} · ${b.weekStart.slice(8, 10)}–${ddmm(b.weekEnd)}`;
export const saturdayOf = (weekStart: string) => addDays(weekStart, 5);

// ── Lịch (chủ SP 20/10: nhìn lướt bằng màu, số, %; bấm ngày ra danh sách gọn) ─────────────────────────────────
export type MyRange = "week" | "2weeks" | "month";
export const MY_RANGE_LABELS: Record<MyRange, string> = { week: "Tuần", "2weeks": "2 tuần", month: "Tháng" };
const mondayOfDay = (day: string) => { const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(day, -dow); };
/** Các ngày hiển thị (luôn đủ tuần, thứ 2 → chủ nhật) quanh ngày neo; tháng thì từ thứ 2 trước ngày 1 đến chủ nhật sau ngày cuối. */
export function myRangeDays(range: MyRange, anchor: string): { days: string[]; from: string; to: string; label: string } {
  let from: string; let to: string; let label: string;
  if (range === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0)).toISOString().slice(0, 10);
    from = mondayOfDay(first); to = addDays(mondayOfDay(last), 6);
    label = `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;
  } else {
    from = mondayOfDay(anchor); to = addDays(from, range === "week" ? 6 : 13);
    label = range === "week" ? `Tuần ${isoWeek(from)} · ${from.slice(8, 10)}/${from.slice(5, 7)}–${ddmm(to)}` : `Tuần ${isoWeek(from)}–${isoWeek(to)} · ${ddmm(from)}–${ddmm(to)}`;
  }
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { days, from, to, label };
}
/** Neo của khoảng trước / sau. */
export function myShiftAnchor(range: MyRange, anchor: string, dir: -1 | 1) {
  if (range === "month") {
    const y = Number(anchor.slice(0, 4)); const m = Number(anchor.slice(5, 7)) - 1 + dir;
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return addDays(anchor, dir * (range === "week" ? 7 : 14));
}

export type MyDayState = "none" | "late" | "warn" | "done" | "open";
export interface MyDay { day: string; tasks: WorkMyTask[]; count: number; open: number; percent: number | null; state: MyDayState; levels: Array<"A" | "B" | "C"> }
const STALE_MS = 48 * 3_600_000;
/** Ô ngày: việc đến hạn hôm đó, % trung bình (việc xong = 100), màu: đỏ có việc trễ · cam có việc vướng / lâu chưa cập nhật · xanh xong hết. */
export function myDay(day: string, tasks: WorkMyTask[], now: Date = new Date()): MyDay {
  const list = tasks.filter((t) => t.deadlineAt && t.status !== "cancelled" && vnDay(t.deadlineAt) === day).sort(byDue);
  const open = list.filter((t) => t.status !== "completed");
  const late = open.some((t) => LATE_STATES.has(t.status) && Date.parse(t.deadlineAt!) < now.getTime());
  const warn = open.some((t) => t.status === "blocked" || (["not_started", "in_progress", "changes_requested"].includes(t.status)
    && t.lastProgressAt != null && now.getTime() - Date.parse(t.lastProgressAt) > STALE_MS));
  const percent = list.length ? Math.round(list.reduce((n, t) => n + (t.status === "completed" ? 100 : t.progressPercent), 0) / list.length) : null;
  return { day, tasks: list, count: list.length, open: open.length, percent,
    state: !list.length ? "none" : late ? "late" : warn ? "warn" : open.length ? "open" : "done", levels: list.map((t) => t.level) };
}
/** Việc chưa có hạn (không có ô ngày) — gom thành một nút. */
export const myNoDue = (tasks: WorkMyTask[]) => tasks.filter((t) => !t.deadlineAt && t.status !== "completed" && t.status !== "cancelled");

