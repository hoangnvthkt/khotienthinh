import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WorkLifecycleCommandInput,
  WorkCollaborationCommandInput,
  WorkCollaborationCommandResult,
  WorkTaskComment,
  WorkTaskEvent,
  WorkTaskHistoryFilters,
  WorkMentionCandidatePage,
  WorkDetailContext,
  WorkCommentAnchor,
} from "./workTypes";
import type {
  CreateWorkTaskInput,
  WorkRecipientPreview,
  WorkPriority,
  WorkScope,
  WorkTaskCommandResult,
  WorkTaskCursor,
  WorkTaskDetail,
  WorkTaskFilters,
  WorkTaskPage,
  WorkTaskSummary,
  WorkTaskView,
} from "./workTypes";
export interface WorkOption {
  id: string;
  name: string;
  kind: string;
}
export interface WorkOptionPage {
  items: WorkOption[];
  nextCursor: { id: string } | null;
}
export interface WorkCreationContext {
  actorId: string;
  canCreate: boolean;
  canAssignUser: boolean;
  canAssignGroup: boolean;
  canChooseReviewer: boolean;
  calendarReady: boolean;
}
export interface WorkCloneForm {
  draft: CreateWorkTaskInput;
  requiresDeadlineConfirmation: boolean;
  labels: Record<string, string>;
}
export type WorkOptionKind =
  | "scope"
  | "filter_scope"
  | "user"
  | "work_group"
  | "watcher"
  | "reviewer";
export function createWorkTaskService(client: Pick<SupabaseClient, "rpc">) {
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data as T;
  }
  return {
    command: (input: WorkLifecycleCommandInput) =>
      call<WorkTaskCommandResult>("command_work_task", {
        p_task_id: input.taskId,
        p_command: input.command,
        p_payload: input.payload,
        p_expected_lock_version: input.expectedLockVersion,
        p_idempotency_key: input.idempotencyKey,
      }),
    collaborate: (input: WorkCollaborationCommandInput) =>
      call<WorkCollaborationCommandResult>("command_work_task_collaboration", {
        p_task_id: input.taskId,
        p_command: input.command,
        p_payload: input.payload,
        p_idempotency_key: input.idempotencyKey,
      }),
    comments: (taskId: string, cursor: WorkTaskCursor | null = null) =>
      call<WorkTaskPage<WorkTaskComment>>("list_work_task_comments", {
        p_task_id: taskId,
        p_cursor: cursor,
        p_limit: 30,
      }),
    history: (
      taskId: string,
      filters: WorkTaskHistoryFilters = {},
      cursor: WorkTaskCursor | null = null,
    ) =>
      call<WorkTaskPage<WorkTaskEvent>>("list_work_task_history", {
        p_task_id: taskId,
        p_filters: filters,
        p_cursor: cursor,
        p_limit: 30,
      }),
    mentions: (taskId: string, search = "", cursor: string | null = null) =>
      call<WorkMentionCandidatePage>("list_work_task_mention_candidates", {
        p_task_id: taskId,
        p_search: search,
        p_cursor: cursor,
        p_limit: 30,
      }),
    assigneeOptions: (
      taskId: string,
      action: "transfer" | "add_assignees",
      search = "",
      cursor: string | null = null,
    ) =>
      call<WorkMentionCandidatePage>("list_work_task_assignment_candidates", {
        p_task_id: taskId,
        p_action: action,
        p_search: search,
        p_cursor: cursor,
        p_limit: 30,
      }),
    detailContext: (taskId: string, userIds: string[] = []) =>
      call<WorkDetailContext>("get_work_task_ui_context", {
        p_task_id: taskId,
        p_user_ids: userIds,
      }),
    commentAnchor: (taskId: string, commentId: string) =>
      call<WorkCommentAnchor>("get_work_task_comment_anchor", {
        p_task_id: taskId,
        p_comment_id: commentId,
      }),
    list: (
      view: WorkTaskView,
      filters: WorkTaskFilters,
      cursor: WorkTaskCursor | null = null,
    ) =>
      call<WorkTaskPage<WorkTaskSummary>>("list_work_tasks", {
        p_view: view,
        p_filters: filters,
        p_cursor: cursor,
        p_limit: 30,
      }),
    detail: (taskRef: string) =>
      call<WorkTaskDetail>("get_work_task_detail", { p_task_ref: taskRef }),
    clone: (taskId: string) =>
      call<WorkCloneForm>("get_work_clone_form", { p_task_id: taskId }),
    context: (scope: WorkScope, priority: WorkPriority = "normal") =>
      call<WorkCreationContext>("get_work_creation_context", {
        p_scope: scope,
        p_priority: priority,
      }),
    options: (
      kind: WorkOptionKind,
      scope: WorkScope | null,
      search = "",
      cursor: { id: string } | null = null,
    ) =>
      call<WorkOptionPage>("list_work_creation_options", {
        p_kind: kind,
        p_scope: scope,
        p_search: search,
        p_cursor: cursor,
        p_limit: 30,
      }),
    groups: (scope: WorkScope, cursor: WorkTaskCursor | null = null) =>
      call<WorkTaskPage<{ id: string; name: string }>>(
        "list_work_task_groups",
        { p_scope: scope, p_cursor: cursor, p_limit: 30 },
      ),
    preview: (
      sources: CreateWorkTaskInput["recipientSources"],
      scope: WorkScope,
    ) =>
      call<WorkRecipientPreview>("preview_work_task_recipients", {
        p_sources: sources,
        p_scope: scope,
      }),
    create: (input: CreateWorkTaskInput, key: string, fingerprint: string) =>
      call<WorkTaskCommandResult>("create_work_task", {
        p_input: input,
        p_idempotency_key: key,
        p_recipient_fingerprint: fingerprint,
      }),
  };
}
export type WorkTaskService = ReturnType<typeof createWorkTaskService>;
