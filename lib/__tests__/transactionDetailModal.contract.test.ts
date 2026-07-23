import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../components/TransactionDetailModal.tsx', import.meta.url),
  'utf8',
);

describe('transaction detail actual receipt contract', () => {
  it('does not cap actual quantity to the current voucher quantity', () => {
    expect(source).not.toContain('Số lượng thực tế không được lớn hơn số lượng trên phiếu');
    expect(source).toContain('buildActualReceiptItems');
    expect(source).toContain('orderedQty');
  });

  it('supports approval attachments and lazy viewing', () => {
    expect(source).toContain('uploadTransactionAttachments');
    expect(source).toContain('persistTransactionAttachments');
    expect(source).toContain('getTransactionAttachmentUrl');
    expect(source).toContain('Xem tệp');
    expect(source).toContain('Tải xuống');
  });
});
