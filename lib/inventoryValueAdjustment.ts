// Bổ sung đơn giá cho dòng nhập kho giá 0 bằng phiếu điều chỉnh giá trị (DCGT).
// Phiếu nhập NCC chưa ghi công nợ đi đường Tài chính (route 'finance'); còn lại Kế toán kho lập phiếu ở đây.
import { isSupabaseConfigured, supabase } from './supabase';

export type UnpricedReceiptLine = {
  ledgerEntryId: string;
  date: string;
  documentCode: string;
  transactionId: string | null;
  quantity: number;
  unit: string;
  partner: string | null;
  note: string | null;
  route: 'finance' | 'adjust';
  suggestedPrice: number | null;
  suggestedSource: 'document' | 'catalog' | null;
  /** Phần của dòng nhập còn trong kho (nhập trước – xuất trước). */
  remainingQty: number;
};

export type UnpricedReceipts = { canAdjust: boolean; lines: UnpricedReceiptLine[] };

export type ValueAdjustmentResult = { id: string; code: string; totalIn: number; totalOut: number; totalStock: number };

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const mapUnpricedLine = (row: any): UnpricedReceiptLine => ({
  ledgerEntryId: String(row.ledgerEntryId),
  date: String(row.date ?? ''),
  documentCode: String(row.documentCode ?? ''),
  transactionId: row.transactionId ?? null,
  quantity: num(row.quantity),
  unit: String(row.unit ?? ''),
  partner: row.partner ?? null,
  note: row.note ?? null,
  route: row.route === 'finance' ? 'finance' : 'adjust',
  suggestedPrice: row.suggestedPrice == null ? null : num(row.suggestedPrice) || null,
  suggestedSource: row.suggestedSource === 'document' || row.suggestedSource === 'catalog' ? row.suggestedSource : null,
  remainingQty: Math.min(num(row.quantity), Math.max(0, num(row.remainingQty))),
});

/** Giá trị phiếu sẽ ghi: nhập = SL × giá; phần còn tồn vào giá trị tồn; phần đã xuất vào giá trị xuất. */
export const previewAdjustment = (lines: UnpricedReceiptLine[], prices: Record<string, number | undefined>) =>
  lines.reduce((acc, line) => {
    const price = prices[line.ledgerEntryId];
    if (line.route !== 'adjust' || !price || price <= 0) return acc;
    const valueIn = Math.round(line.quantity * price);
    const valueStock = Math.round(line.remainingQty * price);
    return {
      lines: acc.lines + 1,
      valueIn: acc.valueIn + valueIn,
      valueStock: acc.valueStock + valueStock,
      valueOut: acc.valueOut + valueIn - valueStock,
    };
  }, { lines: 0, valueIn: 0, valueOut: 0, valueStock: 0 });

const ERROR_TEXT: Record<string, string> = {
  INVENTORY_VALUE_DENIED: 'Cần ô quyền Kế toán kho để bổ sung đơn giá.',
  INVENTORY_VALUE_REASON_REQUIRED: 'Nhập lý do bổ sung giá (ví dụ: theo hóa đơn số …).',
  INVENTORY_VALUE_LINES_REQUIRED: 'Nhập đơn giá ít nhất một dòng.',
  INVENTORY_VALUE_PRICE_INVALID: 'Đơn giá phải lớn hơn 0.',
  INVENTORY_VALUE_ALREADY_PRICED: 'Dòng nhập này đã có giá. Tải lại để xem số mới.',
  INVENTORY_VALUE_FINANCE_ROUTE: 'Phiếu nhập NCC chưa ghi công nợ: bổ sung giá ở Tài chính → Phiếu nhập NCC.',
  INVENTORY_VALUE_BALANCE_MISMATCH: 'Tồn kho của dòng này lệch sổ kho, báo quản trị kiểm tra.',
};

export const valueAdjustmentErrorText = (error: any) => {
  const message = String(error?.message || '');
  const key = Object.keys(ERROR_TEXT).find(code => message.includes(code));
  return key ? ERROR_TEXT[key] : message || 'Chưa ghi được phiếu điều chỉnh.';
};

export const inventoryValueAdjustmentService = {
  async listUnpriced(warehouseId: string, materialId: string): Promise<UnpricedReceipts> {
    if (!isSupabaseConfigured) return { canAdjust: false, lines: [] };
    const { data, error } = await supabase.rpc('get_inventory_unpriced_receipts_v1', { p_filters: { warehouseId, materialId } });
    if (error) throw error;
    return { canAdjust: (data as any)?.canAdjust === true, lines: ((data as any)?.lines || []).map(mapUnpricedLine) };
  },

  async post(reason: string, lines: Array<{ ledgerEntryId: string; unitPrice: number }>): Promise<ValueAdjustmentResult> {
    const { data, error } = await supabase.rpc('post_inventory_value_adjustment_v1', { p: { reason, lines } });
    if (error) throw error;
    const d = data as any;
    return { id: d.id, code: d.code, totalIn: num(d.totalIn), totalOut: num(d.totalOut), totalStock: num(d.totalStock) };
  },
};
