import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import { projectMasterService } from '../projectMasterService';

describe('projectMasterService Phase 3 RPC mutations', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('creates projects through the project master RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'project-1',
        code: 'PRJ-001',
        name: 'Dự án 001',
        project_type: 'construction',
        status: 'planning',
        source: 'manual',
      },
      error: null,
    });

    const project = await projectMasterService.create({
      code: 'PRJ-001',
      name: 'Dự án 001',
      createdBy: 'user-1',
    });

    expect(project.id).toBe('project-1');
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_project', {
      p_project: expect.objectContaining({
        code: 'PRJ-001',
        name: 'Dự án 001',
        created_by: 'user-1',
        source: 'manual',
      }),
    });
    expect(supabaseMocks.from).not.toHaveBeenCalled();
  });

  it('updates, pins, hides, and restores projects through project master RPCs', async () => {
    supabaseMocks.rpc
      .mockResolvedValueOnce({
        data: {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Dự án cập nhật',
          project_type: 'construction',
          status: 'active',
          source: 'manual',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Dự án cập nhật',
          project_type: 'construction',
          status: 'active',
          source: 'manual',
          is_pinned: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Dự án cập nhật',
          project_type: 'construction',
          status: 'active',
          source: 'manual',
          is_hidden: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'project-1',
          code: 'PRJ-001',
          name: 'Dự án cập nhật',
          project_type: 'construction',
          status: 'active',
          source: 'manual',
          is_hidden: false,
        },
        error: null,
      });

    await projectMasterService.update({
      id: 'project-1',
      code: 'PRJ-001',
      name: 'Dự án cập nhật',
      projectType: 'construction',
      status: 'active',
      source: 'manual',
    });
    await projectMasterService.setPinned('project-1', true, 'user-1');
    await projectMasterService.hide('project-1', {
      reason: 'Trùng dữ liệu',
      hiddenBy: 'user-1',
      force: true,
    });
    await projectMasterService.restore('project-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'update_project', {
      p_project_id: 'project-1',
      p_project: expect.objectContaining({
        code: 'PRJ-001',
        name: 'Dự án cập nhật',
      }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'update_project', {
      p_project_id: 'project-1',
      p_project: expect.objectContaining({
        is_pinned: true,
        pinned_by: 'user-1',
      }),
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(3, 'hide_project', {
      p_project_id: 'project-1',
      p_reason: 'Trùng dữ liệu',
      p_hidden_by: 'user-1',
      p_force: true,
      p_construction_site_id: null,
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(4, 'restore_project', {
      p_project_id: 'project-1',
    });
  });
});
