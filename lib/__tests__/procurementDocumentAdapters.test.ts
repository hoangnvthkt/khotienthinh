import { describe, expect, it } from 'vitest';
import { resolveProcurementDocument, validateProcurementReturnTo } from '../procurement/documentAdapters';

describe('procurement document adapters', () => {
  it('maps persisted document identity to trace without searching by display code', () => {
    expect(resolveProcurementDocument(
      { type: 'purchase_order', id: 'po/id 1', engine: 'purchase_order' },
      '/procurement?view=work&demandId=d-1',
    )).toEqual({
      route: '/trace?type=purchase_order&id=po%2Fid+1&returnTo=%2Fprocurement%3Fview%3Dwork%26demandId%3Dd-1',
      engine: 'purchase_order',
    });
  });

  it('maps compatibility types to canonical trace node types', () => {
    expect(resolveProcurementDocument(
      { type: 'payable', id: 'ap-1', engine: 'supplier_payable' }, '/procurement',
    ).route).toContain('type=supplier_payable_document');
    expect(resolveProcurementDocument(
      { type: 'wms', id: 'tx-1', engine: 'wms_transaction' }, '/procurement',
    ).route).toContain('type=wms_transaction');
  });

  it('rejects external, protocol-relative and escaped return routes', () => {
    for (const route of ['https://outside.invalid', '//outside.invalid', '/\\outside.invalid', 'javascript:alert(1)']) {
      expect(() => validateProcurementReturnTo(route)).toThrow('INVALID_RETURN_ROUTE');
    }
  });
});
