import type { SiteCashSettlementBatch, SiteCashSettlementLine, SiteDirectPurchase } from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const BATCH_TABLE = 'site_cash_settlement_batches';
const LINE_TABLE = 'site_cash_settlement_lines';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const directPurchaseSettlementSources = new Set(['site_cash', 'staff_paid']);

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const calculateSiteCashSettlementSummary = (input: {
  openingBalance: number;
  topupAmount: number;
  lines: SiteCashSettlementLine[];
}) => {
  const claimedAmount = money(input.lines.reduce((sum, line) => sum + numeric(line.claimedAmount ?? line.spendAmount), 0));
  const approvedSpendAmount = money(input.lines.reduce((sum, line) => {
    if (line.status === 'accepted' || line.status === 'adjusted') return sum + numeric(line.approvedAmount);
    return sum;
  }, 0));
  const rejectedAmount = money(input.lines.reduce((sum, line) => {
    if (line.status === 'rejected') return sum + numeric(line.claimedAmount ?? line.spendAmount);
    return sum;
  }, 0));
  const approvedSiteCashSpend = money(input.lines.reduce((sum, line) => {
    if (line.status !== 'accepted' && line.status !== 'adjusted') return sum;
    if (line.paymentSource === 'site_cash') return sum + numeric(line.fundSpendAmount ?? line.approvedAmount);
    return sum + numeric(line.fundSpendAmount);
  }, 0));
  const approvedStaffPaidAmount = money(input.lines.reduce((sum, line) => {
    if (line.status !== 'accepted' && line.status !== 'adjusted') return sum;
    if (line.paymentSource !== 'staff_paid') return sum;
    return sum + numeric(line.approvedAmount);
  }, 0));
  const staffReimbursedAmount = money(input.lines.reduce((sum, line) => {
    if (line.status !== 'accepted' && line.status !== 'adjusted') return sum;
    return sum + numeric(line.staffReimbursedAmount);
  }, 0));
  const staffOutstandingAmount = money(Math.max(0, approvedStaffPaidAmount - staffReimbursedAmount));
  return {
    claimedAmount,
    approvedSpendAmount,
    rejectedAmount,
    approvedSiteCashSpend,
    approvedStaffPaidAmount,
    staffReimbursedAmount,
    staffOutstandingAmount,
    endingBalance: money(numeric(input.openingBalance) + numeric(input.topupAmount) - approvedSiteCashSpend - staffReimbursedAmount),
  };
};

const normalizeBatch = (row: any): SiteCashSettlementBatch => ({
  ...(fromDb(row) as SiteCashSettlementBatch),
  openingBalance: money(row.opening_balance ?? row.openingBalance),
  topupAmount: money(row.topup_amount ?? row.topupAmount),
  acceptedSpendAmount: money(row.accepted_spend_amount ?? row.acceptedSpendAmount),
  rejectedSpendAmount: money(row.rejected_spend_amount ?? row.rejectedSpendAmount),
  approvedSiteCashSpend: money(row.approved_site_cash_spend ?? row.approvedSiteCashSpend),
  approvedStaffPaidAmount: money(row.approved_staff_paid_amount ?? row.approvedStaffPaidAmount),
  staffReimbursedAmount: money(row.staff_reimbursed_amount ?? row.staffReimbursedAmount),
  staffOutstandingAmount: money(row.staff_outstanding_amount ?? row.staffOutstandingAmount),
  closingBalance: money(row.closing_balance ?? row.closingBalance),
  metadata: row.metadata || {},
});

const normalizeLine = (row: any): SiteCashSettlementLine => ({
  ...(fromDb(row) as SiteCashSettlementLine),
  claimedAmount: money(row.claimed_amount ?? row.claimedAmount),
  spendAmount: money(row.spend_amount ?? row.spendAmount),
  approvedAmount: money(row.approved_amount ?? row.approvedAmount),
  fundSpendAmount: money(row.fund_spend_amount ?? row.fundSpendAmount),
  staffClaimAmount: money(row.staff_claim_amount ?? row.staffClaimAmount),
  staffReimbursedAmount: money(row.staff_reimbursed_amount ?? row.staffReimbursedAmount),
});

