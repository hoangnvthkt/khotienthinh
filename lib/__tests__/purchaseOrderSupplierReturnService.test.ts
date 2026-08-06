import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import { purchaseOrderSupplierReturnService } from '../purchaseOrderSupplierReturnService';

describe('purchaseOrderSupplierReturnService', () => {
  beforeEach(() => {
    const query = {
      select: supabaseMocks.select,
      in: supabaseMocks.in,
      order: supabaseMocks.order,
      data: [],
      error: null,
    };
    supabaseMocks.from.mockReset().mockReturnValue(query);
    supabaseMocks.rpc.mockReset();
    supabaseMocks.select.mockReset().mockReturnValue(query);
    supabaseMocks.in.mockReset().mockReturnValue(query);
    supabaseMocks.order.mockReset().mockReturnValue(query);
  });

  it('creates a supplier return through the receipt-safe RPC contract', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'return-1',
        return_no: 'SR-PO-001',
        purchase_order_id: 'po-1',
        source_warehouse_id: 'warehouse-1',
        status: 'pending',
        transaction_id: 'tx-return-1',
        reason: 'Hang loi',
        note: null,
        created_at: '2026-07-25T00:00:00.000Z',
        updated_at: '2026-07-25T00:00:00.000Z',
      },
      error: null,
    });

    const result = await purchaseOrderSupplierReturnService.create({
      purchaseOrderId: 'po-1',
      sourceWarehouseId: 'warehouse-1',
      reason: 'Hang loi',
      note: undefined,
      lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 10 }],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_purchase_order_supplier_return', {
      p_purchase_order_id: 'po-1',
      p_source_warehouse_id: 'warehouse-1',
      p_lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 10 }],
      p_reason: 'Hang loi',
      p_note: null,
    });
    expect(result).toMatchObject({
      id: 'return-1',
      returnNo: 'SR-PO-001',
      purchaseOrderId: 'po-1',
      sourceWarehouseId: 'warehouse-1',
      status: 'pending',
      transactionId: 'tx-return-1',
      lines: [],
    });
  });

  it('preserves both commercial line IDs when returning a repeated SKU', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'return-commercial-lines',
        return_no: 'SR-PO-COMMERCIAL-LINES',
        purchase_order_id: 'po-commercial-lines',
        source_warehouse_id: 'warehouse-1',
        status: 'pending',
        transaction_id: 'tx-return-commercial-lines',
        reason: 'Hang loi',
        note: null,
        created_at: '2026-08-06T00:00:00.000Z',
        updated_at: '2026-08-06T00:00:00.000Z',
      },
      error: null,
    });

    await purchaseOrderSupplierReturnService.create({
      purchaseOrderId: 'po-commercial-lines',
      sourceWarehouseId: 'warehouse-1',
      reason: 'Hang loi',
      lines: [
        { purchaseOrderLineId: 'commercial-10k', quantity: 3 },
        { purchaseOrderLineId: 'commercial-12k', quantity: 7 },
      ],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_purchase_order_supplier_return', {
      p_purchase_order_id: 'po-commercial-lines',
      p_source_warehouse_id: 'warehouse-1',
      p_lines: [
        { purchaseOrderLineId: 'commercial-10k', quantity: 3 },
        { purchaseOrderLineId: 'commercial-12k', quantity: 7 },
      ],
      p_reason: 'Hang loi',
      p_note: null,
    });
  });

  it('loads supplier returns with their lines and maps database keys', async () => {
    const returnQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValueOnce({
        data: [{
          id: 'return-1',
          return_no: 'SR-001',
          purchase_order_id: 'po-1',
          source_warehouse_id: 'warehouse-1',
          status: 'completed',
          transaction_id: 'tx-return-1',
          reason: 'Tra NCC',
          created_at: '2026-07-25T00:00:00.000Z',
          updated_at: '2026-07-25T00:00:00.000Z',
        }],
        error: null,
      }),
    };
    const lineQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValueOnce({
        data: [{
          id: 'line-1',
          supplier_return_id: 'return-1',
          purchase_order_line_id: 'po-line-1',
          item_id: 'item-1',
          received_qty_snapshot: 90,
          previously_returned_qty_snapshot: 0,
          return_qty: 10,
          unit_price: 10000,
          stock_return_qty: 10,
          stock_unit: 'Kg',
          created_at: '2026-07-25T00:00:00.000Z',
        }],
        error: null,
      }),
    };
    supabaseMocks.from
      .mockReturnValueOnce(returnQuery)
      .mockReturnValueOnce(lineQuery);

    const result = await purchaseOrderSupplierReturnService.listByPurchaseOrderIds(['po-1', 'po-1']);

    expect(returnQuery.in).toHaveBeenCalledWith('purchase_order_id', ['po-1']);
    expect(lineQuery.in).toHaveBeenCalledWith('supplier_return_id', ['return-1']);
    expect(result[0]).toMatchObject({
      id: 'return-1',
      returnNo: 'SR-001',
      purchaseOrderId: 'po-1',
      transactionId: 'tx-return-1',
      lines: [{
        supplierReturnId: 'return-1',
        purchaseOrderLineId: 'po-line-1',
        returnQty: 10,
        stockReturnQty: 10,
        stockUnit: 'Kg',
      }],
    });
  });

  it('throws RPC errors instead of returning a partial supplier return', async () => {
    const error = new Error('return exceeds accepted quantity');
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error });

    await expect(purchaseOrderSupplierReturnService.create({
      purchaseOrderId: 'po-1',
      sourceWarehouseId: 'warehouse-1',
      reason: 'Hang loi',
      lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 91 }],
    })).rejects.toThrow(error);
  });
});
