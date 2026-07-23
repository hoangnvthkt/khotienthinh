import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { rpc: supabaseMocks.rpc },
}));

import { projectPermissionRoomService } from '../projectPermissionRoomService';

describe('projectPermissionRoomService', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
  });

  it('replaces a Room in one batch using the Room-scoped action payload', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null });

    await projectPermissionRoomService.replaceMembers('project-1', 'site-1', 'material_po', [{
      staffId: 'staff-1',
      actionCodes: ['approve'],
    }]);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('replace_project_permission_room_members', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_room_code: 'material_po',
      p_members: [{ project_staff_id: 'staff-1', action_codes: ['approve'] }],
    });
  });

  it('reads recipients from the exact Room and action only', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [{ project_staff_id: 'staff-1', user_id: 'user-1', user_name: 'Nguyễn Văn A' }],
      error: null,
    });

    const recipients = await projectPermissionRoomService.listRecipients(
      'project-1', 'site-1', 'daily_log', 'approve',
    );

    expect(recipients).toEqual([expect.objectContaining({
      id: 'staff-1', userId: 'user-1', userName: 'Nguyễn Văn A',
    })]);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_project_room_action_recipients', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_room_code: 'daily_log',
      p_action_code: 'approve',
    });
  });

  it('rejects an action outside the selected Room before calling Supabase', async () => {
    await expect(projectPermissionRoomService.replaceMembers('project-1', null, 'material_planning', [{
      staffId: 'staff-1',
      actionCodes: ['approve'],
    }])).rejects.toThrow('không hợp lệ');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });
});
