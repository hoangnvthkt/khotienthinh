import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { ToastProvider } from '../../context/ToastContext';
import UserModal from '../../components/UserModal';
import SettingsUsers from '../../pages/settings/SettingsUsers';
import {
  canEditUserAuthorization,
  canManageUserAccountOf,
  canManageUserAccounts,
} from '../settingsPermissions';

const person = (id: string, role: Role, ...permissionCodes: string[]): User => ({
  id,
  name: id,
  email: `${id}@invalid.local`,
  role,
  permissionGrants: permissionCodes.map(permissionCode => ({
    userId: id, permissionCode, scopeType: 'global', scopeId: '*', isActive: true,
  })),
});

const admin = person('admin', Role.ADMIN, 'system.authorization.manage_grants');
const giang = person('giang', Role.EMPLOYEE, 'settings.users.manage');
const viewer = person('viewer', Role.EMPLOYEE, 'settings.users.view');
const staff = person('staff', Role.EMPLOYEE);

const renderModal = (props: Partial<React.ComponentProps<typeof UserModal>>) => renderToStaticMarkup(
  <ToastProvider>
    <UserModal isOpen onClose={() => {}} onSave={() => {}} onAuthorizationSaved={() => {}} warehouses={[]} {...props} />
  </ToastProvider>,
);

const renderUsers = (currentUser: User) => renderToStaticMarkup(
  <MemoryRouter>
    <ToastProvider>
      <SettingsUsers
        users={[admin, giang, viewer, staff]} currentUser={currentUser} warehouses={[]}
        isUserModalOpen={false} setIsUserModalOpen={() => {}} editingUser={null}
        accountTarget={null} accountAction="DISABLE" closeAccountAction={() => {}}
        openAccountAction={() => {}} handleAccountAction={() => {}}
        handleAddUser={() => {}} handleEditUser={() => {}} handleSaveUser={() => {}}
        onAuthorizationSaved={() => {}} getRoleBadge={role => <span>{role}</span>}
      />
    </ToastProvider>
  </MemoryRouter>,
);

describe('Cài đặt → Người dùng: Quản lý tài khoản (Đợt 2a-2)', () => {
  it('separates account management from permission editing', () => {
    expect(canManageUserAccounts(admin)).toBe(true);
    expect(canManageUserAccounts(giang)).toBe(true);
    expect(canManageUserAccounts(viewer)).toBe(false);
    expect(canEditUserAuthorization(admin)).toBe(true);
    expect(canEditUserAuthorization(giang)).toBe(false);
  });

  it('keeps Admin accounts and one\'s own account out of reach of an account manager', () => {
    expect(canManageUserAccountOf(giang, staff)).toBe(true);
    expect(canManageUserAccountOf(giang, admin)).toBe(false);
    expect(canManageUserAccountOf(giang, giang)).toBe(false);
    expect(canManageUserAccountOf(admin, admin)).toBe(false);
    expect(canManageUserAccountOf(admin, giang)).toBe(true);
    expect(canManageUserAccountOf(viewer, staff)).toBe(false);
  });

  it('offers the administrator type only to an Admin when creating an account', () => {
    const forAdmin = renderModal({ canAssignAdminRole: true, canGrantPermissions: true });
    expect(forAdmin).toContain('Quản trị viên');
    expect(forAdmin).toContain('mở lại người này để cấp quyền');

    const forGiang = renderModal({ canAssignAdminRole: false, canGrantPermissions: false });
    expect(forGiang).not.toContain('Quản trị viên');
    expect(forGiang).toContain('Tài khoản thường');
    expect(forGiang).toContain('Admin cấp quyền sau');
    expect(forGiang).not.toContain('mở lại người này để cấp quyền');
  });

  it('shows "Thêm tài khoản" to Admin and account managers only', () => {
    expect(renderUsers(admin)).toContain('Thêm tài khoản');
    expect(renderUsers(giang)).toContain('Thêm tài khoản');
    expect(renderUsers(viewer)).not.toContain('Thêm tài khoản');
  });

  it('gates the row menu and the detail panel by the same rules', () => {
    const source = readFileSync(join(process.cwd(), 'pages/settings/SettingsUsers.tsx'), 'utf8');
    expect(source).toMatch(/\{canEditAuthorization && \(\s*<div[^>]*>\s*<p[^>]*>Phân vai trò tài khoản/);
    // The button opened right after the gate holds the label (stops at its own </button>).
    expect(source).toMatch(/\{canEditAuthorization && \(\s*<button(?:(?!<\/button>)[\s\S])*Chỉnh sửa thông tin cá nhân/);
    expect(source).toMatch(/\{canEditAuthorization && \(\s*<button(?:(?!<\/button>)[\s\S])*Chỉnh sửa & phân quyền/);
    expect(source).toContain('disabled={popoverAccountLocked}');
    expect(source).toContain('!canManageUserAccountOf(currentUser, selectedUserForPopover)');
    expect(source).toContain('canAssignAdminRole={currentUser.role === Role.ADMIN}');
    expect(source).toContain('canGrantPermissions={canEditAuthorization}');
  });

  it('does not write the new profile again from the browser', () => {
    const context = readFileSync(join(process.cwd(), 'context/AppContext.tsx'), 'utf8');
    const addUser = context.slice(context.indexOf('const addUser = async'), context.indexOf('const updateUser = async'));
    expect(addUser).not.toContain("syncToSupabase('users'");
    expect(addUser).toContain('refreshManagedUser(nextUser.id)');
  });
});
