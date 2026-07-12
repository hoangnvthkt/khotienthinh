import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.rpc.mockReset();
  supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
});

describe('poService Phase 3.3 workflow transitions', () => {
  it('routes status changes through the project material PO transition RPC', async () => {
    const { poService } = await import('../projectService');

    await poService.updateStatus('po-1', {
      status: 'sent',
      submittedToUserId: 'buyer-1',
      submittedToName: 'Buyer',
      receivedTransactionIds: ['txn-1'],
    } as any);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('transition_project_purchase_order_status', {
      p_po_id: 'po-1',
      p_status: 'sent',
      p_patch: expect.objectContaining({
        status: 'sent',
        submitted_to_user_id: 'buyer-1',
        submitted_to_name: 'Buyer',
        received_transaction_ids: ['txn-1'],
      }),
    });
    expect(supabaseMock.from).not.toHaveBeenCalledWith('purchase_orders');
  });
});
