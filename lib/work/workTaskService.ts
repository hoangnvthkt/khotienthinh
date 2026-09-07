import type { SupabaseClient } from "@supabase/supabase-js";
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
