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
        deliveredPurchaseQty: 103,
        acceptedPurchaseQty: 101,
        deliveredStockQty: 103,
        acceptedStockQty: 101,
        varianceReason: 'Cân thực tế',
      }],
      attachments: [],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('approve_material_po_quality', {
      p_delivery_batch_id: 'batch-1',
      p_wms_transaction_id: 'tx-1',
      p_actor_user_id: 'keeper-1',
      p_quality_result: 'partial',
      p_lines: [{
        deliveryLineId: 'delivery-line-1',
        itemId: 'item-1',
        deliveredPurchaseQty: 103,
        acceptedPurchaseQty: 101,
        deliveredStockQty: 103,
        acceptedStockQty: 101,
        varianceReason: 'Cân thực tế',
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

    const result = await purchaseReceiptService.finalizeReceipt({
      deliveryBatchId: 'batch-1',
      wmsTransactionId: 'tx-1',
      actorUserId: 'keeper-1',
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('finalize_material_po_receipt', {
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
});
