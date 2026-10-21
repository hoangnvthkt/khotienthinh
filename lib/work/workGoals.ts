/** Vioo Work Đợt 2 PR-6: chốt kỳ (lưu số cố định, mở lại có lý do), mục tiêu tháng / quý 4 phần, lịch chốt mặc định.
 * Mọi số liệu và quyền do RPC tính; tệp này chỉ gọi RPC và dựng chữ / dữ liệu gửi AI trên máy. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkCompanyBoard, WorkDirective, WorkLevel, WorkTeamBoard, WorkUnitRef } from "./workBoardService";
import { ontimeRate } from "./workBoardService";
import { ddmm } from "./workMyBoard";
import { addDays, daysBetween } from "./workPeriod";

export type WorkCadence = "week" | "2weeks" | "month";
export interface WorkPeriodSetting {
  orgUnitId: string | null; cadence: WorkCadence; closeDow: number; closeTime: string; reportDow: number; reportTime: string;
  updatedAt: string | null; updatedBy: string | null; unit?: WorkUnitRef;
}
export interface WorkReopenEvent { closeId: string; at: string; actor: string; reason: string | null; unit: WorkUnitRef | null; from: string; to: string; label: string }
export interface WorkPeriodSettings {
  company: WorkPeriodSetting; overrides: WorkPeriodSetting[]; canEditCompany: boolean; editableUnits: WorkUnitRef[]; reopens: WorkReopenEvent[];
}
export interface WorkCloseHistory { closeId: string; action: "close" | "reopen"; at: string; actor: string; reason: string | null }
export interface WorkPeriodStatus {
  orgUnitId: string | null; setting: WorkPeriodSetting; settingSource: "unit" | "parent" | "company"; canClose: boolean;
  close: null | { id: string; from: string; to: string; label: string; note: string | null; closedAt: string; closedBy: string };
  history: WorkCloseHistory[];
}
export type WorkGoalStatus = "met" | "missed" | "at_risk" | "on_track" | "unknown";
export interface WorkGoal {
  id: string; orgUnitId: string | null; unit: WorkUnitRef | null; periodKind: "month" | "quarter"; periodStart: string; periodEnd: string; label: string;
  parentGoalId: string | null; title: string; criteria: string | null; targetValue: number | null; measure: string | null; higherIsBetter: boolean;
  actualValue: number | null; owner: { id: string; name: string } | null; assessment: string | null; solution: string | null; lockVersion: number; updatedAt: string;
  tasks: { total: number; done: number; ontime: number; late: number; overdue: number };
  achievedPercent: number | null; status: WorkGoalStatus;
}
export interface WorkGoalList { canEdit: boolean; goals: WorkGoal[] }
export interface WorkGoalInput {
  id?: string | null; orgUnitId?: string | null; periodKind?: "month" | "quarter"; periodStart?: string; parentGoalId?: string | null;
  title: string; criteria?: string | null; targetValue?: number | null; measure?: string | null; higherIsBetter?: boolean; actualValue?: number | null;
  ownerUserId?: string | null; assessment?: string | null; solution?: string | null; expectedLockVersion?: number;
}
export interface WorkGoalTask {
  id: string; code: string | null; title: string; status: string; level: WorkLevel; deadlineAt: string | null; progressPercent: number;
  completedAt: string | null; ontime: boolean | null; overdue: boolean; lastProgressAt: string | null; assignees: Array<{ userId: string; name: string }>; restricted: boolean;
}
export interface WorkGoalReview { goalId: string; actualValue: number | null; assessment: string | null; solution: string | null }
export interface WorkCloseSnapshot {
  version: number; scope: { orgUnitId: string | null; code: string | null; name: string | null }; from: string; to: string; label: string;
  prevFrom: string | null; prevTo: string | null; board: WorkTeamBoard | WorkCompanyBoard; directives: WorkDirective[]; goals: WorkGoal[];
  note: string | null; closedAt: string; closedBy: { id: string; name: string };
}
export interface WorkPeriodCloseDetail {
  id: string; orgUnitId: string | null; from: string; to: string; label: string; status: "closed" | "reopened"; note: string | null;
  closedAt: string; closedBy: string; reopenedAt: string | null; reopenedBy: string | null; reopenReason: string | null;
  snapshot: WorkCloseSnapshot; history: WorkCloseHistory[];
}

export function createWorkGoalService(client: Pick<SupabaseClient, "rpc">) {
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data as T;
  }
  return {
    settings: () => call<WorkPeriodSettings>("work_period_settings_v1", {}),
    saveSetting: (orgUnitId: string | null, s: Pick<WorkPeriodSetting, "cadence" | "closeDow" | "closeTime" | "reportDow" | "reportTime">) =>
      call<WorkPeriodSetting>("work_period_settings_save_v1", { p_org_unit_id: orgUnitId, p_cadence: s.cadence, p_close_dow: s.closeDow,
        p_close_time: s.closeTime, p_report_dow: s.reportDow, p_report_time: s.reportTime }),
    resetSetting: (orgUnitId: string) => call<WorkPeriodSetting>("work_period_settings_reset_v1", { p_org_unit_id: orgUnitId }),
    status: (orgUnitId: string | null, from: string, to: string) =>
      call<WorkPeriodStatus>("work_period_status_v1", { p_org_unit_id: orgUnitId, p_from: from, p_to: to }),
    close: (input: { orgUnitId: string | null; from: string; to: string; prevFrom: string | null; prevTo: string | null; label: string;
      note: string | null; reviews: WorkGoalReview[]; aiRunId: string | null }) =>
      call<{ closeId: string; closedAt: string }>("work_period_close_v1", { p_org_unit_id: input.orgUnitId, p_from: input.from, p_to: input.to,
        p_prev_from: input.prevFrom, p_prev_to: input.prevTo, p_label: input.label, p_note: input.note?.trim() || null,
        p_goal_reviews: input.reviews, p_ai_run_id: input.aiRunId }),
    reopen: (closeId: string, reason: string) => call<{ closeId: string; status: "reopened" }>("work_period_reopen_v1", { p_close_id: closeId, p_reason: reason.trim() }),
    closeDetail: (closeId: string) => call<WorkPeriodCloseDetail>("work_period_close_get_v1", { p_close_id: closeId }),
    goals: (orgUnitId: string | null, from: string, to: string) => call<WorkGoalList>("work_goals_v1", { p_org_unit_id: orgUnitId, p_from: from, p_to: to }),
    saveGoal: (goal: WorkGoalInput) => call<WorkGoal>("work_goal_save_v1", { p_goal: goal }),
    splitGoal: (goalId: string) => call<{ goals: WorkGoal[] }>("work_goal_split_v1", { p_goal_id: goalId }),
    deleteGoal: (goalId: string, lockVersion: number) => call<{ id: string }>("work_goal_delete_v1", { p_goal_id: goalId, p_expected_lock_version: lockVersion }),
    setGoalTasks: (goalId: string, add: string[], remove: string[] = []) =>
      call<{ total: number }>("work_goal_tasks_set_v1", { p_goal_id: goalId, p_add: add, p_remove: remove }),
    goalTasks: (goalId: string) => call<{ items: WorkGoalTask[] }>("work_goal_tasks_v1", { p_goal_id: goalId }),
  };
}
export type WorkGoalService = ReturnType<typeof createWorkGoalService>;

// ── Chữ hiển thị ───────────────────────────────────────────────────────────────────────────────────
export const DOW_LABELS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
export const DOW_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export const CADENCE_LABELS: Record<WorkCadence, string> = { week: "Hằng tuần", "2weeks": "2 tuần", month: "Hằng tháng" };
export const GOAL_STATUS: Record<WorkGoalStatus, { label: string; tone: string }> = {
  met: { label: "Đạt", tone: "ok" }, missed: { label: "Chưa đạt", tone: "rose" }, at_risk: { label: "Có rủi ro", tone: "amber" },
  on_track: { label: "Đúng tiến độ", tone: "sky" }, unknown: { label: "Chưa có số", tone: "muted" },
};
/** "Thứ 7 · 17:00 hằng tuần". */
export const settingLabel = (s: Pick<WorkPeriodSetting, "cadence" | "closeDow" | "closeTime">) =>
  `${DOW_LABELS[s.closeDow]} · ${s.closeTime} ${s.cadence === "week" ? "hằng tuần" : s.cadence === "2weeks" ? "2 tuần một lần" : "cuối tháng"}`;

