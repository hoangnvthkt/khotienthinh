import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import {
  mapMaterialIssueSettlementFromDb,
  materialIssueService,
} from '../materialIssueService';

describe('material issue settlement V1 service', () => {
  beforeEach(() => rpc.mockReset());

  it('posts a dated idempotent consumption document', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'settlement-1',
        settlement_no: 'MIS-001',
        issue_order_id: 'order-1',
        settlement_type: 'consume',
        settlement_date: '2026-08-20',
        status: 'posted',
        reason: 'Đã thi công khu A',
        idempotency_key: 'consume-order-1-001',
        attachments: [],
      },
      error: null,
    });

    const settlement = await materialIssueService.postSettlement({
      orderId: 'order-1',
      settlementType: 'consume',
      settlementDate: '2026-08-20',
      lines: [{ issueLineId: 'line-1', quantity: 12.5 }],
      reason: 'Đã thi công khu A',
      idempotencyKey: 'consume-order-1-001',
    });

    expect(rpc).toHaveBeenCalledWith('post_material_issue_settlement_v1', {
      p_order_id: 'order-1',
      p_settlement_type: 'consume',
      p_settlement_date: '2026-08-20',
      p_lines: [{ issueLineId: 'line-1', quantity: 12.5 }],
      p_reason: 'Đã thi công khu A',
      p_idempotency_key: 'consume-order-1-001',
      p_attachments: [],
    });
    expect(settlement).toEqual(expect.objectContaining({
      id: 'settlement-1',
      settlementNo: 'MIS-001',
      settlementDate: '2026-08-20',
    }));
  });

  it('reverses by settlement id with a mandatory reason and idempotency key', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'reversal-1',
        settlement_no: 'MISR-001',
        issue_order_id: 'order-1',
        settlement_type: 'consume',
        settlement_date: '2026-08-20',
        status: 'posted',
        reason: 'Ghi nhầm khối lượng',
        idempotency_key: 'reverse-settlement-1',
        reversal_of_settlement_id: 'settlement-1',
      },
      error: null,
    });

    const reversal = await materialIssueService.reverseSettlement({
      settlementId: 'settlement-1',
      reason: 'Ghi nhầm khối lượng',
      idempotencyKey: 'reverse-settlement-1',
    });

    expect(rpc).toHaveBeenCalledWith('reverse_material_issue_settlement_v1', {
      p_settlement_id: 'settlement-1',
      p_reason: 'Ghi nhầm khối lượng',
      p_idempotency_key: 'reverse-settlement-1',
    });
    expect(reversal.reversalOfSettlementId).toBe('settlement-1');
  });

  it('maps settlement and line audit fields from Supabase', () => {
    expect(mapMaterialIssueSettlementFromDb({
      id: 'settlement-1',
      settlement_no: 'MIS-001',
      issue_order_id: 'order-1',
      settlement_type: 'loss',
      settlement_date: '2026-08-19',
      status: 'reversed',
      reason: 'Hư hỏng sau cấp',
      reversal_reason: 'Tìm lại được vật tư',
      idempotency_key: 'loss-001',
      lines: [{
        id: 'settlement-line-1',
        settlement_id: 'settlement-1',
        issue_line_id: 'line-1',
        item_id: 'item-1',
        quantity: '2.5',
        work_boq_item_id: 'work-1',
      }],
    })).toEqual(expect.objectContaining({
      settlementNo: 'MIS-001',
      settlementType: 'loss',
      reversalReason: 'Tìm lại được vật tư',
      lines: [expect.objectContaining({ quantity: 2.5, workBoqItemId: 'work-1' })],
    }));
  });
});
