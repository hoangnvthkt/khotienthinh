import type {
  CreateWorkTaskInput,
  WorkScope,
  WorkTextDocument,
} from "./workTypes";
import {
  WorkspaceScopeValidationError,
  validateWorkspaceScope,
  type WorkspaceScope,
} from "./workWorkspaceTypes";
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
const validatedWorkScope = (scope: unknown): WorkScope =>
  validateWorkspaceScope(scope) as WorkScope;

/** Convert the scope used by the drawer and URL state to a stable key. */
export const scopeToKey = (scope: WorkScope): string => {
  const value = validatedWorkScope(scope) as WorkspaceScope;
  switch (value.type) {
    case "direct":
      return "direct";
    case "department":
      if (value.departmentId.includes(":"))
        throw new WorkspaceScopeValidationError(
          "WORK_SCOPE_INVALID_FIELD",
          "departmentId must be a single key segment",
        );
      return `department:${value.departmentId}`;
    case "project":
      return `project:${value.projectId}`;
    case "workspace":
      if (value.workspaceId.includes(":"))
        throw new WorkspaceScopeValidationError(
          "WORK_SCOPE_INVALID_FIELD",
          "workspaceId must be a single key segment",
        );
      return `workspace:${value.workspaceId}`;
  }
};

/** Backwards-compatible name used by the existing Work drawer. */
export const scopeKey = scopeToKey;

/**
 * Parse a scope key without guessing unknown values as project scopes.
 * Project IDs may contain further colons, so only the first separator is
 * significant. The resulting object still passes the strict WS1 parser.
 */
