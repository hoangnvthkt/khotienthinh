import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { materialPlanService } from '../materialPlanning/materialPlanService';

const detail = (patch: Record<string, unknown> = {}) => ({
  id: '10000000-0000-4000-8000-000000000001',
  planNo: 'MP-2026-0001',
  projectId: 'project-1', constructionSiteId: 'site-1', title: 'Kế hoạch tháng 10',
  periodStart: '2026-10-01', periodEnd: '2026-10-31', note: null,
  status: 'draft', version: 1, createdBy: '20000000-0000-4000-8000-000000000001',
  createdAt: '2026-09-21T02:00:00Z', updatedAt: '2026-09-21T02:00:00Z',
  capabilities: { canEdit: true, canConvert: true },
  lines: [{
    id: '30000000-0000-4000-8000-000000000001', itemId: 'item-1', sku: 'STEEL',
    itemName: 'Thép', unit: 'kg', quantity: '10.000000', convertedQty: '6.000000', remainingQty: '4.000000',
    neededDate: '2026-10-01', destination: 'Kho A',
    allocations: [{
      id: '40000000-0000-4000-8000-000000000001', sourceBudgetLineId: 'budget-1',
      sourceWorkBoqItemId: 'work-1', sourceTaskId: 'task-1', quantity: '10.000000',
      convertedQty: '6.000000', remainingQty: '4.000000', neededDate: '2026-10-01', destination: 'Kho A',
    }],
  }],
  revisions: [{ version: 1, sourceHash: 'a'.repeat(64), changedBy: '20000000-0000-4000-8000-000000000001', createdAt: '2026-09-21T02:00:00Z' }],
  conversions: [{ id: '50000000-0000-4000-8000-000000000001', planVersion: 1, requestId: 'mr-1', requestCode: 'MR-2026-0001', quantity: '6.000000', unit: 'kg', state: 'active', createdAt: '2026-09-21T02:05:00Z' }],
  ...patch,
});

describe('materialPlanService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('saves a plan with expected version and no client actor or owner claim', async () => {
    mocks.rpc.mockResolvedValue({ data: { plan: detail(), command: { commandId: 'cmd-1', outcome: 'committed' } }, error: null });
    const result = await materialPlanService.save({
      planId: null, projectId: 'project-1', constructionSiteId: 'site-1', expectedVersion: null,
      title: 'Kế hoạch tháng 10', periodStart: '2026-10-01', periodEnd: '2026-10-31', note: null,
      status: 'draft', payloadSchemaVersion: 1, idempotencyKey: 'save-plan-1',
      lines: detail().lines.map((line: any) => ({
        id: line.id, itemId: line.itemId, sku: line.sku, itemName: line.itemName, unit: line.unit,
        quantity: line.quantity, neededDate: line.neededDate, destination: line.destination,
        allocations: line.allocations.map(({ convertedQty: _c, remainingQty: _r, ...allocation }: any) => allocation),
      })),
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_material_plan_v1', expect.objectContaining({
      p_plan_id: null, p_project_id: 'project-1', p_construction_site_id: 'site-1',
      p_expected_version: null, p_idempotency_key: 'save-plan-1', p_payload_schema_version: 1,
    }));
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_actor_user_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_owner_context_id');
    expect(result.plan.lines[0].remainingQty).toBe('4.000000');
  });

  it('loads scoped detail and rejects a response from another scope', async () => {
    mocks.rpc.mockResolvedValue({ data: detail({ projectId: 'project-2' }), error: null });
    await expect(materialPlanService.get({
      planId: '10000000-0000-4000-8000-000000000001', projectId: 'project-1', constructionSiteId: 'site-1',
    })).rejects.toThrow('MATERIAL_PLAN_SCOPE_MISMATCH');
  });

  it('converts an exact partial quantity and keeps server errors distinct', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { commandId: 'cmd-2', outcome: 'committed', planId: detail().id, planVersion: 1, requestId: 'mr-1', requestCode: 'MR-2026-0001', convertedQty: '6.000000' }, error: null,
    });
    await materialPlanService.convert({
      planId: detail().id, expectedVersion: 1, siteWarehouseId: 'warehouse-1',
      fulfillmentMode: 'RECEIVE_TO_STOCK', payloadSchemaVersion: 1, idempotencyKey: 'convert-1',
      allocations: [{ allocationId: detail().lines[0].allocations[0].id, quantity: '6.000000' }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('convert_material_plan_to_request_v1', {
      p_plan_id: detail().id, p_expected_version: 1, p_site_warehouse_id: 'warehouse-1',
      p_fulfillment_mode: 'RECEIVE_TO_STOCK', p_allocations: [{ allocationId: detail().lines[0].allocations[0].id, quantity: '6.000000' }],
      p_payload_schema_version: 1, p_idempotency_key: 'convert-1',
    });

    const conflict = { code: '40001', message: 'MATERIAL_PLAN_CONVERSION_EXCEEDED' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: conflict });
    await expect(materialPlanService.convert({
      planId: detail().id, expectedVersion: 1, siteWarehouseId: 'warehouse-1',
      fulfillmentMode: 'RECEIVE_TO_STOCK', payloadSchemaVersion: 1, idempotencyKey: 'convert-2',
      allocations: [{ allocationId: detail().lines[0].allocations[0].id, quantity: '6.000000' }],
    })).rejects.toBe(conflict);
  });

  it.each([
    ['invalid decimal', detail({ lines: [{ ...detail().lines[0], quantity: '10.0000001' }] })],
    ['remaining mismatch', detail({ lines: [{ ...detail().lines[0], remainingQty: '5.000000' }] })],
    ['invalid status', detail({ status: 'approved' })],
    ['invalid version', detail({ version: 0 })],
  ])('rejects %s instead of coercing server data', async (_label, response) => {
    mocks.rpc.mockResolvedValue({ data: response, error: null });
    await expect(materialPlanService.get({ planId: detail().id, projectId: 'project-1', constructionSiteId: 'site-1' }))
      .rejects.toThrow();
  });

  it('propagates denied reads and does not return an empty plan', async () => {
    const denied = { code: '42501', message: 'MATERIAL_PLAN_READ_DENIED' };
    mocks.rpc.mockResolvedValue({ data: null, error: denied });
    await expect(materialPlanService.get({ planId: detail().id, projectId: 'project-1', constructionSiteId: 'site-1' }))
      .rejects.toBe(denied);
  });

  it('accepts zero summary counts and rejects count coercion', async () => {
    const summary = {
      id: detail().id, planNo: 'MP-2026-0001', title: 'Kế hoạch tháng 10',
      periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'draft', version: 1,
      lineCount: 0, remainingAllocationCount: 0, updatedAt: '2026-09-21T02:00:00Z',
    };
    mocks.rpc.mockResolvedValueOnce({ data: [summary], error: null });
    await expect(materialPlanService.list({ projectId: 'project-1', constructionSiteId: 'site-1' }))
      .resolves.toMatchObject([{ lineCount: 0, remainingAllocationCount: 0 }]);

    mocks.rpc.mockResolvedValueOnce({ data: [{ ...summary, lineCount: '0' }], error: null });
    await expect(materialPlanService.list({ projectId: 'project-1', constructionSiteId: 'site-1' }))
      .rejects.toThrow('MATERIAL_PLAN_COUNT_INVALID');
  });
});
