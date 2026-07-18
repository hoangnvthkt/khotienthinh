import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPermissionGrant } from '../../types';

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: supabaseMock,
}));

import {
  authorizationGovernanceService,
  buildAssignBusinessRoleRpcArgs,
  buildOverrideRpcArgs,
  buildPreviewAuthorizationChangeRpcArgs,
  buildPreviewBusinessRoleAssignmentRpcArgs,
  mapEffectivePermissionSource,
} from '../permissions/authorizationGovernanceService';
import {
  applyUserPermissionChange,
  buildDirectGrantReplacementPayload,
  previewUserPermissionChange,
  replaceUserPermissionGrants,
} from '../permissions/permissionAdminService';

describe('authorization governance service contracts', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.from.mockReset();
  });

  it('maps source explanation rows without losing scope/time/risk', () => {
    expect(mapEffectivePermissionSource({
      permission_code: 'project.daily_log.approve',
      source_type: 'ROLE',
      source_id: 'assignment-1',
      source_code: 'PROJECT_APPROVER',
      source_label: 'Project Approver',
      scope_type: 'project',
      scope_id: 'project-1',
      starts_at: '2026-07-17T00:00:00Z',
      expires_at: null,
      risk_level: 'sensitive',
      is_business_approval: true,
      metadata: { roleTemplateId: 'role-1' },
    })).toMatchObject({
      permissionCode: 'project.daily_log.approve',
      sourceType: 'ROLE',
      sourceCode: 'PROJECT_APPROVER',
      scopeType: 'project',
      scopeId: 'project-1',
      startsAt: '2026-07-17T00:00:00Z',
      expiresAt: null,
      riskLevel: 'sensitive',
      isBusinessApproval: true,
      metadata: { roleTemplateId: 'role-1' },
    });
  });

  it('never sends an actor field in browser RPC payloads', () => {
    const assignmentArgs = buildAssignBusinessRoleRpcArgs({
      targetUserId: 'user-1', roleTemplateId: 'role-1',
      scopeType: 'project', scopeId: 'project-1',
      startsAt: '2026-07-17T00:00:00Z', expiresAt: null,
      reason: '  Phân công vai trò dự án  ', warningAcceptances: [],
    });
    const overrideArgs = buildOverrideRpcArgs({
      ruleCode: 'WORKFLOW_CONTROLLED_EXCEPTION',
      subjectType: 'workflow_subject', subjectId: 'subject-1',
      scopeType: 'project', scopeId: 'project-1',
      reason: '  Xử lý ngoại lệ có owner giám sát  ',
      controlOwnerUserId: 'auditor-1',
      expiresAt: '2026-07-18T00:00:00Z',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    const previewArgs = buildPreviewAuthorizationChangeRpcArgs({
      targetUserId: 'user-1',
      proposedPermissionCodes: ['project.daily_log.approve'],
      scopeType: 'project', scopeId: 'project-1',
      changeMode: 'ADD',
    });
    const rolePreviewArgs = buildPreviewBusinessRoleAssignmentRpcArgs({
      targetUserId: 'user-1', roleTemplateId: 'role-1',
      scopeType: 'project', scopeId: 'project-1',
    });

    expect(assignmentArgs.p_reason).toBe('Phân công vai trò dự án');
    expect(overrideArgs.p_reason).toBe('Xử lý ngoại lệ có owner giám sát');
    expect(previewArgs.p_change_mode).toBe('ADD');
    for (const args of [assignmentArgs, overrideArgs, previewArgs, rolePreviewArgs]) {
      expect(Object.keys(args).some(key => /actor/i.test(key))).toBe(false);
    }
  });

  it('previews the exact normalized active direct-grant replacement payload in one RPC', async () => {
    const grants: UserPermissionGrant[] = [
      {
        id: 'active', userId: 'user-1', permissionCode: 'project.daily_log.approve',
        scopeType: 'project', scopeId: 'project-1', isActive: true,
        expiresAt: '2026-08-01T00:00:00Z',
      },
      {
        id: 'inactive', userId: 'user-1', permissionCode: 'project.daily_log.verify',
        scopeType: 'project', scopeId: 'project-1', isActive: false,
      },
    ];
    const payload = buildDirectGrantReplacementPayload(grants);
    supabaseMock.rpc.mockResolvedValueOnce({
      data: { hardDenies: [], warnings: [] },
      error: null,
    });

    await expect(authorizationGovernanceService.previewDirectGrantReplacement('user-1', grants))
      .resolves.toEqual({ hardDenies: [], warnings: [] });

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('preview_direct_grant_replacement', {
      p_user_id: 'user-1',
      p_grants: payload,
    });
    expect(Object.keys(supabaseMock.rpc.mock.calls[0][1]).some(key => /actor/i.test(key))).toBe(false);

    supabaseMock.rpc.mockReset();
    supabaseMock.rpc.mockResolvedValueOnce({ data: null, error: null });
    await replaceUserPermissionGrants('user-1', grants, {
      reason: '  Điều chỉnh quyền trực tiếp theo nhiệm vụ  ',
      warningAcceptances: [],
    });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('replace_user_permission_grants_v2', {
      p_user_id: 'user-1',
      p_grants: payload,
      p_reason: 'Điều chỉnh quyền trực tiếp theo nhiệm vụ',
      p_warning_acceptances: [],
    });
  });

  it('previews and applies one actor-free unified permission payload', async () => {
    const legacyState = {
      allowedModules: ['DA'],
      allowedSubModules: { DA: ['/da/tabs/dailylog'] },
      adminModules: [],
      adminSubModules: {},
    };
    const grants: UserPermissionGrant[] = [{
      userId: 'user-1',
      permissionCode: 'project.daily_log.view',
      scopeType: 'project',
      scopeId: 'project-1',
    }];
    const preview = {
      beforeFingerprint: 'before-1',
      decision: { hardDenies: [], warnings: [] },
      legacyBefore: legacyState,
      legacyAfter: legacyState,
    };
    supabaseMock.rpc
      .mockResolvedValueOnce({ data: preview, error: null })
      .mockResolvedValueOnce({
        data: { ...preview, afterFingerprint: 'after-1', directAfter: grants },
        error: null,
      });

    await previewUserPermissionChange('user-1', legacyState, grants);
    await applyUserPermissionChange('user-1', 'before-1', legacyState, grants, {
      reason: '  Cập nhật quyền nhật ký dự án  ',
      warningAcceptances: [],
    });

    expect(supabaseMock.rpc.mock.calls[0]).toEqual([
      'preview_user_permission_change',
      {
        p_user_id: 'user-1',
        p_legacy_state: legacyState,
        p_grants: buildDirectGrantReplacementPayload(grants),
      },
    ]);
    expect(supabaseMock.rpc.mock.calls[1]).toEqual([
      'apply_user_permission_change',
      {
        p_user_id: 'user-1',
        p_expected_fingerprint: 'before-1',
        p_legacy_state: legacyState,
        p_grants: buildDirectGrantReplacementPayload(grants),
        p_reason: 'Cập nhật quyền nhật ký dự án',
        p_warning_acceptances: [],
      },
    ]);
    for (const [, args] of supabaseMock.rpc.mock.calls) {
      expect(Object.keys(args).some(key => /actor/i.test(key))).toBe(false);
    }
  });
});
