import type { RequestRuntimeStatus } from '../types';
import { supabase } from './supabase';

export interface SubmitRequestInput {
  requestTemplateVersionId: string;
  title: string;
  description: string;
  formData: Record<string, unknown>;
  dynamicApproversByBlock: Record<string, string[]>;
  idempotencyKey: string;
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
};
