// Browser-only isolated fixture. Never mounted by the production entry point.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { WorkWorkspace } from "../../pages/work/WorkPage";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import { emptyWorkDraft, workDocument } from "../../lib/work/workForm";
import type { WorkTaskSummary } from "../../lib/work/workTypes";
const query = new URLSearchParams(window.location.search);
const qa = {
  calls: [] as { name: string; args: unknown[] }[],
  createAttempts: 0,
  finalizeAttempts: 0,
};
(window as unknown as { workQa: typeof qa }).workQa = qa;
const log = (name: string, ...args: unknown[]) => qa.calls.push({ name, args });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = (id: string, title: string): WorkTaskSummary => ({
  id,
  task_code: `VW-2026-${id.padStart(6, "0")}`,
  title,
  status: "in_progress",
  priority: "important",
  privacy: "standard",
  scope_type: "direct",
  department_id: null,
  project_id: null,
  task_group_id: null,
  deadline_at: "2026-09-10T10:00:00Z",
  created_by: "actor",
  reviewer_user_id: "actor",
  updated_at: "2026-09-07T00:00:00Z",
  lock_version: 1,
  assignment_count: 2,
  acknowledged_count: 1,
});
const people = [
  { id: "actor", name: "Lê Minh An", kind: "user" },
  { id: "second", name: "Nguyễn Thu Hà", kind: "user" },
];
const service: WorkTaskService = {
  async list(view, filters, cursor) {
    log("list", view, filters, cursor);
    await wait(filters.search === "chậm" ? 800 : 15);
    if (filters.search === "lỗi") throw new Error("network");
    if (filters.search)
      return {
        items: [summary("3", `Kết quả ${filters.search}`)],
        nextCursor: null,
      };
    return {
      items: cursor
        ? [summary("2", "Tổng hợp kết quả kiểm tra")]
        : [
            summary(
              "1",
              view === "created_by_me"
                ? "Công việc tôi đã giao"
                : "Chuẩn bị hồ sơ nghiệm thu",
            ),
          ],
      nextCursor: cursor ? null : { sortAt: "2026-09-07T00:00:00Z", id: "1" },
    };
  },
  async options(kind, scope, search) {
    log("options", kind, scope, search);
    const items =
      kind === "scope" || kind === "filter_scope"
        ? [
            { id: "direct", name: "Trực tiếp", kind: "direct" },
            {
              id: "department:dept",
              name: "Phòng kỹ thuật",
              kind: "department",
            },
          ]
        : kind === "work_group"
          ? [{ id: "group", name: "Nhóm vận hành", kind: "work_group" }]
          : people;
    return {
      items: items.filter(
        (x) => !search || x.name.toLowerCase().includes(search.toLowerCase()),
      ),
      nextCursor: null,
    };
  },
  async context(scope) {
    log("context", scope);
    return {
      actorId: "actor",
      canCreate: true,
      canAssignUser: true,
      canAssignGroup: true,
      canChooseReviewer: true,
      calendarReady: query.get("calendar") !== "off",
    };
  },
  async groups() {
    return { items: [{ id: "bucket", name: "Hồ sơ" }], nextCursor: null };
  },
  async preview(sources, scope) {
    log("preview", sources, scope);
    await wait(sources.length === 1 ? 100 : 20);
    const ids = [
      ...new Set(
        sources.flatMap((x) =>
          x.type === "work_group" ? people.map((u) => u.id) : [x.id],
        ),
      ),
    ];
    return {
      sources,
      validRecipients: ids.map((id) => ({
        userId: id,
        name: people.find((p) => p.id === id)!.name,
        sources,
      })),
      invalidRecipients: [],
      validCount: ids.length,
      invalidCount: 0,
      fingerprint: JSON.stringify([sources, scope]),
    };
  },
  async create(input, key, fingerprint) {
    log("create", input, key, fingerprint);
    qa.createAttempts++;
    if (query.get("ambiguous") === "true" && qa.createAttempts === 1)
      throw new Error("network timeout");
    return {
      taskId: "new",
      taskCode: "VW-2026-000099",
      lockVersion: 1,
      status: "pending_acknowledgement",
    };
  },
  async detail(ref) {
    log("detail", ref);
    if (query.get("deny") === "true") throw new Error("WORK_TASK_NOT_FOUND");
    return {
      task: {
        ...summary("1", "Chuẩn bị hồ sơ nghiệm thu"),
        description_document: workDocument(
          "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.\nKhông diễn giải nội dung thành HTML.",
        ),
      },
      checklist: [],
      capabilities: { canClone: true },
    } as any;
  },
  async clone(id) {
    log("clone", id);
    return {
      draft: {
        ...emptyWorkDraft({ type: "direct" }),
        title: "Bản sao hồ sơ",
        recipientSources: [{ type: "user", id: "actor" }],
        watcherUserIds: ["second"],
        clonedFromTaskId: id,
      },
      labels: {
        actor: "Lê Minh An",
        second: "Nguyễn Thu Hà",
        direct: "Trực tiếp",
      },
      requiresDeadlineConfirmation: true,
    };
  },
};
const attachments: ReturnType<typeof createWorkAttachmentService> = {
  async begin(taskId, file, kind, keep, key) {
    log("attachment.begin", taskId, file.name, kind, keep, key);
    return {
      id: "attachment",
      status: "pending",
      bucket: "work-attachments",
      path: "reserved",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  },
  async upload() {
    log("attachment.upload");
  },
  async finalize() {
    log("attachment.finalize");
    qa.finalizeAttempts++;
    if (query.get("fileFailure") === "true" && qa.finalizeAttempts === 1)
      throw new Error("network");
    return { id: "attachment", status: "ready" };
  },
  async read() {
    throw new Error("not used");
  },
  async remove() {
    throw new Error("not used");
  },
};
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Routes>
      <Route
        path="/work/my"
        element={
          <WorkWorkspace
            actorId="actor"
            service={service}
            attachments={attachments}
          />
        }
      />
      <Route
        path="/work/tasks/:taskCode"
        element={
          <WorkWorkspace
            actorId="actor"
            service={service}
            attachments={attachments}
          />
        }
      />
    </Routes>
  </HashRouter>,
);
