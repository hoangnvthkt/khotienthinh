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

  it('loads the current actor effective actions with their authorization source', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [
        {
          room_code: 'daily_log',
          action_code: 'edit',
          authorization_source: 'room',
          enforcement_status: 'pilot',
        },
        {
          room_code: 'material_planning',
          action_code: 'delete',
          authorization_source: 'pbac_fallback',
          enforcement_status: 'pilot',
        },
      ],
      error: null,
    });

    const actions = await projectPermissionRoomService.listMyActions('project-1', 'site-1');

    expect(actions).toEqual([
      {
        roomCode: 'daily_log', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot',
      },
      {
        roomCode: 'material_planning', actionCode: 'delete', source: 'pbac_fallback', enforcementStatus: 'pilot',
      },
    ]);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_my_project_room_actions', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
    });
  });

  it('loads Room enforcement metadata and scoped fallback counts', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: [{
          code: 'material_planning',
          group_code: 'material',
          name: 'Kế hoạch & BOQ vật tư',
          description: 'Quản lý BOQ',
          allowed_actions: ['view', 'edit', 'delete'],
          required_actions: [],
          action_enforcement_statuses: { view: 'pilot', edit: 'pilot', delete: 'pilot' },
          fallback_only_user_count: 2,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const rooms = await projectPermissionRoomService.listRooms('project-1', 'site-1');

    expect(rooms[0]).toEqual(expect.objectContaining({
      actionEnforcement: { view: 'pilot', edit: 'pilot', delete: 'pilot' },
      fallbackOnlyUserCount: 2,
    }));
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'list_project_permission_rooms', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
    });
  });

  it('loads broad PBAC exceptions through the centralized Room audit RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [
        { room_code: 'daily_log', permission_code: 'project.daily_log.edit_all' },
        { room_code: 'daily_log', permission_code: 'project.daily_log.delete_all' },
      ],
      error: null,
    });

    const exceptions = await projectPermissionRoomService.listMyPbacExceptions('project-1', 'site-1');

    expect(exceptions).toEqual([
      { roomCode: 'daily_log', permissionCode: 'project.daily_log.edit_all' },
      { roomCode: 'daily_log', permissionCode: 'project.daily_log.delete_all' },
    ]);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_my_project_room_pbac_exceptions', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
    });
  });

  it('loads candidate PBAC exceptions even before the user joins the Room', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: [{
          project_staff_id: 'staff-1',
          user_id: 'user-1',
          user_name: 'Phạm Ngọc Sơn',
          legacy_permission_codes: ['project.material_po.manage'],
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const candidates = await projectPermissionRoomService.listCandidates(
      'project-1', 'site-1', 'material_po',
    );

    expect(candidates[0]).toEqual(expect.objectContaining({
      isRoomMember: false,
      legacyPermissionCodes: ['project.material_po.manage'],
    }));
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'list_project_room_staff_candidates', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_room_code: 'material_po',
    });
  });
});
