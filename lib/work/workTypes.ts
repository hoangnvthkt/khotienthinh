/** Vioo Work contracts. This domain is independent of project planning tasks. */
import type { WorkspaceTaskScope } from './workWorkspaceTypes';

export type WorkScope =
  | { type: 'direct'; workspaceId?: never; departmentId?: never; projectId?: never }
  | { type: 'department'; departmentId: string; workspaceId?: never; projectId?: never }
  | { type: 'project'; projectId: string; workspaceId?: never; departmentId?: never }
  | WorkspaceTaskScope;

export type WorkRecipientSource = { type: 'user' | 'work_group'; id: string };
export type WorkPriority = 'normal' | 'important' | 'urgent';
export type WorkPrivacy = 'standard' | 'restricted';
export type WorkReviewPolicy = 'auto_complete' | 'creator_review' | 'reviewer_review';
export type WorkTaskStatus = 'draft' | 'pending_acknowledgement' | 'clarification_requested'
  | 'not_started' | 'in_progress' | 'blocked' | 'awaiting_review' | 'changes_requested' | 'completed' | 'cancelled';
export type WorkAssignmentState = Exclude<WorkTaskStatus, 'draft'> | 'transferred';

export type WorkInlineNode =
  | {
      type: "text";
      text: string;
      marks?: Array<{ type: "bold" | "italic" | "strike" | "code" }>;
    }
  | { type: "mention"; userId: string; label: string };

/** Rich text content, rendered as safe text/mention nodes; never interpret as HTML. */
export interface WorkTextDocument {
  version: 1;
  type: "doc";
  content: Array<{
    type: "paragraph";
    content: WorkInlineNode[];
  }>;
}

export interface CreateWorkTaskInput {
  title: string;
  description: WorkTextDocument;
  scope: WorkScope;
  taskGroupId?: string;
  recipientSources: WorkRecipientSource[];
  watcherUserIds: string[];
  reviewerUserId?: string;
  reviewPolicy?: WorkReviewPolicy;
  plannedStartAt?: string;
  deadlineAt?: string;
  priority: WorkPriority;
  privacy: WorkPrivacy;
  labels: string[];
  checklist: Array<{ title: string; assigneeUserId?: string }>;
  clonedFromTaskId?: string;
  parentTaskId?: string;
}

export interface WorkRecipientPreview {
  sources: WorkRecipientSource[];
  validRecipients: Array<{ userId: string; name: string; sources: WorkRecipientSource[] }>;
  invalidRecipients: Array<{
    userId: string | null;
    reason: 'NO_APP_ACCOUNT' | 'INACTIVE_USER' | 'ACCOUNT_NOT_ACTIVE' | 'NO_MODULE_ACCESS'
      | 'NOT_WORKSPACE_MEMBER' | 'GROUP_NOT_FOUND' | 'GROUP_INACTIVE' | 'NO_ACTIVE_MEMBERS';
    sources: WorkRecipientSource[];
  }>;
  validCount: number;
  invalidCount: number;
  fingerprint: string;
}

export interface WorkTaskCommandResult {
  taskId: string;
  taskCode: string;
  lockVersion: number;
  status: WorkTaskStatus;
  capabilities?: WorkTaskCapabilities;
}

export interface WorkTaskCursor { sortAt: string; id: string }
export interface WorkTaskPage<T> { items: T[]; nextCursor: WorkTaskCursor | null }
export type WorkTaskView = 'assigned_to_me' | 'created_by_me' | 'following' | 'pinned';
export interface WorkTaskFilters {
  status?: WorkTaskStatus[];
  priority?: WorkPriority[];
  scope?: WorkScope;
  taskGroupId?: string;
  assigneeUserId?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  search?: string;
}

/** Read projections retain database field names. Commands use camelCase inputs. */
export interface WorkTaskSummary {
  /** List-only aggregates; task detail has its separate assignment projection. */
  assignment_count?: number;
  acknowledged_count?: number;
  id: string;
  task_code: string;
  title: string;
  status: WorkTaskStatus;
  priority: WorkPriority;
  privacy: WorkPrivacy;
  scope_type: WorkScope['type'];
  /** Null for direct and legacy tasks that have not entered a Workspace. */
  workspace_id?: string | null;
  department_id: string | null;
  project_id: string | null;
  task_group_id: string | null;
  planned_start_at?: string | null;
  deadline_at: string | null;
  parent_task_id?: string | null;
  created_by: string;
  reviewer_user_id: string | null;
  updated_at: string;
  lock_version: number;
}
export interface WorkTask extends WorkTaskSummary {
  started_at: string | null;
  blocked_reason: string | null;
  description_document: WorkTextDocument;
  description_text: string;
  recipient_snapshot_fingerprint: string | null;
  labels: string[];
  review_policy: WorkReviewPolicy;
  cloned_from_task_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}
