import { describe, expect, it } from 'vitest';
import type { InventoryItem, RequestItem } from '../../types';
import {
  buildPurchaseOrderLineDescription,
  getMaterialDocumentLineKey,
  resolveMaterialLineName,
  resolveMaterialLineSpecification,
} from '../materialLineDescription';

const catalogItem: InventoryItem = {
  id: 'item-valve',
  sku: 'VT0001489',
  name: 'Van PPR D32',
  category: 'Ống nước',
  unit: 'Cái',
  priceIn: 0,
  priceOut: 0,
  minStock: 0,
  stockByWarehouse: {},
};

const requestLine = (lineId: string, name: string, specification: string): RequestItem => ({
  lineId,
  itemId: catalogItem.id,
  requestQty: 1,
  approvedQty: 0,
  skuSnapshot: catalogItem.sku,
  itemNameSnapshot: name,
  unitSnapshot: catalogItem.unit,
  specification,
});

describe('materialLineDescription', () => {
  it('prefers the document snapshot over the catalog name', () => {
    expect(resolveMaterialLineName(requestLine('line-a', 'Van chặn PPR D32', 'PN20'), catalogItem.name))
      .toBe('Van chặn PPR D32');
  });

  it('falls back safely for legacy rows without a snapshot', () => {
    expect(resolveMaterialLineName({ name: 'Tên PO cũ' }, catalogItem.name)).toBe('Tên PO cũ');
    expect(resolveMaterialLineName({}, catalogItem.name)).toBe('Van PPR D32');
  });

  it('keeps same-item document lines distinct by lineId', () => {
    expect(getMaterialDocumentLineKey(requestLine('line-a', 'Van chặn PPR D32', ''), 0)).toBe('line:line-a');
    expect(getMaterialDocumentLineKey(requestLine('line-b', 'Van PPR D32', ''), 1)).toBe('line:line-b');
  });

  it('uses an index-based key only for legacy rows without lineId', () => {
    expect(getMaterialDocumentLineKey({ itemId: catalogItem.id }, 3)).toBe('legacy:3:item-valve');
  });

  it('builds an independent PO description from the MR snapshot', () => {
    expect(buildPurchaseOrderLineDescription(
      requestLine('line-a', 'Van chặn PPR D32', 'PN20'),
      catalogItem,
    )).toEqual({
      name: 'Van chặn PPR D32',
      itemNameSnapshot: 'Van chặn PPR D32',
      specification: 'PN20',
    });
    expect(resolveMaterialLineSpecification(requestLine('line-a', 'Van chặn PPR D32', ' PN20 ')))
      .toBe('PN20');
  });
});
