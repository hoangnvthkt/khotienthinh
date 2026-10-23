import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_MANAGER_REQUIRED,
  ACCOUNT_TARGET_ADMIN_ONLY,
  accountManagerDenial,
  parseAccountManagerAccess,
  resolveCreatedAccountRole,
} from '../../supabase/functions/_shared/accountManagerPolicy.ts';

const access = (canManageAccounts: boolean, targetRequiresAdmin: boolean | null) => ({ canManageAccounts, targetRequiresAdmin });

describe('Quản lý tài khoản (Edge Function, Đợt 2a-2)', () => {
  it('reads the RPC answer and fails closed on anything unexpected', () => {
    expect(parseAccountManagerAccess({ canManageAccounts: true, targetRequiresAdmin: false })).toEqual(access(true, false));
    expect(parseAccountManagerAccess({ canManageAccounts: true, targetRequiresAdmin: null })).toEqual(access(true, null));
    expect(parseAccountManagerAccess({ canManageAccounts: 'true', targetRequiresAdmin: 'false' })).toEqual(access(false, true));
    expect(parseAccountManagerAccess(null)).toEqual(access(false, null));
  });

  it('needs Admin or settings.users.manage', () => {
    expect(accountManagerDenial(access(false, null), { isAdmin: false, hasTarget: false })).toBe(ACCOUNT_MANAGER_REQUIRED);
    expect(accountManagerDenial(access(false, false), { isAdmin: false, hasTarget: true })).toBe(ACCOUNT_MANAGER_REQUIRED);
    expect(accountManagerDenial(access(true, null), { isAdmin: false, hasTarget: false })).toBeNull();
  });

  it('keeps administrator accounts for Admin only', () => {
    expect(accountManagerDenial(access(true, true), { isAdmin: false, hasTarget: true })).toBe(ACCOUNT_TARGET_ADMIN_ONLY);
    expect(accountManagerDenial(access(true, null), { isAdmin: false, hasTarget: true })).toBe(ACCOUNT_TARGET_ADMIN_ONLY);
    expect(accountManagerDenial(access(true, false), { isAdmin: false, hasTarget: true })).toBeNull();
    expect(accountManagerDenial(access(true, true), { isAdmin: true, hasTarget: true })).toBeNull();
  });

  it('creates only ordinary accounts for someone who is not an Admin', () => {
    expect(resolveCreatedAccountRole('ADMIN', false)).toBe('EMPLOYEE');
    expect(resolveCreatedAccountRole('WAREHOUSE_KEEPER', false)).toBe('EMPLOYEE');
    expect(resolveCreatedAccountRole('admin', true)).toBe('ADMIN');
    expect(resolveCreatedAccountRole('WAREHOUSE_KEEPER', true)).toBe('WAREHOUSE_KEEPER');
    expect(resolveCreatedAccountRole('OWNER', true)).toBe('EMPLOYEE');
    expect(resolveCreatedAccountRole(undefined, true)).toBe('EMPLOYEE');
  });
});
