import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Role, type User, type UserPermissionGrant } from '../../types';
import { buildHrmEmployeeActionPolicy } from '../permissions/hrmPermissionCapabilities';
import { canPerform, canViewRoute } from '../permissions/permissionService';

const userWith = (
  permissionCodes: string[],
  scopeType: UserPermissionGrant['scopeType'] = 'global',
): User => ({
  id: 'user-1',
  name: 'Member',
  email: 'member@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: 'user-1',
    permissionCode,
    scopeType,
    scopeId: scopeType === 'global' ? '*' : 'dept-1',
  })),
});

describe('HRM permission gateway', () => {
  it('requires HRM employee view to open employee routes', () => {
    expect(canViewRoute(userWith([]), '/hrm/employees')).toBe(false);
    expect(canViewRoute(userWith(['hrm.employee.view']), '/hrm/employees')).toBe(true);
  });

  it('requires create and edit actions for employee mutations', () => {
    expect(canPerform(userWith(['hrm.employee.view']), 'hrm.employee.create')).toBe(false);
    expect(canPerform(userWith(['hrm.employee.view', 'hrm.employee.create']), 'hrm.employee.create')).toBe(true);
    expect(canPerform(userWith(['hrm.employee.view']), 'hrm.employee.edit')).toBe(false);
    expect(canPerform(userWith(['hrm.employee.view', 'hrm.employee.edit']), 'hrm.employee.edit')).toBe(true);
  });

  it('respects department scope for HRM actions', () => {
    const actor = userWith(['hrm.employee.view', 'hrm.employee.edit'], 'department');
    expect(canPerform(actor, 'hrm.employee.edit', { scopeType: 'department', scopeId: 'dept-1' })).toBe(true);
    expect(canPerform(actor, 'hrm.employee.edit', { scopeType: 'department', scopeId: 'dept-2' })).toBe(false);
  });

  it('does not treat HRM employee edit as delete during the legacy transition', () => {
    const directEditor = userWith(['hrm.employee.view', 'hrm.employee.edit']);
    expect(buildHrmEmployeeActionPolicy(directEditor).canDeleteEmployee(null)).toBe(false);

    const legacyHrmAdmin = {
      ...userWith([]),
      adminModules: ['HRM'],
    };
    expect(buildHrmEmployeeActionPolicy(legacyHrmAdmin).canDeleteEmployee(null)).toBe(true);
  });

  it('gates HRM employee UI with explicit action permissions instead of broad route management', () => {
    const employeesPage = readFileSync(join(process.cwd(), 'pages/hrm/Employees.tsx'), 'utf8');
    const detailModal = readFileSync(join(process.cwd(), 'components/hrm/EmployeeDetailModal.tsx'), 'utf8');
    const capabilities = readFileSync(join(process.cwd(), 'lib/permissions/hrmPermissionCapabilities.ts'), 'utf8');

    expect(employeesPage).toContain('buildHrmEmployeeActionPolicy');
    expect(employeesPage).toContain('HRM_EMPLOYEE_CREATE_PERMISSION');
    expect(employeesPage).toContain('HRM_EMPLOYEE_EDIT_PERMISSION');
    expect(capabilities).toContain("'hrm.employee.create'");
    expect(capabilities).toContain("'hrm.employee.edit'");
    expect(capabilities).toContain("'hrm.employee.delete'");
    expect(employeesPage).not.toContain("canCRUD = canManage('/hrm/employees')");
    expect(employeesPage).not.toContain('canDeleteEmployee = (emp: Employee) => employeeActionPolicy.canEditEmployeeByGrant(emp)');
    expect(detailModal).toContain('buildHrmEmployeeActionPolicy');
    expect(detailModal).not.toContain("canCRUD = canManage('/hrm/employees')");
  });

  it('guards HRM employee create and edit handlers in AppContext', () => {
    const appContext = readFileSync(join(process.cwd(), 'context/AppContext.tsx'), 'utf8');

    expect(appContext).toContain('assertHrmEmployeePermission');
    expect(appContext).toContain("'hrm.employee.create'");
    expect(appContext).toContain("'hrm.employee.edit'");
    expect(appContext).toContain('canDeleteHrmEmployeeRecord');
  });
});
