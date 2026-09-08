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
  mentionedUserIds,
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
  planned_start_at: "2026-09-09T01:00:00Z",
  deadline_at: "2026-09-10T10:00:00Z",
  parent_task_id: null,
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
let plannedStartAt: string | null = "2026-09-09T01:00:00Z";
let deadlineAt: string | null = "2026-09-10T10:00:00Z";
let watcherIds = ["second"];
const fixtureChildren: any[] = [];
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
        content_document: input.payload.content,
        mentionedUserIds: mentionedUserIds(input.payload.content),
        lock_version: commentVersion,
      });
    }
    if (input.command === "set_pin") pinned = input.payload.pinned;
    if (input.command === "schedule_update") {
      plannedStartAt = input.payload.plannedStartAt;
      deadlineAt = input.payload.deadlineAt;
      taskVersion++;
    }
    if (input.command === "watchers_update") {
      watcherIds = [...new Set([...watcherIds.filter((id) => !input.payload.removeUserIds.includes(id)), ...input.payload.addUserIds])];
      taskVersion++;
    }
    if (input.command === "checklist_set_completed")
      checkDone = input.payload.completed;
    if (input.command === "comment_create") {
      const c = {
        ...comment("new-comment", documentText(input.payload.content)),
        content_document: input.payload.content,
        mentionedUserIds: mentionedUserIds(input.payload.content),
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
  async watcherOptions(taskId, search, cursor) {
    log("watcherOptions", taskId, search, cursor);
    return {
      items: people.map((p) => ({ userId: p.id, name: p.name })),
      nextCursor: null,
    };
  },
  async children(taskId, cursor) {
    log("children", taskId, cursor);
    return {
      items: fixtureChildren,
      aggregate: {
        visibleTotal: fixtureChildren.filter((item) => item.status !== "cancelled").length,
        visibleCompleted: fixtureChildren.filter((item) => item.status === "completed").length,
        visibleCancelled: 0,
        visibleOpen: fixtureChildren.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
      },
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
    if (input.parentTaskId && !fixtureChildren.length)
      fixtureChildren.push({
        ...summary("99", input.title),
        task_code: "VW-2026-000099",
        parent_task_id: input.parentTaskId,
        planned_start_at: input.plannedStartAt || null,
        deadline_at: input.deadlineAt || null,
        assignee_names: ["Lê Minh An"],
        attachment_count: 0,
      });
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
        planned_start_at: plannedStartAt,
        deadline_at: deadlineAt,
        description_document: workDocument(
          "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.\nKhông diễn giải nội dung thành HTML.",
        ),
        description_text: "Kiểm tra đầy đủ hồ sơ trước khi trình duyệt.",
        labels: ["Nghiệm thu", "Hồ sơ"],
        review_policy: query.get("autoComplete") === "true" ? "auto_complete" : "creator_review",
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
      participants: watcherIds.map((userId) => ({ id: `watcher-${userId}`, user_id: userId, participant_role: "watcher" })),
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
              {
                id: "pdf",
                task_id: "1",
                file_name: "bien-ban-nghiem-thu.pdf",
                mime_type: "application/pdf",
                size_bytes: 2048,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
              },
              {
                id: "text",
                task_id: "1",
                file_name: "ghi-chu-hien-truong.txt",
                mime_type: "text/plain",
                size_bytes: 96,
                attachment_kind: "discussion",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
              },
              {
                id: "sheet",
                task_id: "1",
                file_name: "du-lieu-cu.xls",
                mime_type: "application/vnd.ms-excel",
                size_bytes: 4096,
                attachment_kind: "input",
                uploader_user_id: "actor",
                can_delete: false,
                variants: { original: {} },
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
        canCreateChild: active,
        canManageSchedule: active,
        canManageWatchers: active,
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
      childAggregate: {
        visibleTotal: fixtureChildren.length,
        visibleCompleted: fixtureChildren.filter((item) => item.status === "completed").length,
        visibleCancelled: 0,
        visibleOpen: fixtureChildren.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
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
    if (qa.denyReads) throw new Error("WORK_COMMAND_DENIED");
    const signedUrl =
      id === "text"
        ? "data:text/plain;charset=utf-8,Ghi%20ch%C3%BA%20an%20to%C3%A0n%20t%E1%BA%A1i%20hi%E1%BB%87n%20tr%C6%B0%E1%BB%9Dng."
        : id === "pdf"
          ? "data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y="
          : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1UAAAAASUVORK5CYII=";
    return {
      signedUrl,
      expiresIn: query.get("previewExpired") === "true" ? 5 : 60,
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
