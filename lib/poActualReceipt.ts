import type { Transaction, TransactionItem } from '../types';

export interface ReceiptQuantityLine {
  index: number;
  quantity: number;
  reason: string;
}

export const validateReceiptQuantityLines = (
  transaction: Pick<Transaction, 'items'>,
  lines: ReceiptQuantityLine[],
): ReceiptQuantityLine[] => {
  const byIndex = new Map(lines.map(line => [line.index, line]));

  return transaction.items.map((item, index) => {
    const line = byIndex.get(index);
    if (!line || !Number.isFinite(line.quantity) || line.quantity < 0) {
      throw new Error(`Dòng ${index + 1}: Số lượng thực nhận không được âm.`);
    }

    const orderedQty = Number.isFinite(Number(item.orderedQty))
      ? Number(item.orderedQty)
      : Number(item.quantity || 0);
    const reason = line.reason.trim();
    if (line.quantity !== orderedQty && !reason) {
      throw new Error(`Dòng ${index + 1}: Phải nhập lý do khi số lượng thực nhận lệch số lượng trên phiếu.`);
    }

    return { ...line, reason };
  });
};

export const buildActualReceiptItems = (
  items: TransactionItem[],
  lines: ReceiptQuantityLine[],
): TransactionItem[] => {
  const byIndex = new Map(lines.map(line => [line.index, line]));
  return items.map((item, index) => {
    const line = byIndex.get(index);
    if (!line) return item;
    const orderedQty = Number.isFinite(Number(item.orderedQty))
      ? Number(item.orderedQty)
      : Number(item.quantity || 0);
    return {
      ...item,
      quantity: line.quantity,
      orderedQty,
      varianceReason: line.reason || item.varianceReason,
    };
  });
};
