import { describe, expect, it } from 'vitest';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import { getPurchaseOrderUiPolicy } from '../purchaseOrderUiPolicy';

const makePo = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  vendorId: 'vendor-1',
  vendorName: 'NCC A',
  poNumber: 'PO-001',
  items: [
    {
      lineId: 'line-1',
      itemId: 'item-1',
      sku: 'VT001',
      name: 'Thep D16',
      unit: 'kg',
      qty: 100,
      unitPrice: 1000,
      receivedQty: 0,
    },
  ],
  totalAmount: 100000,
  orderDate: '2026-07-06',
  expectedDeliveryDate: '2026-07-10',
  status: 'draft',
  sourceMode: 'from_request',
  createdAt: '2026-07-06T00:00:00.000Z',
  ...patch,
});

const plannedBatch = (patch: Partial<PurchaseOrderDeliveryBatch> = {}): PurchaseOrderDeliveryBatch => ({
  id: 'batch-1',
  purchaseOrderId: 'po-1',
  deliveryNo: 1,
  plannedDeliveryDate: '2026-07-10',
  status: 'planned',
  lines: [],
  ...patch,
});

const packagePo = (patch: Partial<PurchaseOrder> = {}) => makePo({
  status: 'confirmed',
  purchaseMode: 'single',
  referenceGrossAmount: 100_000,
  ...patch,
});

const packageActions = (patch: Parameters<typeof getPurchaseOrderUiPolicy>[0]) => {
  const policy = getPurchaseOrderUiPolicy(baseInput(patch));
  return [
    policy.primaryAction?.id,
    ...policy.secondaryActions.map(action => action.id),
    ...policy.menuActions.map(action => action.id),
  ].filter(Boolean);
};

const baseInput = (patch: Parameters<typeof getPurchaseOrderUiPolicy>[0]) => ({
  receiptStats: {
    orderedQty: 100,
    receivedQty: 0,
    remainingQty: 100,
  },
  deliveryBatches: [],
  supplierReturnableQty: 0,
  canEditPoDocument: true,
  canSubmitPoDocument: true,
  canApprovePoDocument: true,
  canDeletePoDocument: true,
  canConfirmPo: true,
  canRunRestrictedPoActions: true,
  editBlockReason: null,
  removalBlockReason: null,
  hasStockImpact: false,
  groupSize: 1,
  ...patch,
});

