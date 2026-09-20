import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  procurementAllocationService,
  validateAllocationQuantities,
} from '../procurement/allocationService';

describe('procurement allocation contract', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('accepts an exact conversion snapshot and preserves decimal strings', () => {
    expect(validateAllocationQuantities({
      reservedNeedQty: '0', committedNeedQty: '50', executionQty: '2',
      executionUnit: 'bao', needUnit: 'kg', conversionNumerator: '25', conversionDenominator: '1',
    })).toEqual({ reservedNeedQty: '0', committedNeedQty: '50', executionQty: '2' });
  });

  it('rejects a conversion that does not reconcile to the allocated need quantity', () => {
    expect(() => validateAllocationQuantities({
      reservedNeedQty: '0', committedNeedQty: '49', executionQty: '2',
      executionUnit: 'bao', needUnit: 'kg', conversionNumerator: '25', conversionDenominator: '1',
    })).toThrow('PROCUREMENT_CONVERSION_MISMATCH');
  });

  it('sends exact source revision and expected demand-line version without actor claims', async () => {
    mocks.rpc.mockResolvedValue({ data: { commandId: 'cmd-a', outcome: 'committed' }, error: null });
    await procurementAllocationService.save({
      demandLineId: 'demand-line-1', sourceRevisionId: 'revision-1',
      executionSourceLineRegistryId: 'execution-line-1', method: 'po', state: 'committed',
      reservedNeedQty: '0', committedNeedQty: '50', executionQty: '2',
      executionUnit: 'bao', needUnit: 'kg', conversionNumerator: '25', conversionDenominator: '1',
      expectedDemandLineVersion: 4, idempotencyKey: 'allocation-1', reason: 'PO line committed',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('save_procurement_allocation_v1', expect.objectContaining({
      p_demand_line_id: 'demand-line-1', p_source_revision_id: 'revision-1',
      p_expected_demand_line_version: 4, p_committed_need_qty: '50',
    }));
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_actor_user_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_owner_context_id');
  });

  it('records signed fulfillment and requires a reversal link for reversal effects', async () => {
    mocks.rpc.mockResolvedValue({ data: { commandId: 'cmd-f', outcome: 'committed' }, error: null });
    await procurementAllocationService.recordFulfillment({
      allocationId: 'allocation-1', sourceRevisionId: 'revision-1',
      canonicalEffectId: 'receipt-line-1', effectKind: 'receipt', quantity: '30', unit: 'kg',
      expectedDemandLineVersion: 5, idempotencyKey: 'fulfillment-1',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('record_procurement_fulfillment_attribution_v1', expect.objectContaining({
      p_canonical_effect_id: 'receipt-line-1', p_quantity: '30', p_effect_kind: 'receipt',
    }));

    await expect(procurementAllocationService.recordFulfillment({
      allocationId: 'allocation-1', sourceRevisionId: 'revision-1',
      canonicalEffectId: 'return-line-1', effectKind: 'reversal', quantity: '-5', unit: 'kg',
      expectedDemandLineVersion: 6, idempotencyKey: 'fulfillment-2',
    })).rejects.toThrow('PROCUREMENT_REVERSAL_LINK_REQUIRED');
  });

  it('propagates server conflict and permission errors', async () => {
    const conflict = { code: '40001', message: 'PROCUREMENT_AVAILABLE_EXCEEDED' };
    mocks.rpc.mockResolvedValue({ data: null, error: conflict });
    await expect(procurementAllocationService.save({
      demandLineId: 'demand-line-1', sourceRevisionId: 'revision-1',
      executionSourceLineRegistryId: 'execution-line-1', method: 'po', state: 'committed',
      reservedNeedQty: '0', committedNeedQty: '60', executionQty: '60',
      executionUnit: 'kg', needUnit: 'kg', conversionNumerator: '1', conversionDenominator: '1',
      expectedDemandLineVersion: 1, idempotencyKey: 'allocation-2', reason: 'Second writer',
    })).rejects.toBe(conflict);
  });
});
