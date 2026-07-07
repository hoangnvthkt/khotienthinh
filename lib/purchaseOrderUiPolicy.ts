import type {
  POStatus,
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
} from '../types';

export type PurchaseOrderUiActionId =
  | 'request_approval'
  | 'approve_po'
  | 'request_revision'
  | 'create_delivery'
  | 'create_receipt'
  | 'create_supplemental_delivery'
  | 'close_partial'
  | 'close_po'
  | 'print_purchase_order'
  | 'print_approval_request'
  | 'print_group_purchase_order'
  | 'print_group_approval_request'
  | 'edit_po'
  | 'remove_po'
  | 'supplier_return'
  | 'view_history';

export type PurchaseOrderUiActionIntent = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export interface PurchaseOrderUiAction {
  id: PurchaseOrderUiActionId;
  label: string;
  intent?: PurchaseOrderUiActionIntent;
  disabled?: boolean;
  disabledReason?: string | null;
  deliveryBatchId?: string;
}

export interface PurchaseOrderUiAlert {
  id: 'missing_qty' | 'overdue' | 'waiting_approval' | 'rejected_before_receipt';
  label: string;
  tone: 'warning' | 'danger' | 'neutral';
}

export interface PurchaseOrderReceiptStats {
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
}

export interface PurchaseOrderUiPolicyInput {
  po: PurchaseOrder;
  receiptStats?: PurchaseOrderReceiptStats;
  deliveryBatches?: PurchaseOrderDeliveryBatch[];
  supplierReturnableQty?: number;
  canManageTab?: boolean;
  canRunRestrictedPoActions?: boolean;
  canMutatePoDocument?: boolean;
  editBlockReason?: string | null;
  removalBlockReason?: string | null;
  hasStockImpact?: boolean;
  isRejectedBeforeReceipt?: boolean;
  groupSize?: number;
}

export interface PurchaseOrderUiPolicy {
  primaryAction?: PurchaseOrderUiAction;
  secondaryActions: PurchaseOrderUiAction[];
  menuActions: PurchaseOrderUiAction[];
  alerts: PurchaseOrderUiAlert[];
  nextStep: string;
}

const hasOpenReceiptNeed = (receiptStats?: PurchaseOrderReceiptStats) =>
  Number(receiptStats?.remainingQty || 0) > 0;

const hasActiveDeliveryBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.some(batch => ['planned', 'wms_pending'].includes(batch.status));

const firstPlannedBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.find(batch => batch.status === 'planned');

const canCreateDeliveryDraft = (
  status: POStatus,
  deliveryBatches: PurchaseOrderDeliveryBatch[],
  receiptStats: PurchaseOrderReceiptStats | undefined,
  isCompanyConsolidatedPo: boolean,
) => !isCompanyConsolidatedPo
  && ['confirmed', 'in_transit', 'partial'].includes(status)
  && !hasActiveDeliveryBatch(deliveryBatches)
  && hasOpenReceiptNeed(receiptStats);

