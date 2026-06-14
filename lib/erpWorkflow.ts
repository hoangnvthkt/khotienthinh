import type { ErpStatusTone } from '../components/erp/status';
import type { AppNotification } from './notificationService';
import { MaterialRequest, RequestStatus, Transaction, TransactionStatus, TransactionType, User } from '../types';
import {
  canApproveMaterialRequest,
  canApproveWmsTransaction,
  canExportMaterialRequest,
  canReceiveMaterialRequest,
  canReceiveWmsTransaction,
  isFulfillmentBatchTransaction,
} from './wmsPermissions';

export type ErpStatusView = {
  label: string;
  tone: ErpStatusTone;
};

export type ErpNextActionView = ErpStatusView & {
  nextAction: string;
  actionLabel: string;
  isActionable: boolean;
};

export const getMaterialRequestStatusView = (status?: RequestStatus | string | null): ErpStatusView => {
  switch (status) {
    case RequestStatus.PENDING:
    case RequestStatus.LEGACY_PENDING:
      return { label: 'Chờ duyệt', tone: 'warning' };
    case RequestStatus.APPROVED:
    case RequestStatus.LEGACY_APPROVED:
      return { label: 'Chờ xuất', tone: 'info' };
    case RequestStatus.IN_TRANSIT:
      return { label: 'Đang giao', tone: 'attention' };
    case RequestStatus.COMPLETED:
      return { label: 'Đã nhận', tone: 'success' };
    case RequestStatus.REJECTED:
      return { label: 'Từ chối', tone: 'danger' };
    case RequestStatus.DRAFT:
    default:
      return { label: 'Nháp', tone: 'neutral' };
  }
};

export const getMaterialRequestNextAction = (request: MaterialRequest, user: User): ErpNextActionView => {
  const view = getMaterialRequestStatusView(request.status);

  if (request.status === RequestStatus.PENDING || request.status === RequestStatus.LEGACY_PENDING) {
    const actionable = canApproveMaterialRequest(user, request);
    return {
      ...view,
      nextAction: actionable ? 'Bạn cần thẩm định phiếu và quyết định duyệt hoặc từ chối.' : 'Đang chờ phòng vật tư hoặc kho nguồn thẩm định.',
      actionLabel: actionable ? 'Thẩm định' : 'Xem phiếu',
      isActionable: actionable,
    };
  }

  if (request.status === RequestStatus.APPROVED || request.status === RequestStatus.LEGACY_APPROVED) {
    const actionable = canExportMaterialRequest(user, request);
    return {
      ...view,
      nextAction: actionable ? 'Bạn cần xuất kho cho công trường hoặc bộ phận yêu cầu.' : 'Đã duyệt, chờ kho nguồn xuất hàng.',
      actionLabel: actionable ? 'Xuất kho' : 'Xem phiếu',
      isActionable: actionable,
    };
  }

  if (request.status === RequestStatus.IN_TRANSIT) {
    const actionable = canReceiveMaterialRequest(user, request);
    return {
      ...view,
      nextAction: actionable ? 'Bạn cần xác nhận số lượng thực nhận.' : 'Đang giao, chờ kho/công trường xác nhận nhận hàng.',
      actionLabel: actionable ? 'Nhận hàng' : 'Xem phiếu',
      isActionable: actionable,
    };
  }

  if (request.status === RequestStatus.REJECTED) {
    return {
      ...view,
      nextAction: 'Phiếu bị từ chối, cần xem lý do trước khi tạo hoặc gửi lại.',
      actionLabel: 'Xem lý do',
      isActionable: request.requesterId === user.id,
    };
  }

  if (request.status === RequestStatus.COMPLETED) {
    return {
      ...view,
      nextAction: 'Phiếu đã hoàn tất nhận hàng.',
      actionLabel: 'Xem phiếu',
      isActionable: false,
    };
  }

  return {
    ...view,
    nextAction: request.requesterId === user.id ? 'Hoàn thiện nháp và gửi duyệt khi đã đủ thông tin.' : 'Phiếu đang ở trạng thái nháp.',
    actionLabel: 'Mở nháp',
    isActionable: request.requesterId === user.id,
  };
};

