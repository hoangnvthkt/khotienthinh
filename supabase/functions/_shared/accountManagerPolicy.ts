// "Quản lý tài khoản" (Đợt 2a-2): Admin, hoặc người có settings.users.manage toàn công ty.
// Máy chủ quyết qua RPC account_manager_access_v1; file này chỉ đọc kết quả, không phụ thuộc Deno
// để vitest kiểm được.

export const ACCOUNT_MANAGER_REQUIRED = 'Cần quyền Quản lý tài khoản.';
export const ACCOUNT_TARGET_ADMIN_ONLY = 'Chỉ Admin thao tác được trên tài khoản quản trị.';

export type AccountManagerAccess = {
  canManageAccounts: boolean;
  /** null khi không hỏi về tài khoản đích. */
  targetRequiresAdmin: boolean | null;
};

export type CreatedAccountRole = 'ADMIN' | 'EMPLOYEE' | 'WAREHOUSE_KEEPER';

const CREATABLE_ROLES = new Set<CreatedAccountRole>(['ADMIN', 'EMPLOYEE', 'WAREHOUSE_KEEPER']);

export const parseAccountManagerAccess = (value: unknown): AccountManagerAccess => {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    canManageAccounts: row.canManageAccounts === true,
    targetRequiresAdmin: row.targetRequiresAdmin === null || row.targetRequiresAdmin === undefined
      ? null
      : row.targetRequiresAdmin !== false,
  };
};

/** Lý do từ chối, hoặc null khi được làm. Không rõ về tài khoản đích thì coi như chỉ Admin. */
export const accountManagerDenial = (
  access: AccountManagerAccess,
  caller: { isAdmin: boolean; hasTarget: boolean },
): string | null => {
  if (!access.canManageAccounts) return ACCOUNT_MANAGER_REQUIRED;
  if (caller.hasTarget && !caller.isAdmin && access.targetRequiresAdmin !== false) {
    return ACCOUNT_TARGET_ADMIN_ONLY;
  }
  return null;
};

/** Người không phải Admin chỉ tạo được tài khoản thường. */
export const resolveCreatedAccountRole = (requested: unknown, callerIsAdmin: boolean): CreatedAccountRole => {
  if (!callerIsAdmin) return 'EMPLOYEE';
  const role = String(requested || '').trim().toUpperCase() as CreatedAccountRole;
  return CREATABLE_ROLES.has(role) ? role : 'EMPLOYEE';
};
