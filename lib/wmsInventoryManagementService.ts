import { supabase } from './supabase';

export interface AdjustInventoryStockInput {
  itemId: string;
  warehouseId: string;
  newQuantity: number;
  expectedCurrentQuantity: number;
  reason: string;
}

export interface InventoryStockAdjustmentReceipt {
  itemId: string;
  warehouseId: string;
  previousQuantity: number;
  quantity: number;
  adjustedBy: string;
  adjustedAt: string;
}

export const wmsInventoryManagementService = {
  async adjustStock(input: AdjustInventoryStockInput): Promise<InventoryStockAdjustmentReceipt> {
    const { data, error } = await supabase.rpc('adjust_inventory_stock', {
      p_item_id: input.itemId,
      p_warehouse_id: input.warehouseId,
      p_new_quantity: input.newQuantity,
      p_expected_current_quantity: input.expectedCurrentQuantity,
      p_reason: input.reason,
    });
    if (error) throw error;
    return data as InventoryStockAdjustmentReceipt;
  },
};
