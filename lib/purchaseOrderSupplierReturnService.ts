import { PurchaseOrderSupplierReturn } from '../types';
import { supabase } from './supabase';

const RETURN_TABLE = 'purchase_order_supplier_returns';
const LINE_TABLE = 'purchase_order_supplier_return_lines';

const toCamel = (value: string) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const mapKeys = (value: any): any => {
  if (Array.isArray(value)) return value.map(mapKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [toCamel(key), mapKeys(item)]));
  }
  return value;
};

const mapReturns = (returnRows: any[], lineRows: any[]): PurchaseOrderSupplierReturn[] => {
  const linesByReturn = new Map<string, any[]>();
  lineRows.forEach(line => {
    linesByReturn.set(line.supplier_return_id, [...(linesByReturn.get(line.supplier_return_id) || []), line]);
  });
  return returnRows.map(row => ({
    ...mapKeys(row),
    lines: (linesByReturn.get(row.id) || []).map(mapKeys),
  }));
};

export const purchaseOrderSupplierReturnService = {
  async listByPurchaseOrderIds(purchaseOrderIds: string[]): Promise<PurchaseOrderSupplierReturn[]> {
    const ids = Array.from(new Set(purchaseOrderIds.filter(Boolean)));
    if (ids.length === 0) return [];

    const { data: returnRows, error: returnError } = await supabase
      .from(RETURN_TABLE)
      .select('*')
      .in('purchase_order_id', ids)
      .order('created_at', { ascending: false });
    if (returnError) {
      if (returnError.code === '42P01') return [];
      throw returnError;
    }
    if (!returnRows?.length) return [];

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .in('supplier_return_id', returnRows.map(row => row.id))
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return mapReturns(returnRows, lineRows || []);
  },

  async create(input: {
    purchaseOrderId: string;
    sourceWarehouseId: string;
    reason: string;
    note?: string;
    lines: Array<{ purchaseOrderLineId: string; quantity: number }>;
  }): Promise<PurchaseOrderSupplierReturn> {
    const { data, error } = await supabase.rpc('create_purchase_order_supplier_return', {
      p_purchase_order_id: input.purchaseOrderId,
      p_source_warehouse_id: input.sourceWarehouseId,
      p_lines: input.lines,
      p_reason: input.reason,
      p_note: input.note || null,
    });
    if (error) throw error;
    return { ...mapKeys(data), lines: [] } as PurchaseOrderSupplierReturn;
  },
};
