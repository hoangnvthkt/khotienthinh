import { describe, expect, it } from 'vitest';
import {
  buildUserAccountLifecyclePayload,
  normalizeUserAccountLifecyclePreview,
} from '../userAccountLifecycleService';

describe('buildUserAccountLifecyclePayload', () => {
  it('normalizes a disable command without a password', () => {
    expect(buildUserAccountLifecyclePayload({
      action: 'DISABLE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: '  Nhân viên nghỉ việc  ',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      action: 'DISABLE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Nhân viên nghỉ việc',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('keeps the new password only for reactivation', () => {
    expect(buildUserAccountLifecyclePayload({
      action: 'REACTIVATE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Nhân viên quay lại',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      newPassword: 'temporary-strong-password',
    })).toMatchObject({
      action: 'REACTIVATE',
      newPassword: 'temporary-strong-password',
    });
  });

  it('normalizes numeric preview counts and retry metadata', () => {
    expect(normalizeUserAccountLifecyclePreview({
      targetUserId: '11111111-1111-4111-8111-111111111111',
      accountStatus: 'DISABLED',
      operationStatus: 'AUTH_RETRY',
      operationAction: 'DISABLE',
      hasAuthIdentity: true,
      directGrants: '2',
      legacyModules: 1,
      projectStaffAssignments: 3,
      responsibilitySlots: 1,
      runtimeAssignments: 4,
    })).toMatchObject({
      operationStatus: 'AUTH_RETRY',
      operationAction: 'DISABLE',
      directGrants: 2,
      needsReassignment: 5,
    });
  });
});
