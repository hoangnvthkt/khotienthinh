import type {
  CreateWorkTaskInput,
  WorkScope,
  WorkTextDocument,
} from "./workTypes";
export const workDocument = (text: string): WorkTextDocument => ({
  version: 1,
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }],
  })),
});
export const documentText = (doc: WorkTextDocument) =>
  doc.content.map((p) => p.content.map((t) => t.text).join("")).join("\n");
export const scopeKey = (scope: WorkScope) =>
  scope.type === "direct"
    ? "direct"
    : scope.type === "department"
      ? `department:${scope.departmentId}`
      : `project:${scope.projectId}`;
export const scopeFromKey = (key: string): WorkScope =>
  key === "direct"
    ? { type: "direct" }
    : key.startsWith("department:")
      ? { type: "department", departmentId: key.slice(11) }
      : { type: "project", projectId: key.slice(8) };
export function localDeadline(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function deadlineShortcut(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return localDeadline(date.toISOString());
}
export const emptyWorkDraft = (scope: WorkScope): CreateWorkTaskInput => ({
  title: "",
  description: workDocument(""),
  scope,
  recipientSources: [],
  watcherUserIds: [],
  priority: "normal",
  privacy: "standard",
  labels: [],
  checklist: [],
});
export function workError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  const messages: Record<string, string> = {
    WORK_RECIPIENT_PREVIEW_STALE:
      "Danh sách người nhận đã thay đổi. Hãy kiểm tra lại trước khi tạo.",
    WORK_CALENDAR_NOT_CONFIGURED:
      "Chưa có lịch làm việc phù hợp. Vui lòng liên hệ người quản lý cấu hình.",
    WORK_NO_VALID_RECIPIENTS: "Cần ít nhất một người nhận hợp lệ.",
    WORK_TASK_NOT_FOUND:
      "Công việc không tồn tại hoặc bạn không còn quyền xem.",
    WORK_ACCESS_DENIED: "Bạn không còn quyền truy cập Vioo Work.",
    WORK_REVIEW_POLICY_DENIED:
      "Chính sách đánh giá chưa phù hợp với quyền của bạn.",
    WORK_REVIEWER_INELIGIBLE: "Người đánh giá không còn đủ điều kiện.",
    WORK_WATCHER_INELIGIBLE: "Người theo dõi không còn đủ điều kiện.",
    WORK_DEADLINE_EXPIRED: "Deadline cần nằm trong tương lai.",
    WORK_INVALID_FILE:
      "Tệp không hợp lệ hoặc ảnh vượt giới hạn 4 megapixel. Hãy chọn tệp khác.",
    WORK_ATTACHMENT_EXPIRED:
      "Phiên tải đã kết thúc. Hãy tải lại từ đầu hoặc chọn tệp khác.",
    WORK_ATTACHMENT_BUSY: "Tệp đang được xử lý. Vui lòng thử lại sau ít phút.",
    WORK_INVALID_REVIEWER:
      "Người đánh giá chưa đủ điều kiện. Hãy kiểm tra chính sách đánh giá.",
    WORK_CREATE_DENIED: "Bạn không có quyền tạo việc trong phạm vi này.",
    WORK_ATTACHMENT_TOO_LARGE: "Tệp vượt quá dung lượng cho phép.",
    WORK_INVALID_ATTACHMENT: "Tên hoặc định dạng tệp chưa được hỗ trợ.",
  };
  return messages[code] || "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
}
/** A lost response keeps the exact payload/key; changing fields must never retry a
 * different task under the same key or create a second task under a new key. */
export class WorkCreateAttempt {
  readonly key = crypto.randomUUID();
  readonly input: CreateWorkTaskInput;
  constructor(
    input: CreateWorkTaskInput,
    readonly fingerprint: string,
  ) {
    this.input = structuredClone(input);
  }
}
export const knownWorkRejection = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  /^WORK_/.test(String(error.message)) &&
  ![
    "WORK_IDEMPOTENCY_CONFLICT",
    "WORK_ACCESS_DENIED",
    "WORK_TASK_NOT_FOUND",
  ].includes(String(error.message));
