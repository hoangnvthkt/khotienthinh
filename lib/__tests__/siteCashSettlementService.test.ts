import { describe, expect, it } from 'vitest';
import type { SiteCashSettlementLine } from '../../types';
import { calculateSiteCashSettlementSummary } from '../siteCashSettlementService';

const settlementLine = (patch: Partial<SiteCashSettlementLine> = {}): SiteCashSettlementLine => ({
  id: 'line-1',
  settlementBatchId: 'settlement-1',
  sourceType: 'site_direct_purchase',
  sourceId: 'direct-1',
  description: 'Mua vat tu le',
  claimedAmount: 5_000_000,
  approvedAmount: 5_000_000,
  status: 'accepted',
  note: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  ...patch,
});

describe('siteCashSettlementService helpers', () => {
  it('calculates opening plus topups minus approved spend as ending balance', () => {
    const summary = calculateSiteCashSettlementSummary({
      openingBalance: 100_000_000,
      topupAmount: 50_000_000,
      lines: [
        settlementLine({ id: 'line-1', claimedAmount: 30_000_000, approvedAmount: 30_000_000, status: 'accepted' }),
        settlementLine({ id: 'line-2', claimedAmount: 15_000_000, approvedAmount: 12_000_000, status: 'adjusted' }),
        settlementLine({ id: 'line-3', claimedAmount: 8_000_000, approvedAmount: 0, status: 'rejected' }),
      ],
    });

    expect(summary.claimedAmount).toBe(53_000_000);
    expect(summary.approvedSpendAmount).toBe(42_000_000);
    expect(summary.rejectedAmount).toBe(8_000_000);
    expect(summary.endingBalance).toBe(108_000_000);
  });
});