/** Số kiểu Việt: 1.234,5 (bỏ số lẻ thừa). */
export function formatGoalValue(v: number | null, measure: string | null = null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(v);
  return measure ? (measure === "%" ? `${n}%` : `${n} ${measure}`) : n;
}
/** Đọc số người dùng gõ: "1.234,5" / "1234.5" / "5 tỷ" → số; rỗng → null; sai → NaN. */
export function parseGoalNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, "").replace(/[^\d.,-]/g, "");
  if (!raw.trim()) return null;
  if (!t || t === "-") return Number.NaN;
  let s = t;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Mục tiêu quý kèm tháng con; tháng không có cha đứng riêng. Giữ thứ tự máy chủ. */
export function goalTree(goals: WorkGoal[]): Array<{ goal: WorkGoal; children: WorkGoal[] }> {
  const ids = new Set(goals.map((g) => g.id));
  return goals.filter((g) => !g.parentGoalId || !ids.has(g.parentGoalId))
    .map((goal) => ({ goal, children: goals.filter((c) => c.parentGoalId === goal.id) }));
}
export function goalCounts(goals: WorkGoal[]) {
  const c: Record<WorkGoalStatus, number> = { met: 0, missed: 0, at_risk: 0, on_track: 0, unknown: 0 };
  for (const g of goals) c[g.status] += 1;
  return c;
}

