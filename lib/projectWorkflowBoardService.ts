import { supabase } from './supabase';
import { fromDb } from './dbMapping';
import { mapMaterialRequestFromDb } from './materialRequestService';
import { materialRequestFulfillmentService } from './materialRequestFulfillmentService';
import {
  MaterialRequest,
  MaterialRequestBoardPage,
  MaterialRequestDetailResult,
  MaterialRequestEvent,
  MaterialRequestFulfillmentBatch,
  MaterialRequestWorkflowBoardCard,
  ProjectWorkflowActionContextResult,
  ProjectWorkflowRuntimeContext,
  ProjectWorkflowBoardFilter,
  ProjectWorkflowSubject,
  ProjectWorkflowSubjectType,
  ProjectWorkflowTimelineEntry,
  WorkflowRuntimeEdge,
  WorkflowRuntimeNode,
  WorkflowStepAssignment,
} from '../types';

const isMissingWorkflowBoardRpc = (error: any): boolean =>
  ['42883', 'PGRST202'].includes(error?.code)
  || String(error?.message || '').includes('get_project_material_request_board')
  || String(error?.message || '').includes('get_material_request_workflow_board')
  || String(error?.message || '').includes('get_project_material_request_detail')
  || String(error?.message || '').includes('get_project_workflow_timeline')
  || String(error?.message || '').includes('get_project_workflow_action_context');

const normalizeCard = (row: any): MaterialRequestWorkflowBoardCard => ({
  id: row.id,
  code: row.code,
  status: row.status,
  workflowStep: row.workflowStep ?? row.workflow_step ?? null,
  workflowStepStartedAt: row.workflowStepStartedAt ?? row.workflow_step_started_at ?? null,
  workflowStepDueAt: row.workflowStepDueAt ?? row.workflow_step_due_at ?? null,
  workflowStepSlaHours: row.workflowStepSlaHours ?? row.workflow_step_sla_hours ?? null,
  projectId: row.projectId ?? row.project_id ?? null,
  constructionSiteId: row.constructionSiteId ?? row.construction_site_id ?? null,
  requesterId: row.requesterId ?? row.requester_id ?? null,
  requesterName: row.requesterName ?? row.requester_name ?? null,
  submittedToUserId: row.submittedToUserId ?? row.submitted_to_user_id ?? null,
  submittedToName: row.submittedToName ?? row.submitted_to_name ?? null,
  createdDate: row.createdDate ?? row.created_date ?? null,
  expectedDate: row.expectedDate ?? row.expected_date ?? null,
  itemCount: Number(row.itemCount ?? row.item_count ?? 0),
  itemPreview: row.itemPreview ?? row.item_preview ?? [],
  subject: row.subject ?? null,
  currentRuntimeNode: row.currentRuntimeNode ?? row.current_runtime_node ?? null,
  currentAssignees: row.currentAssignees ?? row.current_assignees ?? [],
  slaState: row.slaState ?? row.sla_state ?? 'none',
  fulfillmentSummary: row.fulfillmentSummary ?? row.fulfillment_summary,
  eventPreview: row.eventPreview ?? row.event_preview ?? [],
  downstream: row.downstream,
});

