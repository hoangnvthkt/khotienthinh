import type {
  POStatus,
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
} from '../types';
import { canClonePurchaseOrder } from './purchaseOrderClone';

export type PurchaseOrderUiActionId =
  | 'submit_package'
  | 'approve_package'
  | 'clone_po'
  | 'add_delivery'
  | 'clone_delivery'
  | 'cancel_delivery'
  | 'open_delivery_qr'
  | 'close_short'
  | 'request_approval'
  | 'approve_po'
  | 'request_revision'
  | 'approve_supplemental'
  | 'reject_supplemental'
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
  | 'open_wms_transaction'
  | 'create_supplier_payable'
  | 'view_history';

export type PurchaseOrderUiActionIntent = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export interface PurchaseOrderUiAction {
  id: PurchaseOrderUiActionId;
  label: string;
  intent?: PurchaseOrderUiActionIntent;
  disabled?: boolean;
  disabledReason?: string | null;
  deliveryBatchId?: string;
  transactionId?: string;
  supplementalApprovalId?: string;
  qrToken?: string | null;
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
  canEditPoDocument?: boolean;
  canSubmitPoDocument?: boolean;
  canApprovePoDocument?: boolean;
  canDeletePoDocument?: boolean;
  canClonePoDocument?: boolean;
  canConfirmPo?: boolean;
  canRunRestrictedPoActions?: boolean;
  editBlockReason?: string | null;
  removalBlockReason?: string | null;
  hasStockImpact?: boolean;
  isRejectedBeforeReceipt?: boolean;
  groupSize?: number;
  pendingWmsTransactionId?: string | null;
  pendingSupplementalApprovalId?: string | null;
  supplementalOverAmount?: number;
  recognizedPayableAmount?: number;
  supplierPayableStatus?: 'none' | 'draft' | 'open' | 'payable' | 'partial' | 'paid' | 'cancelled' | 'reversed';
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
  deliveryBatches.some(batch => ['planned', 'supplemental_pending', 'wms_pending'].includes(batch.status));

const firstPlannedBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.find(batch => batch.status === 'planned');

const isPurchasePackageV2 = (po: PurchaseOrder) =>
  po.sourceMode === 'from_request' && (po.purchaseMode === 'single' || po.purchaseMode === 'multiple');

const firstOpenPackageBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.find(batch => !['cancelled'].includes(batch.status));

const hasRejectedPackageBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.some(batch => batch.status === 'cancelled');

const hasSupplementalPendingBatch = (deliveryBatches: PurchaseOrderDeliveryBatch[]) =>
  deliveryBatches.some(batch => batch.status === 'supplemental_pending');

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
  canEditPoDocument = false,
  canSubmitPoDocument = false,
  canApprovePoDocument = false,
  canDeletePoDocument = false,
  canClonePoDocument = false,
  canConfirmPo = false,
  canRunRestrictedPoActions = false,
  editBlockReason = null,
  removalBlockReason = null,
  hasStockImpact = false,
  isRejectedBeforeReceipt = false,
  groupSize = 1,
  pendingWmsTransactionId = null,
  pendingSupplementalApprovalId = null,
  supplementalOverAmount = 0,
  recognizedPayableAmount = 0,
  supplierPayableStatus = 'none',
}: PurchaseOrderUiPolicyInput): PurchaseOrderUiPolicy => {
  const isCompanyConsolidatedPo = po.sourceMode === 'company_consolidated';
  const isPackageV2 = isPurchasePackageV2(po);
  const mayApprovePo = canApprovePoDocument;
  const maySubmitPo = canSubmitPoDocument;
  const mayReceivePo = canConfirmPo;
  const mayEditPo = canEditPoDocument;
  const mayDeletePo = canDeletePoDocument;
  const mayClonePo = canClonePoDocument && canClonePurchaseOrder(po);
  const mayReturnSupplier = canRunRestrictedPoActions;
  const plannedBatch = firstPlannedBatch(deliveryBatches);
  const hasPendingSupplemental = Boolean(pendingSupplementalApprovalId)
    || po.supplementalApprovalStatus === 'pending'
    || hasSupplementalPendingBatch(deliveryBatches);
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

  if (isPackageV2) {
    const openBatch = firstOpenPackageBatch(deliveryBatches);
    const canOpenDeliveryQr = Boolean(openBatch?.qrToken || openBatch?.wmsTransactionId);
    if (po.status === 'draft' && maySubmitPo) {
      primaryAction = { id: 'submit_package', label: 'Gửi duyệt gói', intent: 'warning' };
      nextStep = 'Gửi Gói mua hàng vào luồng duyệt.';
    } else if (po.status === 'sent' && mayApprovePo) {
      primaryAction = { id: 'approve_package', label: 'Duyệt gói', intent: 'success' };
      secondaryActions.push({ id: 'request_revision', label: 'Yêu cầu chỉnh sửa', intent: 'neutral' });
      nextStep = po.purchaseMode === 'single'
        ? 'Duyệt Gói mua hàng và tạo sẵn đợt giao đầu tiên.'
        : 'Duyệt Gói mua hàng, sau đó thêm từng đợt giao khi có lịch.';
    } else if (['confirmed', 'in_transit', 'partial'].includes(po.status)) {
      if (canOpenDeliveryQr && openBatch) {
        primaryAction = {
          id: 'open_delivery_qr',
          label: 'Mở QR đợt giao',
          intent: 'primary',
          deliveryBatchId: openBatch.id,
          transactionId: openBatch.wmsTransactionId || undefined,
          qrToken: openBatch.qrToken || null,
        };
        nextStep = 'Theo dõi đợt giao hiện tại qua QR/WMS.';
      } else if (mayReceivePo) {
        const isRecreateAfterRejectedSingleBatch = po.purchaseMode === 'single' && hasRejectedPackageBatch(deliveryBatches);
        primaryAction = {
          id: 'add_delivery',
          label: isRecreateAfterRejectedSingleBatch ? 'Tạo lại đợt giao' : 'Thêm đợt giao',
          intent: 'primary',
        };
        nextStep = isRecreateAfterRejectedSingleBatch
          ? 'Đợt giao trước đã bị từ chối. Tạo lại đợt giao để gửi Kho xử lý WMS/QR.'
          : 'Tạo đợt giao để nhà cung cấp giao hàng và kho xử lý QR/WMS.';
      }

      if (mayReceivePo && po.purchaseMode === 'multiple' && primaryAction?.id !== 'add_delivery') {
        secondaryActions.push({ id: 'add_delivery', label: 'Thêm đợt giao', intent: 'primary' });
      }
      if (mayReceivePo && po.purchaseMode === 'multiple' && openBatch) {
        secondaryActions.push({
          id: 'clone_delivery',
          label: 'Clone đợt',
          intent: 'neutral',
          deliveryBatchId: openBatch.id,
        });
        if (['planned', 'wms_pending'].includes(openBatch.status)) {
          secondaryActions.push({
            id: 'cancel_delivery',
            label: 'Hủy đợt giao',
            intent: 'danger',
            deliveryBatchId: openBatch.id,
          });
        }
      }
      if (mayReceivePo && hasOpenReceiptNeed(receiptStats) && !openBatch) {
        secondaryActions.push({ id: 'close_short', label: 'Kết thúc thiếu', intent: 'warning' });
      }
    } else if (po.status === 'closed') {
      primaryAction = { id: 'print_purchase_order', label: 'In chứng từ', intent: 'neutral' };
      nextStep = 'Gói mua hàng đã đóng, chỉ còn tra cứu và in chứng từ.';
    }
  } else if (!isCompanyConsolidatedPo) {
    if (hasPendingSupplemental && mayApprovePo && pendingSupplementalApprovalId) {
      primaryAction = {
        id: 'approve_supplemental',
        label: supplementalOverAmount > 0
          ? `Duyệt bổ sung ${supplementalOverAmount.toLocaleString('vi-VN')} đ`
          : 'Duyệt bổ sung',
        intent: 'warning',
        supplementalApprovalId: pendingSupplementalApprovalId,
      };
      secondaryActions.push({
        id: 'reject_supplemental',
        label: 'Từ chối bổ sung',
        intent: 'neutral',
        supplementalApprovalId: pendingSupplementalApprovalId,
      });
      nextStep = 'Đợt mua đang vượt giá trị PO tổng đã duyệt. Duyệt bổ sung để mở tạo WMS/QR.';
    } else if (po.status === 'draft' && maySubmitPo) {
      primaryAction = { id: 'request_approval', label: 'Đề nghị duyệt', intent: 'warning' };
      nextStep = 'Chọn người xác nhận và gửi PO vào luồng duyệt.';
    } else if (po.status === 'sent' && mayApprovePo) {
      primaryAction = { id: 'approve_po', label: 'Duyệt PO', intent: 'success' };
      secondaryActions.push({ id: 'request_revision', label: 'Yêu cầu chỉnh sửa', intent: 'neutral' });
      nextStep = 'Kiểm tra thông tin đặt hàng rồi duyệt hoặc yêu cầu chỉnh sửa.';
    } else if (po.status === 'confirmed' && mayReceivePo && canCreateDeliveryDraft(po.status, deliveryBatches, receiptStats, isCompanyConsolidatedPo)) {
      primaryAction = { id: 'create_delivery', label: 'Tạo đợt giao', intent: 'primary' };
      nextStep = 'Lập đợt giao để chuyển PO sang bước thực hiện giao nhận.';
    } else if (po.status === 'in_transit' && mayReceivePo) {
      if (plannedBatch) {
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
      } else if (hasPendingSupplemental) {
        nextStep = 'Đợt mua đang chờ duyệt bổ sung nên chưa thể tạo WMS/QR.';
      } else {
        nextStep = 'Theo dõi phiếu WMS/QR và ghi nhận thực nhận khi kho xử lý.';
      }
    } else if (po.status === 'partial' && mayReceivePo) {
      if (canCreateDeliveryDraft(po.status, deliveryBatches, receiptStats, isCompanyConsolidatedPo)) {
        primaryAction = { id: 'create_supplemental_delivery', label: 'Tạo đợt giao bổ sung', intent: 'primary' };
      }
      if (hasOpenReceiptNeed(receiptStats)) {
        secondaryActions.push({ id: 'close_partial', label: 'Kết thúc thiếu PO', intent: 'warning' });
      }
      nextStep = hasOpenReceiptNeed(receiptStats)
        ? 'PO còn thiếu số lượng, tạo giao bổ sung hoặc kết thúc thiếu nếu không tiếp tục nhận.'
        : 'Đối chiếu chứng từ nhận hàng và hoàn tất PO khi đủ điều kiện.';
    } else if (po.status === 'delivered' && mayReceivePo) {
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

  if (!isPackageV2 && pendingWmsTransactionId && deliveryBatches.some(batch => batch.status === 'wms_pending')) {
    primaryAction = {
      id: 'open_wms_transaction',
      label: 'Mở phiếu WMS',
      intent: 'primary',
      transactionId: pendingWmsTransactionId,
    };
    nextStep = 'Đợt giao đang chờ kho xử lý. Mở phiếu WMS để duyệt, từ chối hoặc xác nhận nhập theo quyền.';
  }

  const canCreateSupplierPayable = Number(recognizedPayableAmount || 0) > 0
    && (supplierPayableStatus === 'none' || supplierPayableStatus === 'draft')
    && !['draft', 'sent', 'confirmed', 'in_transit', 'cancelled', 'returned'].includes(po.status);
  if (!isPackageV2 && canCreateSupplierPayable) {
    const action: PurchaseOrderUiAction = {
      id: 'create_supplier_payable',
      label: 'Tạo công nợ NCC',
      intent: 'success',
    };
    if (!primaryAction || ['delivered', 'closed'].includes(po.status)) primaryAction = action;
    else secondaryActions.push(action);
    nextStep = 'PO đã có giá trị thực nhận. Tạo chứng từ công nợ NCC để chuyển sang bước thanh toán.';
  } else if (Number(recognizedPayableAmount || 0) > 0 && ['open', 'partial'].includes(supplierPayableStatus || '')) {
    nextStep = 'Công nợ NCC đã ghi nhận, tiếp tục theo dõi số còn phải trả và thanh toán.';
  } else if (Number(recognizedPayableAmount || 0) > 0 && supplierPayableStatus === 'paid') {
    nextStep = 'Công nợ NCC đã thanh toán, còn lại in chứng từ và tra cứu lịch sử.';
  }

  if (mayReturnSupplier && ['partial', 'delivered', 'closed'].includes(po.status) && supplierReturnableQty > 0) {
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

  if (mayClonePo) {
    menuActions.push({ id: 'clone_po', label: 'Nhân bản PO', intent: 'neutral' });
  }

  if (po.procurementGroupId && groupSize > 1) {
    menuActions.push(
      { id: 'print_group_purchase_order', label: 'In nhóm đơn đặt hàng', intent: 'neutral' },
      { id: 'print_group_approval_request', label: 'In nhóm đề nghị duyệt', intent: 'neutral' },
    );
  }

  if (mayEditPo || mayDeletePo) {
    if (mayEditPo) {
      menuActions.push(
        {
          id: 'edit_po',
          label: 'Sửa PO',
          intent: 'neutral',
          disabled: Boolean(editBlockReason || hasStockImpact),
          disabledReason: editBlockReason || (hasStockImpact ? 'PO đã phát sinh nhập kho/hoàn kho nên không thể sửa.' : null),
        },
      );
    }
    if (mayDeletePo) {
      menuActions.push(
        {
          id: 'remove_po',
          label: hasStockImpact ? 'Lưu trữ PO' : 'Xoá PO',
          intent: 'danger',
          disabled: Boolean(removalBlockReason),
          disabledReason: removalBlockReason,
        },
      );
    }
  }

  if (mayReturnSupplier && ['partial', 'delivered', 'closed'].includes(po.status) && supplierReturnableQty > 0) {
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
