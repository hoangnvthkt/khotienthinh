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
  it('upserts purchase order content without direct workflow metadata updates', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.from.mockReturnValueOnce({ upsert });
    const { poService } = await import('../projectService');

    await poService.upsert({
      id: 'po-1',
      vendorId: 'vendor-1',
      vendorName: 'NCC',
      poNumber: 'PO-001',
      items: [],
      totalAmount: 0,
      orderDate: '2026-07-13',
      status: 'draft',
      sourceMode: 'proactive_project',
    } as any);

    expect(supabaseMock.from).toHaveBeenCalledWith('purchase_orders');
    const payload = upsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty('last_action_by');
    expect(payload).not.toHaveProperty('last_action_at');
    expect(payload).not.toHaveProperty('ever_submitted');
    expect(upsert).toHaveBeenCalledWith(payload, { onConflict: 'id' });
  });

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

  it('syncs pending supplemental approvals with the selected approver target', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.from.mockReturnValueOnce({ upsert });
    const { poSupplementalApprovalService } = await import('../projectService');

    await poSupplementalApprovalService.syncPendingForPurchaseOrder(
      {
        id: 'po-1',
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        vendorId: 'vendor-1',
        poNumber: 'PO-001',
        items: [],
        totalAmount: 100000,
        approvedTotalAmount: 100000,
        orderDate: '2026-07-13',
        status: 'confirmed',
        sourceMode: 'from_request',
        createdAt: '2026-07-13T00:00:00.000Z',
      },
      [{
        purchaseOrderId: 'po-1',
        deliveryBatchId: 'batch-2',
        previousApprovedAmount: 100000,
        requestedTotalAmount: 114000,
        overAmount: 14000,
      }],
      {
        userId: 'approver-1',
        name: 'Anh duyệt',
        permissionCode: 'project.material_po.approve',
        note: 'Duyệt phần vượt',
      },
      'creator-1',
    );

    expect(supabaseMock.from).toHaveBeenCalledWith('purchase_order_supplemental_approvals');
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        purchase_order_id: 'po-1',
        delivery_batch_id: 'batch-2',
        previous_approved_amount: 100000,
        requested_total_amount: 114000,
        over_amount: 14000,
        status: 'pending',
        submitted_to_user_id: 'approver-1',
        submitted_to_name: 'Anh duyệt',
        submitted_to_permission: 'project.material_po.approve',
        submission_note: 'Duyệt phần vượt',
        requested_by: 'creator-1',
      }),
    ], { onConflict: 'delivery_batch_id' });
  });

  it('approves supplemental approvals through the RPC', async () => {
    const { poSupplementalApprovalService } = await import('../projectService');

    await poSupplementalApprovalService.approve('supp-1', 'approver-1', 'ok');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('approve_purchase_order_supplemental_approval', {
      p_approval_id: 'supp-1',
      p_actor_id: 'approver-1',
      p_note: 'ok',
    });
  });
});
