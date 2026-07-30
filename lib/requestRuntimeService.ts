import type {
  RequestAssignmentStatus,
  RequestCompletionPolicy,
  RequestFlowMode,
  RequestRuntimeStatus,
  RequestTemplateFieldSchema,
} from '../types';
import { supabase } from './supabase';

export interface SubmitRequestInput {
  requestTemplateVersionId: string;
  title: string;
  description: string;
  formData: Record<string, unknown>;
  dynamicApproversByBlock: Record<string, string[]>;
  idempotencyKey: string;
}

export interface UsableRequestTemplate {
  templateId: string;
  templateVersionId: string;
  name: string;
  description: string;
  versionNumber: number;
  formSchema: RequestTemplateFieldSchema[];
  approvalBlocks: Array<{
    key: string;
    name: string;
    source: 'FIXED_SINGLE' | 'FIXED_MULTI' | 'DIRECT_MANAGER' | 'DYNAMIC_CREATOR_SELECT';
    minimumDynamicApprovers: number | null;
    sortOrder: number;
  }>;
}

export interface RequestCommandResult {
  requestId: string;
  requestCode: string;
  status: RequestRuntimeStatus;
  workflowInstanceId: string;
  workflowSubjectId: string;
  currentBlockKeys: string[];
  updatedAt: string;
}

export interface RequestListFilters {
  view: 'ALL' | 'ASSIGNED_TO_ME' | 'CREATED_BY_ME' | 'WATCHING';
  status?: 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  overdue?: boolean;
  search?: string;
  templateId?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export interface RequestUserSnapshot {
  id: string;
  name: string;
  avatarUrl: string | null;
  position: string | null;
}

export interface RequestListItem {
  id: string;
  code: string;
  title: string;
  status: RequestRuntimeStatus;
  templateId: string;
  templateName: string;
  creator: RequestUserSnapshot;
  activeApprovers: Array<RequestUserSnapshot & { assignmentStatus: RequestAssignmentStatus }>;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestListPage {
  items: RequestListItem[];
  nextCursor?: { createdAt: string; id: string };
}

export interface RequestActionCapabilities {
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canResubmit: boolean;
  canCancel: boolean;
  canReassign: boolean;
  canPrint: boolean;
}

export interface RequestApprovalBlockSnapshot {
  key: string;
  name: string;
  sortOrder: number;
  status: 'NOT_ACTIVE' | 'ACTIVE' | 'COMPLETED' | 'RETURNED' | 'CANCELLED';
  slaHours: number | null;
  assignments: Array<{
    id: string;
    roundId: string;
    approver: RequestUserSnapshot;
    status: RequestAssignmentStatus;
    actedAt: string | null;
    comment: string | null;
  }>;
}

export interface RequestDetail extends RequestListItem {
  description: string;
  templateVersionId: string;
  templateVersionNumber: number;
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  formSchema: RequestTemplateFieldSchema[];
  formData: Record<string, unknown>;
  approvalBlocks: RequestApprovalBlockSnapshot[];
  watcherIds: string[];
  timeline: Array<{
    id: string;
    eventType: string;
    actor: RequestUserSnapshot | null;
    comment: string | null;
    createdAt: string;
  }>;
  printConfig: {
    browserPrintEnabled: boolean;
    docxStoragePath: string | null;
  };
  capabilities: RequestActionCapabilities;
}

export interface RequestSummary {
  all: number;
  assignedToMe: number;
  createdByMe: number;
  watching: number;
  pending: number;
  returned: number;
  overdue: number;
  approved: number;
  rejected: number;
}

export type RequestAction =
  | 'APPROVE' | 'REJECT' | 'RETURN'
  | 'RESUBMIT' | 'CANCEL' | 'REASSIGN';

export interface ActOnRequestInput {
  requestId: string;
  action: RequestAction;
  comment?: string;
  formData?: Record<string, unknown>;
  assigneeUserId?: string;
  idempotencyKey: string;
  expectedUpdatedAt: string;
}

export type RequestRpcErrorCode =
  | 'REQUEST_STALE_STATE'
  | 'REQUEST_ACTION_FORBIDDEN'
  | 'REQUEST_ASSIGNMENT_NOT_ACTIVE'
  | 'REQUEST_ALREADY_PROCESSED'
  | 'REQUEST_APPROVER_INACTIVE'
  | 'REQUEST_DIRECT_MANAGER_MISSING'
  | 'REQUEST_DYNAMIC_APPROVER_REQUIRED'
  | 'REQUEST_TEMPLATE_NOT_PUBLISHED'
  | 'REQUEST_TEMPLATE_OUT_OF_SCOPE'
  | 'REQUEST_PRINT_TEMPLATE_INVALID'
  | 'REQUEST_IDEMPOTENCY_CONFLICT'
  | 'REQUEST_NOT_FOUND_OR_FORBIDDEN';

export class RequestRpcError extends Error {
  readonly code: RequestRpcErrorCode | string;
  readonly cause: unknown;

