import { describe, expect, it } from 'vitest';
import { formatPoApprovalLineDetails } from '../poSpecsUtils';
import type { PurchaseOrderItem } from '../../types';

const makePoItem = (patch: Partial<PurchaseOrderItem>): PurchaseOrderItem => ({
  itemId: 'item-1',
  sku: 'SKU-1',
  name: 'Vat tu',
  unit: 'cai',
  qty: 1,
  unitPrice: 0,
  ...patch,
});

describe('poSpecsUtils', () => {
  it('formats PO approval line specs and notes for print', () => {
    const item = makePoItem({
      specification: 'Quy cach cu: day 2 ly',
      note: 'Cat theo ban ve A-01',
      specs: {
        width: { value: 1200, label: 'Rong', unit: 'mm' },
        customFinish: { value: 'Son tinh dien', label: 'Hoan thien' },
        length: { value: 6000, label: 'Dai', unit: 'mm' },
      },
    });

    expect(formatPoApprovalLineDetails(item)).toEqual([
      'Quy cách: Quy cach cu: day 2 ly; Dai 6000 mm; Rong 1200 mm; Hoan thien Son tinh dien',
      'Ghi chú: Cat theo ban ve A-01',
    ]);
  });

  it('ignores empty specs and notes', () => {
    const item = makePoItem({
      specification: '  ',
      note: '',
      specs: {
        length: { value: '', label: 'Dai', unit: 'mm' },
        color: { value: null as unknown as string, label: 'Mau sac' },
      },
    });

    expect(formatPoApprovalLineDetails(item)).toEqual([]);
  });
});
