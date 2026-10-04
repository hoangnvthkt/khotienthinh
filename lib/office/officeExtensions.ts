import type { OfficeTextDocument } from "./officeContent";
import type { OfficeSummary } from "./officeTypes";
import {
  displayDate,
  OFFICE_GROUPS,
  OFFICE_STATUSES,
} from "./officePresentation";

export const OFFICE_TEMPLATE_FIELDS: Record<string, string> = {
  document_number: "Số văn bản (điền khi cấp số)",
  document_date: "Ngày văn bản",
  document_title: "Tiêu đề",
  company_name: "Tên công ty",
  department_name: "Bộ phận ban hành",
  project_name: "Dự án",
  signer_name: "Người ký",
  signer_position: "Chức danh người ký",
};
export function officeTemplateVariables(value: OfficeTextDocument): string[] {
  return [
    ...new Set(
      [...JSON.stringify(value).matchAll(/\{\{([a-z_]+)\}\}/g)].map(
        (x) => x[1],
      ),
    ),
  ];
}
export function fillOfficeText(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (whole, name) =>
    name === "document_number" ? whole : variables[name] || whole,
  );
}
export function fillOfficeTemplate(
  value: OfficeTextDocument,
  variables: Record<string, string>,
): OfficeTextDocument {
  // Replace only text nodes, never mark URLs, IDs or structural attributes.
  return JSON.parse(JSON.stringify(value), (key, v) =>
    key === "text" && typeof v === "string" ? fillOfficeText(v, variables) : v,
  );
}
export function officeVersionChanges(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const fields = {
    title: "Tiêu đề",
    summary: "Trích yếu",
    content: "Nội dung",
    attachments: "Tệp đính kèm",
    document_date: "Ngày văn bản",
    document_number: "Số văn bản",
    status: "Trạng thái",
    issuer_department_id: "Bộ phận gửi",
    signer_user_id: "Người ký",
    recipient_specs: "Người nhận",
    workflow_id: "Tuyến duyệt",
    confidentiality: "Bảo mật",
    urgency: "Độ khẩn",
    archive_folder_id: "Thư mục",
    require_acknowledgement: "Yêu cầu xác nhận",
    expires_on: "Ngày hết hạn",
  };
  return Object.entries(fields)
    .filter(([key]) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map(([, label]) => label);
}
export function officeExportRows(items: OfficeSummary[]) {
  return items.map((d, i) => ({
    STT: i + 1,
    "Số văn bản": d.document_number || d.source_document_number || "",
    "Tiêu đề": d.title,
    "Nghiệp vụ": OFFICE_GROUPS[d.document_group].label,
    "Loại văn bản": d.type_name || "",
    "Trạng thái": OFFICE_STATUSES[d.status],
    "Ngày văn bản": displayDate(d.document_date),
    "Ngày phát hành": d.issued_at ? displayDate(d.issued_at) : "",
    "Người tạo": d.creator_name,
    "Bộ phận gửi": d.department_name || "",
    "Dự án": d.project_name || "",
    "Hạn xử lý": d.due_date ? displayDate(d.due_date) : "",
  }));
}
export async function downloadOfficeWorkbook(
  items: OfficeSummary[],
  title: string,
) {
  const XLSX = await import("xlsx");
  // json_to_sheet creates string cells (t:s) for user text, never formula cells.
  const sheet = XLSX.utils.json_to_sheet(officeExportRows(items));
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 24 },
    { wch: 65 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    { wch: 16 },
    { wch: 18 },
    { wch: 25 },
    { wch: 28 },
    { wch: 28 },
    { wch: 16 },
  ];
  if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, title.slice(0, 31));
  XLSX.writeFile(
    workbook,
    `Office-${title.replace(/[^\p{L}\p{N}-]/gu, "-")}.xlsx`,
  );
}
