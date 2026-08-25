import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialRequestFulfillmentMode } from '../../types';

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
  type CreatePurchaseDeliveryInput,
} from '../purchasePackageService';

const commandResult = {
  deliveryBatchId: 'batch-1',
  deliveryNo: 1,
  deliveryCode: 'PO01-01',
  wmsTransactionId: 'tx-1',
  qrToken: 'pod_batch_1',
};

const input: CreatePurchaseDeliveryInput = {
  purchaseOrderId: 'po-1',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  supplierId: 'vendor-1',
  supplierNameSnapshot: 'NCC 1',
  fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
  vatRate: 10,
  targetWarehouseId: 'warehouse-1',
  plannedDeliveryDate: null,
  note: null,
  actorUserId: 'user-1',
  lines: [{
    purchaseOrderLineId: 'po-line-1',
    itemId: 'item-1',
    purchaseQty: 2,
    purchaseUnit: 'kg',
    stockQty: 2,
    stockUnit: 'kg',
    purchaseUnitPrice: 100,
    stockUnitPrice: 100,
  }],
};

describe('purchasePackageService', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockReset();
  });

  it('sends one create command containing delivery, WMS, and QR data', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: commandResult, error: null });

    const result = await purchasePackageService.createDelivery(input);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_delivery_batch_with_wms_qr_v2', {
      p_purchase_order_id: 'po-1',
      p_idempotency_key: input.idempotencyKey,
      p_supplier_id: 'vendor-1',
      p_supplier_name: 'NCC 1',
      p_fulfillment_mode: 'RECEIVE_TO_STOCK',
      p_vat_rate: 10,
      p_target_warehouse_id: 'warehouse-1',
      p_planned_delivery_date: null,
      p_note: null,
      p_actor_user_id: 'user-1',
      p_lines: input.lines,
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

    const result = await purchasePackageService.createDelivery(input);

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
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('id', 'tx-1');
    expect(result?.sourceType).toBe('po_delivery_batch');
    expect(result?.sourceId).toBe('batch-1');
  });

  it('updates the same unreceived delivery and WMS', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: [commandResult], error: null });

    await purchasePackageService.updateUnreceivedDelivery({
      ...input,
      vatRate: 8,
      deliveryBatchId: 'batch-1',
      wmsTransactionId: 'tx-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'update_unreceived_delivery_batch_v2',
      expect.objectContaining({
        p_delivery_batch_id: 'batch-1',
        p_wms_transaction_id: 'tx-1',
        p_purchase_order_id: 'po-1',
        p_idempotency_key: input.idempotencyKey,
        p_vat_rate: 8,
      }),
    );
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

    const result = await purchasePackageService.approvePackage({
      purchaseOrderId: 'po-1',
      actorUserId: 'leader-1',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_purchase_package_and_prepare_single_batch_v2', {
      p_purchase_order_id: 'po-1',
      p_actor_user_id: 'leader-1',
      p_idempotency_key: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.delivery?.deliveryCode).toBe('PO01-01');
  });

  it('does not expect a delivery for a multiple package approval', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        purchaseOrderId: 'po-2',
        status: 'confirmed',
        purchaseMode: 'multiple',
      },
      error: null,
    });

    const result = await purchasePackageService.approvePackage({
      purchaseOrderId: 'po-2',
      actorUserId: 'leader-1',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });

    expect(result.delivery).toBeUndefined();
  });

  it('approves a flow v3 batch with QR but without a pre-created WMS', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', approvalStatus: 'approved', qrToken: 'pod_v3_batch_1' },
      error: null,
    });

    const result = await purchasePackageService.approveDeliveryBatch({
      deliveryBatchId: 'batch-1',
      actorUserId: 'approver-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_purchase_order_delivery_batch_v2', {
      p_delivery_batch_id: 'batch-1',
      p_actor_user_id: 'approver-1',
    });
    expect(result).toEqual({
      deliveryBatchId: 'batch-1', approvalStatus: 'approved', qrToken: 'pod_v3_batch_1',
    });
  });

  it('sends the first selected approver with a flow v3 batch submission', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', approvalStatus: 'pending_approval' },
      error: null,
    });

    await purchasePackageService.submitDeliveryBatchApproval({
      deliveryBatchId: 'batch-1', actorUserId: 'buyer-1', approverUserId: 'approver-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('submit_purchase_order_delivery_batch_approval_v2', {
      p_delivery_batch_id: 'batch-1',
      p_approver_user_id: 'approver-1',
      p_actor_user_id: 'buyer-1',
    });
  });

  it('saves independent request and purchase quantities in a draft batch', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { deliveryBatchId: 'batch-1', deliveryNo: 1, approvalStatus: 'draft', lineCount: 1 },
      error: null,
    });

    await purchasePackageService.saveDeliveryBatchDraft({
      purchaseOrderId: 'po-1', deliveryBatchId: null, plannedDeliveryDate: null,
      vatRate: 0, varianceReason: null, note: null, actorUserId: 'buyer-1',
      lines: [{
        purchaseOrderLineId: 'po-line-1', itemId: 'item-1', requestQty: 1187,
        requestUnit: 'Cây', purchaseQty: 21176, purchaseUnit: 'Kg', purchaseUnitPrice: 15072,
      }],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('save_purchase_order_delivery_batch_draft_v2', {
      p_purchase_order_id: 'po-1', p_delivery_batch_id: null, p_planned_delivery_date: null,
      p_vat_rate: 0, p_variance_reason: null, p_note: null, p_actor_user_id: 'buyer-1',
      p_lines: [{
        purchaseOrderLineId: 'po-line-1', itemId: 'item-1', requestQty: 1187,
        requestUnit: 'Cây', purchaseQty: 21176, purchaseUnit: 'Kg', purchaseUnitPrice: 15072,
      }],
    });
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

    await expect(purchasePackageService.createDelivery(input))
      .rejects.toThrow('Đợt giao, WMS hoặc QR chưa được tạo đầy đủ.');
  });
});