export const getTransactionTypeLabel = (type?: TransactionType | string | null): string => {
  switch (type) {
    case TransactionType.IMPORT:
      return 'Nhập kho';
    case TransactionType.EXPORT:
      return 'Xuất kho';
    case TransactionType.TRANSFER:
      return 'Chuyển kho';
    case TransactionType.LIQUIDATION:
      return 'Xuất hủy';
    case TransactionType.ADJUSTMENT:
      return 'Điều chỉnh';
    default:
      return String(type || 'Phiếu kho');
  }
};

export const getTransactionStatusView = (status?: TransactionStatus | string | null): ErpStatusView => {
  switch (status) {
    case TransactionStatus.PENDING:
    case TransactionStatus.LEGACY_PENDING:
      return { label: 'Chờ duyệt', tone: 'warning' };
    case TransactionStatus.APPROVED:
      return { label: 'Chờ nhận', tone: 'info' };
    case TransactionStatus.COMPLETED:
    case TransactionStatus.LEGACY_COMPLETED:
      return { label: 'Hoàn thành', tone: 'success' };
    case TransactionStatus.CANCELLED:
    case TransactionStatus.LEGACY_CANCELLED:
      return { label: 'Từ chối', tone: 'danger' };
    default:
      return { label: 'Nháp', tone: 'neutral' };
  }
};

export const getTransactionNextAction = (transaction: Transaction, user: User): ErpNextActionView => {
  const view = getTransactionStatusView(transaction.status);

  if (transaction.status === TransactionStatus.PENDING || transaction.status === TransactionStatus.LEGACY_PENDING) {
    const actionable = canApproveWmsTransaction(user, transaction);
    const fulfillmentLabel = isFulfillmentBatchTransaction(transaction) ? 'số lượng/chất lượng đợt cấp' : 'phiếu kho';
    return {
      ...view,
      nextAction: actionable ? `Bạn cần duyệt ${fulfillmentLabel}.` : 'Đang chờ người có quyền duyệt phiếu.',
      actionLabel: actionable ? 'Duyệt phiếu' : 'Xem phiếu',
      isActionable: actionable,
    };
  }

  if (transaction.status === TransactionStatus.APPROVED) {
    const actionable = canReceiveWmsTransaction(user, transaction);
    return {
      ...view,
      nextAction: actionable ? 'Bạn cần xác nhận đã nhận hàng thực tế.' : 'Đã duyệt, chờ kho nhận xác nhận.',
      actionLabel: actionable ? 'Xác nhận nhận' : 'Xem phiếu',
      isActionable: actionable,
    };
  }

  if (transaction.status === TransactionStatus.COMPLETED || transaction.status === TransactionStatus.LEGACY_COMPLETED) {
    return { ...view, nextAction: 'Phiếu kho đã hoàn tất.', actionLabel: 'Xem phiếu', isActionable: false };
  }

  if (transaction.status === TransactionStatus.CANCELLED || transaction.status === TransactionStatus.LEGACY_CANCELLED) {
    return { ...view, nextAction: 'Phiếu đã bị từ chối hoặc hủy.', actionLabel: 'Xem phiếu', isActionable: false };
  }

  return { ...view, nextAction: 'Kiểm tra thông tin phiếu.', actionLabel: 'Xem phiếu', isActionable: false };
};

export type NotificationWorkGroup = 'action' | 'tracking' | 'alert';

export const getNotificationWorkGroup = (notification: AppNotification): NotificationWorkGroup => {
  if (notification.severity === 'critical') return 'alert';
  if (['inventory', 'budget', 'progress', 'payment', 'safety'].includes(notification.category) && notification.severity !== 'info') return 'alert';
  if (!notification.isRead && [
    'workflow',
    'request',
    'rq',
    'material',
    'material_request',
    'quality_checklist',
    'quantity_acceptance',
    'payment_certificate',
    'safety_issue',
    'safety_inspection',
  ].some(token => String(notification.sourceType || notification.category).includes(token))) {
    return 'action';
  }
  return 'tracking';
};

export const getNotificationWorkGroupLabel = (group: NotificationWorkGroup): string => {
  if (group === 'action') return 'Cần tôi xử lý';
  if (group === 'alert') return 'Cảnh báo';
  return 'Theo dõi';
};
