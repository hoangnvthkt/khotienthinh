import type { SiteDirectPurchase, SiteDirectPurchaseLine } from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const PURCHASE_TABLE = 'site_direct_purchases';
const LINE_TABLE = 'site_direct_purchase_lines';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

export const calculateSiteDirectPurchaseTotals = (lines: SiteDirectPurchaseLine[]) => {
  const grossAmount = money(lines.reduce((sum, line) => sum + numeric(line.quantity) * numeric(line.unitPrice), 0));
  const vatAmount = money(lines.reduce((sum, line) => {
    const lineAmount = numeric(line.quantity) * numeric(line.unitPrice);
    return sum + lineAmount * numeric(line.vatRate) / 100;
  }, 0));
  return {
    grossAmount,
    vatAmount,
    totalAmount: money(grossAmount + vatAmount),
  };
};

export const canRecognizeSiteDirectPurchaseLine = (
  line: SiteDirectPurchaseLine,
  context: { wmsStatus?: string | null; financeAccepted?: boolean },
) => {
  if (line.status === 'rejected') return false;
  if (line.lineType === 'expense_only') return Boolean(context.financeAccepted);
  return context.wmsStatus === 'completed' && Boolean(context.financeAccepted);
};

const normalizePurchase = (row: any): SiteDirectPurchase => ({
  ...(fromDb(row) as SiteDirectPurchase),
  grossAmount: money(row.gross_amount),
  vatAmount: money(row.vat_amount),
  totalAmount: money(row.total_amount),
});

export const siteDirectPurchaseService = {
  async upsert(input: SiteDirectPurchase, lines: SiteDirectPurchaseLine[] = []): Promise<SiteDirectPurchase> {
    const totals = calculateSiteDirectPurchaseTotals(lines.length > 0 ? lines : input.lines || []);
    const { data, error } = await supabase
      .from(PURCHASE_TABLE)
      .upsert(toDb({ ...input, ...totals }), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;

    if (lines.length > 0) {
      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .upsert(lines.map(toDb), { onConflict: 'id' });
      if (lineError) throw lineError;
    }

    return normalizePurchase(data);
  },

  async list(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    supplierId?: string | null;
    status?: string | null;
  } = {}): Promise<SiteDirectPurchase[]> {
    let query = supabase.from(PURCHASE_TABLE).select('*').order('purchase_date', { ascending: false });
    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.supplierId) query = query.eq('supplier_id', input.supplierId);
    if (input.status) query = query.eq('status', input.status);
    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return (data || []).map(normalizePurchase);
  },
};
