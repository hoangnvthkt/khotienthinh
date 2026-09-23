import { supabase } from '../supabase';
import { parseQuantity6 } from '../procurement/decimal';
import type { ProjectV2SourceCandidate } from './sourcePicker';

export interface MonthCandidate {
  contractItemId: string; code: string; title: string; unit: string | null;
  parentId: string | null; isGroup: boolean;
  priceVisible?: boolean; unitPrice?: string | null;
  contractQuantity: string | null; previousPlannedQuantity: string | null;
  availableQuantity: string | null; baselineRevision: string | null;
  baselineState: string; workspaceId: string; unavailableReason: string | null;
}
export interface ConstructionCandidate extends ProjectV2SourceCandidate {
  workItemId: string | null; contractItemId: string | null;
}
export interface ProjectV2Crew { id: string; name: string; workspaceId: string }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROJECT_V2_CANDIDATE_INVALID');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('PROJECT_V2_CANDIDATE_INVALID');
  return value;
}
function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}
function decimal(value: unknown): string | null {
  if (value === null) return null;
  const result = typeof value === 'number' && Number.isSafeInteger(Math.round(value * 1e6))
    ? value.toFixed(6) : string(value);
  parseQuantity6(result);
  return result;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return object(data);
}
export const projectV2CandidateService = {
  async listMonth(workspaceId: string, excludePlanId: string | null = null): Promise<MonthCandidate[]> {
    const response = await rpc('list_project_v2_source_candidates_v1', {
      p_workspace_id: workspaceId, p_target_type: 'month', p_exclude_plan_id: excludePlanId,
    });
    if (!Array.isArray(response.items)) throw new Error('PROJECT_V2_CANDIDATE_INVALID');
    return response.items.map(value => {
      const row = object(value);
      if (string(row.workspaceId) !== workspaceId) throw new Error('PROJECT_V2_SOURCE_SCOPE_MISMATCH');
      return { contractItemId: string(row.contractItemId), code: string(row.code),
        title: string(row.title), unit: nullableString(row.unit),
        parentId: nullableString(row.parentId), isGroup: row.isGroup === true,
        priceVisible: row.priceVisible === true, unitPrice: row.priceVisible === true ? decimal(row.unitPrice) : null,
        contractQuantity: decimal(row.contractQuantity),
        previousPlannedQuantity: decimal(row.previousPlannedQuantity),
        availableQuantity: decimal(row.availableQuantity),
        baselineRevision: nullableString(row.baselineRevision),
        baselineState: string(row.baselineState), workspaceId,
        unavailableReason: nullableString(row.unavailableReason) };
    });
  },
  async listConstruction(workspaceId: string, excludePlanId: string | null = null): Promise<ConstructionCandidate[]> {
    const response = await rpc('list_project_v2_source_candidates_v1', {
      p_workspace_id: workspaceId, p_target_type: 'construction', p_exclude_plan_id: excludePlanId,
    });
    if (!Array.isArray(response.items)) throw new Error('PROJECT_V2_CANDIDATE_INVALID');
    return response.items.map(value => {
      const row = object(value);
      if (string(row.workspaceId) !== workspaceId) throw new Error('PROJECT_V2_SOURCE_SCOPE_MISMATCH');
      if (!Number.isSafeInteger(row.sourceRevision) || Number(row.sourceRevision) < 1)
        throw new Error('PROJECT_V2_CANDIDATE_INVALID');
      return { sourcePlanId: string(row.sourcePlanId), sourceRevision: Number(row.sourceRevision),
        sourcePlanHash: string(row.sourcePlanHash), sourceLineId: string(row.sourceLineId),
        sourceQuantity: decimal(row.sourceQuantity), availableQuantity: decimal(row.availableQuantity),
        sourceUnit: nullableString(row.sourceUnit), workspaceId,
        sourceStatus: string(row.sourceStatus), unavailableReason: nullableString(row.unavailableReason),
        code: string(row.code), title: string(row.title),
        workItemId: nullableString(row.workItemId), contractItemId: nullableString(row.contractItemId) };
    });
  },
  async listCrews(workspaceId: string): Promise<ProjectV2Crew[]> {
    const response = await rpc('list_project_v2_crews_v1', { p_workspace_id: workspaceId });
    if (!Array.isArray(response.crews)) throw new Error('PROJECT_V2_CREWS_INVALID');
    return response.crews.map(value => {
      const row = object(value);
      if (string(row.workspaceId) !== workspaceId) throw new Error('PROJECT_V2_CREW_SCOPE_MISMATCH');
      return { id: string(row.id), name: string(row.name), workspaceId };
    });
  },
};
