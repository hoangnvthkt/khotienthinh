import { QualityChecklist, QualityChecklistStatus, QualityInspectionAttempt } from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

export type QualityChecklistCommandErrorCode =
  | 'QUALITY_PERMISSION_DENIED'
  | 'QUALITY_SCOPE_MISMATCH'
  | 'QUALITY_INVALID_TRANSITION'
  | 'QUALITY_RECIPIENT_INVALID'
  | 'QUALITY_STALE_VERSION'
  | 'QUALITY_REQUEST_ID_REUSED'
  | 'QUALITY_COMMAND_FAILED';

const ERROR_MESSAGES: Record<QualityChecklistCommandErrorCode, string> = {
  QUALITY_PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này trong Room Chất lượng.',
  QUALITY_SCOPE_MISMATCH: 'Hồ sơ chất lượng không thuộc đúng dự án hoặc công trường đang mở.',
  QUALITY_INVALID_TRANSITION: 'Không thể chuyển hồ sơ từ trạng thái hiện tại.',
  QUALITY_RECIPIENT_INVALID: 'Người duyệt không còn quyền phê duyệt trong Room Chất lượng.',
  QUALITY_STALE_VERSION: 'Hồ sơ đã thay đổi. Vui lòng tải lại dữ liệu trước khi tiếp tục.',
  QUALITY_REQUEST_ID_REUSED: 'Mã yêu cầu đã được dùng cho một nội dung khác.',
  QUALITY_COMMAND_FAILED: 'Không thể cập nhật hồ sơ chất lượng. Vui lòng thử lại.',
};

export class QualityChecklistCommandError extends Error {
  constructor(
    public readonly code: QualityChecklistCommandErrorCode,
    message = ERROR_MESSAGES[code],
    public readonly shouldReload = code === 'QUALITY_STALE_VERSION',
  ) {
    super(message);
    this.name = 'QualityChecklistCommandError';
  }
}

export interface QualityChecklistCommandScope {
  projectId: string;
  constructionSiteId: string;
}

export interface QualityChecklistCommandResult {
  ok: boolean;
  requestId: string;
  replayed: boolean;
  mutated: boolean;
  checklist: QualityChecklist | null;
  attempt?: QualityInspectionAttempt | null;
}

type RpcResult = Promise<{ data: any; error: any }>;
type RpcInvoker = (name: string, params: Record<string, unknown>) => RpcResult;

const knownErrorCodes = Object.keys(ERROR_MESSAGES) as QualityChecklistCommandErrorCode[];

const mapCommandError = (error: any): QualityChecklistCommandError => {
  const detail = [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(' ');
  const code = knownErrorCodes.find(candidate => detail.includes(candidate))
    || 'QUALITY_COMMAND_FAILED';
  return new QualityChecklistCommandError(code);
};

const defaultRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createQualityChecklistCommandService = (dependencies: {
  rpc: RpcInvoker;
  newRequestId?: () => string;
}) => {
  const execute = async (
    rpcName: string,
    scope: QualityChecklistCommandScope,
    params: Record<string, unknown>,
    requestId?: string,
  ): Promise<QualityChecklistCommandResult> => {
    const effectiveRequestId = requestId || dependencies.newRequestId?.() || defaultRequestId();
    const { data, error } = await dependencies.rpc(rpcName, {
      p_request_id: effectiveRequestId,
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      ...params,
    });

    if (error) throw mapCommandError(error);

    const result = fromDb(data || {});
    return {
      ok: result.ok === true,
      requestId: result.requestId || effectiveRequestId,
      replayed: result.replayed === true,
      mutated: result.replayed !== true,
      checklist: result.checklist ? fromDb(result.checklist) : null,
      attempt: result.attempt ? fromDb(result.attempt) : null,
    };
  };

  return {
    create(
      scope: QualityChecklistCommandScope,
      payload: Partial<QualityChecklist>,
      submissionTarget?: { userId: string; name?: string; note?: string } | null,
      requestId?: string,
    ) {
      return execute('create_quality_checklist', scope, {
        p_payload: toDb(payload),
        p_submission_target: submissionTarget ? toDb(submissionTarget) : null,
      }, requestId);
    },

    update(
      scope: QualityChecklistCommandScope,
      checklistId: string,
      expectedUpdatedAt: string,
      changes: Partial<QualityChecklist>,
      requestId?: string,
    ) {
      return execute('update_quality_checklist', scope, {
        p_checklist_id: checklistId,
        p_expected_updated_at: expectedUpdatedAt,
        p_changes: toDb(changes),
      }, requestId);
    },

    transition(
      scope: QualityChecklistCommandScope,
      checklistId: string,
      expectedUpdatedAt: string,
      status: QualityChecklistStatus,
      options: { targetUserId?: string; targetName?: string; targetNote?: string; reason?: string } = {},
      requestId?: string,
    ) {
      return execute('transition_quality_checklist', scope, {
        p_checklist_id: checklistId,
        p_expected_updated_at: expectedUpdatedAt,
        p_status: status,
        p_submission_target: options.targetUserId ? {
          user_id: options.targetUserId,
          name: options.targetName,
          note: options.targetNote,
        } : null,
        p_reason: options.reason || null,
      }, requestId);
    },

    remove(
      scope: QualityChecklistCommandScope,
      checklistId: string,
      expectedUpdatedAt: string,
      requestId?: string,
    ) {
      return execute('delete_quality_checklist', scope, {
        p_checklist_id: checklistId,
        p_expected_updated_at: expectedUpdatedAt,
      }, requestId);
    },

    createAttempt(
      scope: QualityChecklistCommandScope,
      checklistId: string,
      expectedUpdatedAt: string,
      attempt: Partial<QualityInspectionAttempt>,
      requestId?: string,
    ) {
      return execute('create_quality_inspection_attempt', scope, {
        p_checklist_id: checklistId,
        p_expected_updated_at: expectedUpdatedAt,
        p_payload: toDb(attempt),
      }, requestId);
    },
  };
};

export const qualityChecklistCommandService = createQualityChecklistCommandService({
  rpc: async (name, params) => {
    const { data, error } = await supabase.rpc(name, params);
    return { data, error };
  },
});
