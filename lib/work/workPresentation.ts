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
