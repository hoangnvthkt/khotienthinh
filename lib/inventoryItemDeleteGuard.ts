import type { InventoryItem, MaterialRequest, Transaction } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

export type InventoryItemDeleteBlocker = {
  key: string;
  label: string;
  count: number;
};

const optionalMissingTableCodes = new Set(['42P01', 'PGRST205']);

export const getInventoryItemTotalStock = (item?: Pick<InventoryItem, 'stockByWarehouse'> | null) =>
  Object.values(item?.stockByWarehouse || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);

export const formatInventoryItemDeleteBlockers = (blockers: InventoryItemDeleteBlocker[]) =>
  blockers
    .filter(blocker => blocker.count > 0)
    .map(blocker => `${blocker.label}: ${blocker.count.toLocaleString('vi-VN')}`)
    .join(' • ');

export const getLocalInventoryItemDeleteBlockers = (
  item: InventoryItem,
  context: {
    transactions?: Transaction[];
    requests?: MaterialRequest[];
  } = {},
): InventoryItemDeleteBlocker[] => {
  const itemId = item.id;
  const totalStock = getInventoryItemTotalStock(item);
  const transactionCount = (context.transactions || []).filter(tx =>
    (tx.items || []).some(line => line.itemId === itemId) ||
    (tx.pendingItems || []).some(pendingItem => pendingItem.id === itemId),
  ).length;
  const requestCount = (context.requests || []).filter(req =>
    (req.items || []).some(line => line.itemId === itemId),
  ).length;

  return [
    { key: 'stock', label: 'Tồn kho hiện tại', count: totalStock },
    { key: 'transactions', label: 'Phiếu giao dịch kho liên quan', count: transactionCount },
    { key: 'requests', label: 'Đề xuất vật tư liên quan', count: requestCount },
  ].filter(blocker => blocker.count > 0);
};

const countRows = async (
  label: string,
  buildQuery: () => any,
): Promise<InventoryItemDeleteBlocker | null> => {
  const { data, error } = await buildQuery();
  if (error) {
    if (optionalMissingTableCodes.has(error.code)) return null;
    throw error;
  }
  const safeCount = (data || []).length > 0 ? 1 : 0;
  return safeCount > 0 ? { key: label, label, count: safeCount } : null;
};

export const getRemoteInventoryItemDeleteBlockers = async (itemId: string): Promise<InventoryItemDeleteBlocker[]> => {
  if (!isSupabaseConfigured) return [];

  const checks = await Promise.all([
    countRows('Phiếu giao dịch kho liên quan', () =>
      supabase.from('transactions').select('id').contains('items', [{ itemId }]).limit(1),
    ),
    countRows('Phiếu giao dịch kho pending item liên quan', () =>
      supabase.from('transactions').select('id').contains('pending_items', [{ id: itemId }]).limit(1),
    ),
    countRows('Đề xuất vật tư liên quan', () =>
      supabase.from('requests').select('id').contains('items', [{ itemId }]).limit(1),
    ),
    countRows('Đơn hàng PO liên quan', () =>
      supabase.from('purchase_orders').select('id').contains('items', [{ itemId }]).limit(1),
    ),
    countRows('Đợt nhận vật tư từ PO/đề xuất liên quan', () =>
      supabase.from('material_request_fulfillment_lines').select('id').eq('item_id', itemId).limit(1),
    ),
    countRows('Phiếu xuất cấp thi công liên quan', () =>
      supabase.from('material_issue_lines').select('id').eq('item_id', itemId).limit(1),
    ),
    countRows('Xác nhận nhận vật tư liên quan', () =>
      supabase.from('material_issue_receipt_lines').select('id').eq('item_id', itemId).limit(1),
    ),
    countRows('Phiếu trả vật tư thi công liên quan', () =>
      supabase.from('material_issue_return_lines').select('id').eq('item_id', itemId).limit(1),
    ),
    countRows('Sổ công nợ vật tư đối tác liên quan', () =>
      supabase.from('material_party_ledger').select('id').eq('item_id', itemId).limit(1),
    ),
    countRows('Phiếu trả hàng NCC liên quan', () =>
      supabase.from('purchase_order_supplier_return_lines').select('id').eq('item_id', itemId).limit(1),
    ),
  ]);

  const merged = new Map<string, InventoryItemDeleteBlocker>();
  checks.filter(Boolean).forEach(blocker => {
    const current = merged.get(blocker!.label);
    merged.set(blocker!.label, {
      ...blocker!,
      count: Number(current?.count || 0) + Number(blocker!.count || 0),
    });
  });
  return Array.from(merged.values()).filter(blocker => blocker.count > 0);
};
