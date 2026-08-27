import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const supplyChainSource = readFileSync(
  new URL('../../../pages/project/SupplyChainTab.tsx', import.meta.url),
  'utf8',
);
const deliveryEditorSource = readFileSync(
  new URL('../PurchaseDeliveryBatchEditor.tsx', import.meta.url),
  'utf8',
);

describe('practical material PO form flow', () => {
  it('routes single PO approval and multiple batch approval through neutral commands', () => {
    expect(supplyChainSource).toContain('purchasePackageService.approveSingle');
    expect(supplyChainSource).toContain('purchasePackageService.submitBatch');
    expect(supplyChainSource).toContain('purchasePackageService.setBatchVarianceReason');
    expect(supplyChainSource).toContain('purchasePackageService.approveBatch');
  });

  it('collects the batch-specific MR overage reason in the approval submission window', () => {
    expect(supplyChainSource).toContain('Lý do vượt nhu cầu MR');
    expect(supplyChainSource).toContain('batchSubmissionVarianceReason');
  });

  it('saves a multiple-delivery draft without creating WMS or QR', () => {
    expect(deliveryEditorSource).toContain('purchasePackageService.saveBatchDraft');
    expect(deliveryEditorSource).not.toContain('purchasePackageService.createDelivery');
  });

  it('keeps request snapshots and practical purchase modes on the PO form', () => {
    expect(supplyChainSource).toContain("sourceMode: pSourceMode");
    expect(supplyChainSource).toContain('purchaseMode: isV2Package ? pPurchaseMode');
    expect(supplyChainSource).toContain('buildPoBudgetSnapshot');
  });
});
