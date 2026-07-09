import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteCashSettlementBatch, SiteCashSettlementLine, SiteDirectPurchase } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  buildSettlementLinesFromDirectPurchases,
  calculateSiteCashSettlementSummary,
  siteCashSettlementService,
} from '../siteCashSettlementService';

const settlementLine = (patch: Partial<SiteCashSettlementLine> = {}): SiteCashSettlementLine => ({
  id: 'line-1',
  settlementBatchId: 'settlement-1',
  sourceType: 'site_direct_purchase',
  sourceId: 'direct-1',
  supplierId: null,
  supplierNameSnapshot: 'Tạp hóa cô Lan',
  documentNoSnapshot: 'MNN-001',
  description: 'Mua vật tư lẻ',
  paymentSource: 'site_cash',
  purchaseDate: '2026-07-15',
  claimedAmount: 5_000_000,
  spendAmount: 5_000_000,
  approvedAmount: 5_000_000,
  fundSpendAmount: 5_000_000,
  staffClaimAmount: 0,
  staffReimbursedAmount: 0,
  status: 'accepted',
  note: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  ...patch,
});

const settlementBatch = (patch: Partial<SiteCashSettlementBatch> = {}): SiteCashSettlementBatch => ({
  id: 'settlement-1',
  code: 'HU-202607-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  periodMonth: '2026-07-01',
  cashFundId: 'fund-1',
  openingBalance: 100_000_000,
  topupAmount: 50_000_000,
  acceptedSpendAmount: 42_000_000,
  rejectedSpendAmount: 8_000_000,
  approvedSiteCashSpend: 42_000_000,
  approvedStaffPaidAmount: 0,
  staffReimbursedAmount: 0,
  staffOutstandingAmount: 0,
  closingBalance: 108_000_000,
  status: 'draft',
  qrToken: 'qr-settlement-1',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  note: null,
  ...patch,
});

const directPurchase = (patch: Partial<SiteDirectPurchase> = {}): SiteDirectPurchase => ({
  id: 'direct-1',
  code: 'MNN-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierId: null,
  supplierNameSnapshot: 'Tạp hóa cô Lan',
  purchaseMode: 'immediate',
  paymentSource: 'site_cash',
  status: 'reconciled',
  purchaseDate: '2026-07-15',
  grossAmount: 4_545_455,
  vatAmount: 454_545,
  totalAmount: 5_000_000,
  attachments: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  note: 'Mua nóng',
  ...patch,
});

