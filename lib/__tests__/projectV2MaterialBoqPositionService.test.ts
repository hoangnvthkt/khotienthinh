import { describe, expect, it } from 'vitest';
import { parseProjectV2MaterialBoqPositions } from '../projectV2/materialBoqPositionService';

describe('Project V2 material BOQ read response', () => {
  it('preserves authoritative quantities and an unknown pending balance', () => {
    const result = parseProjectV2MaterialBoqPositions({ items: [{ itemId: 'steel', unit: 't',
      state: 'known', boqQuantity: '200.000000', receivedQuantity: '80.000000',
      remainingQuantity: '120.000000', pendingQuantity: null, issues: [],
    }] }, ['steel']);
    expect(result.get('steel')).toEqual({ itemId: 'steel', unit: 't', state: 'known',
      boqQuantity: '200.000000', receivedQuantity: '80.000000',
      remainingQuantity: '120.000000', pendingQuantity: null, issues: [],
    });
  });

  it('keeps outside-BOQ and unresolved groups distinct from known zero', () => {
    const result = parseProjectV2MaterialBoqPositions({ items: [
      { itemId: 'small', unit: 'kg', state: 'outside_boq', boqQuantity: null,
        receivedQuantity: '5.000000', remainingQuantity: null, pendingQuantity: null, issues: [] },
      { itemId: 'mixed', unit: 't', state: 'unknown', boqQuantity: null,
        receivedQuantity: '0.000000', remainingQuantity: null, pendingQuantity: null,
        issues: ['boq_source_unknown'] },
    ] }, ['small', 'mixed']);
    expect(result.get('small')?.state).toBe('outside_boq');
    expect(result.get('mixed')?.remainingQuantity).toBeNull();
  });

  it('rejects incomplete, duplicated, or out-of-scope responses', () => {
    const known = { itemId: 'steel', unit: 't', state: 'known', boqQuantity: '200.000000',
      receivedQuantity: '80.000000', remainingQuantity: '120.000000',
      pendingQuantity: null, issues: [] };
    expect(() => parseProjectV2MaterialBoqPositions({ items: [{ ...known, remainingQuantity: null }] },
      ['steel'])).toThrow('PROJECT_V2_BOQ_RESPONSE_INVALID');
    expect(() => parseProjectV2MaterialBoqPositions({ items: [known, known] },
      ['steel'])).toThrow('PROJECT_V2_BOQ_RESPONSE_INVALID');
    expect(() => parseProjectV2MaterialBoqPositions({ items: [known] },
      ['cement'])).toThrow('PROJECT_V2_BOQ_RESPONSE_INVALID');
  });
});
