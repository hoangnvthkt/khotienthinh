import { supabase } from '../supabase';
import { parseQuantity6 } from '../procurement/decimal';

export interface SiteStockContext {
  itemId: string;
  availableQuantity: string | null;
  inTransitQuantity: string;
  receiptCustodyQuantity: string | null;
}

function quantity(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid site stock quantity');
  const raw = String(value);
  parseQuantity6(raw);
  return raw;
}

export function parseSiteStockContext(data: unknown, warehouseId: string): SiteStockContext[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid site stock response');
  const value = data as Record<string, unknown>;
  if (value.metricVersion !== 'project.site-stock.g6.v1' || value.warehouseId !== warehouseId || !Array.isArray(value.rows)) {
    throw new Error('Invalid site stock response');
  }
  const seen = new Set<string>();
  return value.rows.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid site stock row');
    const row = entry as Record<string, unknown>;
    if (typeof row.itemId !== 'string' || !row.itemId || seen.has(row.itemId)) throw new Error('Invalid site stock item');
    seen.add(row.itemId);
    return {
      itemId: row.itemId,
      availableQuantity: quantity(row.availableQty, true),
      inTransitQuantity: quantity(row.inTransitQty)!,
      receiptCustodyQuantity: quantity(row.receiptCustodyQty, true),
    };
  });
}

export const siteStockContextService = {
  async get(input: { projectId: string; constructionSiteId?: string | null; warehouseId: string; itemIds: string[] }) {
    const { data, error } = await supabase.rpc('get_project_material_request_site_stock_context_v1', {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId || null,
      p_warehouse_id: input.warehouseId,
      p_item_ids: input.itemIds,
    });
    if (error) throw error;
    return parseSiteStockContext(data, input.warehouseId);
  },
};
