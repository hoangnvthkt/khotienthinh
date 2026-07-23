import { describe, expect, it } from 'vitest';
import { buildActualReceiptItems, validateReceiptQuantityLines } from '../poActualReceipt';

const transaction = {
  items: [{ itemId: 'steel', quantity: 2000, orderedQty: 2000, varianceReason: undefined }],
} as any;

describe('poActualReceipt', () => {
  it('accepts overage only with reason and preserves ordered baseline', () => {
    const lines = validateReceiptQuantityLines(transaction, [{ index: 0, quantity: 2010, reason: 'Kết quả cân thực tế' }]);
    expect(buildActualReceiptItems(transaction.items, lines)[0]).toMatchObject({
      quantity: 2010,
      orderedQty: 2000,
      varianceReason: 'Kết quả cân thực tế',
    });
  });

  it('rejects a changed quantity without reason', () => {
    expect(() => validateReceiptQuantityLines(transaction, [{ index: 0, quantity: 2010, reason: '' }]))
      .toThrow('Phải nhập lý do');
  });

  it('accepts short receipt and zero with a reason', () => {
    expect(validateReceiptQuantityLines(transaction, [{ index: 0, quantity: 0, reason: 'Không giao dòng này' }]))
      .toHaveLength(1);
  });
});
