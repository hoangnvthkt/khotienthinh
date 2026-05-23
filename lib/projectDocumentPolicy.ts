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
  | 'returned'
  | 'rejected'
  | 'cancelled'
  | 'paid'
  | 'locked';

export type ProjectDocumentAction =
  | 'view'
  | 'edit'
  | 'delete'
  | 'return'
  | 'approve'
  | 'cancel'
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
}

const EDITABLE_STATUSES = new Set(['draft', 'returned', 'rejected']);
const RETURNABLE_STATUSES = new Set(['submitted', 'pending', 'verified']);
const LOCKED_DELETE_STATUSES = new Set(['submitted', 'pending', 'verified', 'approved', 'returned', 'rejected', 'cancelled', 'paid', 'locked']);

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
  const currentHandler = includesCurrentUser(userId, input.currentHandlerIds);
  const canView = isAdmin || related || currentHandler || hasPermission(input.permissions, 'view') || hasAnyProjectPermission(input.permissions);

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
    if (!isAdmin && !hasPermission(input.permissions, 'edit')) {
      return deny('Bạn cần quyền "edit" để chỉnh sửa phiếu này.');
    }
    return allow(isAdmin ? 'Admin đang chỉnh sửa dữ liệu dự án. Nếu dữ liệu có liên kết downstream, cần thao tác từ chứng từ gốc.' : undefined);
  }

  if (input.action === 'delete') {
    if (status !== 'draft') {
      const reason = LOCKED_DELETE_STATUSES.has(status)
        ? 'Chỉ được xoá phiếu ở trạng thái nháp. Phiếu đã gửi, trả lại, duyệt, huỷ hoặc thanh toán cần được giữ lại để truy vết.'
        : 'Không thể xoá phiếu ở trạng thái hiện tại.';
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

  if (input.action === 'return') {
    if (!RETURNABLE_STATUSES.has(status)) {
      return deny('Chỉ phiếu đang chờ xử lý mới được trả lại.');
    }
    if (!input.reason?.trim()) {
      return deny('Vui lòng nhập lý do trả lại phiếu.');
    }
    if (!isAdmin && !currentHandler && !hasPermission(input.permissions, 'verify') && !hasPermission(input.permissions, 'approve')) {
      return deny('Bạn cần là người nhận xử lý hoặc có quyền verify/approve để trả lại phiếu.');
    }
    return allow();
  }

  if (input.action === 'approve') {
    if (!isAdmin && !hasPermission(input.permissions, 'approve')) {
      return deny('Bạn cần quyền "approve" để phê duyệt phiếu này.');
    }
    return allow();
  }

  if (input.action === 'cancel') {
    if (dependencies.blockers.length > 0) {
      return deny(dependencies.blockers[0], dependencies.requiredRollbackSteps);
    }
    if (!isAdmin && !hasPermission(input.permissions, 'approve')) {
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
