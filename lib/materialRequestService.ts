import { isSupabaseConfigured, supabase } from './supabase';
import {
  MaterialRequest,
  MaterialRequestEvent,
  MaterialRequestFulfillmentBatch,
  MaterialRequestFulfillmentMode,
  MaterialRequestFulfillmentSummary,
  MaterialRequestKanbanStage,
  MaterialRequestWorkflowStep,
  ProjectSubmissionTarget,
  RequestStatus,
  Transaction,
  TransactionStatus,
} from '../types';
import { materialRequestBoqLineSnapshotService } from './materialRequestBoqLineSnapshotService';

const EVENT_TABLE = 'material_request_events';
const DEFAULT_PROJECT_REQUEST_PAGE_SIZE = 500;

export type MaterialRequestListPage = {
  rows: MaterialRequest[];
  nextCursor: string | null;
  hasMore: boolean;
};

const normalizePageLimit = (limit?: number | null): number =>
  Math.max(1, Math.min(Math.floor(Number(limit || DEFAULT_PROJECT_REQUEST_PAGE_SIZE)), 1000));

const parseOffsetCursor = (cursor?: string | null): number => {
  const offset = Number(cursor || 0);
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
};

export interface MaterialRequestEventCursor {
  createdAt: string;
  id: string;
}

export interface MaterialRequestEventPage {
  items: MaterialRequestEvent[];
  nextCursor?: MaterialRequestEventCursor;
}

export const MATERIAL_REQUEST_STEP_SLA_HOURS: Record<MaterialRequestWorkflowStep, number | null> = {
  draft: null,
  site_manager_review: 24,
  material_department_review: 24,
  batch_planning: 48,
  site_quality_check: 8,
  site_receipt: 8,
  completed: null,
  rejected: null,
  returned_to_creator: null,
};

export const MATERIAL_REQUEST_KANBAN_COLUMNS: Array<{ id: MaterialRequestKanbanStage; label: string; hint: string }> = [
  { id: 'draft', label: 'Nháp', hint: 'Phiếu đang soạn hoặc chưa gửi duyệt' },
  { id: 'site_manager_review', label: 'Chờ quản lý CT duyệt', hint: 'Đang chờ người duyệt tại công trường' },
  { id: 'material_department_review', label: 'Chờ phòng vật tư xử lý', hint: 'Đã qua công trường, chờ phòng vật tư duyệt' },
  { id: 'batch_planning', label: 'Chờ tạo đợt cấp', hint: 'Đã duyệt, chờ tạo đợt cấp/PO' },
  { id: 'site_quality_check', label: 'Đang cấp - chờ duyệt SL/CL', hint: 'Đợt cấp đã tạo, thủ kho công trường kiểm tra' },
  { id: 'site_receipt', label: 'Chờ xác nhận nhập kho', hint: 'Đã duyệt SL/CL, chờ xác nhận nhận hàng' },
  { id: 'completed', label: 'Hoàn tất', hint: 'Đã nhận đủ theo phiếu' },
  { id: 'closed', label: 'Từ chối / trả lại', hint: 'Phiếu bị từ chối hoặc trả lại người tạo' },
];

const isMissingEventTable = (error: any): boolean =>
  error?.code === '42P01' || String(error?.message || '').includes(EVENT_TABLE);

const mapEventFromDb = (row: any): MaterialRequestEvent => ({
  id: row.id,
  requestId: row.request_id ?? row.requestId,
  projectId: row.project_id ?? row.projectId,
  fromStep: row.from_step ?? row.fromStep ?? null,
  toStep: row.to_step ?? row.toStep ?? null,
  action: row.action,
  actorUserId: row.actor_user_id ?? row.actorUserId,
  targetUserId: row.target_user_id ?? row.targetUserId ?? null,
  targetPermission: row.target_permission ?? row.targetPermission ?? null,
  note: row.note ?? null,
  slaHours: row.sla_hours ?? row.slaHours ?? null,
  dueAt: row.due_at ?? row.dueAt ?? null,
  metadata: row.metadata || {},
  createdAt: row.created_at ?? row.createdAt,
});

