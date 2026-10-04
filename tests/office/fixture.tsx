// Fictional data, confined to the UI test harness. No Supabase operations.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { OfficeWorkspace } from "../../pages/office/OfficePage";
import { createOfficeService } from "../../lib/office/officeService";
import { newOfficeDraft } from "../../lib/office/officePresentation";
import type {
  OfficeCatalog,
  OfficeDetail,
  OfficeDocument,
} from "../../lib/office/officeTypes";
import "../../index.css";
const catalog: OfficeCatalog = {
  actorId: "author",
  canCreate: true,
  canConfigure: true,
  rules: [
    {
      id: "rule",
      name: "Sổ Tiến Thịnh",
      format: "{sequence}/{year}/{code}-TT",
      is_active: true,
    },
  ],
  folders: [
    {
      id: "root",
      name: "Văn phòng Tiến Thịnh",
      parent_id: null,
      is_active: true,
    },
    {
      id: "hcns",
      name: "Hành chính Nhân sự",
      parent_id: "root",
      is_active: true,
    },
    {
      id: "projects",
      name: "Quản lý dự án",
      parent_id: "root",
      is_active: true,
    },
  ],
  workflows: [
    {
      id: "workflow",
      name: "HCNS → Tổng Giám đốc",
      steps: [
        { userId: "manager", label: "Trưởng phòng" },
        { userId: "director", label: "Tổng Giám đốc" },
      ],
      stepNames: { manager: "Nguyễn Minh An", director: "Trần Hải Nam" },
      department_id: null,
      project_id: null,
      is_active: true,
      version: 1,
    },
  ],
  types: [
    {
      id: "type-tb",
      code: "TB",
      name: "Thông báo",
      groups: ["ANNOUNCEMENT", "INTERNAL"],
      requires_approval: true,
      requires_number: true,
      numbering_rule_id: "rule",
      workflow_id: "workflow",
      archive_folder_id: "hcns",
      is_active: true,
    },
    {
      id: "type-cv",
      code: "CV",
      name: "Công văn",
      groups: ["INCOMING", "OUTGOING"],
      requires_approval: true,
      requires_number: true,
      numbering_rule_id: "rule",
      workflow_id: "workflow",
      archive_folder_id: "projects",
      is_active: true,
    },
    {
      id: "type-qd",
      code: "QĐ",
      name: "Quyết định",
      groups: ["INTERNAL"],
      requires_approval: true,
      requires_number: true,
      numbering_rule_id: "rule",
      workflow_id: "workflow",
      archive_folder_id: "root",
      is_active: true,
    },
  ],
};
const now = "2026-10-04T08:00:00Z";
const docs = new Map<string, OfficeDocument>();
const reads = new Set<string>();
const bookmarks = new Map<string, { favorite: boolean; following: boolean }>();
const commands: any[] = [];
(window as any).officeTest = { commands };
const titles = [
  "Thông báo kế hoạch kiểm kê quý IV năm 2026",
  "Quyết định thành lập ban điều hành dự án RICO",
  "Công văn đề nghị xác nhận tiến độ bàn giao mặt bằng",
  "Thông báo lịch đào tạo an toàn tại nhà máy KCT",
  "Công văn phản hồi hồ sơ nghiệm thu kết cấu thép",
];
for (let i = 0; i < titles.length; i++) {
  const group =
    i === 2
      ? "INCOMING"
      : i === 4
        ? "OUTGOING"
        : i === 1
          ? "INTERNAL"
          : "ANNOUNCEMENT";
  const d = {
    ...newOfficeDraft(group),
    id: `doc-${i + 1}`,
    title: titles[i],
    document_type_id:
      group === "INTERNAL"
        ? "type-qd"
        : group === "ANNOUNCEMENT"
          ? "type-tb"
          : "type-cv",
    status:
      i === 1
        ? "WAITING_NUMBER"
        : i === 2
          ? "ISSUED"
          : i === 4
            ? "PENDING_APPROVAL"
            : "ISSUED",
    processing_status: i === 2 ? "IN_PROGRESS" : null,
    document_number:
      i === 1 || i === 4
        ? null
        : `${234 - i}/2026/${group === "ANNOUNCEMENT" ? "TB" : "CV"}-TT`,
    version: 4,
    creator_name: "Nguyễn Thu Hương",
    created_by: "author",
    created_at: now,
    updated_at: now,
    issued_at: i === 1 || i === 4 ? null : now,
    revoked_at: null,
    numbered_at: i === 1 || i === 4 ? null : now,
    approved_at: now,
    approval_round: 1,
    assigned_to: i === 2 ? "author" : null,
    collaborator_ids: [],
    processing_instruction:
      i === 2 ? "Đối chiếu hồ sơ và phản hồi chủ đầu tư." : null,
    processing_result: null,
    received_ack_at: i === 2 ? now : null,
    processing_started_at: i === 2 ? now : null,
    processing_completed_at: null,
    content: {
      version: 1,
      type: "doc",
      content: [
        {
          type: "heading",
          level: 1,
          content: [
            { type: "text", text: "Kính gửi các phòng ban và công trường" },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Đề nghị các đơn vị phối hợp thực hiện kế hoạch đã thống nhất. Mọi vướng mắc trong quá trình triển khai vui lòng phản hồi về phòng Hành chính Nhân sự.",
            },
          ],
        },
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                {
                  type: "text",
                  text: "Rà soát hồ sơ và phân công người phụ trách.",
                },
              ],
            },
            {
              type: "list_item",
              content: [
                { type: "text", text: "Gửi kết quả trước ngày 10/10/2026." },
              ],
            },
          ],
        },
      ],
    },
    recipient_specs: [{ type: "company", label: "Toàn công ty" }],
  } as OfficeDocument;
  docs.set(d.id, d);
}
function detail(id: string): OfficeDetail {
  const d = docs.get(id);
  if (!d) throw new Error("OFFICE_NOT_FOUND");
  const editable = ["DRAFT", "RETURNED"].includes(d.status);
  return {
    document: d,
    typeName:
      catalog.types.find((t) => t.id === d.document_type_id)?.name || "Văn bản",
    departmentName: "Hành chính Nhân sự",
    projectName: d.document_group === "INCOMING" ? "RICO" : null,
    signerName: "Trần Hải Nam",
    assigneeName: "Nguyễn Minh An",
    attachments: [],
    capabilities: {
      edit: editable,
      submit: editable,
      approve: d.status === "PENDING_APPROVAL",
      issue_number: d.status === "WAITING_NUMBER",
      publish: d.status === "APPROVED",
      revoke: d.status === "ISSUED",
      archive: ["ISSUED", "REVOKED"].includes(d.status),
      assign: d.document_group === "INCOMING" && d.status === "ISSUED",
      process:
        d.document_group === "INCOMING" && d.processing_status !== "COMPLETED",
      track: true,
      read: !!d.issued_at && !d.revoked_at && !reads.has(id),
    },
    bookmark: bookmarks.get(id) || { favorite: false, following: false },
    recipientStats: {
      total: 42,
      read: reads.has(id) ? 37 : 36,
      unread: reads.has(id) ? 5 : 6,
    },
    approvals:
      d.status === "DRAFT"
        ? []
        : [
            {
              id: "ap1",
              round: 1,
              step: 1,
              label: "Trưởng phòng HCNS",
              name: "Nguyễn Minh An",
              user_id: "manager",
              status: "APPROVED",
              acted_at: now,
              comment: null,
            },
            {
              id: "ap2",
              round: 1,
              step: 2,
              label: "Tổng Giám đốc",
              name: "Trần Hải Nam",
              user_id: "director",
              status: d.status === "PENDING_APPROVAL" ? "PENDING" : "APPROVED",
              acted_at: now,
              comment: null,
            },
          ],
  };
}
const options = {
  user: [
    { id: "manager", name: "Nguyễn Minh An" },
    { id: "director", name: "Trần Hải Nam" },
    { id: "recipient", name: "Lê Thu Hà" },
  ],
  department: [
    { id: "hcns", name: "Hành chính Nhân sự" },
    { id: "factory", name: "Nhà máy KCT" },
  ],
  project: [{ id: "rico", name: "RICO" }],
  site: [{ id: "rico-site", name: "Công trường RICO" }],
  role: [{ id: "role", name: "Kỹ sư" }],
  factory: [{ id: "factory", name: "Nhà máy KCT" }],
};
const rpc = async (name: string, p: any) => {
  await new Promise((r) => setTimeout(r, 80));
  try {
    if (name === "office_query") {
      const q = p.p_query,
        x = p.p_params;
      if (
        new URLSearchParams(location.search).has("error") &&
        q === "dashboard"
      )
        throw new Error("offline");
      if (q === "catalog") return { data: catalog, error: null };
      if (q === "dashboard")
        return {
          data: {
            new: 7,
            unread: 6,
            approval: 3,
            numbering: 2,
            assigned: 4,
            overdue: 1,
            issuedThisMonth: 18,
          },
          error: null,
        };
      if (q === "options")
        return {
          data: (options[x.kind as keyof typeof options] || [])
            .filter(
              (o) =>
                !x.search ||
                o.name.toLowerCase().includes(x.search.toLowerCase()) ||
                x.ids?.includes(o.id),
            )
            .map((o) => ({ ...o, kind: x.kind })),
          error: null,
        };
      if (q === "audience")
        return {
          data: { total: x.specs.length ? 42 : 0, withoutAccess: 0, names: [] },
          error: null,
        };
      if (q === "detail") return { data: detail(x.id), error: null };
      if (q === "list") {
        const rows = [...docs.values()]
          .filter(
            (d) =>
              (!x.group || d.document_group === x.group) &&
              (!x.status || d.status === x.status) &&
              (!x.search ||
                `${d.title} ${d.document_number}`
                  .toLowerCase()
                  .includes(x.search.toLowerCase())) &&
              (x.view !== "favorites" || bookmarks.get(d.id)?.favorite),
          )
          .map((d) => ({
            ...d,
            type_name: catalog.types.find((t) => t.id === d.document_type_id)
              ?.name,
            signer_name: "Trần Hải Nam",
            department_name: "Hành chính Nhân sự",
            project_name: d.document_group === "INCOMING" ? "RICO" : null,
            is_recipient: !!d.issued_at,
            read_at: reads.has(d.id) ? now : null,
          }));
        return {
          data: {
            items: rows.slice(
              (x.page || 0) * 25,
              (x.page || 0) * 25 + (x.pageSize || 25),
            ),
            total: rows.length,
          },
          error: null,
        };
      }
      if (q === "recipients")
        return {
          data: {
            items: [
              {
                user_id: "r1",
                name: "Lê Thu Hà",
                delivered_at: now,
                read_at: x.filter === "unread" ? null : now,
              },
              {
                user_id: "r2",
                name: "Nguyễn Văn Bình",
                delivered_at: now,
                read_at: null,
              },
            ],
            total: 2,
          },
          error: null,
        };
      if (q === "activity")
        return {
          data: [
            {
              id: "e1",
              user_name: "Nguyễn Thu Hương",
              description: "PUBLISHED",
              context: {
                number: "234/2026/TB-TT",
                version: 4,
                status: "ISSUED",
              },
              created_at: now,
            },
            {
              id: "e2",
              user_name: "Lê Thu Hà",
              description: "NUMBER_ISSUED",
              context: {
                number: "234/2026/TB-TT",
                version: 3,
                status: "APPROVED",
              },
              created_at: now,
            },
          ],
          error: null,
        };
    }
    if (name === "office_configure") return { data: "configured", error: null };
    if (name === "office_command") {
      commands.push(p);
      const action = p.p_command,
        data = p.p_payload;
      let d = docs.get(p.p_document_id);
      if (action === "create") {
        d = {
          ...data,
          id: crypto.randomUUID(),
          version: 1,
          status: "DRAFT",
          creator_name: "Nguyễn Thu Hương",
          created_by: "author",
          created_at: now,
          updated_at: now,
          issued_at: null,
          approval_round: 0,
        } as OfficeDocument;
        docs.set(d.id, d);
      }
      if (!d) throw new Error("OFFICE_NOT_FOUND");
      if (action === "save") Object.assign(d, data);
      if (action === "submit") {
        d.status =
          d.document_group === "INCOMING" ? "APPROVED" : "PENDING_APPROVAL";
        d.approval_round = 1;
      }
      if (action === "approve") d.status = "WAITING_NUMBER";
      if (action === "return") d.status = "RETURNED";
      if (action === "reject") d.status = "REJECTED";
      if (action === "issue_number") {
        d.status = "APPROVED";
        d.document_number = "236/2026/TB-TT";
        d.numbered_at = now;
      }
      if (action === "publish") {
        d.status = "ISSUED";
        d.issued_at = now;
      }
      if (action === "read") reads.add(d.id);
      if (action === "bookmark") bookmarks.set(d.id, data);
      if (action === "archive") d.status = "ARCHIVED";
      if (action === "revoke") {
        d.status = "REVOKED";
        d.revoked_at = now;
      }
      if (action === "assign") {
        d.assigned_to = data.userId;
        d.due_date = data.dueDate;
        d.processing_instruction = data.instruction;
        d.processing_status = "ASSIGNED";
        d.received_ack_at = null;
      }
      if (action === "acknowledge") d.received_ack_at = now;
      if (action === "start") d.processing_status = "IN_PROGRESS";
      if (action === "complete") {
        d.processing_status = "COMPLETED";
        d.processing_result = data.result;
      }
      if (!["read", "bookmark", "create"].includes(action)) d.version++;
      return {
        data: { id: d.id, version: d.version, status: d.status },
        error: null,
      };
    }
    throw new Error("Unknown fixture request");
  } catch (error) {
    return { data: null, error };
  }
};
const service = createOfficeService({ rpc } as any);
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <div style={{ padding: "16px", maxWidth: "1600px", margin: "auto" }}>
      <Routes>
        <Route
          path="/office/*"
          element={<OfficeWorkspace service={service} />}
        />
        <Route path="*" element={<Navigate to="/office" replace />} />
      </Routes>
    </div>
  </HashRouter>,
);
