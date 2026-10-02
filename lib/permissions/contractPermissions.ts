import { Role, type User } from '../../types';
import { canPerform } from './permissionService';

// Contracts module: which permission lets a person add, edit or delete each kind of record.
// Mirrors app_private.contract_actor_can_manage on the server.
export type ContractManageKind = 'partner' | 'customer' | 'supplier' | 'template';

const LABELS: Record<ContractManageKind, string> = {
  partner: 'Đối tác',
  customer: 'Hợp đồng khách hàng',
  supplier: 'Hợp đồng nhà cung cấp',
  template: 'Mẫu hợp đồng',
};

export const contractManageCode = (kind: ContractManageKind) => `contract.${kind}.manage`;

export const canManageContracts = (user: User | null | undefined, kind: ContractManageKind): boolean =>
  Boolean(user) && (user!.role === Role.ADMIN
    || canPerform(user!, contractManageCode(kind), { scopeType: 'global', scopeId: '*' }));

/** Shown instead of the add button when the person may only look. */
export const contractManageLockReason = (kind: ContractManageKind): string =>
  `Bạn đang có quyền xem. Để thêm, sửa hoặc xóa cần quyền "Quản trị" của ${LABELS[kind]} (Cài đặt → Người dùng → Sửa → Hợp đồng).`;
