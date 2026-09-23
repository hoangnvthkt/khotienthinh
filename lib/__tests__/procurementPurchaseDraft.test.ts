import { describe, expect, it } from 'vitest';
import { buildProcurementPurchaseDraft, type ProcurementPurchaseSelection } from '../procurement/procurementPurchaseDraft';

const base: ProcurementPurchaseSelection = {
  adapter: 'project_material_request', demandId: 'demand-mr', demandLineId: 'line-mr',
  sourceRevisionId: 'revision-mr', expectedVersion: '3', sourceDocumentId: 'mr-1',
  sourceCode: 'MR-1', sourceLineId: 'mr-line', itemId: 'cement', itemName: 'Xi măng',
  unit: 'kg', availableQty: '100.000000', needQty: '30.000000',
  purchaseUnit: 'bao', conversionNumerator: '50.000000', conversionDenominator: '1.000000',
  unitPrice: '120000.000000', vendorId: 'supplier-1', vendorName: 'NCC Một',
  canViewPrice: true, canAllocate: true, requestedQty: '100.000000', fulfilledQty: '0.000000',
  projectId: 'project-1', constructionSiteId: 'site-1', warehouseId: 'warehouse-1',
  neededDate: '2026-10-08', note: '', poLineId: 'po-line-1',
};
const plan: ProcurementPurchaseSelection = { ...base, adapter: 'material_plan',
  demandId: 'demand-plan', demandLineId: 'line-plan', sourceRevisionId: 'revision-plan',
  sourceDocumentId: 'plan-1', sourceCode: 'VT-1', sourceLineId: 'plan-line',
  needQty: '20.000000', poLineId: 'po-line-2' };
const order = { id: 'po-1', poNumber: 'PO-1', actorUserId: 'buyer-1',
  orderDate: '2026-09-23', expectedDeliveryDate: '2026-10-08', idempotencyKey: 'attempt-1' };

describe('canonical procurement purchase draft', () => {
  it('creates request links only for real MR lines and an allocation for every selected line', () => {
    const payload = buildProcurementPurchaseDraft([base, plan], order);
    expect(payload.requestLineLinks).toHaveLength(1);
    expect(payload.allocations).toHaveLength(2);
    expect(payload.requestLineLinks[0].material_request_id).toBe('mr-1');
    expect(payload.allocations.map(line => line.purchaseOrderLineId)).toEqual(['po-line-1', 'po-line-2']);
    expect(payload.purchaseOrder.items.map(line => line.lineId)).toEqual(['po-line-1', 'po-line-2']);
  });

  it('keeps same-item different-source lines separate', () => {
    const payload = buildProcurementPurchaseDraft([base, plan], order);
    expect(payload.purchaseOrder.items).toHaveLength(2);
    expect(payload.allocations[0].demandLineId).not.toBe(payload.allocations[1].demandLineId);
  });

  it('rejects mixed suppliers and prices in one PO, duplicate lines, and mixed UOM without conversion', () => {
    expect(() => buildProcurementPurchaseDraft([base, { ...plan, vendorId: 'supplier-2' }], order))
      .toThrow('PURCHASE_SCOPE_MIXED');
    expect(() => buildProcurementPurchaseDraft([base, { ...plan, unitPrice: '130000.000000' }], order))
      .not.toThrow();
    expect(() => buildProcurementPurchaseDraft([base, { ...plan, poLineId: base.poLineId }], order))
      .toThrow('PURCHASE_LINE_ID_DUPLICATE');
    expect(() => buildProcurementPurchaseDraft([base, { ...plan, demandLineId: base.demandLineId }], order))
      .toThrow('PURCHASE_DEMAND_LINE_DUPLICATE');
    expect(() => buildProcurementPurchaseDraft([{ ...base, purchaseUnit: 'bao',
      conversionNumerator: '' }], order)).toThrow('PURCHASE_CONVERSION_REQUIRED');
    expect(() => buildProcurementPurchaseDraft([{ ...base, needQty: '1',
      conversionNumerator: '1', conversionDenominator: '3' }], order))
      .toThrow('PURCHASE_CONVERSION_INEXACT');
  });

  it('rejects unavailable, unknown and hidden-price quantities', () => {
    expect(() => buildProcurementPurchaseDraft([{ ...base, needQty: '101.000000' }], order))
      .toThrow('PURCHASE_QUANTITY_UNAVAILABLE');
    expect(() => buildProcurementPurchaseDraft([{ ...base, availableQty: null }], order))
      .toThrow('PURCHASE_QUANTITY_UNKNOWN');
    expect(() => buildProcurementPurchaseDraft([{ ...base, unitPrice: null }], order))
      .toThrow('PURCHASE_PRICE_REQUIRED');
    expect(() => buildProcurementPurchaseDraft([{ ...base, canViewPrice: false }], order))
      .toThrow('PURCHASE_PRICE_HIDDEN');
  });
});