describe('purchaseOrderUiPolicy', () => {
  it('uses ordinary order approval for single delivery and batch approval for multiple delivery', () => {
    const singleDraft = getPurchaseOrderUiPolicy(baseInput({
      po: packagePo({ status: 'draft', purchaseMode: 'single' }),
    }));
    const singleSent = getPurchaseOrderUiPolicy(baseInput({
      po: packagePo({ status: 'sent', purchaseMode: 'single' }),
    }));
    const multipleWithDraftBatch = getPurchaseOrderUiPolicy(baseInput({
      po: packagePo({ status: 'confirmed', purchaseMode: 'multiple' }),
      deliveryBatches: [plannedBatch({ approvalStatus: 'draft' } as any)],
    }));
    const multipleWithPendingBatch = getPurchaseOrderUiPolicy(baseInput({
      po: packagePo({ status: 'confirmed', purchaseMode: 'multiple' }),
      deliveryBatches: [plannedBatch({ approvalStatus: 'pending_approval' } as any)],
    }));

    expect(singleDraft.primaryAction?.id).toBe('submit_package');
    expect(singleSent.primaryAction?.id).toBe('approve_package');
    expect(multipleWithDraftBatch.primaryAction?.id).toBe('submit_delivery_batch');
    expect(multipleWithPendingBatch.primaryAction?.id).toBe('approve_delivery_batch');
    expect(multipleWithPendingBatch.secondaryActions.map(action => action.id)).toEqual(
      expect.arrayContaining(['request_delivery_batch_revision', 'reject_delivery_batch']),
    );
  });

  it('does not expose rejected implementation terminology in practical PO actions', () => {
    const practicalPolicies = [
      getPurchaseOrderUiPolicy(baseInput({
        po: packagePo({ status: 'draft', purchaseMode: 'single' }),
      })),
      getPurchaseOrderUiPolicy(baseInput({
        po: packagePo({ status: 'sent', purchaseMode: 'single' }),
      })),
      getPurchaseOrderUiPolicy(baseInput({
        po: packagePo({ status: 'confirmed', purchaseMode: 'multiple' }),
        deliveryBatches: [plannedBatch({ approvalStatus: 'draft' } as any)],
      })),
    ];
    const labels = practicalPolicies.flatMap(policy => [
      policy.primaryAction?.label,
      ...policy.secondaryActions.map(action => action.label),
      ...policy.menuActions.map(action => action.label),
    ]).filter(Boolean).join(' | ');

    expect(labels).not.toMatch(/Duyệt gói|Duyệt bổ sung|QR cấp PO|V3|V4/i);
  });

  it('maps draft purchase orders to a request approval primary action', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({ po: makePo({ status: 'draft' }) }));

    expect(policy.primaryAction?.id).toBe('request_approval');
    expect(policy.primaryAction?.label).toBe('Đề nghị duyệt');
  });

  it('allows PO submitters to request approval without PO approval capability', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'draft' }),
      canSubmitPoDocument: true,
      canApprovePoDocument: false,
    }));

    expect(policy.primaryAction?.id).toBe('request_approval');
  });

  it('maps sent purchase orders to approve primary action without exposing a rejected status action', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({ po: makePo({ status: 'sent' }) }));
    const allActionIds = [
      policy.primaryAction?.id,
      ...policy.secondaryActions.map(action => action.id),
      ...policy.menuActions.map(action => action.id),
    ].filter(Boolean);

    expect(policy.primaryAction?.id).toBe('approve_po');
    expect(policy.secondaryActions.map(action => action.id)).toContain('request_revision');
    expect(allActionIds).not.toContain('reject_po');
  });

  it('maps confirmed purchase orders to create delivery primary action when remaining quantity exists', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({ po: makePo({ status: 'confirmed' }) }));

    expect(policy.primaryAction?.id).toBe('create_delivery');
    expect(policy.primaryAction?.label).toBe('Tạo đợt giao');
  });

  it('allows PO receive capability to create delivery without legacy manage access', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'confirmed' }),
      canConfirmPo: true,
    }));

    expect(policy.primaryAction?.id).toBe('create_delivery');
  });

  it('maps in-transit purchase orders with a planned batch to a WMS receipt action', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'in_transit', sourceMode: 'from_request' }),
      deliveryBatches: [plannedBatch()],
    }));

    expect(policy.primaryAction?.id).toBe('create_receipt');
    expect(policy.primaryAction?.label).toBe('Tạo phiếu nhận WMS');
    expect(policy.primaryAction?.deliveryBatchId).toBe('batch-1');
  });

  it('blocks WMS receipt action for supplemental-pending purchase batches', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'in_transit', sourceMode: 'from_request' }),
      deliveryBatches: [plannedBatch({ status: 'supplemental_pending' as any })],
      canConfirmPo: true,
    }));

    expect(policy.primaryAction?.id).not.toBe('create_receipt');
    expect(policy.nextStep).toContain('chờ duyệt bổ sung');
  });

  it('shows supplemental approval action for PO approvers when a release is pending extra approval', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'in_transit', sourceMode: 'from_request', supplementalApprovalStatus: 'pending' as any }),
      deliveryBatches: [plannedBatch({ status: 'supplemental_pending' as any })],
      canApprovePoDocument: true,
      canConfirmPo: false,
      pendingSupplementalApprovalId: 'supp-1',
      supplementalOverAmount: 14000,
    }));

    expect(policy.primaryAction?.id).toBe('approve_supplemental');
    expect(policy.primaryAction?.label).toContain('Duyệt bổ sung');
  });

  it('maps WMS pending purchase orders to open the related WMS transaction when available', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'in_transit', sourceMode: 'from_request' }),
      deliveryBatches: [plannedBatch({ status: 'wms_pending' })],
      pendingWmsTransactionId: 'tx-wms-1',
    }));

    expect(policy.primaryAction?.id).toBe('open_wms_transaction');
    expect(policy.primaryAction?.label).toBe('Mở phiếu WMS');
    expect(policy.primaryAction?.transactionId).toBe('tx-wms-1');
  });

  it('prompts supplier payable creation once received quantity is recognized but AP is missing', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'delivered' }),
      receiptStats: {
        orderedQty: 100,
        receivedQty: 100,
        remainingQty: 0,
      },
      recognizedPayableAmount: 100_000,
      supplierPayableStatus: 'none',
    }));

    expect(policy.primaryAction?.id).toBe('create_supplier_payable');
    expect(policy.primaryAction?.label).toBe('Tạo công nợ NCC');
  });

  it('does not prompt supplier payable creation once AP is paid', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'closed' }),
      receiptStats: {
        orderedQty: 100,
        receivedQty: 100,
        remainingQty: 0,
      },
      recognizedPayableAmount: 100_000,
      supplierPayableStatus: 'paid',
    }));

    expect([
      policy.primaryAction?.id,
      ...policy.secondaryActions.map(action => action.id),
      ...policy.menuActions.map(action => action.id),
    ]).not.toContain('create_supplier_payable');
  });

  it('prioritizes supplemental delivery for partial purchase orders with remaining quantity', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'partial' }),
      receiptStats: {
        orderedQty: 100,
        receivedQty: 40,
        remainingQty: 60,
      },
    }));

    expect(policy.primaryAction?.id).toBe('create_supplemental_delivery');
    expect(policy.secondaryActions.map(action => action.id)).toContain('close_partial');
  });

  it('blocks edit and removal menu actions when the purchase order already has stock impact', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'partial' }),
      hasStockImpact: true,
      editBlockReason: 'PO đã phát sinh nhập kho/hoàn kho nên không thể sửa.',
      removalBlockReason: 'PO đã phát sinh nhập kho/hoàn kho nên không thể xoá.',
    }));

    expect(policy.menuActions.find(action => action.id === 'edit_po')?.disabled).toBe(true);
    expect(policy.menuActions.find(action => action.id === 'remove_po')?.disabled).toBe(true);
  });

  it('shows edit action only from the document-scoped edit decision', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'draft' }),
      canEditPoDocument: true,
    }));

    expect(policy.menuActions.find(action => action.id === 'edit_po')?.disabled).toBeFalsy();
  });

  it('shows remove action only from the document-scoped delete decision', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ status: 'draft' }),
      canDeletePoDocument: true,
    }));

    expect(policy.menuActions.find(action => action.id === 'remove_po')?.disabled).toBeFalsy();
  });

  it('keeps history as a secondary menu action for quick audit access', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({ po: makePo({ status: 'confirmed' }) }));

    expect(policy.menuActions.map(action => action.id)).toContain('view_history');
  });

  it('shows clone action for proactive project purchase orders in any status when creation is allowed', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ sourceMode: 'proactive_project', status: 'closed' }),
      canClonePoDocument: true,
      canEditPoDocument: false,
      canDeletePoDocument: false,
    }));

    expect(policy.menuActions.map(action => action.id)).toContain('clone_po');
  });

  it('does not show clone action for request or proactive stock purchase orders', () => {
    const requestPolicy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ sourceMode: 'from_request' }),
      canClonePoDocument: true,
    }));
    const stockPolicy = getPurchaseOrderUiPolicy(baseInput({
      po: makePo({ sourceMode: 'proactive_stock' }),
      canClonePoDocument: true,
    }));

    expect(requestPolicy.menuActions.map(action => action.id)).not.toContain('clone_po');
    expect(stockPolicy.menuActions.map(action => action.id)).not.toContain('clone_po');
  });

  it('uses practical actions for approved request-backed PO flows', () => {
    expect(packageActions({
      po: packagePo({ purchaseMode: 'single' }),
      deliveryBatches: [plannedBatch({
        status: 'receiving',
        approvalStatus: 'approved',
        qrToken: 'qr-1',
        wmsTransactionId: 'tx-1',
      })],
    })).toEqual(['open_delivery_qr', 'print_purchase_order', 'print_approval_request', 'view_history', 'edit_po', 'remove_po']);

    expect(packageActions({
      po: packagePo({ purchaseMode: 'multiple' }),
      deliveryBatches: [],
    })).toContain('add_delivery');

    expect(packageActions({
      po: packagePo({ supplementalApprovalStatus: 'pending' as any }),
      deliveryBatches: [plannedBatch({ status: 'supplemental_pending' as any })],
      pendingSupplementalApprovalId: 'supp-1',
      supplementalOverAmount: 14_000,
    })).not.toContain('approve_supplemental');

    expect(packageActions({
      po: packagePo({ status: 'delivered' }),
      receiptStats: { orderedQty: 100, receivedQty: 100, remainingQty: 0 },
      recognizedPayableAmount: 100_000,
      supplierPayableStatus: 'none',
    })).not.toContain('create_supplier_payable');

    expect(packageActions({
      po: packagePo({ status: 'partial', purchaseMode: 'multiple' }),
      receiptStats: { orderedQty: 100, receivedQty: 70, remainingQty: 30 },
      deliveryBatches: [],
    })).toContain('close_short');
  });

  it('does not create a second delivery for a single-delivery order', () => {
    const policy = getPurchaseOrderUiPolicy(baseInput({
      po: packagePo({ purchaseMode: 'single' }),
      deliveryBatches: [plannedBatch({ status: 'cancelled' })],
      receiptStats: { orderedQty: 100, receivedQty: 0, remainingQty: 100 },
    }));

    expect(policy.primaryAction?.id).not.toBe('add_delivery');
    expect(policy.secondaryActions.map(action => action.id)).not.toContain('add_delivery');
  });
});
