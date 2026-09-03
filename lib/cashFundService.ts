import type { CashFund } from '../types';
import { fromDb } from './dbMapping';
import { supabase } from './supabase';
import { getSupabaseOrderColumns } from './supabaseProjections';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';

const TABLE = 'cash_funds';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const normalizeCashFund = (row: any): CashFund => {
  const mapped = fromDb(row) as CashFund;
  return {
    ...mapped,
    currency: mapped.currency || 'VND',
    openingBalance: money((mapped as any).openingBalance),
    isActive: mapped.isActive !== false,
  };
};

export const cashFundService = {
  async listActive(): Promise<CashFund[]> {
    const { data, error } = await fetchAllSupabaseRows(supabase
      .from(TABLE)
      .select('id, name, currency, opening_balance, description, is_active, created_at')
      .eq('is_active', true)
      .order('name', { ascending: true }), { label: "lib/cashFundService.ts:26", maxRows: 20_000, orderBy: getSupabaseOrderColumns(TABLE) });

    if (error) {
      if (error.code === '42P01' || error.code === '42703') return [];
      throw error;
    }

    return (data || []).map(normalizeCashFund);
  },
};
