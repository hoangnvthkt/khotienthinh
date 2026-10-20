/** Vioo Work Đợt 1 (PR-1): cập nhật tiến độ có cấu trúc, Phòng tôi, Toàn công ty, Sổ chỉ đạo, việc giao miệng, dấu vết AI.
 * Mọi số liệu do RPC tính theo quyền; client chỉ kiểm sơ bộ đầu vào để báo lỗi sớm. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkPriority, WorkTaskStatus } from "./workTypes";

/** Mức quan trọng hiển thị: A Trọng điểm · B Quan trọng · C Thường (lưu bằng priority sẵn có). */
export type WorkLevel = "A" | "B" | "C";
export const WORK_LEVEL_LABELS: Record<WorkLevel, string> = { A: "Trọng điểm", B: "Quan trọng", C: "Thường" };
export const levelOfPriority = (priority: WorkPriority): WorkLevel =>
  priority === "urgent" ? "A" : priority === "important" ? "B" : "C";
export const priorityOfLevel = (level: WorkLevel): WorkPriority =>
  level === "A" ? "urgent" : level === "B" ? "important" : "normal";
/** Tải việc: A×3 + B×2 + C×1. */
export const workLoad = (levels: Record<WorkLevel, number>) => 3 * levels.A + 2 * levels.B + levels.C;

/** Việc "lâu chưa cập nhật" khi quá 48 giờ không có chuyển động (cập nhật, bắt đầu, nộp, vướng). */
export const STALE_HOURS = 48;
export function hoursSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, (now.getTime() - at) / 3_600_000);
}
export const isStale = (lastProgressAt: string | null | undefined, now: Date = new Date()) => {
  const hours = hoursSince(lastProgressAt, now);
  return hours !== null && hours > STALE_HOURS;
};

export interface WorkProgressReportInput {
  done?: string | null;
  doing?: string | null;
  next?: string | null;
  blocked?: string | null;
  progressPercent: number;
  attachmentIds?: string[];
  expectedLockVersion?: number;
  aiRunId?: string | null;
}
export type WorkProgressReportProblem = "empty" | "too_long" | "progress";
const TEXT_KEYS = ["done", "doing", "next", "blocked"] as const;
const MAX_TEXT = 2000;

/** Chuẩn hóa như máy chủ (cắt khoảng trắng, bỏ dòng rỗng); trả lỗi đầu tiên để màn hình báo ngay. */
export function normalizeProgressReport(input: WorkProgressReportInput):
  { ok: true; payload: Record<string, unknown> } | { ok: false; problem: WorkProgressReportProblem } {
  const payload: Record<string, unknown> = {};
  for (const key of TEXT_KEYS) {
    const value = (input[key] ?? "").trim();
    if (value.length > MAX_TEXT) return { ok: false, problem: "too_long" };
    if (value) payload[key] = value;
  }
  if (!TEXT_KEYS.some((key) => key in payload)) return { ok: false, problem: "empty" };
  if (!Number.isInteger(input.progressPercent) || input.progressPercent < 0 || input.progressPercent > 100) {
    return { ok: false, problem: "progress" };
  }
  payload.progressPercent = input.progressPercent;
  if (input.attachmentIds?.length) payload.attachmentIds = [...new Set(input.attachmentIds)].slice(0, 10);
  if (input.expectedLockVersion !== undefined) payload.expectedLockVersion = input.expectedLockVersion;
  if (input.aiRunId) payload.aiRunId = input.aiRunId;
  return { ok: true, payload };
}
export const PROGRESS_REPORT_PROBLEMS: Record<WorkProgressReportProblem, string> = {
  empty: "Ghi ít nhất một dòng Đã làm, Đang làm, Sẽ làm hoặc Vướng.",
  too_long: "Mỗi dòng tối đa 2.000 ký tự.",
  progress: "Tiến độ phải từ 0 đến 100%.",
};

export interface WorkProgressReportResult {
  taskId: string;
  taskLockVersion: number;
  progressPercent: number;
  status: WorkTaskStatus;
  updateId: string;
  /** Có ghi Vướng khi việc đang làm: màn hình hỏi người làm có chuyển sang "Vướng" (lệnh block) không. */
  suggestBlock: boolean;
}

