import { describe, expect, it } from 'vitest';
import { assertResourceEvidenceHasNoMoneyKeys } from '../resourceEvidenceNoMoneyLeak';

describe('resource evidence no-money boundary', () => {
  it('rejects money keys anywhere in a nested page', () => {
    expect(() => assertResourceEvidenceHasNoMoneyKeys({ rows: [{ resourceLineId: 'labor-1', totalCost: 4_000_000 }] }))
      .toThrow('RESOURCE_EVIDENCE_MONEY_KEY:totalCost');
    expect(() => assertResourceEvidenceHasNoMoneyKeys({ rows: [{ provider: { unit_cost: 100000 } }] }))
      .toThrow('RESOURCE_EVIDENCE_MONEY_KEY:unit_cost');
    expect(() => assertResourceEvidenceHasNoMoneyKeys({ projectTransactions: [] }))
      .toThrow('RESOURCE_EVIDENCE_MONEY_KEY:projectTransactions');
  });

  it('accepts physical measurements and lineage', () => {
    expect(() => assertResourceEvidenceHasNoMoneyKeys({ rows: [{ resourceLineId: 'labor-1', totalLaborHours: 8 }] }))
      .not.toThrow();
  });
});
