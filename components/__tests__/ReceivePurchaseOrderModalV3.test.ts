import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modalSource = readFileSync(new URL('../ReceivePurchaseOrderModal.tsx', import.meta.url), 'utf8');
const inventorySource = readFileSync(new URL('../../pages/Inventory.tsx', import.meta.url), 'utf8');

describe('purchase receipt v3 UI contract', () => {
  it('opens an approved flow v3 batch without requiring a pre-created WMS transaction', () => {
    expect(inventorySource).toContain('lookup.purchaseOrder.procurementFlowVersion === 3');
    expect(inventorySource).toContain("lookup.deliveryBatch.approvalStatus !== 'approved'");
  });

  it('records each flow v3 receipt with independent purchase and stock quantities', () => {
    expect(modalSource).toContain('purchaseReceiptService.recordReceiptV3');
    expect(modalSource).toContain('SL giao theo ĐVT mua');
    expect(modalSource).toContain('SL đạt nhập kho');
    expect(modalSource).toContain('Xác nhận &amp; kết thúc đợt');
  });
});
