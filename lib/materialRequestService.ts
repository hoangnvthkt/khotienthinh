import { supabase } from './supabase';
import { MaterialRequest, MaterialRequestFulfillmentMode } from '../types';

export const mapMaterialRequestFromDb = (row: any): MaterialRequest => ({
  ...row,
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
});

export const materialRequestService = {
  async listByProject(projectId: string): Promise<MaterialRequest[]> {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('request_origin', 'project')
      .eq('project_id', projectId)
      .order('created_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapMaterialRequestFromDb);
  },
};
