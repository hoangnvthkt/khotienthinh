import { Role, User } from '../types';
import { ProjectPermissionCode } from './projectStaffService';

export type ProjectDocumentType =
  | 'daily_log'
  | 'schedule_task'
  | 'completion_request'
  | 'quantity_acceptance'
  | 'payment_certificate'
  | 'material_request'
  | 'purchase_order'
  | 'warehouse_receipt'
  | 'contract_item'
  | 'boq_item';

export type ProjectDocumentStatus =
  | 'draft'
  | 'submitted'
  | 'pending'
  | 'verified'
  | 'approved'
  | 'reviewed'
  | 'returned'
  | 'rejected'
  | 'cancelled'
  | 'paid'
  | 'locked';

export type ProjectDocumentAction =
  | 'view'
  | 'edit'
  | 'delete'
  | 'submit'
  | 'verify'
  | 'confirm'
  | 'return'
  | 'approve'
  | 'cancel'
  | 'rollback'
  | 'admin_override';

export interface ProjectDocumentDependencies {
  blockers: string[];
  requiredRollbackSteps: string[];
  warnings?: string[];
  metadata?: Record<string, any>;
}

export interface ProjectDocumentPolicyResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
  requiredRollbackSteps: string[];
}

export interface ProjectDocumentPolicyInput {
  action: ProjectDocumentAction;
  documentType: ProjectDocumentType;
  status?: ProjectDocumentStatus | string | null;
  user?: User | null;
  permissions?: Iterable<ProjectPermissionCode>;
  relatedUserIds?: Array<string | null | undefined>;
  currentHandlerIds?: Array<string | null | undefined>;
  dependencies?: ProjectDocumentDependencies | null;
  reason?: string | null;
  documentLabel?: string;
  everSubmitted?: boolean | null;
  legacyPermissionFallback?: boolean;
}

const EDITABLE_STATUSES = new Set(['draft', 'returned', 'rejected']);
const WAITING_STATUSES = new Set(['submitted', 'pending', 'verified', 'approved', 'reviewed']);
const RETURNABLE_STATUSES = new Set(['submitted', 'pending', 'verified', 'approved', 'reviewed']);
const LOCKED_DELETE_STATUSES = new Set(['submitted', 'pending', 'verified', 'approved', 'reviewed', 'returned', 'rejected', 'cancelled', 'paid', 'locked']);

const normalizeStatus = (status?: string | null): ProjectDocumentStatus => (
  (status || 'draft') as ProjectDocumentStatus
);

const hasPermission = (permissions: Iterable<ProjectPermissionCode> | undefined, code: ProjectPermissionCode) => {
  if (!permissions) return false;
  return new Set(permissions).has(code);
};

const includesCurrentUser = (userId: string | undefined, values?: Array<string | null | undefined>) => (
  !!userId && !!values?.some(value => value === userId)
);

const hasKnownHandler = (values?: Array<string | null | undefined>) => (
  !!values?.some(Boolean)
);

const hasAnyProjectPermission = (permissions: Iterable<ProjectPermissionCode> | undefined) => (
  !!permissions && Array.from(permissions).length > 0
);

const deny = (reason: string, requiredRollbackSteps: string[] = []): ProjectDocumentPolicyResult => ({
  allowed: false,
  reason,
  requiredRollbackSteps,
});

const allow = (warning?: string, requiredRollbackSteps: string[] = []): ProjectDocumentPolicyResult => ({
  allowed: true,
  warning,
  requiredRollbackSteps,
});