// ── Kỳ của mục tiêu ────────────────────────────────────────────────────────────────────────────────
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const quarterStart = (d: string) => `${d.slice(0, 5)}${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
const nextMonth = (d: string) => monthStart(addDays(monthStart(d), 32));
export const goalPeriodLabel = (kind: "month" | "quarter", start: string) => kind === "month"
  ? `Tháng ${Number(start.slice(5, 7))}/${start.slice(0, 4)}` : `Quý ${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1}/${start.slice(0, 4)}`;
/** Lựa chọn kỳ khi thêm mục tiêu: tháng / quý chứa kỳ đang xem và tháng / quý kế tiếp. */
export function goalPeriodOptions(from: string): Array<{ kind: "month" | "quarter"; start: string; label: string }> {
  const m = monthStart(from); const q = quarterStart(from);
  const nq = quarterStart(addDays(q, 100));
  return [
    { kind: "month" as const, start: m }, { kind: "month" as const, start: nextMonth(m) },
    { kind: "quarter" as const, start: q }, { kind: "quarter" as const, start: nq },
  ].map((o) => ({ ...o, label: goalPeriodLabel(o.kind, o.start) }));
}

/** Hạn chốt của kỳ theo lịch: ngày cuối cùng trong kỳ đúng thứ chốt (không có thì ngày cuối kỳ) + giờ chốt. */
export function closeDueOf(setting: Pick<WorkPeriodSetting, "closeDow" | "closeTime">, from: string, to: string): { day: string; time: string } {
  for (let d = to; d >= from; d = addDays(d, -1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === setting.closeDow) return { day: d, time: setting.closeTime };
    if (daysBetween(d, to) > 31) break;
  }
  return { day: to, time: setting.closeTime };
}
export const closeDueLabel = (due: { day: string; time: string }) => `${DOW_SHORT[new Date(`${due.day}T00:00:00Z`).getUTCDay()]} ${ddmm(due.day)} ${due.time}`;

/** Khóa ngắn gửi AI thay cho id mục tiêu (uuid có thể bị cổng che như số CCCD); màn hình đổi ngược theo thứ tự. */
export const reviewKey = (i: number) => `M${i + 1}`;
// ── Dữ liệu gửi AI soạn Đánh giá + Giải pháp ───────────────────────────────────────────────────────
const pct = (n: number | null) => (n == null ? "chưa có số" : `${n}%`);
/** Các dòng số liệu do máy tính sẵn (AI chỉ diễn đạt, không tính lại). */
export function periodReviewFacts(input: {
  scopeName: string; label: string; board: { due: number; ontime: number; overdue: number; stale?: number; prevRate?: number | null };
  directives?: { open: number; late: number; done: number } | null; goals: WorkGoal[];
  lateTasks?: Array<{ title: string; people: string; deadline: string | null }>;
}): string {
  const rate = ontimeRate(input.board.ontime, input.board.due);
  const lines = [
    `Đơn vị: ${input.scopeName} · Kỳ: ${input.label}`,
    `Đúng hạn: ${pct(rate)} (${input.board.ontime}/${input.board.due} việc đến hạn)${input.board.prevRate != null ? ` · kỳ trước ${input.board.prevRate}%` : ""}`,
    `Quá hạn đang mở: ${input.board.overdue} việc${input.board.stale ? ` · lâu chưa cập nhật: ${input.board.stale}` : ""}`,
  ];
  if (input.directives) lines.push(`Chỉ đạo BLĐ: ${input.directives.done} xong, ${input.directives.open} đang mở, ${input.directives.late} trễ`);
  if (!input.goals.length) lines.push("Mục tiêu: không có mục tiêu trong kỳ");
  input.goals.forEach((g, i) => {
    lines.push([`Mục tiêu [${reviewKey(i)}] ${g.title} (${g.label})`,
      g.targetValue != null ? `chỉ tiêu ${formatGoalValue(g.targetValue, g.measure)}${g.higherIsBetter ? "" : " (càng thấp càng tốt)"}` : "không có chỉ tiêu số",
      g.actualValue != null ? `thực tế ${formatGoalValue(g.actualValue, g.measure)}` : "chưa nhập thực tế",
      `đạt ${pct(g.achievedPercent)}`,
      `việc ${g.tasks.done}/${g.tasks.total} xong, ${g.tasks.ontime} đúng hạn, ${g.tasks.late} trễ, ${g.tasks.overdue} đang quá hạn`,
      `trạng thái máy tính: ${GOAL_STATUS[g.status].label}`,
      g.owner ? `phụ trách ${g.owner.name}` : null].filter(Boolean).join(" · "));
  });
  for (const t of (input.lateTasks || []).slice(0, 12)) lines.push(`Việc trễ: ${t.title} · ${t.people || "chưa rõ người"}${t.deadline ? ` · hạn ${t.deadline}` : ""}`);
  return lines.join("\n");
}

// ── Trạng thái tính trên máy (giống máy chủ) khi người chốt sửa số thực tế trong form ──────────────────
export function achievedOf(target: number | null, actual: number | null, higherIsBetter: boolean): number | null {
  if (target == null || actual == null) return null;
  if (higherIsBetter) return target === 0 ? null : Math.round((actual / target) * 100);
  if (actual <= 0) return 100;
  return target === 0 ? null : Math.round((target / actual) * 100);
}
export function goalStatusOf(g: Pick<WorkGoal, "targetValue" | "higherIsBetter" | "periodEnd" | "tasks">, actual: number | null, today: string): WorkGoalStatus {
  const a = achievedOf(g.targetValue, actual, g.higherIsBetter);
  if (g.periodEnd < today) {
    if (a != null) return a >= 100 ? "met" : "missed";
    if (!g.tasks.total) return "unknown";
    return g.tasks.done === g.tasks.total && g.tasks.late === 0 ? "met" : "missed";
  }
  if (g.tasks.overdue > 0 || g.tasks.late > 0) return "at_risk";
  return a != null && a >= 100 ? "met" : "on_track";
}