export interface WorkTaskAssignment {
  id: string;
  task_id: string;
  user_id: string;
  state: WorkAssignmentState;
  assigned_by: string;
  assigned_at: string;
  acknowledgement_due_at: string | null;
  execution_sla_started_at: string | null;
  execution_sla_due_at: string | null;
  sla_snapshot: Record<string, unknown>;
  acknowledged_at: string | null;
  clarification_requested_at: string | null;
  clarification_note: string | null;
  started_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  completed_at: string | null;
  ended_at: string | null;
  transfer_from_assignment_id: string | null;
  transfer_to_assignment_id: string | null;
  transfer_reason: string | null;
  created_at: string;
  updated_at: string;
}
export interface WorkTaskParticipant {
  id: string;
  task_id: string;
  user_id: string;
  participant_role: 'watcher' | 'reviewer';
  added_by: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}
export interface WorkChecklistItem {
  id: string;
  task_id: string;
  title: string;
  assignee_user_id: string | null;
  sort_order: number;
  completed_by: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  lock_version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface WorkTaskSubmission {
  id: string;
  task_id: string;
  iteration: number;
  submitted_by: string;
  result_document: WorkTextDocument;
  result_text: string;
  status: 'pending_review' | 'approved' | 'changes_requested';
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}
export type WorkAttachmentKind = 'input' | 'discussion' | 'result' | 'evidence';
export interface WorkAttachmentFileVariant { path: string; mimeType: string; sizeBytes: number; width?: number; height?: number }
export interface WorkTaskAttachment {
  id: string;
  task_id: string;
  uploader_user_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: 'ready';
  attachment_kind: WorkAttachmentKind;
  can_delete: boolean;
  variants: Partial<Record<'thumbnail' | 'display' | 'fallback' | 'original', WorkAttachmentFileVariant>>;
  keep_original: boolean;
  evidence_type: string | null;
  finalized_at: string | null;
  deleted_at: null;
  deleted_by: string | null;
  created_at: string;
}
/** Server decisions include task state, canonical scope and active assignment. */
export interface WorkTaskCapabilities {
  canClone: boolean;
  canViewHistory: boolean;
  canAcknowledge: boolean;
  canRequestClarification: boolean;
  canStart: boolean;
  canBlock: boolean;
  canUnblock: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canCancel: boolean;
  canTransfer: boolean;
  canAddAssignees: boolean;
  canManageChecklist: boolean;
  canCreateChild?: boolean;
  canManageSchedule?: boolean;
  canManageWatchers?: boolean;
  canComment: boolean;
  canSetPreferences: boolean;
  canAttachInput: boolean;
  canAttachDiscussion: boolean;
  canAttachResult: boolean;
  canAttachEvidence: boolean;
}
export type WorkLifecycleCommand =
  | { command: 'acknowledge' | 'start' | 'unblock'; payload: Record<string, never> }
  | { command: 'request_clarification' | 'block' | 'cancel'; payload: { reason: string } }
  | { command: 'submit'; payload: { result: WorkTextDocument } }
  | { command: 'review'; payload: { decision: 'approve'; reason?: string } | { decision: 'request_changes'; reason: string } }
  | { command: 'transfer'; payload: { userId: string; reason: string } }
  | { command: 'add_assignees'; payload: { userIds: string[] } };
export type WorkLifecycleCommandInput = WorkLifecycleCommand & {
  taskId: string;
  expectedLockVersion: number;
  idempotencyKey: string;
};
export interface WorkTaskDetail {
  task: WorkTask;
  assignments: WorkTaskAssignment[];
  participants: WorkTaskParticipant[];
  checklist: WorkChecklistItem[];
  currentSubmission: WorkTaskSubmission | null;
  attachments: WorkTaskAttachment[];
  capabilities: WorkTaskCapabilities;
  preferences: WorkTaskPreferences;
  childAggregate?: WorkTaskChildAggregate;
}

export interface WorkTaskChildSummary extends WorkTaskSummary {
  parent_task_id: string;
  assignee_names: string[];
  attachment_count: number;
}

export interface WorkTaskChildAggregate {
  visibleTotal: number;
  visibleCompleted: number;
  visibleCancelled: number;
  visibleOpen: number;
}

export interface WorkTaskChildrenPage {
  items: WorkTaskChildSummary[];
  aggregate: WorkTaskChildAggregate;
  nextCursor: WorkTaskCursor | null;
}

export interface WorkDetailContext { names: Record<string,string>; scopeName:string; bucketName:string|null }
export interface WorkCommentAnchor { comment:WorkTaskComment; parent:WorkTaskComment|null }

/** Mute applies to routine activity; mandatory delivery is enforced by the worker. */
export interface WorkTaskPreferences {
  pinned: boolean;
  notificationsEnabled: boolean;
}
export interface WorkTaskComment {
  id: string;
  task_id: string;
  author_user_id: string;
  parent_comment_id: string | null;
  content_document: WorkTextDocument;
  content_text: string;
  edited_at: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
  mentionedUserIds: string[];
  /** Author-only editing while the task is open and the actor can comment. */
  can_edit: boolean;
}
export interface WorkTaskEvent {
  id: string;
  task_id: string;
  actor_user_id: string | null;
  event_type: string;
  source: 'human' | 'ai_chatbot' | 'automation' | 'system';
  payload: Record<string, unknown>;
  correlation_id: string | null;
  idempotency_key: string | null;
  created_at: string;
}
export interface WorkTaskHistoryFilters {
  category?: 'status' | 'assignees' | 'files' | 'comments' | 'sla' | 'permissions' | 'checklist';
  actorUserId?: string;
}
export interface WorkMentionCandidatePage {
  items: Array<{ userId: string; name: string }>;
  /** UUID cursor, ordered by user ID. Search and task must remain the same. */
  nextCursor: string | null;
}
/** Comment edits replace content and the full mention list; an omitted list means empty. */
export type WorkCollaborationCommand =
  | { command: 'checklist_create'; payload: { title: string; assigneeUserId?: string | null; sortOrder?: number } }
  | { command: 'checklist_update'; payload: { itemId: string; expectedLockVersion: number; title?: string; assigneeUserId?: string | null; sortOrder?: number } }
  | { command: 'checklist_set_completed'; payload: { itemId: string; expectedLockVersion: number; completed: boolean } }
  | { command: 'checklist_delete'; payload: { itemId: string; expectedLockVersion: number } }
  | { command: 'comment_create'; payload: { content: WorkTextDocument; parentCommentId?: string; mentionedUserIds?: string[] } }
  | { command: 'comment_edit'; payload: { commentId: string; expectedLockVersion: number; content: WorkTextDocument; mentionedUserIds?: string[] } }
  | { command: 'set_pin'; payload: { pinned: boolean } }
  | { command: 'set_notifications'; payload: { notificationsEnabled: boolean } }
  | {
      command: "schedule_update";
      payload: {
        plannedStartAt: string | null;
        deadlineAt: string | null;
        expectedLockVersion: number;
      };
    }
  | {
      command: "watchers_update";
      payload: {
        addUserIds: string[];
        removeUserIds: string[];
        expectedLockVersion: number;
      };
    };
export type WorkCollaborationCommandInput = WorkCollaborationCommand & { taskId: string; idempotencyKey: string };
export type WorkCollaborationCommandResult = { taskId: string; taskLockVersion: number } & (
  | { item: WorkChecklistItem }
  | { comment: WorkTaskComment }
  | { preferences: WorkTaskPreferences }
  | { schedule: { plannedStartAt: string | null; deadlineAt: string | null } }
  | { addedUserIds: string[]; removedUserIds: string[] }
);
export interface WorkTaskCloneDraft {
  draft: CreateWorkTaskInput;
  recipientSnapshot: Array<{ userId: string }>;
  requiresDeadlineConfirmation: boolean;
}
export interface WorkTaskGroup {
  id: string;
  name: string;
  description: string | null;
  scope_type: 'department' | 'project';
  department_id: string | null;
  project_id: string | null;
  sort_order: number;
  created_at: string;
}
