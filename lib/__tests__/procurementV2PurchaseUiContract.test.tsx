import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProcurementV2PurchaseDialog } from '../../components/procurement-v2/ProcurementV2PurchaseDialog';
import type { ProcurementPurchaseCandidate } from '../procurement/procurementPurchaseOrderService';

describe('Procurement V2 purchase dialog', () => {
  it('asks for supplier, quantity, conversion, price, delivery and destination before creation', () => {
    const candidate = { demandLineId: 'line-1', itemName: 'Xi măng', sourceCode: 'VT-1',
      availableQty: '100.000000', unit: 'kg', purchaseUnit: 'bao',
      conversionNumerator: '50', conversionDenominator: '1', canAllocate: true,
      canViewPrice: true } as ProcurementPurchaseCandidate;
    const html = renderToStaticMarkup(<ProcurementV2PurchaseDialog open
      candidates={[candidate]} suppliers={[]} warehouses={[]} onClose={() => {}} onCreate={async () => {}} />);
    for (const label of ['Nhà cung cấp', 'Số lượng cần mua', 'Đơn vị mua',
      'Quy đổi', 'Đơn giá', 'Ngày giao dự kiến', 'Kho nhận', 'Ghi chú'])
      expect(html).toContain(label);
  });
});
