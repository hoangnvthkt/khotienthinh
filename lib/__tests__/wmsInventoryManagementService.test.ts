import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { wmsInventoryManagementService } from '../wmsInventoryManagementService';

describe('wmsInventoryManagementService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('sends the scoped stock correction and optimistic quantity to the guarded RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        itemId: 'item-1',
        warehouseId: 'warehouse-a',
        previousQuantity: 10,
        quantity: 15,
        adjustedBy: 'user-1',
        adjustedAt: '2026-09-17T00:00:00Z',
      },
      error: null,
    });

    const receipt = await wmsInventoryManagementService.adjustStock({
      itemId: 'item-1',
      warehouseId: 'warehouse-a',
      newQuantity: 15,
      expectedCurrentQuantity: 10,
      reason: 'Kiem ke thuc te tai kho A',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('adjust_inventory_stock', {
      p_item_id: 'item-1',
      p_warehouse_id: 'warehouse-a',
      p_new_quantity: 15,
      p_expected_current_quantity: 10,
      p_reason: 'Kiem ke thuc te tai kho A',
    });
    expect(receipt).toMatchObject({ previousQuantity: 10, quantity: 15 });
  });

  it('surfaces RPC authorization or stale-quantity errors', async () => {
    const rpcError = { code: '42501', message: 'WMS inventory edit permission required for warehouse' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(wmsInventoryManagementService.adjustStock({
      itemId: 'item-1',
      warehouseId: 'warehouse-b',
      newQuantity: 15,
      expectedCurrentQuantity: 10,
      reason: 'Kiem ke thuc te tai kho B',
    })).rejects.toBe(rpcError);
  });
});
