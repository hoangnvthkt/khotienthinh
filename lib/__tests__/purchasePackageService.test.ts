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
