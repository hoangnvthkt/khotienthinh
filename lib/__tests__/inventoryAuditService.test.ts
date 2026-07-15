import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: mocks.rpc },
}));

import { inventoryAuditService } from '../inventoryAuditService';

const commandId = '11111111-1111-4111-8111-111111111111';

describe('inventory audit atomic service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts canonical decimal observations through exactly one RPC and maps server truth', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        audit_session: {
          id: 'audit-1',
          warehouseId: 'warehouse-1',
          warehouseName: 'Kho 1',
          date: '2026-07-15T00:00:00.000Z',
          auditorId: 'user-1',
          auditorName: 'Auditor',
          items: [{
            itemId: 'item-1', itemName: 'Cát', sku: 'CAT', unit: 'Kg',
            systemStock: '1.75', actualStock: '2.375', delta: '0.625',
          }],
          totalItems: 1,
          totalDiscrepancies: 1,
          totalExceedNorm: 0,
          totalLossValue: '0',
          transactionId: 'audit-adjustment-1',
        },
        stock_transaction: {
          id: 'audit-adjustment-1',
          type: 'ADJUSTMENT',
          status: 'COMPLETED',
          items: [{ itemId: 'item-1', quantity: '0.625', price: '0' }],
          target_warehouse_id: 'warehouse-1',
        },
        updated_items: [{
          id: 'item-1', sku: 'CAT', name: 'Cát', unit: 'Kg',
          stock_by_warehouse: { 'warehouse-1': '2.375' },
        }],
      },
      error: null,
    });

    const result = await inventoryAuditService.post({
      commandId,
      warehouseId: 'warehouse-1',
      auditedAt: '2026-07-15T00:00:00.000Z',
      observations: [
        { itemId: 'item-1', actualQty: '2.375', expectedSystemQty: '1.75', lossReason: null, note: null },
        { itemId: 'item-2', actualQty: '0.25', expectedSystemQty: '0.25', lossReason: null, note: null },
        { itemId: 'item-3', actualQty: '0.123456', expectedSystemQty: '0', lossReason: null, note: '6 digits' },
      ],
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('post_inventory_audit', {
      p_command_id: commandId,
      p_warehouse_id: 'warehouse-1',
      p_audited_at: '2026-07-15T00:00:00.000Z',
      p_observations: [
        { item_id: 'item-1', actual_qty: '2.375', expected_system_qty: '1.75', loss_reason: null, note: null },
        { item_id: 'item-2', actual_qty: '0.25', expected_system_qty: '0.25', loss_reason: null, note: null },
        { item_id: 'item-3', actual_qty: '0.123456', expected_system_qty: '0', loss_reason: null, note: '6 digits' },
      ],
    });
    expect(result.auditSession.items[0]).toMatchObject({
      systemStock: 1.75,
      actualStock: 2.375,
      delta: 0.625,
    });
    expect(result.auditSession.totalLossValue).toBe(0);
    expect(result.stockTransaction?.id).toBe('audit-adjustment-1');
    expect(result.updatedItems[0].stockByWarehouse).toEqual({ 'warehouse-1': 2.375 });
  });

  it('propagates stale-cache and idempotency conflicts without a second mutation', async () => {
    const error = Object.assign(new Error('inventory cache changed after audit draft'), { code: '40001' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error });

    await expect(inventoryAuditService.post({
      commandId,
      warehouseId: 'warehouse-1',
      auditedAt: '2026-07-15T00:00:00.000Z',
      observations: [{
        itemId: 'item-1', actualQty: '1.75', expectedSystemQty: '2.375', lossReason: null, note: null,
      }],
    })).rejects.toBe(error);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
