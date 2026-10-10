import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';
import type { SpecAllocation } from './wmsCatalogService';

// Tồn theo quy cách của nhiều mã tại một kho — để chọn quy cách trên phiếu xuất (V2).
// Chỉ trả mã có quy cách đặt tên; thứ tự = thứ tự xuất tự động (nhập trước).
export type WarehouseSpecStock = Record<string, SpecAllocation[]>;

export const wmsSpecStockService = {
  async get(warehouseId: string, itemIds: string[]): Promise<WarehouseSpecStock> {
    if (!isSupabaseConfigured || !warehouseId || itemIds.length === 0) return {};
    const { data, error } = await supabase.rpc('get_wms_spec_stock_v1', { p_warehouse_id: warehouseId, p_item_ids: itemIds });
    if (error) throw error;
    return (data || {}) as WarehouseSpecStock;
  },
};

/** Không tải được (thiếu quyền, mất mạng) thì coi như không có quy cách — phiếu vẫn lập được, xuất tự lấy nhập trước. */
export const useWarehouseSpecStock = (warehouseId: string | null | undefined, itemIds: string[]) => {
  const [stock, setStock] = useState<WarehouseSpecStock>({});
  const key = [...new Set(itemIds)].sort().join(',');
  useEffect(() => {
    let live = true;
    if (!warehouseId || !key) { setStock({}); return; }
    wmsSpecStockService.get(warehouseId, key.split(',')).then(s => { if (live) setStock(s); }).catch(() => { if (live) setStock({}); });
    return () => { live = false; };
  }, [warehouseId, key]);
  return stock;
};

export interface TxLedgerAllocation { itemId: string; direction: 'in' | 'out'; qty: number; allocations: SpecAllocation[] | null }

/** Quy cách thực của các dòng sổ kho thuộc một phiếu kho (xuất tự lấy nhập trước cũng có). */
export const fetchTxSpecAllocations = async (transactionId: string): Promise<TxLedgerAllocation[]> => {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_wms_tx_spec_allocations_v1', { p_transaction_id: transactionId });
  if (error) throw error;
  return (data || []) as TxLedgerAllocation[];
};

/**
 * Ghép dòng sổ kho vào từng dòng phiếu: theo mã, theo thứ tự (dòng thứ n của mã ↔ dòng sổ thứ n của mã).
 * Nhập lấy dòng sổ nhập, còn lại lấy dòng sổ xuất. Trả null khi dòng không có quy cách đặt tên.
 */
export const lineSpecAllocations = (isImport: boolean, lines: Array<{ itemId: string }>, ledger: TxLedgerAllocation[]): Array<SpecAllocation[] | null> => {
  const queue = new Map<string, TxLedgerAllocation[]>();
  ledger.filter(e => e.direction === (isImport ? 'in' : 'out')).forEach(e => queue.set(e.itemId, [...(queue.get(e.itemId) || []), e]));
  return lines.map(line => {
    const e = queue.get(line.itemId)?.shift();
    const parts = (e?.allocations || []).filter(a => Number(a.qty) > 0);
    return parts.some(a => a.specification) ? parts : null;
  });
};

/** "M350CV, R7 · 10; chưa ghi quy cách · 5" (một phần thì không kèm số). */
export const specAllocationText = (parts: SpecAllocation[], fmt: (n: number) => string) =>
  parts.length === 1 ? (parts[0].specification || 'chưa ghi quy cách')
    : parts.map(a => `${a.specification || 'chưa ghi quy cách'} · ${fmt(Number(a.qty))}`).join('; ');
