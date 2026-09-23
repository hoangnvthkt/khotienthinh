import { runProcurementCommand } from './commandClient';
import { supabase } from '../supabase';

export const procurementDemandService = {
  async syncMaterialPlan(planId: string, expectedRevision: number, idempotencyKey: string) {
    if (!planId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || !idempotencyKey.trim()) throw new Error('PROCUREMENT_COMMAND_INVALID');
    const { data, error } = await supabase.rpc('sync_material_plan_demand_v1', {
      p_plan_id: planId, p_expected_revision: expectedRevision, p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('PROCUREMENT_COMMAND_RESPONSE_INVALID');
    return data as Record<string, unknown>;
  },
  syncProjectMaterialRequest(requestId: string, sourceRevision: number, idempotencyKey: string) {
    return runProcurementCommand('sync_project_material_request_demand', {
      idempotencyKey,
      expectedVersions: [{ type: 'source', id: requestId, version: String(sourceRevision) }],
      payloadSchemaVersion: 1,
      payload: { requestId },
    });
  },

  resolveSourceChange(input: {
    demandId: string;
    expectedVersion: number;
    disposition: 'accept_current_revision' | 'withdraw';
    reason: string;
    idempotencyKey: string;
  }) {
    return runProcurementCommand('resolve_procurement_source_change', {
      idempotencyKey: input.idempotencyKey,
      expectedVersions: [{ type: 'demand', id: input.demandId, version: String(input.expectedVersion) }],
      payloadSchemaVersion: 1,
      payload: { demandId: input.demandId, disposition: input.disposition },
      reason: input.reason,
    });
  },

  assign(input: {
    demandId: string;
    assigneeUserId: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
  }) {
    return runProcurementCommand('assign_procurement_demand', {
      idempotencyKey: input.idempotencyKey,
      expectedVersions: [{ type: 'demand', id: input.demandId, version: String(input.expectedVersion) }],
      payloadSchemaVersion: 1,
      payload: { demandId: input.demandId, assigneeUserId: input.assigneeUserId },
      reason: input.reason,
    });
  },
};
