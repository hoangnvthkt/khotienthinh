import type { SiteCashSettlementBatch, SiteCashSettlementLine } from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const BATCH_TABLE = 'site_cash_settlement_batches';
const LINE_TABLE = 'site_cash_settlement_lines';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

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
  return {
    claimedAmount,
    approvedSpendAmount,
    rejectedAmount,
    endingBalance: money(numeric(input.openingBalance) + numeric(input.topupAmount) - approvedSpendAmount),
  };
};

const normalizeBatch = (row: any): SiteCashSettlementBatch => ({
  ...(fromDb(row) as SiteCashSettlementBatch),
  openingBalance: money(row.opening_balance),
  topupAmount: money(row.topup_amount),
  acceptedSpendAmount: money(row.accepted_spend_amount),
  rejectedSpendAmount: money(row.rejected_spend_amount),
  closingBalance: money(row.closing_balance),
});

export const siteCashSettlementService = {
  async upsert(input: SiteCashSettlementBatch, lines: SiteCashSettlementLine[] = []): Promise<SiteCashSettlementBatch> {
    const summary = calculateSiteCashSettlementSummary({
      openingBalance: input.openingBalance,
      topupAmount: input.topupAmount,
      lines,
    });
    const payload = {
      ...input,
      acceptedSpendAmount: summary.approvedSpendAmount,
      rejectedSpendAmount: summary.rejectedAmount,
      closingBalance: summary.endingBalance,
    };
    const { data, error } = await supabase
      .from(BATCH_TABLE)
      .upsert(toDb(payload), { onConflict: 'id' })
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
};
