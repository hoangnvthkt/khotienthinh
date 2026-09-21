import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: mocks }));

import { wmsTransferService } from '../wmsTransferService';

describe('wmsTransferService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches with optimistic version and idempotency', async () => {
    mocks.rpc.mockResolvedValue({
      data: { transactionId: 'tx-1', status: 'APPROVED', rowVersion: 2, inTransitQty: 10, replayed: false },
      error: null,
    });
    await expect(wmsTransferService.dispatch({
      transactionId: 'tx-1', expectedVersion: 1, idempotencyKey: 'dispatch-1',
    })).resolves.toMatchObject({ rowVersion: 2, inTransitQty: 10 });
    expect(mocks.rpc).toHaveBeenCalledWith('dispatch_wms_transfer_v1', {
      p_transaction_id: 'tx-1', p_expected_version: 1, p_idempotency_key: 'dispatch-1',
    });
  });

  it('keeps partial receipt quantities on their transfer lines', async () => {
    mocks.rpc.mockResolvedValue({
      data: { transactionId: 'tx-1', status: 'APPROVED', rowVersion: 3, inTransitQty: 4, replayed: false },
      error: null,
    });
    await wmsTransferService.receive({
      transactionId: 'tx-1', expectedVersion: 2, idempotencyKey: 'receive-1',
      lines: [{ transferLineId: 'line-1', quantity: 6 }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith('receive_wms_transfer_v1', {
      p_transaction_id: 'tx-1', p_lines: [{ transferLineId: 'line-1', quantity: 6 }],
      p_expected_version: 2, p_idempotency_key: 'receive-1',
    });
  });

  it('rejects malformed command results', async () => {
    mocks.rpc.mockResolvedValue({ data: { transactionId: 'other', rowVersion: 0 }, error: null });
    await expect(wmsTransferService.dispatch({
      transactionId: 'tx-1', expectedVersion: 1, idempotencyKey: 'dispatch-1',
    })).rejects.toThrow('không hợp lệ');
  });
});
