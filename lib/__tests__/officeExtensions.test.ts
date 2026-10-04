import { describe, expect, it } from "vitest";
import {
  fillOfficeTemplate,
  officeTemplateVariables,
  officeVersionChanges,
  officeExportRows,
} from "../office/officeExtensions";

const content = (text: string) => ({
  version: 1 as const,
  type: "doc" as const,
  content: [
    { type: "paragraph" as const, content: [{ type: "text" as const, text }] },
  ],
});
describe("Office P1", () => {
  it("fills text nodes literally, preserving formatting and unknown/number variables", () => {
    const source = content(
      "Kính gửi {{company_name}} — số {{document_number}}; {{unknown}}",
    );
    const result = fillOfficeTemplate(source, {
      company_name: "A $& <script>",
    });
    expect(result.content[0]).toEqual({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Kính gửi A $& <script> — số {{document_number}}; {{unknown}}",
        },
      ],
    });
    expect(source.content[0].content[0].text).toContain("{{company_name}}");
    expect(officeTemplateVariables(source)).toEqual([
      "company_name",
      "document_number",
      "unknown",
    ]);
  });
  it("compares business fields without version/audit noise", () => {
    const a = {
      title: "Cũ",
      content: content("Nội dung"),
      version: 1,
      updated_at: "yesterday",
    };
    const b = { ...a, title: "Mới", version: 2, updated_at: "today" };
    expect(officeVersionChanges(a, b)).toEqual(["Tiêu đề"]);
    expect(
      officeVersionChanges(a, { ...a, content: content("Đã sửa") }),
    ).toEqual(["Nội dung"]);
  });
  it("exports literal spreadsheet strings and explicit lifecycle labels", () => {
    const rows = officeExportRows([
      {
        title: '=HYPERLINK("https://example.com")',
        document_group: "INCOMING",
        status: "ISSUED",
        document_date: "2026-10-04",
        source_document_number: "123/CV",
        creator_name: "An",
      } as any,
    ]);
    expect(rows[0]["Tiêu đề"]).toBe('=HYPERLINK("https://example.com")');
    expect(rows[0]["Số văn bản"]).toBe("123/CV");
    expect(rows[0]["Nghiệp vụ"]).toBe("Văn bản đến");
    expect(rows[0]["Ngày văn bản"]).toBe("04/10/2026");
  });
});