export interface WorkPersonRef { id: string; name: string }
export interface WorkUnitRef { id: string; code: string | null; name: string }
export interface WorkTaskBrief {
  task: {
    id: string; code: string; title: string; status: WorkTaskStatus; level: WorkLevel; privacy: "standard" | "restricted";
    deadlineAt: string | null; plannedStartAt: string | null; progressPercent: number; labels: string[]; description: string;
    createdAt: string; completedAt: string | null; lastProgressAt: string | null; createdBy: WorkPersonRef | null; reviewer: WorkPersonRef | null;
  };
  origin: null | {
    origin: "directive" | "oral_claim"; claimStatus: "not_needed" | "pending" | "confirmed" | "rejected"; decidedAt: string | null;
    giver: WorkPersonRef | null; meeting: { id: string; title: string; heldOn: string } | null;
  };
  assignees: Array<{ userId: string; name: string; state: string; acknowledgedAt: string | null; completedAt: string | null }>;
  checklist: { done: number; total: number };
  children: { open: number; total: number };
  updates: Array<{ at: string; author: string; done?: string; doing?: string; next?: string; blocked?: string;
    progressBefore: number; progressAfter: number; files: number; ai: boolean }>;
  events: Array<{ at: string; type: string; actor: string }>;
}
export interface WorkTeamMember {
  userId: string; name: string; title: string | null; orgUnitId: string; isHead: boolean;
  active: number; levels: Record<WorkLevel, number>; load: number; overdue: number; stale: number; unack: number;
  /** Tuần trước: việc đến hạn / hoàn thành đúng hạn (việc tự ghi chưa được xác nhận không tính). */
  due: number; ontime: number;
}
export interface WorkTeamBoard {
  unit: WorkUnitRef; myUnits: WorkUnitRef[]; weekStart: string; canViewAll: boolean; reviewWaiting: number; members: WorkTeamMember[];
}
export interface WorkCompanyUnit {
  id: string; code: string | null; name: string; type: string; parent: WorkUnitRef | null; people: number; hasHead: boolean;
  active: number; overdue: number; stale: number; due: number; ontime: number;
  directives: { open: number; late: number; doneThisMonth: number }; claimsPending: number;
}
export interface WorkCompanyBoard { weekStart: string; units: WorkCompanyUnit[]; claimsWaitingMe: number }
export interface WorkAssignablePerson {
  userId: string; name: string; title: string | null; unit: WorkUnitRef | null; myTeam: boolean; sameUnit: boolean; isMe: boolean;
  canReceive: boolean; load: number; aliases: string[];
}
export interface WorkAssignablePeople { canAssignOthers: boolean; people: WorkAssignablePerson[] }
export interface WorkTaskUpdate {
  id: string; at: string; authorId: string; authorName: string; done?: string; doing?: string; next?: string; blocked?: string;
  progressBefore: number; progressAfter: number; ai: boolean;
  files: Array<{ id: string; name: string; mime: string | null; evidenceType: string | null }>;
}
export interface WorkUpdatePage { items: WorkTaskUpdate[]; nextBefore: string | null }
export type WorkAiLinkKind = "task_draft" | "meeting_tasks" | "update_draft" | "task_writer" | "task_brief" | "week_report" | "assistant";

/** Tỷ lệ đúng hạn; chưa có việc đến hạn thì null (không che bằng 0). */
export const ontimeRate = (ontime: number, due: number): number | null => (due > 0 ? Math.round((ontime / due) * 100) : null);

export function createWorkBoardService(client: Pick<SupabaseClient, "rpc">) {
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data as T;
  }
  return {
    /** Gửi cập nhật Đã / Đang / Sẽ / Vướng; cùng khóa thì máy chủ trả lại kết quả cũ (bấm hai lần không tạo hai dòng). */
    reportProgress(taskId: string, input: WorkProgressReportInput, idempotencyKey: string) {
      const normalized = normalizeProgressReport(input);
      if ("problem" in normalized) return Promise.reject(new Error(`WORK_PROGRESS_REPORT_${normalized.problem.toUpperCase()}`));
      return call<WorkProgressReportResult>("command_work_task_collaboration", {
        p_task_id: taskId, p_command: "progress_report", p_payload: normalized.payload, p_idempotency_key: idempotencyKey,
      });
    },
    taskBrief: (taskId: string) => call<WorkTaskBrief>("work_task_brief_v1", { p_task_id: taskId }),
    /** Dòng cập nhật, mới nhất trước; truyền nextBefore để xem thêm. */
    listUpdates: (taskId: string, before: string | null = null, limit = 20) =>
      call<WorkUpdatePage>("list_work_task_updates_v1", { p_task_id: taskId, p_before: before, p_limit: limit }),
    teamBoard: (orgUnitId: string | null = null, weekStart: string | null = null) =>
      call<WorkTeamBoard>("work_team_board_v1", { p_org_unit_id: orgUnitId, p_week_start: weekStart }),
    companyBoard: (weekStart: string | null = null) => call<WorkCompanyBoard>("work_company_board_v1", { p_week_start: weekStart }),
    assignablePeople: (query: string | null = null, limit = 50) =>
      call<WorkAssignablePeople>("work_assignable_people_v1", { p_query: query?.trim() || null, p_limit: limit }),
    createMeeting: (title: string, heldOn: string, orgUnitId: string | null = null) =>
      call<{ meetingId: string; title: string; heldOn: string }>("work_meeting_create_v1", { p_title: title.trim(), p_held_on: heldOn, p_org_unit_id: orgUnitId }),
    setOrigin: (taskId: string, origin: "directive" | "oral_claim", meetingId: string | null = null, giverUserId: string | null = null) =>
      call<{ taskId: string; origin: string; claimStatus: string }>("work_task_set_origin_v1", {
        p_task_id: taskId, p_origin: origin, p_meeting_id: meetingId, p_giver_user_id: giverUserId,
      }),
    decideClaim: (taskId: string, decision: "confirm" | "reject", note: string | null = null) =>
      call<{ taskId: string; claimStatus: string }>("work_task_claim_decide_v1", { p_task_id: taskId, p_decision: decision, p_note: note?.trim() || null }),
    /** Gắn lượt AI đã soạn nháp vào việc sau khi người dùng gửi thật (đánh dấu nháp được dùng). */
    linkAi: (taskId: string, runId: string, kind: WorkAiLinkKind) =>
      call<{ taskId: string; runId: string; kind: WorkAiLinkKind }>("work_ai_link_v1", { p_task_id: taskId, p_run_id: runId, p_kind: kind }),
    /** Học cách gọi người ("Hà KH") sau khi giao thật bằng nháp AI; máy chủ chỉ nhận từ người giao của việc. */
    learnPersonAlias: (taskId: string, alias: string) =>
      call<{ saved: number }>("work_learn_person_alias_v1", { p_task_id: taskId, p_alias: alias.trim() }),
  };
}
export type WorkBoardService = ReturnType<typeof createWorkBoardService>;
