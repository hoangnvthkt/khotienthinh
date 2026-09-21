import { runProcurementCommand } from './commandClient';

export const procurementDemandService = {
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
