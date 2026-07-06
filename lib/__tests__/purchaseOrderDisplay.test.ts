import { describe, expect, it } from 'vitest';
import type { MaterialRequest, PurchaseOrder } from '../../types';
import { buildPurchaseOrderListSummary } from '../purchaseOrderDisplay';

const makePo = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-001',
  items: [
    {
      lineId: 'po-line-1',
      itemId: 'item-1',
      sku: 'VT000111',
      name: 'Bien bao chu A',
      unit: 'Cai',
      qty: 16,
      unitPrice: 1000,
      requestId: 'mr-1',
      requestCode: 'MR-2026-9745',
      requestLineId: 'mr-line-1',
    },
    {
      lineId: 'po-line-2',
      itemId: 'item-2',
      sku: 'VT000224',
      name: 'Ni long trang',
      unit: 'Kg',
      qty: 250,
      unitPrice: 1000,
      requestId: 'mr-1',
      requestCode: 'MR-2026-9745',
      requestLineId: 'mr-line-2',
    },
  ],
  totalAmount: 266000,
  orderDate: '2026-07-06',
  expectedDeliveryDate: '2026-07-07',
  status: 'draft',
  sourceMode: 'from_request',
  createdAt: '2026-07-06T00:00:00.000Z',
  ...patch,
});

const makeRequest = (patch: Partial<MaterialRequest> = {}): MaterialRequest => ({
  id: 'mr-1',
  code: 'MR-2026-9745',
  title: 'Vat tu cong truong Son mien Bac',
  siteWarehouseId: 'wh-site',
  requesterId: 'user-1',
  status: 'approved' as any,
  items: [],
  createdDate: '2026-07-06',
  expectedDate: '2026-07-07',
  logs: [],
  ...patch,
});

describe('purchaseOrderDisplay', () => {
  it('shows the material request title before vendor or warehouse details', () => {
    const summary = buildPurchaseOrderListSummary(makePo(), [makeRequest()]);

    expect(summary.requestTitle).toBe('MR-2026-9745 - Vat tu cong truong Son mien Bac');
    expect(summary.materialSummary).toBe('Bien bao chu A, Ni long trang');
  });

  it('falls back to approval title and compact material names when linked request is not loaded', () => {
    const po = makePo({
      approvalRequestTitle: 'Mua vat tu phu tro cong truong',
      items: [
        ...makePo().items,
        {
          lineId: 'po-line-3',
          itemId: 'item-3',
          sku: 'VT000333',
          name: 'Day dien',
          unit: 'Cuon',
          qty: 1,
          unitPrice: 50000,
        },
      ],
    });

    const summary = buildPurchaseOrderListSummary(po, []);

    expect(summary.requestTitle).toBe('Mua vat tu phu tro cong truong');
    expect(summary.materialSummary).toBe('Bien bao chu A, Ni long trang +1 vật tư');
  });
});
