import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(() => {
    throw new Error('receiveBatch must not perform direct table writes');
  }),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
  },
}));

import { materialRequestFulfillmentService } from '../materialRequestFulfillmentService';

const input = {
  request: { id: 'mr-1' },
  batch: {
    id: '11111111-1111-4111-8111-111111111111',
    materialRequestId: 'mr-1',
    batchNo: 'MR-001-DOT-1',
    batchDate: '2026-09-19T00:00:00.000Z',
    fulfillmentMode: 'RECEIVE_TO_STOCK',
    sourceType: 'stock',
    status: 'issued',
    transactionId: 'tx-1',
    updatedAt: '2026-09-19T00:00:00.000Z',
    lines: [{
      id: '22222222-2222-4222-8222-222222222222',
      batchId: '11111111-1111-4111-8111-111111111111',
      materialRequestId: 'mr-1',
      requestLineId: 'mr-line-1',
      itemId: 'item-1',
      requestedQtySnapshot: 2.5,
      committedQtySnapshot: 2.5,
      issuedQty: 2.5,
      receivedQty: 0,
      unit: 'kg',
      updatedAt: '2026-09-19T00:00:00.000Z',
    }],
  },
  actorUserId: '33333333-3333-4333-8333-333333333333',
  overrideReason: 'Cân thực tế',
  lines: [{
    lineId: '22222222-2222-4222-8222-222222222222',
    receivedQty: 2.25,
    varianceReason: 'Cân thực tế',
  }],
} as any;

const result = {
  batch: {
    id: input.batch.id,
    material_request_id: 'mr-1',
    batch_no: 'MR-001-DOT-1',
    batch_date: '2026-09-19T00:00:00.000Z',
    fulfillment_mode: 'RECEIVE_TO_STOCK',
    source_type: 'stock',
    status: 'received',
    transaction_id: 'tx-1',
    received_by: input.actorUserId,
    received_at: '2026-09-19T00:01:00.000Z',
    updated_at: '2026-09-19T00:01:00.000Z',
  },
  lines: [{
    id: input.batch.lines[0].id,
    batch_id: input.batch.id,
    material_request_id: 'mr-1',
    request_line_id: 'mr-line-1',
    item_id: 'item-1',
    requested_qty_snapshot: 2.5,
    committed_qty_snapshot: 2.5,
    issued_qty: 2.5,
    received_qty: 2.25,
    unit: 'kg',
    variance_reason: 'Cân thực tế',
  }],
  idempotentReplay: false,
};

describe('materialRequestFulfillmentService.receiveBatch', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
    supabaseMocks.from.mockClear();
  });

  it('receives the aggregate through one atomic RPC with a stable replay key', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: result, error: null });

    const saved = await materialRequestFulfillmentService.receiveBatch(input);

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('receive_material_request_fulfillment_batch_v1', {
      p_batch_id: input.batch.id,
      p_expected_updated_at: input.batch.updatedAt,
      p_actor_user_id: input.actorUserId,
      p_idempotency_key: input.batch.id,
      p_lines: [{
        ...input.lines[0],
        expectedUpdatedAt: input.batch.lines[0].updatedAt,
      }],
      p_override_reason: input.overrideReason,
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
    expect(saved).toMatchObject({
      id: input.batch.id,
      status: 'received',
      receivedBy: input.actorUserId,
      lines: [{ receivedQty: 2.25, varianceReason: 'Cân thực tế' }],
    });
  });

  it('rejects missing concurrency evidence before calling the command', async () => {
    await expect(materialRequestFulfillmentService.receiveBatch({
      ...input,
      batch: { ...input.batch, updatedAt: undefined },
    })).rejects.toThrow('Thiếu phiên bản đợt cấp');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a line without concurrency evidence before calling the command', async () => {
    await expect(materialRequestFulfillmentService.receiveBatch({
      ...input,
      batch: {
        ...input.batch,
        lines: [{ ...input.batch.lines[0], updatedAt: undefined }],
      },
    })).rejects.toThrow('Thiếu phiên bản dòng nhận hàng');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a non-finite received quantity before calling the command', async () => {
    await expect(materialRequestFulfillmentService.receiveBatch({
      ...input,
      lines: [{ ...input.lines[0], receivedQty: Number.NaN }],
    })).rejects.toThrow('Số lượng nhận không hợp lệ');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed command response', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { ...result, batch: { ...result.batch, id: 'batch-other' } },
      error: null,
    });

    await expect(materialRequestFulfillmentService.receiveBatch(input))
      .rejects.toThrow('không khớp đợt cấp');
  });
});