const listProjectRequestsPage = async (input: {
  projectId: string;
  constructionSiteId?: string | null;
  limit?: number | null;
  cursor?: string | null;
}): Promise<MaterialRequestListPage> => {
  if (!input.projectId) return { rows: [], nextCursor: null, hasMore: false };
  const limit = normalizePageLimit(input.limit);
  const offset = parseOffsetCursor(input.cursor);

  let query = supabase
    .from('requests')
    .select('*')
    .eq('request_origin', 'project')
    .eq('project_id', input.projectId)
    .order('created_date', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (input.constructionSiteId) {
    query = query.eq('construction_site_id', input.constructionSiteId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).slice(0, limit).map(mapMaterialRequestFromDb);
  const hasMore = (data || []).length > limit;
  return {
    rows,
    hasMore,
    nextCursor: hasMore ? String(offset + limit) : null,
  };
};

const listAllProjectRequests = async (projectId: string, constructionSiteId?: string | null): Promise<MaterialRequest[]> => {
  const rows: MaterialRequest[] = [];
  let cursor: string | null = null;
  do {
    const page = await listProjectRequestsPage({
      projectId,
      constructionSiteId,
      limit: DEFAULT_PROJECT_REQUEST_PAGE_SIZE,
      cursor,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
};

export const getMaterialRequestWorkflowPatch = (
  step: MaterialRequestWorkflowStep,
  actorUserId?: string | null,
  at = new Date(),
): Pick<MaterialRequest, 'workflowStep' | 'workflowStepStartedAt' | 'workflowStepDueAt' | 'workflowStepSlaHours' | 'workflowStepActorUserId'> => {
  const slaHours = MATERIAL_REQUEST_STEP_SLA_HOURS[step] ?? null;
  const startedAt = at.toISOString();
  const dueAt = slaHours ? new Date(at.getTime() + slaHours * 60 * 60 * 1000).toISOString() : null;
  return {
    workflowStep: step,
    workflowStepStartedAt: startedAt,
    workflowStepDueAt: dueAt,
    workflowStepSlaHours: slaHours,
    workflowStepActorUserId: actorUserId || null,
  };
};

export const getDefaultMaterialRequestWorkflowStep = (
  status?: RequestStatus | string | null,
  actionOverride?: string,
): MaterialRequestWorkflowStep => {
  if (actionOverride === 'RETURNED') return 'returned_to_creator';
  if ((actionOverride === 'FULFILLMENT_ISSUED' || actionOverride === 'FULFILLMENT_SYNC') && status === RequestStatus.IN_TRANSIT) return 'site_quality_check';
  if (actionOverride === 'FULFILLMENT_RECEIVED' && status === RequestStatus.IN_TRANSIT) return 'batch_planning';
  if (actionOverride === 'FULFILLMENT_RECEIVED' && status === RequestStatus.APPROVED) return 'batch_planning';
  if (status === RequestStatus.PENDING) return 'site_manager_review';
  if (status === RequestStatus.APPROVED) return 'batch_planning';
  if (status === RequestStatus.IN_TRANSIT) return 'site_quality_check';
  if (status === RequestStatus.COMPLETED) return 'completed';
  if (status === RequestStatus.REJECTED) return 'rejected';
  return 'draft';
};

export const getMaterialRequestSlaState = (request: MaterialRequest): 'none' | 'normal' | 'urgent' | 'overdue' => {
  if (!request.workflowStepDueAt || !request.workflowStepStartedAt || !request.workflowStepSlaHours) return 'none';
  const due = new Date(request.workflowStepDueAt).getTime();
  const started = new Date(request.workflowStepStartedAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(due) || !Number.isFinite(started) || due <= started) return 'none';
  if (now > due) return 'overdue';
  const remainingRatio = (due - now) / (due - started);
  return remainingRatio <= 0.25 ? 'urgent' : 'normal';
};

export const resolveRequestKanbanStage = (
  request: MaterialRequest,
  batches: MaterialRequestFulfillmentBatch[] = [],
  transactions: Transaction[] = [],
  summary?: MaterialRequestFulfillmentSummary,
): MaterialRequestKanbanStage => {
  if (request.status === RequestStatus.REJECTED || request.workflowStep === 'rejected' || request.workflowStep === 'returned_to_creator') {
    return 'closed';
  }
  if (request.status === RequestStatus.COMPLETED || request.workflowStep === 'completed') return 'completed';
  if (request.status === RequestStatus.DRAFT) return 'draft';

  const activeBatches = batches.filter(batch => !['cancelled', 'draft', 'returned'].includes(batch.status));
  const issuedBatches = activeBatches.filter(batch => batch.status === 'issued');
  const transactionById = new Map(transactions.map(tx => [tx.id, tx]));

  if (issuedBatches.length > 0) {
    const issuedTxs = issuedBatches.map(batch => batch.transactionId ? transactionById.get(batch.transactionId) : undefined).filter(Boolean) as Transaction[];
    if (issuedTxs.some(tx => tx.status === TransactionStatus.APPROVED)) return 'site_receipt';
    return 'site_quality_check';
  }

  if (request.status === RequestStatus.IN_TRANSIT) {
    if (summary && summary.committedQty > 0 && summary.receivedQty >= summary.committedQty) return 'completed';
    return 'batch_planning';
  }
  if (request.status === RequestStatus.APPROVED) return 'batch_planning';
  if (request.status === RequestStatus.PENDING) {
    return request.workflowStep === 'material_department_review' ? 'material_department_review' : 'site_manager_review';
  }
  return 'draft';
};

export const mapMaterialRequestFromDb = (row: any): MaterialRequest => ({
  ...row,
  title: row.title ?? row.note ?? 'Đề xuất vật tư',
  projectId: row.project_id ?? row.projectId ?? null,
  constructionSiteId: row.construction_site_id ?? row.constructionSiteId ?? null,
  requestOrigin: row.request_origin ?? row.requestOrigin ?? 'wms',
  siteWarehouseId: row.site_warehouse_id ?? row.siteWarehouseId,
  sourceWarehouseId: row.source_warehouse_id ?? row.sourceWarehouseId ?? undefined,
  requesterId: row.requester_id ?? row.requesterId,
  createdDate: row.created_date ?? row.createdDate,
  expectedDate: row.expected_date ?? row.expectedDate,
  fulfillmentMode: row.fulfillment_mode || row.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
  overrideReason: row.override_reason ?? row.overrideReason ?? undefined,
  relatedTransactionId: row.related_transaction_id ?? row.relatedTransactionId ?? undefined,
  submittedToUserId: row.submitted_to_user_id ?? row.submittedToUserId ?? undefined,
  submittedToName: row.submitted_to_name ?? row.submittedToName ?? undefined,
  submittedToPermission: row.submitted_to_permission ?? row.submittedToPermission ?? undefined,
  submissionNote: row.submission_note ?? row.submissionNote ?? undefined,
  everSubmitted: row.ever_submitted ?? row.everSubmitted ?? false,
  lastActionBy: row.last_action_by ?? row.lastActionBy ?? undefined,
  lastActionAt: row.last_action_at ?? row.lastActionAt ?? undefined,
  workflowStep: row.workflow_step ?? row.workflowStep ?? undefined,
  workflowStepStartedAt: row.workflow_step_started_at ?? row.workflowStepStartedAt ?? undefined,
  workflowStepDueAt: row.workflow_step_due_at ?? row.workflowStepDueAt ?? undefined,
  workflowStepSlaHours: row.workflow_step_sla_hours ?? row.workflowStepSlaHours ?? undefined,
  workflowStepActorUserId: row.workflow_step_actor_user_id ?? row.workflowStepActorUserId ?? undefined,
  workflowInstanceId: row.workflow_instance_id ?? row.workflowInstanceId ?? null,
  workflowSubjectId: row.workflow_subject_id ?? row.workflowSubjectId ?? null,
  workflowTemplateId: row.workflow_template_id ?? row.workflowTemplateId ?? null,
});

export const materialRequestService = {
  async nextCode(): Promise<string> {
    if (!isSupabaseConfigured) {
      return `MR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    }
    const { data, error } = await supabase.rpc('next_material_request_code_v1');
    if (error) throw error;
    const code = String(data || '').trim();
    if (!code) throw new Error('Hệ thống chưa cấp được số MR mới.');
    return code;
  },

  async getById(id: string): Promise<MaterialRequest | null> {
    if (!id) return null;
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapMaterialRequestFromDb(data) : null;
  },

  async listByProject(projectId: string): Promise<MaterialRequest[]> {
    if (!projectId) return [];
    return listAllProjectRequests(projectId);
  },

  async listByProjectPage(input: {
    projectId: string;
    constructionSiteId?: string | null;
    limit?: number | null;
    cursor?: string | null;
  }): Promise<MaterialRequestListPage> {
    return listProjectRequestsPage(input);
  },

  async listEventsByRequestIds(requestIds: string[]): Promise<Record<string, MaterialRequestEvent[]>> {
    const ids = Array.from(new Set(requestIds.filter(Boolean)));
    if (ids.length === 0) return {};
    const { data, error } = await supabase
      .from(EVENT_TABLE)
      .select('*')
      .in('request_id', ids)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingEventTable(error)) return {};
      throw error;
    }
    return (data || []).reduce<Record<string, MaterialRequestEvent[]>>((acc, row) => {
      const event = mapEventFromDb(row);
      acc[event.requestId] = [...(acc[event.requestId] || []), event];
      return acc;
    }, {});
  },

  async listEventsByRequest(requestId: string, options: {
    limit?: number;
    cursor?: MaterialRequestEventCursor;
  } = {}): Promise<MaterialRequestEventPage> {
    if (!requestId) return { items: [] };
    const limit = Math.min(Math.max(options.limit || 100, 1), 200);
    let query = supabase
      .from(EVENT_TABLE)
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (options.cursor?.createdAt && options.cursor.id) {
      query = query.or(`created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingEventTable(error)) return { items: [] };
      throw error;
    }

    const rows = data || [];
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map(mapEventFromDb),
      nextCursor: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : undefined,
    };
  },

  async recordEvent(event: {
    requestId: string;
    projectId?: string | null;
    fromStep?: string | null;
    toStep?: string | null;
    action: string;
    actorUserId: string;
    targetUserId?: string | null;
    targetPermission?: string | null;
    note?: string | null;
    slaHours?: number | null;
    dueAt?: string | null;
    metadata?: Record<string, any>;
  }): Promise<MaterialRequestEvent | null> {
    if (!event.projectId) return null;
    const { data, error } = await supabase
      .from(EVENT_TABLE)
      .insert({
        request_id: event.requestId,
        project_id: event.projectId,
        from_step: event.fromStep || null,
        to_step: event.toStep || null,
        action: event.action,
        actor_user_id: event.actorUserId,
        target_user_id: event.targetUserId || null,
        target_permission: event.targetPermission || null,
        note: event.note || null,
        sla_hours: event.slaHours ?? null,
        due_at: event.dueAt || null,
        metadata: event.metadata || {},
      })
      .select('*')
      .single();
    if (error) {
      if (isMissingEventTable(error)) return null;
      throw error;
    }
    return data ? mapEventFromDb(data) : null;
  },

  async transitionProjectRequestStep(input: {
    request: MaterialRequest;
    toStep: MaterialRequestWorkflowStep;
    action: string;
    actorUserId: string;
    status?: RequestStatus;
    target?: ProjectSubmissionTarget | null;
    note?: string | null;
    metadata?: Record<string, any>;
  }): Promise<MaterialRequest> {
    const now = new Date();
    const fromStep = input.request.workflowStep || getDefaultMaterialRequestWorkflowStep(input.request.status);
    const workflowPatch = getMaterialRequestWorkflowPatch(input.toStep, input.actorUserId, now);
    const status = input.status || input.request.status;
    const logs = [
      ...(input.request.logs || []),
      {
        action: input.action,
        userId: input.actorUserId,
        timestamp: now.toISOString(),
        note: input.note || input.target?.note || undefined,
      },
    ];
    const targetPatch = input.target === undefined
      ? {}
      : input.target
        ? {
          submitted_to_user_id: input.target.userId,
          submitted_to_name: input.target.name,
          submitted_to_permission: input.target.permissionCode || null,
          submission_note: input.target.note || input.note || null,
        }
        : {
          submitted_to_user_id: null,
          submitted_to_name: null,
          submitted_to_permission: null,
          submission_note: input.note || null,
        };

    const { data, error } = await supabase
      .from('requests')
      .update({
        status,
        logs,
        ever_submitted: input.request.everSubmitted || input.action === 'SUBMITTED' || input.action === 'FORWARDED' || undefined,
        last_action_by: input.actorUserId,
        last_action_at: now.toISOString(),
        workflow_step: workflowPatch.workflowStep,
        workflow_step_started_at: workflowPatch.workflowStepStartedAt,
        workflow_step_due_at: workflowPatch.workflowStepDueAt,
        workflow_step_sla_hours: workflowPatch.workflowStepSlaHours,
        workflow_step_actor_user_id: workflowPatch.workflowStepActorUserId,
        ...targetPatch,
      })
      .eq('id', input.request.id)
      .select('*')
      .single();
    if (error) throw error;

    const updatedRequest = mapMaterialRequestFromDb(data);

    try {
      await materialRequestBoqLineSnapshotService.upsertForRequest(updatedRequest);
    } catch (err) {
      console.warn('Failed to sync material request BOQ line snapshots:', err);
    }

    await this.recordEvent({
      requestId: input.request.id,
      projectId: input.request.projectId,
      fromStep,
      toStep: input.toStep,
      action: input.action,
      actorUserId: input.actorUserId,
      targetUserId: input.target?.userId || null,
      targetPermission: input.target?.permissionCode || null,
      note: input.note || input.target?.note || null,
      slaHours: workflowPatch.workflowStepSlaHours,
      dueAt: workflowPatch.workflowStepDueAt,
      metadata: input.metadata || {},
    });

    return updatedRequest;
  },
};
