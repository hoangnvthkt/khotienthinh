import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const editorSource = readFileSync(
  new URL('../PurchaseDeliveryBatchEditor.tsx', import.meta.url),
  'utf8',
);
const supplyChainSource = readFileSync(
  new URL('../../../pages/project/SupplyChainTab.tsx', import.meta.url),
  'utf8',
);

describe('PurchaseDeliveryBatchEditor UI contract', () => {
  it('keeps warehouse receipt quantity out of the delivery planning editor', () => {
    expect(editorSource).not.toContain('SL nhập kho');
    expect(editorSource).toContain('SL quy đổi');
    expect(editorSource).toContain('value={line.stockQty}');
    expect(editorSource).toContain('getStockQtyForPurchaseDeliveryLine(line, purchaseQty)');
  });

  it('opens package delivery editing in a wider modal for multi-line purchase orders', () => {
    expect(supplyChainSource).toContain('max-w-7xl');
  });

  it('keeps PO line notes opt-in and collapses package reconciliation details by default', () => {
    expect(supplyChainSource).toContain('noteEnabled?: boolean');
    expect(supplyChainSource).toContain('Thêm ghi chú');
    expect(supplyChainSource).toContain('getPoItemNoteForSave(item)');
    expect(supplyChainSource).toContain('expandedLineDetailsIdx');
    expect(supplyChainSource).toContain('showPackageReconcileDetails');
    expect(supplyChainSource).toContain('Chi tiết đối soát');
  });

  it('shows the delivery schedule editor directly in request package PO drafts', () => {
    expect(supplyChainSource).toContain('Lịch giao dự kiến');
    expect(supplyChainSource).toContain('Đơn giao nhiều lần: từng đợt có số lượng, giá và VAT riêng');
    expect(supplyChainSource).not.toContain('{!isPurchasePackageV2Form && (');
  });

  it('lets request package PO lines edit the purchase quantity used for pricing', () => {
    expect(supplyChainSource).toContain('SL MUA');
    expect(supplyChainSource).toContain('placeholder="SL"');
    expect(supplyChainSource).toContain("onChange={e => updatePoItem(i, { qtyInput: formatViLiveInput(e.target.value) })}");
    expect(supplyChainSource).not.toContain('SL gốc');
  });

  it('keeps PO line price fields clear of compact action buttons on wide screens', () => {
    expect(supplyChainSource).toContain('lg:grid-cols-[minmax(240px,1.4fr)_minmax(240px,1.4fr)_76px_minmax(145px,0.8fr)_minmax(165px,0.9fr)_max-content]');
    expect(supplyChainSource).toContain('lg:col-auto');
    expect(supplyChainSource).toContain('min-w-max');
  });
});
