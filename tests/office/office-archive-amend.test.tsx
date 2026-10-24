import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it } from "vitest";
import {
  OfficeAmendForm,
  changedAmendFields,
} from "../../pages/office/OfficeAmend";
import {
  OFFICE_ARCHIVE_STATUSES,
  OFFICE_VIEWS,
  isArchivedOfficeStatus,
  officeArchivedAt,
  officeError,
} from "../../lib/office/officePresentation";
import type { OfficeCatalog, OfficeDetail } from "../../lib/office/officeTypes";
import type { OfficeService } from "../../lib/office/officeService";

const catalog = { folders: [], types: [], rules: [], workflows: [] } as unknown as OfficeCatalog;
describe("Kho lưu trữ Office", () => {
  it("coi hủy, thu hồi, từ chối, hết hiệu lực và lưu trữ là không còn hiệu lực", () => {
    for (const status of OFFICE_ARCHIVE_STATUSES)
      expect(isArchivedOfficeStatus(status)).toBe(true);
    for (const status of ["DRAFT", "ISSUED", "PENDING_APPROVAL", "APPROVED"] as const)
      expect(isArchivedOfficeStatus(status)).toBe(false);
  });
  it("lấy đúng mốc văn bản rời danh sách đang dùng theo từng trạng thái", () => {
    expect(
      officeArchivedAt({
        status: "ARCHIVED",
        archived_at: "2026-10-20T03:00:00Z",
        updated_at: "2026-10-24T03:00:00Z",
      }),
    ).toBe("2026-10-20T03:00:00Z");
    expect(
      officeArchivedAt({ status: "REVOKED", revoked_at: "2026-10-21T03:00:00Z" }),
    ).toBe("2026-10-21T03:00:00Z");
    expect(officeArchivedAt({ status: "EXPIRED", expires_on: "2026-09-30" })).toBe(
      "2026-09-30",
    );
    // Văn bản hủy không có mốc riêng nên dùng lần cập nhật gần nhất, không bịa ngày.
    expect(
      officeArchivedAt({ status: "CANCELLED", updated_at: "2026-10-22T03:00:00Z" }),
    ).toBe("2026-10-22T03:00:00Z");
    expect(officeArchivedAt({ status: "CANCELLED" })).toBeNull();
  });
  it("đặt tên lối vào kho theo đúng chữ người dùng thấy", () => {
    expect(OFFICE_VIEWS.archive).toBe("Kho lưu trữ");
  });
});

describe("Sửa văn bản đã ban hành", () => {
  const before = {
    title: "Thông báo kiểm kê",
    summary: "",
    content: { version: 1, type: "doc", content: [] },
    document_date: "2026-10-04",
    effective_on: null,
    expires_on: null,
    signer_user_id: null,
    signer_position: null,
    urgency: "NORMAL",
    confidentiality: "INTERNAL",
    archive_folder_id: null,
    require_acknowledgement: false,
  } as Parameters<typeof changedAmendFields>[0];
  it("chỉ báo những trường thật sự đổi", () => {
    expect(changedAmendFields(before, { ...before })).toEqual([]);
    expect(
      changedAmendFields(before, { ...before, title: "Thông báo kiểm kê (sửa)" }),
    ).toEqual(["title"]);
    expect(
      changedAmendFields(before, {
        ...before,
        urgency: "URGENT",
        require_acknowledgement: true,
      }),
    ).toEqual(["urgency", "require_acknowledgement"]);
  });
  it("so sánh nội dung theo giá trị, không theo tham chiếu", () => {
    expect(
      changedAmendFields(before, {
        ...before,
        content: { version: 1, type: "doc", content: [] },
      }),
    ).toEqual([]);
    expect(
      changedAmendFields(before, {
        ...before,
        content: {
          version: 1,
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
        } as (typeof before)["content"],
      }),
    ).toEqual(["content"]);
  });
  it("nói rõ hậu quả trước khi người dùng sửa bất cứ thứ gì", () => {
    const html = renderAmend(42);
    expect(html).toContain("42 người nhận");
    expect(html).toContain("Lý do sửa");
    expect(html).toContain("Số văn bản, loại văn bản và danh sách người nhận không đổi");
    // Chưa đổi gì thì không cho lưu, tránh gửi thông báo rỗng cho 42 người.
    expect(html).toContain("Chưa có thay đổi nào so với bản đang ban hành.");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
  });
  it("không bịa số người nhận khi chưa có quyền theo dõi", () => {
    const html = renderAmend(undefined);
    expect(html).not.toContain("undefined người nhận");
    expect(html).toContain("người nhận, người theo dõi và người ký");
  });
  it("dịch lỗi không có thay đổi sang tiếng người dùng hiểu", () => {
    expect(officeError({ message: "OFFICE_AMEND_NO_CHANGE" })).toContain(
      "Chưa có gì thay đổi",
    );
    expect(officeError({ message: "OFFICE_OFFICIAL_IMMUTABLE" })).toContain(
      "Quản trị Office",
    );
  });
});

function renderAmend(recipients?: number) {
  const detail = {
    document: {
      id: "doc-1",
      version: 3,
      title: "Thông báo kiểm kê",
      summary: "",
      content: { version: 1, type: "doc", content: [] },
      document_number: "234/2026/TB-TT",
      source_document_number: null,
      document_date: "2026-10-04",
      issued_at: "2026-10-04T03:00:00Z",
      effective_on: null,
      expires_on: null,
      signer_user_id: null,
      signer_position: null,
      urgency: "NORMAL",
      confidentiality: "INTERNAL",
      archive_folder_id: null,
      require_acknowledgement: false,
    },
    capabilities: { amend: true },
    attachments: [],
    recipientStats: recipients
      ? { total: recipients, read: 1, unread: recipients - 1 }
      : null,
  } as unknown as OfficeDetail;
  return renderToStaticMarkup(
    <StaticRouter location="/office/documents/doc-1/amend">
      <OfficeAmendForm
        service={{} as OfficeService}
        catalog={catalog}
        detail={detail}
      />
    </StaticRouter>,
  );
}
