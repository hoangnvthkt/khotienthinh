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
  it('keeps request and purchase quantities independent in the delivery planning editor', () => {
    expect(editorSource).toContain('SL đáp ứng nhu cầu');
    expect(editorSource).toContain('SL mua');
    expect(editorSource).toContain('value={line.stockQty}');
    expect(editorSource).not.toContain('getStockQtyForPurchaseDeliveryLine(line, purchaseQty)');
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
    expect(supplyChainSource).toContain('Các đợt đặt hàng');
    expect(supplyChainSource).toContain('PO tổng chỉ giữ nhu cầu MR');
    expect(supplyChainSource).not.toContain('{!isPurchasePackageV2Form && (');
  });

  it('allows VAT to be entered and summarized independently for every delivery batch', () => {
    expect(supplyChainSource).toContain('VAT đợt (%)');
    expect(supplyChainSource).toContain('batchVatAmount');
    expect(supplyChainSource).toContain('Tổng gồm VAT');
    expect(editorSource).toContain('VAT đợt (%)');
    expect(editorSource).toContain('Tổng gồm VAT');
  });

  it('creates new MR purchase orders as flow v3 single-delivery demand snapshots', () => {
    expect(supplyChainSource).toContain("setPPurchaseMode('single');");
    expect(supplyChainSource).toContain('procurementFlowVersion: isV2Package ? 3');
    expect(supplyChainSource).toContain('purchasePackageService.saveDeliveryBatchDraft');
    expect(supplyChainSource).toContain('SL YÊU CẦU');
  });

  it('keeps PO line price fields clear of compact action buttons on wide screens', () => {
    expect(supplyChainSource).toContain('lg:grid-cols-[minmax(240px,1.4fr)_minmax(240px,1.4fr)_76px_minmax(145px,0.8fr)_minmax(165px,0.9fr)_max-content]');
    expect(supplyChainSource).toContain('lg:col-auto');
    expect(supplyChainSource).toContain('min-w-max');
  });
});
