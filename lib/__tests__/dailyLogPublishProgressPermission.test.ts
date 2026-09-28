import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDailyLogPermissionCodesForEffectiveRoomActions } from '../permissions/projectRoomEffectiveActions';
import {
  getProjectPermissionRoom,
  PROJECT_ROOM_ACTION_CODES,
} from '../permissions/projectPermissionRooms';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';

describe('Daily Log progress publication permission', () => {
  it('keeps publication separate from ordinary Daily Log approval', () => {
    expect(PROJECT_ROOM_ACTION_CODES).toContain('publish_progress');
    expect(getProjectPermissionRoom('daily_log')?.actions).toContain('publish_progress');
    expect(getDailyLogPermissionCodesForEffectiveRoomActions(['publish_progress']))
      .toEqual(['project.daily_log.publish_progress']);
    expect(getDailyLogPermissionCodesForEffectiveRoomActions(['approve']))
      .not.toContain('project.daily_log.publish_progress');
  });

  it('registers the sensitive publication action in the permission catalog', () => {
    const action = getPermissionModuleByCode('project.daily_log')?.actions
      .find(item => item.permissionCode === 'project.daily_log.publish_progress');

    expect(action).toMatchObject({
      action: 'publish_progress',
      label: 'Công bố tiến độ ngày',
    });
  });

  it('seeds an audit-only binding without broad member backfill', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260923091500_daily_log_publish_progress_permission.sql',
    ), 'utf8').toLowerCase();

    expect(sql).toContain('project.daily_log.publish_progress');
    expect(sql).toContain("'publish_progress'");
    expect(sql).toContain("'sensitive'");
    expect(sql).toContain('direct_grant_requires_expiry');
    expect(sql).toContain("'audit_only'");
    expect(sql).toContain('project_permission_rooms_allowed_actions_check');
    expect(sql).toContain('project_permission_room_member_actions_code_check');
    expect(sql).not.toContain('insert into public.project_permission_room_member_actions');
  });

  it('keeps the Project V2 return action in both Room constraints', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260923091500_daily_log_publish_progress_permission.sql',
    ), 'utf8').toLowerCase();

    const roomActions = sql.match(/project_permission_rooms_allowed_actions_check[\s\S]*?array\[([\s\S]*?)\]::text\[\]/)?.[1];
    const memberActions = sql.match(/project_permission_room_member_actions_code_check[\s\S]*?array\[([\s\S]*?)\]::text\[\]/)?.[1];
    expect(roomActions).toContain("'return'");
    expect(memberActions).toContain("'return'");
  });
});
