import { describe, expect, it } from 'vitest';
import { calculateProjectV2MaterialBoqPosition } from '../projectV2/materialBoqPosition';

describe('Project V2 material BOQ position', () => {
  it('sums the whole-project BOQ and subtracts confirmed site receipts only', () => {
    expect(calculateProjectV2MaterialBoqPosition({ unit: 't', boqLines: [
      { quantity: '600.000000', unit: 't' }, { quantity: '400.000000', unit: 't' },
    ], receivedQuantity: '500.000000', pendingQuantity: '200.000000' })).toEqual({
      state: 'known', boqQuantity: '1000.000000', receivedQuantity: '500.000000',
      remainingQuantity: '500.000000', pendingQuantity: '200.000000',
    });
  });

  it('preserves an over-received result instead of clipping it to zero', () => {
    expect(calculateProjectV2MaterialBoqPosition({ unit: 't', boqLines: [
      { quantity: '100.000000', unit: 't' },
    ], receivedQuantity: '101.000000', pendingQuantity: null }).remainingQuantity)
      .toBe('-1.000000');
  });

  it('keeps unknown receipts unknown and materials outside the BOQ distinct from zero', () => {
    expect(calculateProjectV2MaterialBoqPosition({ unit: 't', boqLines: [
      { quantity: '100.000000', unit: 't' },
    ], receivedQuantity: null, pendingQuantity: null })).toEqual({
      state: 'unknown', boqQuantity: '100.000000', receivedQuantity: null,
      remainingQuantity: null, pendingQuantity: null,
    });
    expect(calculateProjectV2MaterialBoqPosition({ unit: 't', boqLines: [],
      receivedQuantity: '5.000000', pendingQuantity: null })).toEqual({
      state: 'outside_boq', boqQuantity: null, receivedQuantity: '5.000000',
      remainingQuantity: null, pendingQuantity: null,
    });
  });

  it('rejects mixed units until an authoritative conversion exists', () => {
    expect(() => calculateProjectV2MaterialBoqPosition({ unit: 't', boqLines: [
      { quantity: '1000.000000', unit: 'kg' },
    ], receivedQuantity: '1.000000', pendingQuantity: null })).toThrow('INVALID_UNIT');
  });
});