export const buildSettlementLinesFromDirectPurchases = (input: {
  settlementBatchId: string;
  purchases: SiteDirectPurchase[];
}): SiteCashSettlementLine[] =>
  input.purchases
    .filter(purchase => directPurchaseSettlementSources.has(purchase.paymentSource))
    .map(purchase => {
      const totalAmount = money(purchase.totalAmount);
      const isStaffPaid = purchase.paymentSource === 'staff_paid';
      return {
        id: newId(),
        settlementBatchId: input.settlementBatchId,
        sourceType: 'site_direct_purchase',
        sourceId: purchase.id,
        supplierId: purchase.supplierId || null,
        supplierNameSnapshot: purchase.supplierNameSnapshot || null,
        documentNoSnapshot: purchase.invoiceNumber || purchase.code,
        description: purchase.note || `Mua nóng ${purchase.code} - ${purchase.supplierNameSnapshot}`,
        paymentSource: purchase.paymentSource,
        purchaseDate: purchase.purchaseDate || null,
        payerUserId: purchase.createdBy || null,
        payerNameSnapshot: null,
        claimedAmount: totalAmount,
        spendAmount: totalAmount,
        approvedAmount: totalAmount,
        fundSpendAmount: isStaffPaid ? 0 : totalAmount,
        staffClaimAmount: isStaffPaid ? totalAmount : 0,
        staffReimbursedAmount: 0,
        status: 'pending',
        note: null,
        createdAt: new Date().toISOString(),
      };
    });

const payloadForBatch = (input: SiteCashSettlementBatch, lines: SiteCashSettlementLine[] = []) => {
  const summary = calculateSiteCashSettlementSummary({
    openingBalance: input.openingBalance,
    topupAmount: input.topupAmount,
    lines,
  });
  return {
    ...input,
    acceptedSpendAmount: summary.approvedSpendAmount,
    rejectedSpendAmount: summary.rejectedAmount,
    approvedSiteCashSpend: summary.approvedSiteCashSpend,
    approvedStaffPaidAmount: summary.approvedStaffPaidAmount,
    staffReimbursedAmount: summary.staffReimbursedAmount,
    staffOutstandingAmount: summary.staffOutstandingAmount,
    closingBalance: summary.endingBalance,
  };
};

export const siteCashSettlementService = {
  async listBatches(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    status?: SiteCashSettlementBatch['status'] | null;
    periodMonth?: string | null;
  } = {}): Promise<SiteCashSettlementBatch[]> {
    let query = supabase.from(BATCH_TABLE).select('*').order('period_month', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.status) query = query.eq('status', input.status);
    if (input.periodMonth) query = query.eq('period_month', input.periodMonth);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizeBatch);
  },

  async getBatchDetail(id: string): Promise<{ batch: SiteCashSettlementBatch; lines: SiteCashSettlementLine[] }> {
    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (batchError) throw batchError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('settlement_batch_id', id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return {
      batch: normalizeBatch(batchRow),
      lines: (lineRows || []).map(normalizeLine),
    };
  },

  async buildDraftFromDirectPurchases(input: {
    settlementBatchId: string;
    projectId?: string | null;
    constructionSiteId: string;
    periodMonth: string;
  }): Promise<SiteCashSettlementLine[]> {
    const start = input.periodMonth.slice(0, 7) + '-01';
    const [year, month] = start.split('-').map(Number);
    const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    let query = supabase
      .from('site_direct_purchases')
      .select('*')
      .eq('construction_site_id', input.constructionSiteId)
      .in('payment_source', ['site_cash', 'staff_paid'])
      .is('site_cash_settlement_id', null)
      .gte('purchase_date', start)
      .lt('purchase_date', end)
      .order('purchase_date', { ascending: true });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return buildSettlementLinesFromDirectPurchases({
      settlementBatchId: input.settlementBatchId,
      purchases: (data || []).map(row => ({
        ...(fromDb(row) as SiteDirectPurchase),
        totalAmount: money(row.total_amount),
      })),
    });
  },

  async upsert(input: SiteCashSettlementBatch, lines: SiteCashSettlementLine[] = []): Promise<SiteCashSettlementBatch> {
    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .upsert(toDb(payloadForBatch(input, lines)), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    if (lines.length > 0) {
      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .upsert(lines.map(toDb), { onConflict: 'id' });
      if (lineError) throw lineError;
    }

    return normalizeBatch(data);
  },

  async reviewLines(settlementBatchId: string, lines: SiteCashSettlementLine[]): Promise<{ batch: SiteCashSettlementBatch; lines: SiteCashSettlementLine[] }> {
    if (lines.length > 0) {
      const { error } = await supabase
        .from(LINE_TABLE)
        .upsert(lines.map(line => toDb({ ...line, settlementBatchId })), { onConflict: 'id' });
      if (error) throw error;
    }
    return this.getBatchDetail(settlementBatchId);
  },

  async post(id: string, actorId?: string | null): Promise<SiteCashSettlementBatch> {
    const { data, error } = await supabase.rpc('post_site_cash_settlement_batch', {
      p_batch_id: id,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeBatch(Array.isArray(data) ? data[0] : data);
  },

  async reverse(id: string, actorId?: string | null): Promise<SiteCashSettlementBatch> {
    const { data, error } = await supabase.rpc('reverse_site_cash_settlement_batch', {
      p_batch_id: id,
      p_actor_id: actorId || null,
    });
    if (error) throw error;
    return normalizeBatch(Array.isArray(data) ? data[0] : data);
  },
};
