import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionStatus } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
  },
}));

import { purchaseReceiptService } from '../purchaseReceiptService';

const commandResult = {
  deliveryBatchId: 'batch-1',
  wmsTransactionId: 'tx-1',
  deliveryStatus: 'quality_approved',
  transactionStatus: TransactionStatus.APPROVED,
  acceptedGrossAmount: 684000,
};

describe('purchaseReceiptService', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
  });

  it('approves quality for exactly one delivery batch and WMS transaction', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: commandResult, error: null });

    const result = await purchaseReceiptService.approveQuality({
      deliveryBatchId: 'batch-1',
      wmsTransactionId: 'tx-1',
      actorUserId: 'keeper-1',
      qualityResult: 'partial',
      lines: [{
        deliveryLineId: 'delivery-line-1',
        itemId: 'item-1',
        acceptedPurchaseQty: 9.5,
        acceptedStockQty: 68.4,
        varianceReason: 'NCC giao thiếu',
      }],
      attachments: [],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_receipt_quality_v2', {
      p_delivery_batch_id: 'batch-1',
      p_wms_transaction_id: 'tx-1',
      p_actor_user_id: 'keeper-1',
      p_quality_result: 'partial',
      p_lines: [{
        deliveryLineId: 'delivery-line-1',
        itemId: 'item-1',
        acceptedPurchaseQty: 9.5,
        acceptedStockQty: 68.4,
        varianceReason: 'NCC giao thiếu',
      }],
      p_attachments: [],
    });
    expect(result).toEqual(commandResult);
  });

  it('finalizes receipt for exactly one delivery batch and WMS transaction', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        ...commandResult,
        deliveryStatus: 'received',
        transactionStatus: TransactionStatus.COMPLETED,
      },
      error: null,
    });

    const result = await purchaseReceiptService.finalize({
      deliveryBatchId: 'batch-1',
      wmsTransactionId: 'tx-1',
      actorUserId: 'keeper-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('finalize_purchase_receipt_v2', {
      p_delivery_batch_id: 'batch-1',
      p_wms_transaction_id: 'tx-1',
      p_actor_user_id: 'keeper-1',
    });
    expect(result.transactionStatus).toBe(TransactionStatus.COMPLETED);
  });

  it('rejects command results for a different delivery batch or WMS transaction', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        ...commandResult,
        deliveryBatchId: 'batch-other',
      },
      error: null,
    });

    await expect(purchaseReceiptService.approveQuality({
      deliveryBatchId: 'batch-1',
      wmsTransactionId: 'tx-1',
      actorUserId: 'keeper-1',
      qualityResult: 'passed',
      lines: [],
      attachments: [],
    })).rejects.toThrow('không khớp Đợt giao hoặc phiếu WMS');
  });

  it('records an independent flow v3 receipt and lets the RPC create its WMS', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        receiptId: 'receipt-1', deliveryBatchId: 'batch-1', receiptNo: 1,
        wmsTransactionId: 'tx-receipt-1', financeStatus: 'posted',
        batchStatus: 'receiving', idempotentReplay: false,
      },
      error: null,
    });

    const result = await purchaseReceiptService.recordReceiptV3({
      deliveryBatchId: 'batch-1',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      actorUserId: 'keeper-1', qualityResult: 'passed', isFinal: false,
      varianceReason: null, attachments: [],
      lines: [{
        deliveryLineId: 'delivery-line-1', itemId: 'item-1',
        deliveredPurchaseQty: 10.8, acceptedPurchaseQty: 10.8,
        deliveredStockQty: 600, acceptedStockQty: 600,
      }],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('record_purchase_order_receipt_v3', {
      p_delivery_batch_id: 'batch-1',
      p_idempotency_key: '11111111-1111-4111-8111-111111111111',
      p_actor_user_id: 'keeper-1', p_quality_result: 'passed', p_is_final: false,
      p_variance_reason: null, p_attachments: [],
      p_lines: [{
        deliveryLineId: 'delivery-line-1', itemId: 'item-1',
        deliveredPurchaseQty: 10.8, acceptedPurchaseQty: 10.8,
        deliveredStockQty: 600, acceptedStockQty: 600,
      }],
    });
    expect(result.wmsTransactionId).toBe('tx-receipt-1');
  });
});
