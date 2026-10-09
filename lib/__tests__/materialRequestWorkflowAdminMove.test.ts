import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getProjectPermissionRoom,
  getProjectPermissionRoomActionLabel,
  isRoomActionAllowed,
} from '../permissions/projectPermissionRooms';
import { getMaterialRequestEffectiveCapabilities } from '../permissions/projectRoomEffectiveActions';

const grant = (actionCode: string) => ({ roomCode: 'material_request', actionCode }) as any;

describe('material request workflow admin move step', () => {
  it('offers manage only in the material request room', () => {
    expect(getProjectPermissionRoom('material_request')?.actions).toContain('manage');
    expect(isRoomActionAllowed('material_po', 'manage')).toBe(false);
    expect(getProjectPermissionRoomActionLabel('material_request', 'manage')).toBe('Quản trị quy trình duyệt');
  });

  it('requires room view and does not leak into approve', () => {
    expect(getMaterialRequestEffectiveCapabilities([grant('manage')]).canManageWorkflow).toBe(false);
    const both = getMaterialRequestEffectiveCapabilities([grant('view'), grant('manage')]);
    expect(both.canManageWorkflow).toBe(true);
    expect(both.canApproveMaterialRequest).toBe(false);
  });

  it('guards the RPC with the manage room action and a mandatory reason', () => {
    const sql = readFileSync(
      'supabase/migrations/20261008105659_material_request_workflow_admin_move_step.sql',
      'utf8',
    );
    expect(sql).toContain("'material_request', 'manage'");
    expect(sql).toContain('Bắt buộc nhập lý do khi chuyển bước.');
    expect(sql).toContain("'ADMIN_MOVED'");
  });
});
