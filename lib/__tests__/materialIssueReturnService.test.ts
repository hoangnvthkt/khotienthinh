import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import type { MaterialIssueOrder } from '../../types';
import { materialIssueService } from '../materialIssueService';

const hydratedOrder = {
  id: 'order-1',
  issueNo: 'PX-001',
  sourceWarehouseId: 'wh-source',
  recipientType: 'employee',
  recipientName: 'Nguyễn Văn A',
  status: 'issued',
  transactionId: 'tx-export-1',
  lines: [],
  returns: [{
    id: 'return-1',
    issueOrderId: 'order-1',
    returnNo: 'PNH-001',
    returnKind: 'unused_return',
    targetWarehouseId: 'wh-source',
    status: 'pending',
    transactionId: 'tx-import-1',
    reason: 'Vật tư thừa',
    idempotencyKey: 'return-key-1',
    metadata: {},
    createdAt: '2026-09-05T00:00:00.000Z',
    lines: [],
  }],
} as MaterialIssueOrder;

describe('material issue return and approval reversal service', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.restoreAllMocks();
  });

  it('creates an idempotent unused return through RPC V2 and hydrates its order', async () => {
    rpc.mockResolvedValueOnce({
      data: { id: 'return-1', issue_order_id: 'order-1' },
      error: null,
    });
    vi.spyOn(materialIssueService, 'getById').mockResolvedValue(hydratedOrder);

    const result = await materialIssueService.createReturn({
      orderId: 'order-1',
      targetWarehouseId: 'wh-source',
      lines: [{ issueLineId: 'line-1', returnQty: 5, reason: 'Còn thừa' }],
      reason: 'Hoàn vật tư chưa dùng',
      note: 'Chờ kho kiểm nhận',
      idempotencyKey: 'return-key-1',
    });

    expect(rpc).toHaveBeenCalledWith('create_material_issue_return_v2', {
      p_order_id: 'order-1',
      p_target_warehouse_id: 'wh-source',
      p_lines: [{ issueLineId: 'line-1', returnQty: 5, reason: 'Còn thừa' }],
      p_reason: 'Hoàn vật tư chưa dùng',
      p_note: 'Chờ kho kiểm nhận',
      p_idempotency_key: 'return-key-1',
    });
    expect(materialIssueService.getById).toHaveBeenCalledWith('order-1');
    expect(result).toMatchObject({ id: 'return-1', returnKind: 'unused_return' });
  });

  it('reverses an untouched approval and returns the freshly hydrated order', async () => {
    const reversedOrder = { ...hydratedOrder, status: 'reversed' as const };
    rpc.mockResolvedValueOnce({
      data: { id: 'order-1', status: 'reversed' },
      error: null,
    });
    vi.spyOn(materialIssueService, 'getById').mockResolvedValue(reversedOrder);

    const result = await materialIssueService.reverseApproval({
      orderId: 'order-1',
      reason: 'Duyệt nhầm, hàng chưa rời kho',
      idempotencyKey: 'reverse-key-1',
    });

    expect(rpc).toHaveBeenCalledWith('reverse_material_issue_approval_v1', {
      p_order_id: 'order-1',
      p_reason: 'Duyệt nhầm, hàng chưa rời kho',
      p_idempotency_key: 'reverse-key-1',
    });
    expect(materialIssueService.getById).toHaveBeenCalledWith('order-1');
    expect(result.status).toBe('reversed');
  });
});
