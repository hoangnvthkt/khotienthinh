import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { runProcurementCommand } from '../procurement/commandClient';

describe('procurement command client', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('sends revisioned intake without a client actor or owner claim', async () => {
    mocks.rpc.mockResolvedValue({
      data: { commandId: 'cmd-1', outcome: 'committed', committedAt: '2026-09-20T00:00:00Z', changedEntities: [], createdDocumentIds: [], warnings: [], refreshScopes: ['project:project-1'] },
      error: null,
    });

    await runProcurementCommand('sync_project_material_request_demand', {
      idempotencyKey: 'sync-1', expectedVersions: [{ type: 'source', id: 'mr-1', version: '2' }],
      payloadSchemaVersion: 1, payload: { requestId: 'mr-1' },
    });

    expect(mocks.rpc).toHaveBeenCalledWith('sync_project_material_request_demand_v1', {
      p_request_id: 'mr-1', p_expected_source_revision: 2, p_idempotency_key: 'sync-1',
    });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_actor_user_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_owner_context_id');
  });

  it('sends source disposition with expected demand version and reason', async () => {
    mocks.rpc.mockResolvedValue({ data: { commandId: 'cmd-2', outcome: 'replayed' }, error: null });
    await runProcurementCommand('resolve_procurement_source_change', {
      idempotencyKey: 'resolve-1', expectedVersions: [{ type: 'demand', id: 'demand-1', version: '3' }],
      payloadSchemaVersion: 1,
      payload: { demandId: 'demand-1', disposition: 'accept_current_revision' }, reason: 'Reviewed revision 2',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_procurement_source_change_v1', {
      p_demand_id: 'demand-1', p_expected_version: 3,
      p_disposition: 'accept_current_revision', p_reason: 'Reviewed revision 2', p_idempotency_key: 'resolve-1',
    });
  });

  it('rejects missing or mismatched versions before calling Supabase', async () => {
    await expect(runProcurementCommand('sync_project_material_request_demand', {
      idempotencyKey: 'sync-1', expectedVersions: [], payloadSchemaVersion: 1, payload: { requestId: 'mr-1' },
    })).rejects.toThrow('PROCUREMENT_EXPECTED_VERSION_REQUIRED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('propagates server authorization and conflict errors', async () => {
    const denied = { code: '42501', message: 'PROCUREMENT_ACCESS_DENIED' };
    mocks.rpc.mockResolvedValue({ data: null, error: denied });
    await expect(runProcurementCommand('sync_project_material_request_demand', {
      idempotencyKey: 'sync-1', expectedVersions: [{ type: 'source', id: 'mr-1', version: '1' }],
      payloadSchemaVersion: 1, payload: { requestId: 'mr-1' },
    })).rejects.toBe(denied);
  });
});