const query = (response: { data?: any; error?: any } = { data: [], error: null }) => {
  const api: any = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    is: vi.fn(() => api),
    gte: vi.fn(() => api),
    lt: vi.fn(() => api),
    delete: vi.fn(() => api),
    update: vi.fn(() => api),
    upsert: vi.fn(() => api),
    maybeSingle: vi.fn(() => Promise.resolve(response)),
    single: vi.fn(() => Promise.resolve(response)),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

describe('siteCashSettlementService helpers', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('calculates site cash and staff reimbursements without double-counting rejected lines', () => {
    const summary = calculateSiteCashSettlementSummary({
      openingBalance: 100_000_000,
      topupAmount: 50_000_000,
      lines: [
        settlementLine({ id: 'line-1', paymentSource: 'site_cash', claimedAmount: 30_000_000, approvedAmount: 30_000_000, fundSpendAmount: 30_000_000, status: 'accepted' }),
        settlementLine({ id: 'line-2', paymentSource: 'site_cash', claimedAmount: 15_000_000, approvedAmount: 12_000_000, fundSpendAmount: 12_000_000, status: 'adjusted' }),
        settlementLine({ id: 'line-3', paymentSource: 'site_cash', claimedAmount: 8_000_000, approvedAmount: 0, fundSpendAmount: 0, status: 'rejected' }),
        settlementLine({ id: 'line-4', sourceId: 'direct-4', paymentSource: 'staff_paid', claimedAmount: 5_000_000, approvedAmount: 4_000_000, fundSpendAmount: 0, staffClaimAmount: 5_000_000, staffReimbursedAmount: 3_000_000, status: 'adjusted' }),
      ],
    });

    expect(summary.claimedAmount).toBe(58_000_000);
    expect(summary.approvedSpendAmount).toBe(46_000_000);
    expect(summary.rejectedAmount).toBe(8_000_000);
    expect(summary.approvedSiteCashSpend).toBe(42_000_000);
    expect(summary.approvedStaffPaidAmount).toBe(4_000_000);
    expect(summary.staffReimbursedAmount).toBe(3_000_000);
    expect(summary.staffOutstandingAmount).toBe(1_000_000);
    expect(summary.endingBalance).toBe(105_000_000);
  });

  it('builds draft settlement lines only from direct purchases that use site cash or staff paid', () => {
    const lines = buildSettlementLinesFromDirectPurchases({
      settlementBatchId: 'settlement-1',
      purchases: [
        directPurchase({ id: 'direct-1', paymentSource: 'site_cash', totalAmount: 5_000_000 }),
        directPurchase({ id: 'direct-2', code: 'MNN-002', paymentSource: 'staff_paid', totalAmount: 2_500_000 }),
        directPurchase({ id: 'direct-3', code: 'MNN-003', paymentSource: 'supplier_credit', totalAmount: 9_000_000 }),
      ],
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      settlementBatchId: 'settlement-1',
      sourceType: 'site_direct_purchase',
      sourceId: 'direct-1',
      paymentSource: 'site_cash',
      claimedAmount: 5_000_000,
      fundSpendAmount: 5_000_000,
      staffClaimAmount: 0,
    });
    expect(lines[1]).toMatchObject({
      sourceId: 'direct-2',
      paymentSource: 'staff_paid',
      claimedAmount: 2_500_000,
      fundSpendAmount: 0,
      staffClaimAmount: 2_500_000,
    });
  });

  it('lists settlement batches with scoped filters and maps finance totals', async () => {
    const batchQuery = query({
      data: [{
        id: 'settlement-1',
        code: 'HU-202607-001',
        project_id: 'project-1',
        construction_site_id: 'site-1',
        period_month: '2026-07-01',
        cash_fund_id: 'fund-1',
        opening_balance: 100_000_000,
        topup_amount: 50_000_000,
        accepted_spend_amount: 46_000_000,
        rejected_spend_amount: 8_000_000,
        approved_site_cash_spend: 42_000_000,
        approved_staff_paid_amount: 4_000_000,
        staff_reimbursed_amount: 3_000_000,
        staff_outstanding_amount: 1_000_000,
        closing_balance: 105_000_000,
        status: 'approved',
        created_at: '2026-07-31T00:00:00.000Z',
      }],
      error: null,
    });
    supabaseMocks.from.mockReturnValueOnce(batchQuery);

    const rows = await siteCashSettlementService.listBatches({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      status: 'approved',
      periodMonth: '2026-07-01',
    });

    expect(supabaseMocks.from).toHaveBeenCalledWith('site_cash_settlement_batches');
    expect(batchQuery.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(batchQuery.eq).toHaveBeenCalledWith('construction_site_id', 'site-1');
    expect(batchQuery.eq).toHaveBeenCalledWith('status', 'approved');
    expect(batchQuery.eq).toHaveBeenCalledWith('period_month', '2026-07-01');
    expect(rows[0].approvedStaffPaidAmount).toBe(4_000_000);
    expect(rows[0].staffOutstandingAmount).toBe(1_000_000);
    expect(rows[0].closingBalance).toBe(105_000_000);
  });

  it('loads settlement batch detail with lines', async () => {
    const batchQuery = query({
      data: {
        id: 'settlement-1',
        code: 'HU-202607-001',
        construction_site_id: 'site-1',
        period_month: '2026-07-01',
        opening_balance: 100_000_000,
        topup_amount: 50_000_000,
        accepted_spend_amount: 46_000_000,
        rejected_spend_amount: 8_000_000,
        approved_site_cash_spend: 42_000_000,
        approved_staff_paid_amount: 4_000_000,
        staff_reimbursed_amount: 3_000_000,
        staff_outstanding_amount: 1_000_000,
        closing_balance: 105_000_000,
        status: 'approved',
        created_at: '2026-07-31T00:00:00.000Z',
      },
      error: null,
    });
    const lineQuery = query({
      data: [{
        id: 'line-1',
        settlement_batch_id: 'settlement-1',
        source_type: 'site_direct_purchase',
        source_id: 'direct-1',
        payment_source: 'staff_paid',
        supplier_name_snapshot: 'Tạp hóa cô Lan',
        document_no_snapshot: 'MNN-001',
        claimed_amount: 5_000_000,
        spend_amount: 5_000_000,
        approved_amount: 4_000_000,
        fund_spend_amount: 0,
        staff_claim_amount: 5_000_000,
        staff_reimbursed_amount: 3_000_000,
        status: 'adjusted',
        created_at: '2026-07-31T00:00:00.000Z',
      }],
      error: null,
    });
    supabaseMocks.from
      .mockReturnValueOnce(batchQuery)
      .mockReturnValueOnce(lineQuery);

    const detail = await siteCashSettlementService.getBatchDetail('settlement-1');

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(1, 'site_cash_settlement_batches');
    expect(supabaseMocks.from).toHaveBeenNthCalledWith(2, 'site_cash_settlement_lines');
    expect(batchQuery.eq).toHaveBeenCalledWith('id', 'settlement-1');
    expect(lineQuery.eq).toHaveBeenCalledWith('settlement_batch_id', 'settlement-1');
    expect(detail.lines[0].paymentSource).toBe('staff_paid');
    expect(detail.lines[0].staffReimbursedAmount).toBe(3_000_000);
  });

  it('posts and reverses a site cash settlement through atomic RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: {
          id: 'settlement-1',
          code: 'HU-202607-001',
          construction_site_id: 'site-1',
          period_month: '2026-07-01',
          opening_balance: 100_000_000,
          topup_amount: 50_000_000,
          accepted_spend_amount: 46_000_000,
          rejected_spend_amount: 8_000_000,
          approved_site_cash_spend: 42_000_000,
          approved_staff_paid_amount: 4_000_000,
          staff_reimbursed_amount: 3_000_000,
          staff_outstanding_amount: 1_000_000,
          closing_balance: 105_000_000,
          status: 'approved',
          created_at: '2026-07-31T00:00:00.000Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'settlement-1',
          code: 'HU-202607-001',
          status: 'cancelled',
          opening_balance: 100_000_000,
          topup_amount: 50_000_000,
          accepted_spend_amount: 46_000_000,
          rejected_spend_amount: 8_000_000,
          closing_balance: 105_000_000,
          created_at: '2026-07-31T00:00:00.000Z',
        },
        error: null,
      });

    const posted = await siteCashSettlementService.post('settlement-1', 'user-1');
    const reversed = await siteCashSettlementService.reverse('settlement-1', 'user-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'post_site_cash_settlement_batch', {
      p_batch_id: 'settlement-1',
      p_actor_id: 'user-1',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'reverse_site_cash_settlement_batch', {
      p_batch_id: 'settlement-1',
      p_actor_id: 'user-1',
    });
    expect(posted.status).toBe('approved');
    expect(reversed.status).toBe('cancelled');
  });
});
