import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
  },
}));

import {
  purchasePackageService,
  type MaterialPoBatchDraftLineInput,
} from '../purchasePackageService';

const commandResult = {
  deliveryBatchId: 'batch-1',
  deliveryNo: 1,
  deliveryCode: 'PO01-01',
  wmsTransactionId: 'tx-1',
  qrToken: 'pod_batch_1',
};

const lines: MaterialPoBatchDraftLineInput[] = [{
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    purchaseQty: 2,
    purchaseUnit: 'kg',
    stockQty: 2,
    stockUnit: 'kg',
    purchaseUnitPrice: 100,
    stockUnitPrice: 100,
  }];

const selectProjectedColumns = (row: Record<string, unknown>, projection: string) =>
  Object.fromEntries(
    projection
      .split(',')
      .map(column => column.trim())
      .filter(column => Object.prototype.hasOwnProperty.call(row, column))
      .map(column => [column, row[column]]),
  );

describe('purchasePackageService', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it('submits one multiple-delivery batch to its selected approver', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', approvalStatus: 'pending_approval' },
      error: null,
    });

    await purchasePackageService.submitBatch({
      deliveryBatchId: 'batch-1',
      approverUserId: 'approver-1',
      actorUserId: 'buyer-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('submit_material_po_batch', {
      p_delivery_batch_id: 'batch-1',
      p_approver_user_id: 'approver-1',
      p_actor_user_id: 'buyer-1',
    });
  });

  it('records the batch-specific MR overage reason before submission', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', varianceReason: 'Giao bù hao hụt thực tế' },
      error: null,
    });

    await purchasePackageService.setBatchVarianceReason({
      deliveryBatchId: 'batch-1',
      varianceReason: 'Giao bù hao hụt thực tế',
      actorUserId: 'buyer-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('set_material_po_batch_variance_reason', {
      p_delivery_batch_id: 'batch-1',
      p_variance_reason: 'Giao bù hao hụt thực tế',
      p_actor_user_id: 'buyer-1',
    });
  });

  it('saves a multiple-delivery draft without creating WMS', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', deliveryNo: 1, approvalStatus: 'draft', lineCount: 1 },
      error: null,
    });

    await purchasePackageService.saveBatchDraft({
      purchaseOrderId: 'po-1',
      deliveryBatchId: null,
      plannedDeliveryDate: '2026-08-27',
      vatRate: 8,
      varianceReason: null,
      note: 'Giao buổi sáng',
      actorUserId: 'buyer-1',
      lines,
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('save_material_po_batch_draft', {
      p_purchase_order_id: 'po-1',
      p_delivery_batch_id: null,
      p_planned_delivery_date: '2026-08-27',
      p_vat_rate: 8,
      p_variance_reason: null,
      p_note: 'Giao buổi sáng',
      p_actor_user_id: 'buyer-1',
      p_lines: lines,
    });
  });

  it('returns a pending batch for revision through the neutral decision command', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', approvalStatus: 'revision_requested' },
      error: null,
    });

    await purchasePackageService.decideBatch({
      deliveryBatchId: 'batch-1',
      decision: 'revision_requested',
      note: 'Bổ sung báo giá',
      actorUserId: 'approver-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('decide_material_po_batch', {
      p_delivery_batch_id: 'batch-1',
      p_decision: 'revision_requested',
      p_note: 'Bổ sung báo giá',
      p_actor_user_id: 'approver-1',
    });
  });

  it('approves one batch and returns its idempotent WMS/QR result', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: commandResult, error: null });

    const result = await purchasePackageService.approveBatch({
      deliveryBatchId: 'batch-1',
      actorUserId: 'approver-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_material_po_batch', {
      p_delivery_batch_id: 'batch-1',
      p_actor_user_id: 'approver-1',
    });
    expect(result).toEqual(commandResult);
  });

  it('accepts snake_case command result fields from PostgREST JSON responses', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        delivery_batch_id: 'batch-1',
        delivery_no: 1,
        delivery_code: 'PO01-01',
        wms_transaction_id: 'tx-1',
        qr_token: 'pod_batch_1',
      },
      error: null,
    });

    const result = await purchasePackageService.approveBatch({
      deliveryBatchId: 'batch-1',
      actorUserId: 'approver-1',
    });

    expect(result).toEqual(commandResult);
  });

  it('loads a WMS transaction by id when the cockpit has only the linked id', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'tx-1',
        type: 'IMPORT',
        status: 'PENDING',
        source_type: 'po_delivery_batch',
        source_id: 'batch-1',
        items: [],
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    supabaseMocks.from.mockReturnValue({ select });

    const result = await purchasePackageService.getWmsTransactionById('tx-1');

    expect(supabaseMocks.from).toHaveBeenCalledWith('transactions');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('items'));
    expect(select).not.toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('id', 'tx-1');
    expect(result?.sourceType).toBe('po_delivery_batch');
    expect(result?.sourceId).toBe('batch-1');
  });

  it('preserves delivered quantities and unknowns across every QR delivery line page', async () => {
    const deliveryRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `line-${String(index).padStart(4, '0')}`,
      delivery_batch_id: 'batch-1',
      purchase_order_id: 'po-1',
      purchase_order_line_id: `po-line-${index}`,
      item_id: `item-${index}`,
      planned_qty: '100',
      delivered_qty: index === 0 ? '98.5' : index === 1 ? '0' : index === 2 ? null : '100',
      accepted_qty: index === 0 ? '98' : index === 2 ? '7' : '0',
      delivered_stock_qty: index === 0 ? '197' : index === 1 ? '0' : index === 2 ? null : '200',
      accepted_stock_qty: index === 0 ? '196' : index === 2 ? '14' : '0',
      returned_qty: '0',
      unit: 'bao',
      stock_planned_qty: '200',
      stock_unit: 'kg',
      delivery_unit_price: '250000',
      created_at: '2026-09-19T00:00:00Z',
      updated_at: '2026-09-19T00:00:00Z',
    }));
    const selectedLineProjections: string[] = [];

    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === 'purchase_order_delivery_batches') {
        let projection = '';
        const maybeSingle = vi.fn(async () => ({
          data: selectProjectedColumns({
            id: 'batch-1',
            purchase_order_id: 'po-1',
            delivery_no: 1,
            status: 'quality_approved',
            quality_result: 'partial',
            quality_approved_at: '2026-09-19T01:00:00Z',
          }, projection),
          error: null,
        }));
        const query = {
          select: vi.fn((value: string) => {
            projection = value;
            return query;
          }),
          eq: vi.fn(() => ({ maybeSingle })),
        };
        return query;
      }

      if (table === 'purchase_order_delivery_lines') {
        let projection = '';
        let cursor: string | undefined;
        const query: any = {
          select: vi.fn((value: string) => {
            projection = value;
            selectedLineProjections.push(value);
            return query;
          }),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          gt: vi.fn((_column: string, value: string) => {
            cursor = value;
            return query;
          }),
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
            const rows = cursor
              ? deliveryRows.filter(row => row.id > cursor)
              : deliveryRows.slice(0, 1001);
            return Promise.resolve({
              data: rows.map(row => selectProjectedColumns(row, projection)),
              error: null,
            }).then(resolve, reject);
          },
        };
        return query;
      }

      if (table === 'purchase_orders') {
        let projection = '';
        const single = vi.fn(async () => ({
          data: selectProjectedColumns({
            id: 'po-1',
            po_number: 'PO-001',
            items: [],
            total_amount: 0,
            order_date: '2026-09-19',
            status: 'confirmed',
          }, projection),
          error: null,
        }));
        const query = {
          select: vi.fn((value: string) => {
            projection = value;
            return query;
          }),
          eq: vi.fn(() => ({ single })),
        };
        return query;
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const result = await purchasePackageService.getDeliveryByQrToken('pod_batch_1');

    expect(result?.deliveryBatch.lines).toHaveLength(1001);
    expect(result?.deliveryBatch.lines[0]).toEqual(expect.objectContaining({
      deliveredQty: 98.5,
      acceptedQty: 98,
      deliveredStockQty: 197,
      acceptedStockQty: 196,
    }));
    expect(result?.deliveryBatch.lines[1]).toEqual(expect.objectContaining({
      deliveredQty: 0,
      deliveredStockQty: 0,
    }));
    expect(result?.deliveryBatch.lines[2]).toEqual(expect.objectContaining({
      deliveredQty: undefined,
      acceptedQty: 7,
      deliveredStockQty: undefined,
      acceptedStockQty: 14,
    }));
    expect(result?.deliveryBatch.lines.at(-1)?.id).toBe('line-1000');
    expect(selectedLineProjections).toHaveLength(2);
    expect(selectedLineProjections[0].split(',')).toEqual(expect.arrayContaining([
      'delivered_qty',
      'delivered_stock_qty',
    ]));
  });

  it('returns the auto-created first delivery for a single package approval', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        purchaseOrderId: 'po-1',
        status: 'confirmed',
        purchaseMode: 'single',
        delivery: commandResult,
      },
      error: null,
    });

    const result = await purchasePackageService.approveSingle({
      purchaseOrderId: 'po-1',
      actorUserId: 'leader-1',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_single_material_po', {
      p_purchase_order_id: 'po-1',
      p_actor_user_id: 'leader-1',
      p_idempotency_key: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.delivery?.deliveryCode).toBe('PO01-01');
  });

  it('cancels an unreceived delivery with its actor and reason', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null });

    await purchasePackageService.cancelUnreceivedDelivery({
      deliveryBatchId: 'batch-1',
      actorUserId: 'user-1',
      reason: 'Nhà cung cấp giao sai hàng',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('cancel_unreceived_delivery_batch_v2', {
      p_delivery_batch_id: 'batch-1',
      p_actor_user_id: 'user-1',
      p_reason: 'Nhà cung cấp giao sai hàng',
    });
  });

  it('surfaces RPC errors from cancel', async () => {
    const error = new Error('cancel failed');
    supabaseMocks.rpc.mockResolvedValue({ data: null, error });

    await expect(purchasePackageService.cancelUnreceivedDelivery({
      deliveryBatchId: 'batch-1',
      actorUserId: 'user-1',
      reason: 'Không còn nhu cầu',
    })).rejects.toBe(error);
  });

  it('closes package shortage with actor, reason, and line quantities', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null });

    await purchasePackageService.closePackageShort({
      purchaseOrderId: 'po-1',
      actorUserId: 'user-1',
      reason: 'Công trường không còn nhu cầu',
      lines: [{ purchaseOrderLineId: 'po-line-1', closeQty: 3 }],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('close_purchase_package_short_v2', {
      p_purchase_order_id: 'po-1',
      p_actor_user_id: 'user-1',
      p_reason: 'Công trường không còn nhu cầu',
      p_lines: [{ purchaseOrderLineId: 'po-line-1', closeQty: 3 }],
    });
  });

  it('rejects an incomplete command result', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', wmsTransactionId: 'tx-1', qrToken: null },
      error: null,
    });

    await expect(purchasePackageService.approveBatch({
      deliveryBatchId: 'batch-1',
      actorUserId: 'approver-1',
    }))
      .rejects.toThrow('Đợt giao, WMS hoặc QR chưa được tạo đầy đủ.');
  });
});
