// Browser-only isolated fixture. Never mounted by the production entry point.
import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { WorkWorkspace } from "../../pages/work/WorkPage";
import type { WorkTaskService } from "../../lib/work/workTaskService";
import type { createWorkAttachmentService } from "../../lib/work/workAttachmentService";
import {
  documentText,
  emptyWorkDraft,
  workDocument,
} from "../../lib/work/workForm";
import type { WorkTaskSummary } from "../../lib/work/workTypes";
const query = new URLSearchParams(window.location.search);
if (query.get("layout") === "true") {
  const root = document.getElementById("root")!;
  const host = document.createElement("main");
  host.dataset.workScrollHost = "true";
  host.style.cssText = "height:100dvh;overflow:auto;position:relative";
  root.replaceWith(host);
  host.append(root);
  const nav = document.createElement("nav");
  nav.textContent = "Điều hướng ứng dụng";
  nav.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;height:64px;background:white;border-top:1px solid #ddd;z-index:50;text-align:center;padding:20px";
  document.body.append(nav);
}
const qa = {
  calls: [] as { name: string; args: unknown[] }[],
  createAttempts: 0,
  finalizeAttempts: 0,
  denyReads: false,
};
(window as unknown as { workQa: typeof qa }).workQa = qa;
const subscribeRefresh = (invalidate: () => void) => {
  window.addEventListener("focus", invalidate);
  return () => window.removeEventListener("focus", invalidate);
};
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
let taskStatus = query.get("state") || "in_progress";
let taskVersion = 1;
let commandAttempts = 0;
const commandResults = new Map<string, any>();
const fixtureComments: any[] = [];
let checkDone = false;
let commentVersion = 1;
let pinned = false;
const role = query.get("role") || "assignee";
const comment = (id: string, text: string) => ({
  id,
  task_id: "1",
  author_user_id: "actor",
  parent_comment_id: null,
  content_document: workDocument(text),
  content_text: text,
  edited_at: null,
  lock_version: 1,
  created_at: "2026-09-07T01:00:00Z",
  updated_at: "2026-09-07T01:00:00Z",
  mentionedUserIds: [],
  can_edit: role !== "watcher",
});
const service: WorkTaskService = {
  async command(input) {
    log("command", structuredClone(input));
    commandAttempts++;
    if (commandResults.has(input.idempotencyKey))
      return commandResults.get(input.idempotencyKey);
    if (query.get("conflict") === "true" && commandAttempts === 1) {
      taskVersion++;
      throw new Error("WORK_VERSION_CONFLICT");
    }
    taskVersion++;
    taskStatus =
      (
        {
          acknowledge: "not_started",
          start: "in_progress",
          block: "blocked",
          unblock: "in_progress",
          submit: "awaiting_review",
          cancel: "cancelled",
          transfer: "pending_acknowledgement",
        } as Record<string, string>
      )[input.command] || taskStatus;
    if (input.command === "review")
      taskStatus =
        input.payload.decision === "approve"
          ? "completed"
          : "changes_requested";
    const result: any = {
      taskId: "1",
      taskCode: "VW-2026-000001",
      lockVersion: taskVersion,
      status: taskStatus,
    };
    commandResults.set(input.idempotencyKey, result);
    if (query.get("lostCommand") === "true" && commandAttempts === 1)
      throw new Error("network");
    return result;
  },
  async collaborate(input) {
    log("collaborate", structuredClone(input));
    if (input.command === "comment_edit") {
      if (query.get("commentConflict") === "true" && commentVersion === 1) {
        commentVersion = 2;
        throw new Error("WORK_VERSION_CONFLICT");
      }
      fixtureComments.unshift({
        ...comment(
          input.payload.commentId,
          documentText(input.payload.content),
        ),
        lock_version: commentVersion,
      });
    }
    if (input.command === "set_pin") pinned = input.payload.pinned;
    if (input.command === "checklist_set_completed")
      checkDone = input.payload.completed;
    if (input.command === "comment_create") {
      const c = {
        ...comment(
          "new-comment",
          documentText(input.payload.content),
        ),
        mentionedUserIds: input.payload.mentionedUserIds || [],
        parent_comment_id: input.payload.parentCommentId || null,
      };
      fixtureComments.unshift(c);
    }
    return {
      taskId: "1",
      taskLockVersion: taskVersion,
      preferences: { pinned, notificationsEnabled: true },
    } as any;
  },
  async comments(taskId, cursor) {
    if (query.has("slowRefresh")) await wait(500);
    if (qa.denyReads) throw new Error("WORK_FORBIDDEN");
    log("comments", taskId, cursor);
    return {
      items: cursor
        ? [comment("older", "Nội dung bình luận cũ")]
        : [
            ...fixtureComments,
            comment("first", "Đã kiểm tra tài liệu đầu vào."),
          ],
      nextCursor: cursor
        ? null
        : { sortAt: "2026-09-07T01:00:00Z", id: "first" },
    };
  },
  async history(taskId, filters, cursor) {
    log("history", taskId, filters, cursor);
    return {
      items: [
        {
          id: "event",
          task_id: taskId,
          actor_user_id: "actor",
          event_type: "task.started",
          source: "human",
          payload: { reason: "Bắt đầu ca kiểm tra" },
          created_at: "2026-09-07T01:00:00Z",
          correlation_id: null,
          idempotency_key: null,
        },
      ],
      nextCursor: null,
    } as any;
  },
  async mentions(taskId, search, cursor) {
    log("mentions", taskId, search, cursor);
    return {
      items: people.map((p) => ({ userId: p.id, name: p.name })),
      nextCursor: null,
    };
  },
  async assigneeOptions(taskId, action, search, cursor) {
    log("assigneeOptions", taskId, action, search, cursor);
    return {
      items: [{ userId: "second", name: "Nguyễn Thu Hà" }],
      nextCursor: null,
    };
  },
  async detailContext(taskId, ids) {
    log("detailContext", taskId, ids);
    return {
      names: { actor: "Lê Minh An", second: "Nguyễn Thu Hà" },
      scopeName: "Trực tiếp",
      bucketName: null,
    };
  },
  async commentAnchor(taskId, id) {
    log("commentAnchor", taskId, id);
    return {
      comment: {
        ...comment(id, "Bình luận đích từ thông báo"),
        lock_version: commentVersion,
      },
      parent: null,
    };
  },
  async list(view, filters, cursor) {
    if (query.has("slowRefresh")) await wait(500);
    if (qa.denyReads) throw new Error("WORK_FORBIDDEN");
    log("list", view, filters, cursor);
    await wait(filters.search === "chậm" ? 800 : 15);
    if (filters.search === "lỗi") throw new Error("network");
    if (filters.search)
      return {
        items: [summary("3", `Kết quả ${filters.search}`)],
        nextCursor: null,
      };
    return {
      items:
        query.get("longList") === "true"
          ? Array.from({ length: 20 }, (_, i) =>
              summary(String(i + 1), `Công việc số ${i + 1}`),
            )
          : cursor
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
    const terminal = ["completed", "cancelled"].includes(taskStatus),
      worker = role === "assignee",
      reviewer = role === "reviewer";
    const active = worker && !terminal;
    return {
      task: {
        ...summary("1", "Chuẩn bị hồ sơ nghiệm thu"),
        status: taskStatus,
        lock_version: taskVersion,
        description_document: workDocument(
          "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.\nKhông diễn giải nội dung thành HTML.",
        ),
        description_text: "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.",
        labels: ["Nghiệm thu", "Hồ sơ"],
        review_policy: "creator_review",
        created_at: "2026-09-07T00:00:00Z",
        blocked_reason: taskStatus === "blocked" ? "Chờ vật tư" : null,
      },
      assignments: [
        {
          id: "assignment",
          task_id: "1",
          user_id: "actor",
          assigned_by: "second",
          state: taskStatus,
          assigned_at: "2026-09-07T00:00:00Z",
          acknowledged_at:
            taskStatus === "pending_acknowledgement"
              ? null
              : "2026-09-07T00:10:00Z",
          acknowledgement_due_at: "2026-09-08T02:00:00Z",
          execution_sla_due_at: "2026-09-10T10:00:00Z",
          ended_at: terminal ? "2026-09-07T03:00:00Z" : null,
        },
      ],
      participants: [
        { id: "watcher", user_id: "second", participant_role: "watcher" },
      ],
      preferences: { pinned, notificationsEnabled: true },
      attachments:
        query.get("images") === "true"
          ? [
              {
                id: "image",
                task_id: "1",
                file_name: "anh-nghiem-thu.webp",
                mime_type: "image/webp",
                size_bytes: 1234,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: {
                  thumbnail: {},
                  display: {},
                  fallback: {},
                  original: {},
                },
              },
            ]
          : [],
      currentSubmission:
        taskStatus === "awaiting_review"
          ? {
              id: "submission",
              iteration: 1,
              submitted_by: "actor",
              submitted_at: "2026-09-07T02:00:00Z",
              result_text: "Hồ sơ đã được kiểm tra đầy đủ.",
              status: "pending_review",
            }
          : null,
      checklist:
        query.get("task9") === "true"
          ? [
              {
                id: "check",
                task_id: "1",
                title: "Đối chiếu biên bản",
                lock_version: 1,
                sort_order: 0,
                assignee_user_id: "actor",
                completed_at: checkDone ? "2026-09-07T02:00:00Z" : null,
              },
            ]
          : [],
      capabilities: {
        canClone: true,
        canViewHistory: role !== "watcher",
        canSetPreferences: true,
        canComment: !terminal,
        canManageChecklist: active && taskStatus !== "awaiting_review",
        canAcknowledge: active && taskStatus === "pending_acknowledgement",
        canRequestClarification:
          active && taskStatus === "pending_acknowledgement",
        canStart: active && taskStatus === "not_started",
        canBlock: active && taskStatus === "in_progress",
        canUnblock: active && taskStatus === "blocked",
        canSubmit: active && taskStatus === "in_progress",
        canReview: reviewer && taskStatus === "awaiting_review",
        canCancel: reviewer && !terminal,
        canTransfer: active,
        canAddAssignees: active,
        canAttachInput: active,
        canAttachDiscussion: !terminal,
        canAttachResult: active,
        canAttachEvidence: active,
      },
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
  async read(id, variant) {
    log("attachment.read", id, variant);
    return {
      signedUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1UAAAAASUVORK5CYII=",
      expiresIn: 60,
    };
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
            subscribe={query.has("slowRefresh") ? subscribeRefresh : undefined}
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
            subscribe={query.has("slowRefresh") ? subscribeRefresh : undefined}
          />
        }
      />
    </Routes>
  </HashRouter>,
);
