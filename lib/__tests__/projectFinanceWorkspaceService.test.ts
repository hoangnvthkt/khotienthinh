import { describe, expect, it, vi } from 'vitest';
import { calculatePoRecognizedPayable } from '../projectFinanceWorkspaceService';

vi.mock('../supabase', () => ({
  supabase: {},
}));

describe('projectFinanceWorkspaceService', () => {
  it('recognizes supplier payable from net received PO quantity, not ordered quantity', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
        },
      ],
    });

    expect(payable).toBe(12_000_000);
  });

  it('deducts supplier returns from recognized payable', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
          returnedQty: 100,
        },
      ],
    });

    expect(payable).toBe(10_000_000);
  });
});