export function getProjectDocumentPolicy(input: ProjectDocumentPolicyInput): ProjectDocumentPolicyResult {
  const status = normalizeStatus(input.status);
  const userId = input.user?.id;
  const isAdmin = input.user?.role === Role.ADMIN;
  const dependencies = input.dependencies || { blockers: [], requiredRollbackSteps: [] };
  const related = includesCurrentUser(userId, input.relatedUserIds);
  const relatedKnown = hasKnownHandler(input.relatedUserIds);
  const currentHandler = includesCurrentUser(userId, input.currentHandlerIds);
  const currentHandlerKnown = hasKnownHandler(input.currentHandlerIds);
  const canView = isAdmin || related || currentHandler || hasPermission(input.permissions, 'view') || hasAnyProjectPermission(input.permissions);
  const legacyFallback = input.legacyPermissionFallback !== false;
  const canActOnCurrentStep = isAdmin || currentHandler || (!currentHandlerKnown && legacyFallback);

  if (input.action === 'view') {
    return canView ? allow() : deny('Bạn không có quyền xem phiếu này.');
  }

  if (!isAdmin && !canView) {
    return deny('Bạn không có quyền xem hoặc thao tác với phiếu này.');
  }

  if (input.action === 'edit') {
    if (!EDITABLE_STATUSES.has(status)) {
      return deny(
        'Phiếu đã gửi đi hoặc đã khoá, không thể chỉnh sửa trực tiếp. Vui lòng trả lại/rollback từ đúng bước nghiệp vụ trước khi sửa.',
        ['Trả lại hoặc rollback chứng từ về trạng thái có thể chỉnh sửa.', 'Sau đó chỉnh sửa dữ liệu gốc và gửi lại luồng duyệt.'],
      );
    }
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    if (!isAdmin && input.documentType === 'daily_log' && !hasPermission(input.permissions, 'edit') && !hasPermission(input.permissions, 'submit') && !hasPermission(input.permissions, 'verify')) {
      return deny('Bạn cần quyền "edit", "submit" hoặc "verify" để chỉnh sửa nhật ký của mình.');
    }
    if (!isAdmin && input.documentType !== 'daily_log' && !hasPermission(input.permissions, 'edit')) {
      return deny('Bạn cần quyền "edit" để chỉnh sửa phiếu này.');
    }
    if (!isAdmin && relatedKnown && !related) {
      return deny('Chỉ người lập phiếu được chỉnh sửa khi phiếu ở nháp hoặc đã được trả lại về mình.');
    }
    return allow(isAdmin ? 'Admin chỉ nên chỉnh sửa khi phiếu đã được rollback/trả lại về trạng thái có thể sửa.' : undefined);
  }

  if (input.action === 'delete') {
    if (input.documentType === 'daily_log' && ['draft', 'returned', 'rejected'].includes(status)) {
      if (dependencies.blockers.length > 0) {
        return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
      }
      if (!isAdmin && relatedKnown && !related) {
        return deny('Chỉ người lập phiếu được xoá nhật ký khi phiếu ở nháp hoặc đã được trả lại.');
      }
      if (!isAdmin && !hasPermission(input.permissions, 'delete') && !hasPermission(input.permissions, 'edit') && !hasPermission(input.permissions, 'submit') && !hasPermission(input.permissions, 'verify')) {
        return deny('Bạn cần quyền "delete", "edit", "submit" hoặc "verify" để xoá nhật ký của mình.');
      }
      return allow();
    }
    if (status !== 'draft' || input.everSubmitted) {
      const reason = LOCKED_DELETE_STATUSES.has(status)
        ? 'Chỉ được xoá phiếu nháp chưa từng gửi duyệt. Phiếu đã gửi, trả lại, duyệt, huỷ hoặc thanh toán cần được giữ lại để truy vết.'
        : 'Không thể xoá phiếu ở trạng thái hiện tại hoặc phiếu đã từng gửi duyệt.';
      return deny(reason, ['Nếu cần điều chỉnh, hãy trả lại, huỷ/rollback hoặc tạo chứng từ điều chỉnh theo đúng luồng.']);
    }
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    if (!isAdmin && !hasPermission(input.permissions, 'delete')) {
      return deny('Bạn cần quyền "delete" để xoá phiếu nháp.');
    }
    return allow();
  }

  if (input.action === 'submit') {
    if (!EDITABLE_STATUSES.has(status)) {
      return deny('Chỉ phiếu nháp hoặc phiếu đã được trả lại mới được gửi duyệt.');
    }
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    if (!isAdmin && !hasPermission(input.permissions, 'submit')) {
      return deny('Bạn cần quyền "submit" để gửi phiếu duyệt.');
    }
    return allow();
  }

  if (input.action === 'return') {
    if (!RETURNABLE_STATUSES.has(status)) {
      return deny('Chỉ phiếu đang chờ xử lý mới được trả lại.');
    }
    if (!input.reason?.trim()) {
      return deny('Vui lòng nhập lý do trả lại phiếu.');
    }
    if (!canActOnCurrentStep) {
      return deny('Phiếu đang chờ người nhận xử lý hiện tại. Bạn chỉ được xem, không được trả lại thay người đó.');
    }
    if (!isAdmin && !hasPermission(input.permissions, 'verify') && !hasPermission(input.permissions, 'approve') && !hasPermission(input.permissions, 'confirm')) {
      return deny('Bạn cần quyền verify/approve/confirm phù hợp để trả lại phiếu.');
    }
    return allow();
  }

  if (input.action === 'verify' || input.action === 'approve' || input.action === 'confirm') {
    const requiredPermission = input.action as ProjectPermissionCode;
    if (!WAITING_STATUSES.has(status)) {
      return deny('Phiếu không ở trạng thái chờ xử lý bước hiện tại.');
    }
    if (!canActOnCurrentStep) {
      return deny('Phiếu không được giao cho bạn ở bước hiện tại. Bạn chỉ được xem.');
    }
    if (!isAdmin && !hasPermission(input.permissions, requiredPermission)) {
      return deny(`Bạn cần quyền "${requiredPermission}" để xử lý bước này.`);
    }
    return allow();
  }

  if (input.action === 'cancel' || input.action === 'rollback') {
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    if (!isAdmin && (!canActOnCurrentStep || !hasPermission(input.permissions, 'approve'))) {
      return deny('Bạn cần quyền "approve" để huỷ hoặc rollback phiếu này.');
    }
    if (!input.reason?.trim()) {
      return deny('Vui lòng nhập lý do huỷ/rollback.');
    }
    return allow('Huỷ/rollback sẽ được ghi log và cần kiểm tra các chứng từ downstream trước khi thực hiện.');
  }

  if (input.action === 'admin_override') {
    if (!isAdmin) return deny('Chỉ admin mới được dùng admin override.');
    if (!input.reason?.trim()) return deny('Admin override bắt buộc nhập lý do.');
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    return allow('Admin override sẽ được ghi log để truy vết.');
  }

  return deny('Hành động không hợp lệ.');
}

export function formatPolicyMessage(policy: ProjectDocumentPolicyResult): string {
  if (policy.allowed) return policy.warning || '';
  if (policy.requiredRollbackSteps.length === 0) return policy.reason || 'Không thể thực hiện thao tác.';
  return `${policy.reason || 'Không thể thực hiện thao tác.'}\n${policy.requiredRollbackSteps.join('\n')}`;
}