  constructor(code: RequestRpcErrorCode | string, message: string, cause?: unknown) {
    super(message);
    this.name = 'RequestRpcError';
    this.code = code;
    this.cause = cause;
  }
}

const REQUEST_RUNTIME_STATUSES = new Set<RequestRuntimeStatus>([
  'DRAFT', 'PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED',
]);

export const assertRequestCommandResult = (value: unknown, commandName = 'request command'):
  RequestCommandResult => {
  if (!value || typeof value !== 'object') {
    throw new Error(`${commandName} không trả về dữ liệu.`);
  }
  const result = value as Partial<RequestCommandResult>;
  if (
    typeof result.requestId !== 'string'
    || typeof result.requestCode !== 'string'
    || typeof result.status !== 'string'
    || !REQUEST_RUNTIME_STATUSES.has(result.status as RequestRuntimeStatus)
    || typeof result.workflowInstanceId !== 'string'
    || typeof result.workflowSubjectId !== 'string'
    || !Array.isArray(result.currentBlockKeys)
    || result.currentBlockKeys.some(key => typeof key !== 'string')
    || typeof result.updatedAt !== 'string'
  ) {
    throw new Error(`${commandName} trả về dữ liệu không hợp lệ.`);
  }
  return result as RequestCommandResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNullableString = (value: unknown): value is string | null => (
  value === null || isString(value)
);

const isUserSnapshot = (value: unknown): value is RequestUserSnapshot => {
  if (!isRecord(value)) return false;
  return isString(value.id)
    && isString(value.name)
    && isNullableString(value.avatarUrl)
    && isNullableString(value.position);
};

const REQUEST_ASSIGNMENT_STATUSES = new Set<RequestAssignmentStatus>([
  'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED',
]);

const REQUEST_BLOCK_STATUSES = new Set<RequestApprovalBlockSnapshot['status']>([
  'NOT_ACTIVE', 'ACTIVE', 'COMPLETED', 'RETURNED', 'CANCELLED',
]);

const isListItem = (value: unknown): value is RequestListItem => {
  if (!isRecord(value)) return false;
  const activeApprovers = value.activeApprovers;
  return isString(value.id)
    && isString(value.code)
    && isString(value.title)
    && isString(value.status)
    && REQUEST_RUNTIME_STATUSES.has(value.status as RequestRuntimeStatus)
    && isString(value.templateId)
    && isString(value.templateName)
    && isUserSnapshot(value.creator)
    && Array.isArray(activeApprovers)
    && activeApprovers.every(item => {
      if (!isRecord(item) || !isUserSnapshot(item)) return false;
      const assignmentStatus = (item as unknown as { assignmentStatus?: unknown }).assignmentStatus;
      return isString(assignmentStatus)
        && REQUEST_ASSIGNMENT_STATUSES.has(assignmentStatus as RequestAssignmentStatus);
    })
    && isNullableString(value.dueAt)
    && isString(value.createdAt)
    && isString(value.updatedAt);
};

const isListPage = (value: unknown): value is RequestListPage => {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(isListItem)) {
    return false;
  }
  return value.nextCursor === undefined
    || value.nextCursor === null
    || (isRecord(value.nextCursor)
      && isString(value.nextCursor.createdAt)
      && isString(value.nextCursor.id));
};

const isUsableTemplate = (value: unknown): value is UsableRequestTemplate => {
  if (!isRecord(value)) return false;
  return isString(value.templateId) && isString(value.templateVersionId)
    && isString(value.name) && isString(value.description)
    && typeof value.versionNumber === 'number'
    && Array.isArray(value.formSchema) && Array.isArray(value.approvalBlocks);
};

const isCapabilities = (value: unknown): value is RequestActionCapabilities => {
  if (!isRecord(value)) return false;
  return [
    'canApprove', 'canReject', 'canReturn', 'canResubmit',
    'canCancel', 'canReassign', 'canPrint',
  ].every(key => typeof value[key] === 'boolean');
};

const isDetail = (value: unknown): value is RequestDetail => {
  if (!isRecord(value) || !isListItem(value)) return false;
  const printConfig = value.printConfig;
  return isString(value.description)
    && isString(value.templateVersionId)
    && typeof value.templateVersionNumber === 'number'
    && (value.flowMode === 'SEQUENTIAL' || value.flowMode === 'PARALLEL')
    && (value.completionPolicy === 'ALL' || value.completionPolicy === 'ANY_ONE')
    && Array.isArray(value.formSchema)
    && isRecord(value.formData)
    && Array.isArray(value.approvalBlocks)
    && value.approvalBlocks.every(block => {
      if (!isRecord(block)) return false;
      return isString(block.key)
        && isString(block.name)
        && typeof block.sortOrder === 'number'
        && isString(block.status)
        && REQUEST_BLOCK_STATUSES.has(block.status as RequestApprovalBlockSnapshot['status'])
        && (block.slaHours === null || typeof block.slaHours === 'number')
        && Array.isArray(block.assignments);
    })
    && Array.isArray(value.watcherIds)
    && value.watcherIds.every(isString)
    && Array.isArray(value.timeline)
    && value.timeline.every(event => isRecord(event)
      && isString(event.id)
      && isString(event.eventType)
      && (event.actor === null || isUserSnapshot(event.actor))
      && isNullableString(event.comment)
      && isString(event.createdAt))
    && isRecord(printConfig)
    && typeof printConfig.browserPrintEnabled === 'boolean'
    && isNullableString(printConfig.docxStoragePath)
    && isCapabilities(value.capabilities);
};

const isSummary = (value: unknown): value is RequestSummary => {
  if (!isRecord(value)) return false;
  return [
    'all', 'assignedToMe', 'createdByMe', 'watching',
    'pending', 'returned', 'overdue', 'approved', 'rejected',
  ].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
};

const REQUEST_RPC_ERROR_CODES = new Set<RequestRpcErrorCode>([
  'REQUEST_STALE_STATE',
  'REQUEST_ACTION_FORBIDDEN',
  'REQUEST_ASSIGNMENT_NOT_ACTIVE',
  'REQUEST_ALREADY_PROCESSED',
  'REQUEST_APPROVER_INACTIVE',
  'REQUEST_DIRECT_MANAGER_MISSING',
  'REQUEST_DYNAMIC_APPROVER_REQUIRED',
  'REQUEST_TEMPLATE_NOT_PUBLISHED',
  'REQUEST_TEMPLATE_OUT_OF_SCOPE',
  'REQUEST_PRINT_TEMPLATE_INVALID',
  'REQUEST_IDEMPOTENCY_CONFLICT',
  'REQUEST_NOT_FOUND_OR_FORBIDDEN',
]);

export const mapRequestRpcError = (error: unknown): RequestRpcError => {
  const value = (error ?? {}) as { code?: string; message?: string; details?: string };
  const diagnostic = value.message || value.details || 'Request RPC failed.';
  const match = diagnostic.match(/REQUEST_[A-Z0-9_]+/);
  const candidate = value.code && REQUEST_RPC_ERROR_CODES.has(value.code as RequestRpcErrorCode)
    ? value.code
    : match?.[0];
  const code = candidate && REQUEST_RPC_ERROR_CODES.has(candidate as RequestRpcErrorCode)
    ? candidate
    : 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  return new RequestRpcError(code, diagnostic, error);
};

const run = async <T>(name: string, payload: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  if (!data) throw new Error(`${name} không trả về dữ liệu.`);
  return data as T;
};

export const requestRuntimeService = {
  submit(input: SubmitRequestInput) {
    return run<RequestCommandResult>('submit_request', {
      p_request_template_version_id: input.requestTemplateVersionId,
      p_title: input.title,
      p_description: input.description,
      p_form_data: input.formData,
      p_dynamic_approvers_by_block: input.dynamicApproversByBlock,
      p_idempotency_key: input.idempotencyKey,
    }).then(result => assertRequestCommandResult(result, 'submit_request'));
  },

  async act(input: ActOnRequestInput): Promise<RequestCommandResult> {
    const { data, error } = await supabase.rpc('act_on_request', {
      p_request_id: input.requestId,
      p_action: input.action,
      p_comment: input.comment ?? null,
      p_form_data: input.formData ?? null,
      p_assignee_user_id: input.assigneeUserId ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) throw mapRequestRpcError(error);
    return assertRequestCommandResult(data, 'act_on_request');
  },

  async list(filters: RequestListFilters): Promise<RequestListPage> {
    const pFilters: Record<string, unknown> = {
      view: filters.view,
    };
    if (filters.status !== undefined) pFilters.status = filters.status;
    if (filters.overdue !== undefined) pFilters.overdue = filters.overdue;
    if (filters.search !== undefined) pFilters.search = filters.search;
    if (filters.templateId !== undefined) pFilters.templateId = filters.templateId;
    if (filters.cursor !== undefined) {
      pFilters.cursorCreatedAt = filters.cursor.createdAt;
      pFilters.cursorId = filters.cursor.id;
    }

    const result = await run<unknown>('list_request_instances', {
      p_filters: pFilters,
      p_limit: filters.limit,
    });
    if (!isListPage(result)) {
      throw new Error('list_request_instances trả về dữ liệu không hợp lệ.');
    }
    return result.nextCursor === null ? { ...result, nextCursor: undefined } : result;
  },

  async getDetail(requestId: string): Promise<RequestDetail> {
    const result = await run<unknown>('get_request_detail', {
      p_request_id: requestId,
    });
    if (!isDetail(result)) {
      throw new Error('get_request_detail trả về dữ liệu không hợp lệ.');
    }
    return result;
  },

  async getSummary(): Promise<RequestSummary> {
    const result = await run<unknown>('get_request_summary', {});
    if (!isSummary(result)) {
      throw new Error('get_request_summary trả về dữ liệu không hợp lệ.');
    }
    return result;
  },

  async listUsableTemplates(): Promise<UsableRequestTemplate[]> {
    const result = await run<unknown>('list_usable_request_templates', {});
    if (!isRecord(result) || !Array.isArray(result.items) || !result.items.every(isUsableTemplate)) {
      throw new Error('list_usable_request_templates trả về dữ liệu không hợp lệ.');
    }
    return result.items;
  },
};