export const scopeFromKey = (key: unknown): WorkScope => {
  if (typeof key !== "string")
    return validatedWorkScope(key);
  if (key === "direct") return validatedWorkScope({ type: "direct" });

  const separator = key.indexOf(":");
  if (separator <= 0)
    return validatedWorkScope({ type: key, id: "" });

  const type = key.slice(0, separator);
  const id = key.slice(separator + 1);
  switch (type) {
    case "department":
      if (id.includes(":"))
        throw new WorkspaceScopeValidationError(
          "WORK_SCOPE_INVALID_FIELD",
          "departmentId must be a single key segment",
        );
      return validatedWorkScope({ type, departmentId: id });
    case "project":
      return validatedWorkScope({ type, projectId: id });
    case "workspace":
      if (id.includes(":"))
        throw new WorkspaceScopeValidationError(
          "WORK_SCOPE_INVALID_FIELD",
          "workspaceId must be a single key segment",
        );
      return validatedWorkScope({ type, workspaceId: id });
    default:
      return validatedWorkScope({ type, id });
  }
};
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
  scope: validatedWorkScope(scope),
  recipientSources: [],
  watcherUserIds: [],
  priority: "normal",
  privacy: "standard",
  labels: [],
  checklist: [],
});
export function workError(error: unknown): string {
  const rawCode = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  const rawMessage = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
  const code = rawCode.match(/(?:^|[^A-Z0-9_])(WORK_[A-Z0-9_]+)/)?.[1]
    || rawMessage.match(/(?:^|[^A-Z0-9_])(WORK_[A-Z0-9_]+)/)?.[1]
    || rawMessage;
  const messages: Record<string, string> = {
    WORK_CONFIGURE_DENIED: "Bạn không có quyền cấu hình phạm vi hoặc lịch này.",
    WORK_INVALID_CONFIGURATION:
      "Cấu hình chưa hợp lệ. Kiểm tra tên, ngày, thời lượng và các trường bắt buộc.",
    WORK_INVALID_INTERVALS:
      "Các ca giờ phải đúng định dạng, tăng dần và không chồng lấn.",
    WORK_POLICY_OVERLAP:
      "Đã có chính sách cùng phạm vi và mức độ trùng thời gian hiệu lực.",
    WORK_DEFAULT_CALENDAR_EXISTS:
      "Đã có lịch mặc định đang hoạt động. Bỏ đánh dấu lịch cũ trước khi chọn lịch này.",
    WORK_CALENDAR_IN_USE:
      "Lịch đang được chính sách SLA sử dụng. Cập nhật chính sách trước khi ngừng lịch.",
    WORK_CONFIGURATION_NOT_FOUND:
      "Không tìm thấy bản cấu hình hoặc bạn không có quyền truy cập.",

    WORK_UPLOADS_PENDING:
      "Còn tệp chưa tải xong. Tải xong hoặc bỏ tệp chờ trước khi nộp kết quả.",
    WORK_VERSION_CONFLICT:
      "Dữ liệu đã được cập nhật ở nơi khác. Tải bản mới, kiểm tra lại rồi xác nhận thao tác.",
    WORK_COMMAND_DENIED:
      "Thao tác không còn phù hợp với quyền hoặc trạng thái hiện tại.",
    WORK_UNRESOLVED_COMMAND:
      "Có yêu cầu chưa rõ kết quả. Hãy thử lại yêu cầu đó trước.",
    WORK_TASK_TERMINAL:
      "Công việc đã kết thúc. Hãy tải lại để xem trạng thái mới.",
    WORK_REASON_REQUIRED: "Vui lòng nhập lý do.",
    WORK_RECIPIENT_INELIGIBLE:
      "Người nhận không còn đủ điều kiện. Hãy chọn lại.",
    WORK_RESTRICTED_RECIPIENT_DENIED:
      "Người nhận chưa có quyền xem công việc hạn chế này.",
    WORK_ASSIGNEE_ALREADY_ACTIVE:
      "Người này đã là người nhận việc. Hãy tải lại danh sách.",
    WORK_MENTION_INELIGIBLE:
      "Người được nhắc tên không còn quyền xem. Hãy bỏ lựa chọn và thử lại.",
    WORK_COMMENT_NOT_FOUND:
      "Bình luận không tồn tại trong công việc này hoặc bạn không có quyền xem.",
    WORK_COMMENT_EDIT_DENIED: "Bạn không còn quyền sửa bình luận này.",
    WORK_CHECKLIST_ASSIGNEE_INELIGIBLE:
      "Người phụ trách checklist không còn đủ điều kiện.",
    WORK_RECIPIENT_PREVIEW_STALE:
      "Danh sách người nhận đã thay đổi. Hãy kiểm tra lại trước khi tạo.",
    WORK_CALENDAR_NOT_CONFIGURED:
      "Chưa có lịch làm việc phù hợp. Vui lòng liên hệ người quản lý cấu hình.",
    WORK_NO_VALID_RECIPIENTS: "Cần ít nhất một người nhận hợp lệ.",
    WORK_TASK_NOT_FOUND:
      "Công việc không tồn tại hoặc bạn không còn quyền xem.",
    WORK_ACCESS_DENIED: "Bạn không còn quyền truy cập Vioo Work.",
    WORK_WORKSPACE_NOT_FOUND:
      "Không gian làm việc không tồn tại hoặc bạn không còn là thành viên.",
    WORK_WORKSPACE_ARCHIVED:
      "Không gian đã lưu trữ và hiện chỉ cho phép xem.",
    WORK_MEMBERSHIP_PREVIEW_STALE:
      "Thành viên hoặc trách nhiệm đã thay đổi. Hãy tải lại danh sách rồi xem trước lần nữa.",
    WORK_LAST_ADMIN:
      "Workspace cần ít nhất một quản trị viên đang hoạt động.",
    WORK_MEMBER_OPEN_ASSIGNMENTS:
      "Thành viên còn việc đang nhận hoặc đang duyệt. Hãy bàn giao trước khi gỡ.",
    WORK_MEMBER_ALREADY_ACTIVE:
      "Người này đã là thành viên. Hãy tải lại danh sách.",
    WORK_MEMBER_USER_INACTIVE:
      "Tài khoản người được chọn không còn hoạt động.",
    WORK_WORKSPACE_ADMIN_REQUIRED:
      "Chỉ quản trị viên Workspace mới được thực hiện thao tác này.",
    WORK_WORKSPACE_SOURCE_EXISTS:
      "Nguồn này đã có Workspace. Hãy mở Workspace hiện có.",
    WORK_WORKSPACE_CREATE_DENIED:
      "Bạn không có quyền tạo Workspace từ nguồn đã chọn.",
    WORK_SOURCE_VIEW_DENIED:
      "Bạn không còn quyền xem phòng ban hoặc dự án nguồn.",
    WORK_SOURCE_NOT_ACTIVE:
      "Phòng ban hoặc dự án nguồn không còn hoạt động.",
    WORK_SOURCE_PERSON_INELIGIBLE:
      "Nhân sự đã chọn không còn thuộc nguồn hoặc chưa đủ điều kiện.",
    WORK_SOURCE_REFERENCE_MISMATCH:
      "Nguồn thành viên đã thay đổi. Hãy tải lại gợi ý rồi xem trước lần nữa.",
    WORK_WORKSPACE_OPEN_TASKS:
      "Workspace còn công việc đang mở. Hoàn tất hoặc di chuyển các việc này trước khi lưu trữ.",
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
