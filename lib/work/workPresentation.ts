import type { WorkScope, WorkTaskStatus } from "./workTypes";
export const workStatusLabels: Record<WorkTaskStatus, string> = {
  draft: "Bản nháp",
  pending_acknowledgement: "Chờ nhận việc",
  clarification_requested: "Cần làm rõ",
  not_started: "Chưa bắt đầu",
  in_progress: "Đang thực hiện",
  blocked: "Đang bị chặn",
  awaiting_review: "Chờ đánh giá",
  changes_requested: "Cần chỉnh sửa",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

export const workWhen = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Chưa có";

export const workScopeKindLabel = (scope: WorkScope) =>
  scope.type === "workspace"
    ? "Không gian làm việc"
    : scope.type === "department"
      ? "Phòng ban"
      : scope.type === "project"
        ? "Dự án"
        : "Giao trực tiếp";

/** Đợt 1: mức quan trọng hiển thị A / B / C (lưu bằng priority: urgent / important / normal). */
export const workLevelOf = (priority: "normal" | "important" | "urgent") =>
  priority === "urgent" ? "A" : priority === "important" ? "B" : "C";
export const workLevelLabels: Record<"normal" | "important" | "urgent", string> = {
  urgent: "A · Trọng điểm",
  important: "B · Quan trọng",
  normal: "C · Thường",
};

const DAY_MS = 86_400_000;
const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const pad = (n: number) => String(n).padStart(2, "0");
/** "T6 23/10 17:00" theo giờ máy người dùng. */
export const workDayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Nhãn hạn ngắn: quá N ngày (đỏ) · hôm nay / mai (cam) · còn N ngày. */
export function workDueInfo(deadlineAt: string | null, status: string, now: Date = new Date()):
  { text: string; tone: "over" | "soon" | "ok" | "none" } {
  if (!deadlineAt) return { text: "Chưa có hạn", tone: "none" };
  if (status === "completed" || status === "cancelled") return { text: workDayLabel(deadlineAt), tone: "ok" };
  const due = new Date(deadlineAt);
  if (due.getTime() < now.getTime()) {
    const days = Math.max(1, Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(due).getTime()) / DAY_MS));
    return { text: due.toDateString() === now.toDateString() ? "Quá hạn hôm nay" : `Quá ${days} ngày`, tone: "over" };
  }
  const days = Math.round((startOfLocalDay(due).getTime() - startOfLocalDay(now).getTime()) / DAY_MS);
  if (days === 0) return { text: `Hôm nay ${pad(due.getHours())}:${pad(due.getMinutes())}`, tone: "soon" };
  if (days === 1) return { text: "Mai", tone: "soon" };
  return { text: `Còn ${days} ngày`, tone: "ok" };
}
/** "Cập nhật 2 giờ trước" · quá 48 giờ với việc đang làm: "3 ngày chưa cập nhật" (cam). */
export function workUpdateInfo(lastProgressAt: string | null | undefined, status: string, now: Date = new Date()):
  { text: string; stale: boolean } | null {
  if (!lastProgressAt) return null;
  const hours = (now.getTime() - new Date(lastProgressAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return null;
  const active = ["not_started", "in_progress", "blocked", "changes_requested"].includes(status);
  if (active && hours > 48) return { text: `${Math.floor(hours / 24)} ngày chưa cập nhật`, stale: true };
  if (!active) return null;
  const minutes = Math.max(1, Math.round(hours * 60));
  return { text: minutes < 60 ? `Cập nhật ${minutes} phút trước` : hours < 24 ? `Cập nhật ${Math.round(hours)} giờ trước` : `Cập nhật ${Math.floor(hours / 24)} ngày trước`, stale: false };
}
