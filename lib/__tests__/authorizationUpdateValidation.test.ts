import { describe, expect, it } from 'vitest';
import { PermissionAdminCatalog } from '../permissions/permissionTypes';
import {
  mapAuthorizationRpcError,
  validateAuthorizationUpdate,
} from '../permissions/authorizationUpdateValidation';

const catalog: PermissionAdminCatalog = {
  generatedAt: '2026-09-11T00:00:00.000Z',
  applications: [{
    code: 'asset',
    label: 'Tài sản',
    sortOrder: 10,
    hasDefaultViewBundle: true,
    modules: [{
      code: 'asset.assignment',
      label: 'Cấp phát',
      sortOrder: 10,
      actions: [{
        action: 'view',
        label: 'Xem',
        permissionCode: 'asset.assignment.view',
        scopeTypes: ['global'],
        sortOrder: 10,
        riskLevel: 'normal',
        grantReadiness: 'enforced',
        directGrantAllowed: true,
        directGrantRequiresExpiry: false,
        isDefaultView: true,
        defaultScopeType: 'global',
      }, {
        action: 'approve',
        label: 'Duyệt',
        permissionCode: 'asset.assignment.approve',
        scopeTypes: ['global'],
        sortOrder: 20,
        riskLevel: 'sensitive',
        grantReadiness: 'enforced',
        directGrantAllowed: true,
        directGrantRequiresExpiry: true,
        isDefaultView: false,
      }],
    }],
  }],
};

const viewGrant = {
  userId: 'user-1',
  permissionCode: 'asset.assignment.view',
  scopeType: 'global' as const,
  scopeId: '*',
  isActive: true,
};

describe('authorization update validation', () => {
  const now = new Date('2026-09-11T08:00:00.000Z');

  it('requires at least ten trimmed characters only when there are changes', () => {
    expect(validateAuthorizationUpdate({ changed: true, reason: 'Cấp TS', grants: [viewGrant], catalog, now }))
      .toContainEqual(expect.objectContaining({ field: 'reason', code: 'reason_too_short' }));
    expect(validateAuthorizationUpdate({ changed: false, reason: '', grants: [viewGrant], catalog, now }))
      .toEqual([]);
  });

  it('rejects an expiry-required action without a future expiry', () => {
    const issues = validateAuthorizationUpdate({
      changed: true,
      reason: 'Cấp quyền tài sản',
      grants: [{ ...viewGrant, permissionCode: 'asset.assignment.approve' }],
      catalog,
      now,
    });
    expect(issues).toContainEqual(expect.objectContaining({
      permissionCode: 'asset.assignment.approve',
      field: 'expiresAt',
      code: 'expiry_required',
    }));
  });

  it('rejects duplicate grant keys and unknown permissions', () => {
    const issues = validateAuthorizationUpdate({
      changed: true,
      reason: 'Cập nhật quyền tài sản',
      grants: [viewGrant, { ...viewGrant }, { ...viewGrant, permissionCode: 'unknown.view' }],
      catalog,
      now,
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'duplicate_grant' }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown_permission', permissionCode: 'unknown.view' }));
  });

  it('maps PostgreSQL JSON details to an actionable command error', () => {
    const error = mapAuthorizationRpcError({
      code: '23514',
      message: 'Invalid direct permission grant',
      details: JSON.stringify({
        code: 'expiry_required',
        permissionCode: 'asset.assignment.approve',
        field: 'expiresAt',
        message: 'Quyền Duyệt cần ngày hết hạn trong tương lai.',
      }),
    });
    expect(error).toMatchObject({
      code: 'expiry_required',
      permissionCode: 'asset.assignment.approve',
      field: 'expiresAt',
      message: 'Quyền Duyệt cần ngày hết hạn trong tương lai.',
    });
  });
});
