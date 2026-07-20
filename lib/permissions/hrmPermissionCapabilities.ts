import type { Employee, User } from '../../types';
import { canPerform, canViewRoute } from './permissionService';
import type { PermissionScope } from './permissionTypes';

export const HRM_EMPLOYEE_CREATE_PERMISSION = 'hrm.employee.create';
export const HRM_EMPLOYEE_EDIT_PERMISSION = 'hrm.employee.edit';

export const isOwnEmployeeRecord = (
  user: Pick<User, 'id'> | null | undefined,
  employee: Pick<Employee, 'userId'> | null | undefined,
): boolean => Boolean(user?.id && employee?.userId === user.id);

export const getHrmEmployeeRecordScope = (
  employee: Pick<Employee, 'departmentId' | 'userId'> | null | undefined,
  currentUserId?: string,
): PermissionScope => {
  if (currentUserId && employee?.userId === currentUserId) {
    return { scopeType: 'own', scopeId: currentUserId };
  }
  if (employee?.departmentId) {
    return { scopeType: 'department', scopeId: employee.departmentId };
  }
  return { scopeType: 'global', scopeId: '*' };
};

export const buildHrmEmployeeActionPolicy = (
  user: Pick<User, 'id' | 'role' | 'allowedModules' | 'adminModules' | 'allowedSubModules' | 'adminSubModules' | 'permissionGrants' | 'effectivePermissions'> | null | undefined,
) => {
  const canEditEmployeeByGrant = (employee: Pick<Employee, 'departmentId' | 'userId'> | null | undefined): boolean =>
    canPerform(user, HRM_EMPLOYEE_EDIT_PERMISSION, getHrmEmployeeRecordScope(employee, user?.id));

  return {
    canViewEmployees: canViewRoute(user, '/hrm/employees'),
    canCreateEmployee: canPerform(user, HRM_EMPLOYEE_CREATE_PERMISSION),
    canEditAnyEmployee: canPerform(user, HRM_EMPLOYEE_EDIT_PERMISSION),
    canEditEmployeeByGrant,
    canEditEmployee: (employee: Pick<Employee, 'departmentId' | 'userId'> | null | undefined): boolean =>
      canEditEmployeeByGrant(employee) || isOwnEmployeeRecord(user, employee),
  };
};
