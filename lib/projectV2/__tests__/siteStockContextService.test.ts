import { describe, expect, it } from 'vitest';
import { parseSiteStockContext } from '../siteStockContextService';

describe('site stock context boundary', () => {
  const response = (row: Record<string, unknown>) => ({
    metricVersion: 'project.site-stock.g6.v1', warehouseId: 'site-1', rows: [row],
  });

  it('preserves an unresolved available balance and receipt count', () => {
    expect(parseSiteStockContext(response({
      itemId: 'material-1', availableQty: null, inTransitQty: '3', receiptCustodyQty: null,
    }), 'site-1')).toEqual([{
      itemId: 'material-1', availableQuantity: null, inTransitQuantity: '3', receiptCustodyQuantity: null,
    }]);
  });

  it('accepts a known zero and rejects malformed or duplicate rows', () => {
    expect(parseSiteStockContext(response({
      itemId: 'material-1', availableQty: '0', inTransitQty: '0', receiptCustodyQty: '0',
    }), 'site-1')[0].availableQuantity).toBe('0');
    expect(() => parseSiteStockContext(response({ itemId: 'material-1', availableQty: undefined, inTransitQty: '0', receiptCustodyQty: '0' }), 'site-1')).toThrow();
    expect(() => parseSiteStockContext({ metricVersion: 'project.site-stock.g6.v1', warehouseId: 'site-1', rows: [
      { itemId: 'material-1', availableQty: '1', inTransitQty: '0', receiptCustodyQty: '0' },
      { itemId: 'material-1', availableQty: '1', inTransitQty: '0', receiptCustodyQty: '0' },
    ] }, 'site-1')).toThrow();
  });
});
