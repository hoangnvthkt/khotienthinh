import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

vi.mock('../featureFlags', () => ({
  isPurchasePackageV2Enabled: true,
  isPurchasePackageV2EnabledForSite: vi.fn(() => true),
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

  it('routes V2 from-request package approval through the purchase package command', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'po-1',
        source_mode: 'from_request',
        construction_site_id: 'site-1',
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    supabaseMock.from.mockReturnValueOnce({ select });
    supabaseMock.rpc.mockResolvedValueOnce({
      data: {
        purchaseOrderId: 'po-1',
        status: 'confirmed',
        purchaseMode: 'multiple',
      },
      error: null,
    });
    const { poService } = await import('../projectService');

    const result = await poService.updateStatus('po-1', {
      status: 'confirmed',
      lastActionBy: 'leader-1',
    } as any);

    expect(result).toEqual({
      purchaseOrderId: 'po-1',
      status: 'confirmed',
      purchaseMode: 'multiple',
      delivery: undefined,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'approve_purchase_package_and_prepare_single_batch_v2',
      expect.objectContaining({
        p_purchase_order_id: 'po-1',
        p_actor_user_id: 'leader-1',
        p_idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      'transition_project_purchase_order_status',
      expect.anything(),
    );
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

  it('maps purchase package v2 delivery fields from delivery schedule rows', async () => {
    const batchOrder = vi.fn().mockResolvedValue({
      data: [{
        id: 'batch-1',
        purchase_order_id: 'po-1',
        project_id: 'project-1',
        construction_site_id: 'site-1',
        supplier_id: 'supplier-1',
        supplier_name_snapshot: 'NCC 1',
        delivery_no: 2,
        planned_delivery_date: '2026-07-25',
        status: 'receiving',
        fulfillment_mode: 'RECEIVE_TO_STOCK',
        vat_rate: '8',
        qr_token: 'pod-token',
        idempotency_key: '11111111-1111-4111-8111-111111111111',
        quality_result: 'partial',
        variance_reason: 'Thiếu 1 bao',
        accepted_gross_amount: '90000',
        fulfillment_batch_ids: [],
        wms_transaction_id: 'tx-1',
        supplemental_approval_id: null,
        note: 'delivery note',
      }],
      error: null,
    });
    const batchIn = vi.fn().mockReturnValue({ order: batchOrder });
    const batchSelect = vi.fn().mockReturnValue({ in: batchIn });
    const lineOrder = vi.fn().mockResolvedValue({
      data: [{
        id: 'line-1',
        delivery_batch_id: 'batch-1',
        purchase_order_id: 'po-1',
        purchase_order_line_id: 'po-line-1',
        item_id: 'item-1',
        planned_qty: '10',
        accepted_qty: '9',
        accepted_stock_qty: '9',
        returned_qty: '1',
        unit: 'Kg',
        delivery_unit_price: '10000',
        stock_planned_qty: '10',
        stock_unit: 'Kg',
      }],
      error: null,
    });
    const lineIn = vi.fn().mockReturnValue({ order: lineOrder });
    const lineSelect = vi.fn().mockReturnValue({ in: lineIn });
    supabaseMock.from
      .mockReturnValueOnce({ select: batchSelect })
      .mockReturnValueOnce({ select: lineSelect });

    const { poDeliveryScheduleService } = await import('../projectService');

    const result = await poDeliveryScheduleService.listByPurchaseOrderIds(['po-1']);

    expect(result['po-1'][0]).toEqual(expect.objectContaining({
      supplierId: 'supplier-1',
      supplierNameSnapshot: 'NCC 1',
      vatRate: 8,
      qrToken: 'pod-token',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      qualityResult: 'partial',
      varianceReason: 'Thiếu 1 bao',
      acceptedGrossAmount: 90000,
      wmsTransactionId: 'tx-1',
    }));
    expect(result['po-1'][0].lines[0]).toEqual(expect.objectContaining({
      plannedQty: 10,
      acceptedQty: 9,
      acceptedStockQty: 9,
      returnedQty: 1,
      deliveryUnitPrice: 10000,
      stockPlannedQty: 10,
    }));
  });

  it('blocks PO-form replacement when an existing delivery batch was created by command/WMS/QR', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{
        id: 'batch-1',
        status: 'cancelled',
        idempotency_key: '11111111-1111-4111-8111-111111111111',
        qr_token: null,
        wms_transaction_id: null,
      }],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    supabaseMock.from.mockReturnValueOnce({ select });
    const { poDeliveryScheduleService } = await import('../projectService');

    await expect(poDeliveryScheduleService.replaceForPurchaseOrder({ id: 'po-1' } as any, []))
      .rejects.toThrow('command/WMS/QR');
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('defaults fulfillment mode when replacing draft delivery schedule from the PO form', async () => {
    const existingEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const existingSelect = vi.fn().mockReturnValue({ eq: existingEq });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });
    const batchInsert = vi.fn().mockResolvedValue({ error: null });
    const lineInsert = vi.fn().mockResolvedValue({ error: null });

    supabaseMock.from
      .mockReturnValueOnce({ select: existingSelect })
      .mockReturnValueOnce({ delete: deleteFn })
      .mockReturnValueOnce({ insert: batchInsert })
      .mockReturnValueOnce({ insert: lineInsert });

    const { poDeliveryScheduleService } = await import('../projectService');

    await poDeliveryScheduleService.replaceForPurchaseOrder({
      id: 'po-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      fulfillmentMode: 'RECEIVE_TO_STOCK',
    } as any, [{
      id: 'batch-1',
      purchaseOrderId: '',
      deliveryNo: 1,
      plannedDeliveryDate: '2026-07-27',
      status: 'planned',
      lines: [{
        id: 'line-1',
        deliveryBatchId: 'batch-1',
        purchaseOrderId: '',
        purchaseOrderLineId: 'po-line-1',
        itemId: 'item-1',
        plannedQty: 5000,
        deliveryUnitPrice: 15212,
        stockPlannedQty: 160,
      }],
    } as any]);

    expect(batchInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        fulfillment_mode: 'RECEIVE_TO_STOCK',
      }),
    ]);
  });
});