const normalizeEvent = (row: any): MaterialRequestEvent => ({
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

const normalizeSubject = (row: any): ProjectWorkflowSubject | null => {
  if (!row) return null;
  const camel = fromDb(row) as any;
  return {
    ...camel,
    currentNode: camel.currentNode || null,
    currentRuntimeNode: camel.currentInstanceNode || camel.currentRuntimeNode || null,
    workflowInstance: camel.workflowInstance || null,
    participants: camel.participants || [],
    currentAssigneeUserIds: camel.currentAssigneeUserIds || [],
    returnToAssigneeUserIds: camel.returnToAssigneeUserIds || [],
  } as ProjectWorkflowSubject;
};

const normalizeRuntimeContext = (
  row: any,
  subject: ProjectWorkflowSubject | null,
): ProjectWorkflowRuntimeContext | null => {
  if (!row || !subject) return null;
  return {
    subject,
    nodes: ((row.nodes || []).map((node: any) => fromDb(node)) || []) as WorkflowRuntimeNode[],
    edges: ((row.edges || []).map((edge: any) => fromDb(edge)) || []) as WorkflowRuntimeEdge[],
  };
};

const normalizeFulfillmentBatch = (row: any): MaterialRequestFulfillmentBatch =>
  fromDb(row) as MaterialRequestFulfillmentBatch;

const cardFromDetail = (detail: MaterialRequestDetailResult): MaterialRequestWorkflowBoardCard => {
  const summary = materialRequestFulfillmentService.summarizeRequest(detail.request, detail.fulfillmentBatches);
  const subject = detail.workflowSubject;
  const currentRuntimeNode = subject?.currentRuntimeNode || null;
  return normalizeCard({
    id: detail.request.id,
    code: detail.request.code,
    status: detail.request.status,
    workflowStep: detail.request.workflowStep,
    workflowStepDueAt: detail.request.workflowStepDueAt,
    workflowStepStartedAt: detail.request.workflowStepStartedAt,
    workflowStepSlaHours: detail.request.workflowStepSlaHours,
    projectId: detail.request.projectId,
    constructionSiteId: detail.request.constructionSiteId,
    requesterId: detail.request.requesterId,
    submittedToUserId: detail.request.submittedToUserId,
    submittedToName: detail.request.submittedToName,
    createdDate: detail.request.createdDate,
    expectedDate: detail.request.expectedDate,
    itemCount: detail.request.items?.length || 0,
    itemPreview: (detail.request.items || []).slice(0, 5),
    subject,
    currentRuntimeNode,
    currentAssignees: (subject?.currentAssigneeUserIds || (subject?.currentAssigneeUserId ? [subject.currentAssigneeUserId] : []))
      .map(id => ({ id })),
    fulfillmentSummary: {
      batchCount: detail.fulfillmentBatches.length,
      activeBatchCount: detail.fulfillmentBatches.filter(batch => !['draft', 'cancelled', 'returned'].includes(batch.status)).length,
      committedQty: summary.committedQty,
      issuedQty: summary.issuedQty,
      receivedQty: summary.receivedQty,
      remainingToReceive: summary.remainingToReceive,
    },
    eventPreview: detail.events.slice(0, 3),
  });
};

export const projectWorkflowBoardService = {
  async listMaterialRequestCards(input: {
    projectId: string;
    constructionSiteId?: string | null;
    filters?: {
      filter?: ProjectWorkflowBoardFilter;
      search?: string;
      [key: string]: any;
    };
    limit?: number;
    cursor?: string | null;
  }): Promise<MaterialRequestBoardPage> {
    if (!input.projectId) return { cards: [] };
    let { data, error } = await supabase.rpc('get_project_material_request_board', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_filters: input.filters || {},
      p_limit: input.limit || 200,
      p_cursor: input.cursor || null,
    });
    if (error && isMissingWorkflowBoardRpc(error)) {
      const fallback = await supabase.rpc('get_material_request_workflow_board', {
        p_project_id: input.projectId,
        p_construction_site_id: input.constructionSiteId || null,
        p_filters: input.filters || {},
        p_limit: input.limit || 200,
        p_cursor: input.cursor || null,
      });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      if (isMissingWorkflowBoardRpc(error)) return { cards: [] };
      throw error;
    }
    return {
      cards: (data?.cards || []).map(normalizeCard),
      cursor: data?.nextCursor ?? data?.cursor ?? null,
      nextCursor: data?.nextCursor ?? null,
    };
  },

  async getMaterialRequestDetail(requestId: string): Promise<MaterialRequestDetailResult | null> {
    if (!requestId) return null;
    const { data, error } = await supabase.rpc('get_project_material_request_detail', {
      p_request_id: requestId,
    });
    if (error) {
      if (isMissingWorkflowBoardRpc(error)) return null;
      throw error;
    }
    if (!data?.request) return null;
    const request = mapMaterialRequestFromDb(data.request) as MaterialRequest;
    const workflowSubject = normalizeSubject(data.workflowSubject ?? data.workflow_subject);
    const runtimeContext = normalizeRuntimeContext(data.runtimeContext ?? data.runtime_context, workflowSubject);
    const assignments = ((data.assignments || []).map((row: any) => fromDb(row)) || []) as WorkflowStepAssignment[];
    const fulfillmentBatches = ((data.fulfillmentBatches ?? data.fulfillment_batches ?? []).map(normalizeFulfillmentBatch)) as MaterialRequestFulfillmentBatch[];
    const events = ((data.events || []).map(normalizeEvent)) as MaterialRequestEvent[];
    return {
      request,
      workflowSubject,
      runtimeContext,
      assignments,
      fulfillmentBatches,
      events,
    };
  },

  async refreshMaterialRequestCard(requestId: string): Promise<MaterialRequestWorkflowBoardCard | null> {
    const detail = await this.getMaterialRequestDetail(requestId);
    return detail ? cardFromDetail(detail) : null;
  },

  async getTimeline(workflowSubjectId: string): Promise<ProjectWorkflowTimelineEntry[]> {
    if (!workflowSubjectId) return [];
    const { data, error } = await supabase.rpc('get_project_workflow_timeline', {
      p_workflow_subject_id: workflowSubjectId,
    });
    if (error) {
      if (isMissingWorkflowBoardRpc(error)) return [];
      throw error;
    }
    return (data?.entries || []) as ProjectWorkflowTimelineEntry[];
  },

  async getActionContext(
    subjectType: ProjectWorkflowSubjectType,
    subjectId: string,
  ): Promise<ProjectWorkflowActionContextResult | null> {
    if (!subjectType || !subjectId) return null;
    const { data, error } = await supabase.rpc('get_project_workflow_action_context', {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
    });
    if (error) {
      if (isMissingWorkflowBoardRpc(error)) return null;
      throw error;
    }
    return data as ProjectWorkflowActionContextResult;
  },
};
