import { supabase } from './supabase';
import {
  MaterialRequestWorkflowBoardCard,
  ProjectWorkflowActionContextResult,
  ProjectWorkflowBoardFilter,
  ProjectWorkflowSubjectType,
  ProjectWorkflowTimelineEntry,
} from '../types';

const isMissingWorkflowBoardRpc = (error: any): boolean =>
  ['42883', 'PGRST202'].includes(error?.code)
  || String(error?.message || '').includes('get_material_request_workflow_board')
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
  subject: row.subject ?? null,
  currentRuntimeNode: row.currentRuntimeNode ?? row.current_runtime_node ?? null,
  currentAssignees: row.currentAssignees ?? row.current_assignees ?? [],
  slaState: row.slaState ?? row.sla_state ?? 'none',
  fulfillmentSummary: row.fulfillmentSummary ?? row.fulfillment_summary,
  eventPreview: row.eventPreview ?? row.event_preview ?? [],
  downstream: row.downstream,
});

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
  }): Promise<{ cards: MaterialRequestWorkflowBoardCard[]; cursor?: string | null }> {
    if (!input.projectId) return { cards: [] };
    const { data, error } = await supabase.rpc('get_material_request_workflow_board', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_filters: input.filters || {},
      p_limit: input.limit || 200,
      p_cursor: input.cursor || null,
    });
    if (error) {
      if (isMissingWorkflowBoardRpc(error)) return { cards: [] };
      throw error;
    }
    return {
      cards: (data?.cards || []).map(normalizeCard),
      cursor: data?.nextCursor ?? data?.cursor ?? null,
    };
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