export const getPurchaseOrderUiPolicy = ({
  po,
  receiptStats,
  deliveryBatches = [],
  supplierReturnableQty = 0,
  canManageTab = false,
  canRunRestrictedPoActions = false,
  canMutatePoDocument = false,
  editBlockReason = null,
  removalBlockReason = null,
  hasStockImpact = false,
  isRejectedBeforeReceipt = false,
  groupSize = 1,
}: PurchaseOrderUiPolicyInput): PurchaseOrderUiPolicy => {
  const isCompanyConsolidatedPo = po.sourceMode === 'company_consolidated';
  const plannedBatch = firstPlannedBatch(deliveryBatches);
  const secondaryActions: PurchaseOrderUiAction[] = [];
  const menuActions: PurchaseOrderUiAction[] = [];
  const alerts: PurchaseOrderUiAlert[] = [];
  let primaryAction: PurchaseOrderUiAction | undefined;
  let nextStep = 'Xem chi tiết đơn hàng và đối chiếu chứng từ liên quan.';

  if (po.status === 'sent') {
    alerts.push({ id: 'waiting_approval', label: 'Chờ duyệt', tone: 'warning' });
  }
  if (hasOpenReceiptNeed(receiptStats) && ['partial', 'in_transit'].includes(po.status)) {
    alerts.push({ id: 'missing_qty', label: 'Còn thiếu', tone: 'warning' });
  }
  if (po.expectedDeliveryDate && hasOpenReceiptNeed(receiptStats)) {
    const expected = new Date(`${po.expectedDeliveryDate}T23:59:59`);
    if (!Number.isNaN(expected.getTime()) && expected.getTime() < Date.now()) {
      alerts.push({ id: 'overdue', label: 'Quá hạn', tone: 'danger' });
    }
  }
  if (isRejectedBeforeReceipt) {
    alerts.push({ id: 'rejected_before_receipt', label: 'Đợt giao bị từ chối', tone: 'danger' });
  }

  if (!isCompanyConsolidatedPo && canManageTab) {
    if (po.status === 'draft') {
      primaryAction = { id: 'request_approval', label: 'Đề nghị duyệt', intent: 'warning' };
      nextStep = 'Chọn người xác nhận và gửi PO vào luồng duyệt.';
    } else if (po.status === 'sent') {
      primaryAction = { id: 'approve_po', label: 'Duyệt PO', intent: 'success' };
      secondaryActions.push({ id: 'request_revision', label: 'Yêu cầu chỉnh sửa', intent: 'neutral' });
      nextStep = 'Kiểm tra thông tin đặt hàng rồi duyệt hoặc yêu cầu chỉnh sửa.';
    } else if (po.status === 'confirmed' && canCreateDeliveryDraft(po.status, deliveryBatches, receiptStats, isCompanyConsolidatedPo)) {
      primaryAction = { id: 'create_delivery', label: 'Tạo đợt giao', intent: 'primary' };
      nextStep = 'Lập đợt giao để chuyển PO sang bước thực hiện giao nhận.';
    } else if (po.status === 'in_transit') {
      if (po.sourceMode === 'from_request' && plannedBatch) {
        primaryAction = {
          id: 'create_receipt',
          label: 'Tạo phiếu nhận WMS',
          intent: 'primary',
          deliveryBatchId: plannedBatch.id,
        };
        nextStep = 'Tạo phiếu nhận WMS/QR cho đợt giao kế hoạch.';
      } else if (canCreateDeliveryDraft(po.status, deliveryBatches, receiptStats, isCompanyConsolidatedPo)) {
        primaryAction = { id: 'create_supplemental_delivery', label: 'Tạo đợt giao bổ sung', intent: 'primary' };
        nextStep = 'PO còn thiếu số lượng, hãy lập đợt giao tiếp theo.';
      } else {
        nextStep = 'Theo dõi phiếu WMS/QR và ghi nhận thực nhận khi kho xử lý.';
      }
    } else if (po.status === 'partial') {
      if (canCreateDeliveryDraft(po.status, deliveryBatches, receiptStats, isCompanyConsolidatedPo)) {
        primaryAction = { id: 'create_supplemental_delivery', label: 'Tạo đợt giao bổ sung', intent: 'primary' };
      }
      if (hasOpenReceiptNeed(receiptStats)) {
        secondaryActions.push({ id: 'close_partial', label: 'Kết thúc thiếu PO', intent: 'warning' });
      }
      nextStep = hasOpenReceiptNeed(receiptStats)
        ? 'PO còn thiếu số lượng, tạo giao bổ sung hoặc kết thúc thiếu nếu không tiếp tục nhận.'
        : 'Đối chiếu chứng từ nhận hàng và hoàn tất PO khi đủ điều kiện.';
    } else if (po.status === 'delivered') {
      primaryAction = { id: 'close_po', label: 'Đóng PO', intent: 'neutral' };
      secondaryActions.push({ id: 'print_purchase_order', label: 'In chứng từ', intent: 'neutral' });
      nextStep = 'PO đã giao đủ, kiểm tra chứng từ rồi đóng đơn.';
    } else if (po.status === 'closed') {
      primaryAction = { id: 'print_purchase_order', label: 'In chứng từ', intent: 'neutral' };
      nextStep = 'PO đã đóng, chỉ còn tra cứu và in chứng từ.';
    }
  }

  if (['returned', 'cancelled'].includes(po.status)) {
    nextStep = 'PO đã kết thúc trạng thái, chỉ xem chi tiết và lịch sử.';
  }

  if (canRunRestrictedPoActions && ['partial', 'delivered', 'closed'].includes(po.status) && supplierReturnableQty > 0) {
    const action: PurchaseOrderUiAction = {
      id: 'supplier_return',
      label: po.status === 'closed' ? 'Tạo phiếu hoàn NCC' : 'Trả hàng NCC',
      intent: 'danger',
    };
    if (po.status === 'closed' && !primaryAction) primaryAction = action;
    else secondaryActions.push(action);
  }

  menuActions.push(
    { id: 'print_purchase_order', label: 'In đơn đặt hàng', intent: 'neutral' },
    { id: 'print_approval_request', label: 'In đề nghị duyệt', intent: 'neutral' },
    { id: 'view_history', label: 'Xem lịch sử', intent: 'neutral' },
  );

  if (po.procurementGroupId && groupSize > 1) {
    menuActions.push(
      { id: 'print_group_purchase_order', label: 'In nhóm đơn đặt hàng', intent: 'neutral' },
      { id: 'print_group_approval_request', label: 'In nhóm đề nghị duyệt', intent: 'neutral' },
    );
  }

  if (canMutatePoDocument) {
    menuActions.push(
      {
        id: 'edit_po',
        label: 'Sửa PO',
        intent: 'neutral',
        disabled: Boolean(editBlockReason || hasStockImpact),
        disabledReason: editBlockReason || (hasStockImpact ? 'PO đã phát sinh nhập kho/hoàn kho nên không thể sửa.' : null),
      },
      {
        id: 'remove_po',
        label: hasStockImpact ? 'Lưu trữ PO' : 'Xoá PO',
        intent: 'danger',
        disabled: Boolean(removalBlockReason),
        disabledReason: removalBlockReason,
      },
    );
  }

  if (canRunRestrictedPoActions && ['partial', 'delivered', 'closed'].includes(po.status) && supplierReturnableQty > 0) {
    menuActions.push({
      id: 'supplier_return',
      label: po.status === 'closed' ? 'Tạo phiếu hoàn NCC' : 'Trả hàng NCC',
      intent: 'danger',
    });
  }

  return {
    primaryAction,
    secondaryActions,
    menuActions,
    alerts,
    nextStep,
  };
};
