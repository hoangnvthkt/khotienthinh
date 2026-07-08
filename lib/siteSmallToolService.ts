import type {
  SiteSmallToolHolderType,
  SiteSmallToolRecord,
  SiteSmallToolStatus,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { supabase } from './supabase';

const TABLE = 'site_small_tool_records';

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => Math.round(numeric(value) * 100) / 100;

const isMissingSmallToolTable = (error: any): boolean =>
  error?.code === '42P01'
  || String(error?.message || '').includes(TABLE)
  || String(error?.message || '').includes('sync_site_small_tools_from_site_direct_purchase');

const normalizeRecord = (row: any): SiteSmallToolRecord => {
  const mapped = fromDb(row) as SiteSmallToolRecord;
  return {
    ...mapped,
    quantity: numeric((mapped as any).quantity),
    unitCost: money((mapped as any).unitCost),
    totalAmount: money((mapped as any).totalAmount),
    holderType: mapped.holderType || 'site',
    status: mapped.status || 'stored',
    attachments: mapped.attachments || [],
  };
};

export const siteSmallToolService = {
  async list(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    status?: SiteSmallToolStatus | 'all' | null;
    holderType?: SiteSmallToolHolderType | 'all' | null;
    search?: string | null;
  } = {}): Promise<SiteSmallToolRecord[]> {
    let query = supabase
      .from(TABLE)
      .select('*')
      .order('purchase_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (input.projectId) query = query.eq('project_id', input.projectId);
    if (input.constructionSiteId) query = query.eq('construction_site_id', input.constructionSiteId);
    if (input.status && input.status !== 'all') query = query.eq('status', input.status);
    if (input.holderType && input.holderType !== 'all') query = query.eq('holder_type', input.holderType);
    if (input.search?.trim()) query = query.ilike('item_name_snapshot', `%${input.search.trim()}%`);

    const { data, error } = await query;
    if (error) {
      if (isMissingSmallToolTable(error)) return [];
      throw error;
    }
    return (data || []).map(normalizeRecord);
  },

  async getDetail(id: string): Promise<SiteSmallToolRecord> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return normalizeRecord(data);
  },

  async syncFromSiteDirectPurchase(directPurchaseId: string): Promise<SiteSmallToolRecord[]> {
    const { data, error } = await supabase.rpc('sync_site_small_tools_from_site_direct_purchase', {
      p_direct_purchase_id: directPurchaseId,
    });
    if (error) {
      if (isMissingSmallToolTable(error)) return [];
      throw error;
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows.map(normalizeRecord);
  },

  async updateCustody(
    id: string,
    patch: {
      holderType: SiteSmallToolHolderType;
      holderId?: string | null;
      holderNameSnapshot?: string | null;
      locationNote?: string | null;
    },
  ): Promise<SiteSmallToolRecord> {
    const { data, error } = await supabase
      .from(TABLE)
      .update(toDb({
        holderType: patch.holderType,
        holderId: patch.holderId || null,
        holderNameSnapshot: patch.holderNameSnapshot || null,
        locationNote: patch.locationNote || null,
        status: patch.holderType === 'site' ? 'stored' : 'in_use',
        updatedAt: new Date().toISOString(),
      }))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeRecord(data);
  },

  async updateStatus(id: string, status: SiteSmallToolStatus, note?: string | null): Promise<SiteSmallToolRecord> {
    const { data, error } = await supabase
      .from(TABLE)
      .update(toDb({
        status,
        note: note || null,
        updatedAt: new Date().toISOString(),
      }))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeRecord(data);
  },
};
