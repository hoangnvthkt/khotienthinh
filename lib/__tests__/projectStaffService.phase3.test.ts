import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

vi.mock('../auditService', () => ({
  auditService: {
    log: vi.fn(),
  },
}));

import { projectStaffService } from '../projectStaffService';

describe('projectStaffService Phase 3 explicit action helpers', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('manages project staff assignments through Phase 3 assignment RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: 'staff-1', error: null })
      .mockResolvedValueOnce({ data: 'staff-1', error: null })
      .mockResolvedValueOnce({ data: { id: 'staff-1', end_date: '2026-07-12' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'staff-1' }, error: null });

    const staffId = await projectStaffService.add({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      userId: 'user-1',
      positionId: 'position-1',
      permissionTypeIds: [],
      startDate: '2026-07-01',
      note: 'Chỉ huy trưởng',
      grantedBy: 'admin-1',
      operatorName: 'Admin',
    });
    await projectStaffService.update('staff-1', {
      positionId: 'position-2',
      startDate: '2026-07-02',
      note: 'Cập nhật',
    }, 'admin-1', 'Admin');
    await projectStaffService.update('staff-1', {
      endDate: '2026-07-12',
    }, 'admin-1', 'Admin');
    await projectStaffService.remove('staff-1', 'admin-1', 'Admin');

    expect(staffId).toBe('staff-1');
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'upsert_project_staff_assignment', {
      p_staff: expect.objectContaining({
        project_id: 'project-1',
        construction_site_id: 'site-1',
        user_id: 'user-1',
        position_id: 'position-1',
        start_date: '2026-07-01',
        note: 'Chỉ huy trưởng',
      }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'upsert_project_staff_assignment', {
      p_staff: expect.objectContaining({
        id: 'staff-1',
        position_id: 'position-2',
        start_date: '2026-07-02',
        note: 'Cập nhật',
      }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(3, 'end_project_staff_assignment', {
      p_staff_id: 'staff-1',
      p_end_date: '2026-07-12',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(4, 'remove_project_staff_assignment', {
      p_staff_id: 'staff-1',
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('rejects legacy permission type ids before creating a staff assignment', async () => {
    await expect(projectStaffService.add({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      userId: 'user-1',
      positionId: 'position-1',
      permissionTypeIds: ['legacy-view'],
      startDate: '2026-07-01',
    })).rejects.toThrow('Project PBAC v2 grants');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('loads Project Org capabilities from explicit namespaced permission checks', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    const capabilities = await projectStaffService.getProjectOrgCapabilities({
      userId: 'user-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    });

    expect(capabilities).toEqual({
      canView: true,
      canAssignStaff: true,
      canGrantPermissions: false,
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'project_has_permission_v2', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_permission_code: 'project.org.view',
      p_user_id: 'user-1',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'project_has_permission_v2', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_permission_code: 'project.org.assign_staff',
      p_user_id: 'user-1',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(3, 'project_has_permission_v2', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_permission_code: 'project.org.grant_permissions',
      p_user_id: 'user-1',
    });
  });

  it('checks a namespaced project action through the backend RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await projectStaffService.checkProjectAction({
      userId: 'user-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      permissionCode: 'project.payment.mark_paid',
    });

    expect(result.allowed).toBe(true);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('project_has_permission_v2', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_permission_code: 'project.payment.mark_paid',
      p_user_id: 'user-1',
    });
  });

  it('requires a namespaced project action and throws without no-PBAC mutation fallback', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(projectStaffService.requireProjectAction({
      userId: 'user-1',
      projectId: 'project-1',
      permissionCode: 'project.daily_log.verify',
      actionLabel: 'xác nhận nhật ký',
    })).rejects.toThrow('Bạn cần quyền "project.daily_log.verify" để xác nhận nhật ký.');
  });

  it('lists recipients by namespaced permission codes through the backend RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [{
        staff_id: 'staff-1',
        project_id: 'project-1',
        construction_site_id: 'site-1',
        user_id: 'user-1',
        user_name: 'Nguyễn Văn A',
        position_id: 'position-1',
        position_name: 'Chỉ huy trưởng',
        permission_codes: ['project.daily_log.verify'],
      }],
      error: null,
    });

    const rows = await projectStaffService.listProjectStaffWithPermissionCodes(
      'project-1',
      'site-1',
      ['project.daily_log.verify'],
    );

    expect(rows).toEqual([expect.objectContaining({
      id: 'staff-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      userId: 'user-1',
      userName: 'Nguyễn Văn A',
      positionId: 'position-1',
      positionName: 'Chỉ huy trưởng',
    })]);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_project_permission_recipients', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_permission_codes: ['project.daily_log.verify'],
    });
  });
});
