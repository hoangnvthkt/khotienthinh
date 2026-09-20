import type { ProcurementCommandRequest, ProcurementCommandResult } from '../../types/procurementIdentity';
import { supabase } from '../supabase';

export type ProcurementCommandType =
  | 'sync_project_material_request_demand'
  | 'resolve_procurement_source_change';

const expectedVersion = (
  request: ProcurementCommandRequest,
  type: string,
  id: string,
): number => {
  const resource = request.expectedVersions.find(item => item.type === type && item.id === id);
  const version = Number(resource?.version);
  if (!resource || !Number.isSafeInteger(version) || version < 1) {
    throw new Error('PROCUREMENT_EXPECTED_VERSION_REQUIRED');
  }
  return version;
};

export async function runProcurementCommand(
  commandType: ProcurementCommandType,
  request: ProcurementCommandRequest,
): Promise<ProcurementCommandResult> {
  if (!request.idempotencyKey.trim() || request.payloadSchemaVersion !== 1) {
    throw new Error('PROCUREMENT_COMMAND_INVALID');
  }

  let rpc: string;
  let params: Record<string, unknown>;
  if (commandType === 'sync_project_material_request_demand') {
    const requestId = String(request.payload.requestId || '');
    if (!requestId) throw new Error('PROCUREMENT_COMMAND_INVALID');
    rpc = 'sync_project_material_request_demand_v1';
    params = {
      p_request_id: requestId,
      p_expected_source_revision: expectedVersion(request, 'source', requestId),
      p_idempotency_key: request.idempotencyKey,
    };
  } else {
    const demandId = String(request.payload.demandId || '');
    const disposition = String(request.payload.disposition || '');
    if (!demandId || !disposition || !request.reason?.trim()) throw new Error('PROCUREMENT_COMMAND_INVALID');
    rpc = 'resolve_procurement_source_change_v1';
    params = {
      p_demand_id: demandId,
      p_expected_version: expectedVersion(request, 'demand', demandId),
      p_disposition: disposition,
      p_reason: request.reason.trim(),
      p_idempotency_key: request.idempotencyKey,
    };
  }

  const { data, error } = await supabase.rpc(rpc, params);
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('PROCUREMENT_COMMAND_RESPONSE_INVALID');
  return data as ProcurementCommandResult;
}
