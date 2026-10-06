import type {
  OfficeDraft,
  OfficeFilters,
  ProcessingStatus,
  OfficeGroup,
  OfficeStatus,
} from "./officeTypes";

export function officeFileMime(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    txt: "text/plain",
    csv: "text/csv",
  };
  return (
    byExtension[file.name.split(".").pop()?.toLowerCase() || ""] ||
    "application/octet-stream"
  );
}
export const OFFICE_GROUPS: Record<
  OfficeGroup,
  { label: string; description: string }
> = {
  ANNOUNCEMENT: {
    label: "Thông báo",
    description: "Phổ biến thông tin và theo dõi người đã đọc.",
  },
  INCOMING: {
    label: "Văn bản đến",
    description: "Tiếp nhận, phân phối và giao người xử lý.",
  },
  OUTGOING: {
    label: "Văn bản đi",
    description: "Soạn công văn gửi đối tác, khách hàng.",
  },
  INTERNAL: {
    label: "Văn bản nội bộ",
    description: "Quyết định, quy định và hồ sơ nội bộ.",
  },
};
export const OFFICE_STATUSES: Record<OfficeStatus, string> = {
  DRAFT: "Bản nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  RETURNED: "Cần chỉnh sửa",
  REJECTED: "Đã từ chối",
  APPROVED: "Đã duyệt",
  WAITING_NUMBER: "Chờ cấp số",
  ISSUED: "Đã phát hành",
  REVOKED: "Đã thu hồi",
  ARCHIVED: "Đã lưu trữ",
  EXPIRED: "Hết hiệu lực",
  CANCELLED: "Đã hủy",
};
export const OFFICE_VIEWS = {
  all: "Tất cả văn bản",
  approval: "Chờ tôi duyệt",
  numbering: "Chờ cấp số",
  assigned: "Được giao xử lý",
  created: "Tạo bởi tôi",
  unread: "Chưa đọc",
  overdue: "Quá hạn xử lý",
  following: "Đang theo dõi",
  favorites: "Yêu thích",
  archive: "Đã lưu trữ",
} as const;
export const URGENCY = {
  NORMAL: "Bình thường",
  URGENT: "Khẩn",
  VERY_URGENT: "Rất khẩn",
};
export const CONFIDENTIALITY = {
  NORMAL: "Bình thường",
  INTERNAL: "Nội bộ",
  RESTRICTED: "Hạn chế",
  CONFIDENTIAL: "Bảo mật",
};
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function displayDate(date?: string | null, time = false) {
  if (!date) return "—";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(time ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
      }).format(parsed);
}
export function processingLabel(
  status: ProcessingStatus | null,
  due?: string | null,
) {
  if (!status) return "—";
  if (status === "COMPLETED") return "Đã hoàn thành";
  if (due && due < localDate()) return "Quá hạn";
  return {
    RECEIVED: "Đã tiếp nhận",
    ASSIGNED: "Chờ nhận xử lý",
    IN_PROGRESS: "Đang xử lý",
  }[status];
}
export function normalizeOfficeFilters(filters: OfficeFilters): OfficeFilters {
  if (filters.view && !(filters.view in OFFICE_VIEWS))
    throw new Error("OFFICE_INVALID_QUERY");
  return {
    ...filters,
    search: filters.search?.trim().slice(0, 200),
    page: Math.max(0, Math.floor(filters.page || 0)),
    pageSize: Math.max(1, Math.min(50, Math.floor(filters.pageSize || 25))),
  };
}
export function newOfficeDraft(
  group: OfficeGroup = "ANNOUNCEMENT",
): OfficeDraft {
  return {
    require_acknowledgement: false,
    expires_on: null,
    effective_on: null,
    document_group: group,
    document_type_id: "",
    title: "",
    summary: "",
    content: { version: 1, type: "doc", content: [] },
    document_date: localDate(),
    received_date: group === "INCOMING" ? localDate() : null,
    due_date: null,
    issuer_department_id: null,
    signer_user_id: null,
    signer_position: null,
    project_id: null,
    construction_site_id: null,
    source_organization: null,
    source_document_number: null,
    source_sender: null,
    external_recipient: null,
    urgency: "NORMAL",
    confidentiality: "INTERNAL",
    archive_folder_id: null,
    workflow_id: null,
    recipient_specs: [],
    watcher_ids: [],
    proposed_sequence: null,
  };
}
/** Tách mẫu sổ "{sequence}/{year}/{code}-TT" thành phần trước / sau ô số. */
export function officeNumberParts(format: string, code: string, year: number) {
  const fill = (part: string) =>
    part.replaceAll("{year}", String(year)).replaceAll("{code}", code);
  const [before, after = ""] = format.split("{sequence}");
  return { prefix: fill(before), suffix: fill(after) };
}
export function editableDraft(document: OfficeDraft): OfficeDraft {
  const keys = Object.keys(newOfficeDraft()) as (keyof OfficeDraft)[];
  return Object.fromEntries(
    keys.map((key) => [key, document[key]]),
  ) as unknown as OfficeDraft;
}
export function officeError(error: unknown): string {
  const message = (error as { message?: string })?.message || "";
  const errors: Record<string, string> = {
    OFFICE_EXPORT_LIMIT:
      "Danh sách vượt 5.000 văn bản. Hãy thu hẹp khoảng ngày hoặc bộ lọc để xuất đầy đủ.",
    OFFICE_INVALID_CONTENT:
      "Nội dung hoặc định dạng không hợp lệ. Kiểm tra kích thước và định dạng văn bản.",
    OFFICE_TEMPLATE_UNFILLED:
      "Vui lòng điền đầy đủ các biến trong mẫu trước khi gửi duyệt.",
    OFFICE_TEMPLATE_IMAGE:
      "Mẫu dùng nội dung và bảng. Hãy thêm ảnh đính kèm khi soạn từng văn bản.",
    OFFICE_INVALID_EXPIRY: "Ngày hết hiệu lực phải từ ngày văn bản trở đi.",
    OFFICE_EXPIRED:
      "Văn bản đã hết hiệu lực, không thể phát hành hoặc gửi bổ sung.",
    OFFICE_AI_NOT_CONFIGURED:
      "AI/OCR chưa được cấu hình. Quản trị viên có thể thêm API key và model để kích hoạt.",
    OFFICE_AI_RATE_LIMIT:
      "Bạn đã đạt giới hạn AI. Chờ một phút để thử lại (tối đa 100 lượt/ngày).",
    OFFICE_AI_FILE_LIMIT:
      "OCR hỗ trợ PDF/ảnh tối đa 8 MB mỗi lần. Hãy chọn tệp nhỏ hơn.",
    OFFICE_AI_FAILED:
      "AI chưa trả được kết quả. Vui lòng thử lại; nội dung văn bản chưa thay đổi.",
    OFFICE_VERSION_CONFLICT:
      "Văn bản đã thay đổi ở phiên khác. Vui lòng tải lại trước khi tiếp tục.",
    OFFICE_NOT_FOUND: "Không tìm thấy văn bản hoặc bạn chưa có quyền truy cập.",
    OFFICE_DENIED:
      "Bạn chưa có quyền thực hiện thao tác này hoặc trạng thái văn bản đã thay đổi.",
    OFFICE_NUMBER_TAKEN:
      "Số văn bản đã được dùng cho văn bản khác. Mở bản nháp, chọn số trống rồi cấp số lại.",
    OFFICE_RECIPIENT_REQUIRED:
      "Chọn ít nhất một người nhận có tài khoản hoạt động.",
    OFFICE_RECIPIENT_INELIGIBLE:
      "Có người nhận chưa được cấp quyền Office hoặc quyền xem văn bản. Kiểm tra phân quyền trước khi phát hành.",
    OFFICE_CONTENT_REQUIRED:
      "Nhập nội dung hoặc tải lên ít nhất một tệp đính kèm.",
    OFFICE_INCOMING_REQUIRED:
      "Văn bản đến cần đơn vị gửi, ngày nhận và tệp gốc.",
    OFFICE_EXTERNAL_RECIPIENT_REQUIRED: "Nhập đơn vị nhận văn bản đi.",
    OFFICE_WORKFLOW_REQUIRED:
      "Chưa có tuyến duyệt phù hợp. Chọn tuyến duyệt hoặc nhờ quản trị cấu hình.",
    OFFICE_APPROVER_INELIGIBLE:
      "Có người trong tuyến duyệt chưa được cấp quyền xem và duyệt văn bản.",
    OFFICE_SELF_APPROVAL:
      "Người trình không được đồng thời là người duyệt. Chọn tuyến duyệt phù hợp.",
    OFFICE_REASON_REQUIRED: "Vui lòng nhập lý do.",
    OFFICE_UPLOAD_INCOMPLETE: "Tệp chưa tải lên đầy đủ. Hãy thử tải lại.",
    OFFICE_FILE_TYPE:
      "Định dạng tệp chưa được hỗ trợ. Chọn PDF, Word, Excel, ảnh, CSV hoặc TXT.",
    OFFICE_ATTACHMENT_LIMIT: "Mỗi văn bản có tối đa 30 tệp.",
    OFFICE_RESULT_REQUIRED:
      "Bắt đầu xử lý và nhập kết quả trước khi hoàn thành.",
    OFFICE_ACK_REQUIRED: "Xác nhận tiếp nhận trước khi bắt đầu xử lý.",
    OFFICE_ASSIGNMENT_REQUIRED: "Chọn người phụ trách, hạn và yêu cầu xử lý.",
    OFFICE_SITE_PROJECT_MISMATCH: "Công trường không thuộc dự án đã chọn.",
    OFFICE_FOLDER_CYCLE: "Thư mục cha không được nằm trong chính thư mục này.",
    OFFICE_OFFICIAL_IMMUTABLE:
      "Văn bản đã cấp số hoặc phát hành được khóa nội dung.",
    OFFICE_INVALID_WORKFLOW:
      "Tuyến duyệt không còn phù hợp với đơn vị hoặc dự án.",
    OFFICE_INVALID_TYPE: "Loại văn bản không phù hợp hoặc đã ngừng sử dụng.",
  };
  for (const [code, text] of Object.entries(errors))
    if (message.includes(code)) return text;
  if ((error as { code?: string })?.code === "23505")
    return "Mã đã được sử dụng. Kiểm tra lại trước khi lưu.";
  if (message.includes("office_query") || message.includes("schema cache"))
    return "Office chưa được kích hoạt trên môi trường này. Cần áp dụng migration và cấp quyền trước khi sử dụng.";
  return "Không thực hiện được thao tác. Kiểm tra kết nối và thử lại; dữ liệu đang nhập vẫn được giữ.";
}
