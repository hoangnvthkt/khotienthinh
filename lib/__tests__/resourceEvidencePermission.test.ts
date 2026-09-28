import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_ROOM_ACTION_CODES,
  getProjectPermissionRoom,
  getProjectPermissionRoomActionLabel,
  isRoomActionAllowed,
} from '../permissions/projectPermissionRooms';
import { getPaymentPermissionCodesForEffectiveRoomActions } from '../permissions/projectRoomEffectiveActions';
import { PROJECT_PERMISSION_MODULES } from '../permissions/projectPermissionRegistry';

describe('resource evidence view permission', () => {
  it('provides a distinct read-only Payment Room action, not generic payment view', () => {
    expect(PROJECT_ROOM_ACTION_CODES).toContain('view_resource_evidence');
    expect(getProjectPermissionRoom('payment')?.actions).toContain('view_resource_evidence');
    expect(getProjectPermissionRoomActionLabel('payment', 'view_resource_evidence')).toBe('Xem bằng chứng nguồn lực');
    expect(isRoomActionAllowed('daily_log', 'view_resource_evidence')).toBe(false);
    expect(getProjectPermissionRoom('payment')?.actionPrerequisites.view_resource_evidence).toBeUndefined();
    expect(getPaymentPermissionCodesForEffectiveRoomActions(['view'])).toEqual([]);
    expect(getPaymentPermissionCodesForEffectiveRoomActions(['view_resource_evidence']))
      .toEqual(['project.payment.view_resource_evidence']);
  });

  it('registers the permission without a payment mutation capability', () => {
    const permission = PROJECT_PERMISSION_MODULES
      .find(module => module.code === 'project.payment')?.actions
      .find(action => action.permissionCode === 'project.payment.view_resource_evidence');
    expect(permission).toMatchObject({ label: 'Xem bằng chứng nguồn lực' });
  });

  it('declares a sensitive, expiry-bound, audit-only binding', () => {
    const sql = readFileSync('supabase/migrations/20260925160000_resource_evidence_permission.sql', 'utf8');
    expect(sql).toContain('project.payment.view_resource_evidence');
    expect(sql).toContain("'view_resource_evidence'");
    expect(sql).toContain("'audit_only'");
    expect(sql).not.toContain('project.payment.view_cost');
    expect(sql).not.toContain('project.payment.reconcile_resource_cost');
  });
});
