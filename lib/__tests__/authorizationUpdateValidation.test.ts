import { describe, expect, it } from 'vitest';
import { PermissionAdminCatalog } from '../permissions/permissionTypes';
import {
  getCatalogEditableGrants,
  getRetainedHiddenGrants,
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

  it('retains Hà\'s unchanged hidden shell grants while validating a new catalog grant', () => {
    const retainedShellGrants = [
      'system.da.view',
      'system.hd.view',
      'system.rq.manage',
      'system.rq.view',
      'system.ts.view',
      'system.wf.manage',
      'system.wf.view',
      'system.wms.view',
    ].map(permissionCode => ({ ...viewGrant, permissionCode }));
    const issues = validateAuthorizationUpdate({
      changed: true,
      reason: 'Cấp quyền xem tài sản',
      originalGrants: retainedShellGrants,
      grants: [...retainedShellGrants, viewGrant],
      catalog,
      now,
    });

    expect(issues).toEqual([]);
  });

  it('still rejects a hidden shell grant when it is newly added or modified', () => {
    const shellGrant = {
      ...viewGrant,
      permissionCode: 'system.ts.view',
    };
    const newGrantIssues = validateAuthorizationUpdate({
      changed: true,
      reason: 'Thử thêm quyền hệ thống',
      originalGrants: [],
      grants: [shellGrant],
      catalog,
      now,
    });
    const modifiedGrantIssues = validateAuthorizationUpdate({
      changed: true,
      reason: 'Thử sửa quyền hệ thống',
      originalGrants: [shellGrant],
      grants: [{ ...shellGrant, expiresAt: '2026-12-01T00:00:00.000Z' }],
      catalog,
      now,
    });

    expect(newGrantIssues).toContainEqual(expect.objectContaining({
      code: 'unknown_permission',
      permissionCode: 'system.ts.view',
    }));
    expect(modifiedGrantIssues).toContainEqual(expect.objectContaining({
      code: 'unknown_permission',
      permissionCode: 'system.ts.view',
    }));
  });

  it('lists only unchanged hidden grants for read-only presentation', () => {
    const retainedShell = { ...viewGrant, permissionCode: 'system.ts.view' };
    const newlyPastedShell = { ...viewGrant, permissionCode: 'system.wms.view' };

    expect(getRetainedHiddenGrants({
      grants: [retainedShell, newlyPastedShell, viewGrant],
      originalGrants: [retainedShell],
      catalog,
    })).toEqual([retainedShell]);
  });

  it('keeps hidden shell grants out of editable clipboard grants', () => {
    const hiddenShell = { ...viewGrant, permissionCode: 'system.ts.view' };

    expect(getCatalogEditableGrants({
      grants: [hiddenShell, viewGrant],
      catalog,
    })).toEqual([viewGrant]);
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
