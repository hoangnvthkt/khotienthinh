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
