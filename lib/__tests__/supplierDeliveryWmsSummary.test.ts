import { describe, expect, it } from 'vitest';
import type { SupplierDirectDeliveryLine } from '../../types';
import { getSupplierDeliveryWmsSummary } from '../supplierDeliveryWmsSummary';

const line = (patch: Partial<SupplierDirectDeliveryLine> = {}): SupplierDirectDeliveryLine => ({
  id: 'line-1',
  deliveryNoteId: 'note-1',
  supplierContractId: 'contract-1',
  supplierContractLineId: null,
  lineNo: 1,
  itemId: 'item-1',
  skuSnapshot: 'VT-001',
  itemNameSnapshot: 'Xi mang',
  unitSnapshot: 'kg',
  quantity: 1,
  unitPrice: 0,
  vatRate: 0,
  lineAmount: 0,
  vatAmount: 0,
  totalAmount: 0,
  acceptedQuantity: 1,
  acceptedAmount: 0,
  status: 'accepted',
  issueReason: null,
  workBoqItemId: null,
  materialBudgetItemId: null,
  note: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  wmsFlowMode: 'direct_in_out',
  targetWarehouseId: 'wh-1',
  wmsStatus: 'not_required',
  wmsImportTransactionId: null,
  wmsExportTransactionId: null,
  ...patch,
});

describe('getSupplierDeliveryWmsSummary', () => {
  it('shows direct-in-out instead of no-warehouse before WMS import is created', () => {
    const summary = getSupplierDeliveryWmsSummary([line()]);

    expect(summary.hasDirectLines).toBe(true);
    expect(summary.canCreateImport).toBe(true);
    expect(summary.readyForStatement).toBe(false);
    expect(summary.label).toBe('Nhập-xuất thẳng');
  });

  it('shows no-warehouse only when the note has no direct-in-out lines', () => {
    const summary = getSupplierDeliveryWmsSummary([
      line({ wmsFlowMode: 'none', wmsStatus: 'not_required' }),
    ]);

    expect(summary.hasDirectLines).toBe(false);
    expect(summary.label).toBe('Không qua kho');
  });
});
