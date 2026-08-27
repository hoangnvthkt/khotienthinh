import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../ReceivePurchaseOrderModal.tsx', import.meta.url),
  'utf8',
);
const inventorySource = readFileSync(new URL('../../pages/Inventory.tsx', import.meta.url), 'utf8');
const operationsSource = readFileSync(new URL('../../pages/Operations.tsx', import.meta.url), 'utf8');

describe('ReceivePurchaseOrderModal practical flow', () => {
  it('captures actual delivered, quality accepted, and stock quantities separately', () => {
    expect(source).toContain("['SL thực giao'");
    expect(source).toContain("['SL đạt chất lượng'");
    expect(source).toContain("['SL giao theo đơn vị kho'");
    expect(source).toContain("['SL thực nhập kho'");
  });

  it('uses a quality action for PENDING and a stock action for APPROVED', () => {
    expect(source).toContain("transaction.status === TransactionStatus.PENDING");
    expect(source).toContain("transaction.status === TransactionStatus.APPROVED");
    expect(source).toContain('Duyệt SL/CL');
    expect(source).toContain('Nhập kho');
    expect(source).toContain('Đã nhập kho');
    expect(source).toContain('purchaseReceiptService.finalizeReceipt');
  });

  it('keeps the modal open after quality approval so stock receipt remains a separate action', () => {
    const qualityBranch = source.slice(
      source.indexOf('purchaseReceiptService.approveQuality'),
      source.indexOf('purchaseReceiptService.finalizeReceipt'),
    );
    expect(qualityBranch).not.toContain('onClose();');
  });

  it('routes existing PO delivery WMS vouchers through the shared transaction detail', () => {
    expect(operationsSource).not.toContain('<ReceivePurchaseOrderModal');
    expect(operationsSource).toContain('setViewingHistoryTx(tx)');
    expect(inventorySource).toContain('setViewingPurchaseReceiptTx(transaction)');
    expect(inventorySource).toContain('<TransactionDetailModal');
  });
});
