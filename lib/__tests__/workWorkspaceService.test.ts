import { describe, expect, it, vi } from 'vitest';
import {
  createWorkWorkspaceService,
  mapWorkWorkspaceError,
  type CreateWorkWorkspaceInput,
} from '../work/workWorkspaceService';

const input: CreateWorkWorkspaceInput = {
  kind: 'department',
  name: 'Phòng Quản lý dự án',
  departmentId: 'department-1',
  iconKey: 'building',
  colorKey: 'blue',
  coverKey: 'blueprint',
};

const page = { items: [], nextCursor: null };

describe('Work Workspace service', () => {
  it('uses the guarded RPCs and bounded reader limits', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    const service = createWorkWorkspaceService({ rpc } as any);

    await service.list('Dự án', 'department', { sortAt: '2026-09-07T00:00:00Z', id: 'w-1' }, true, 'recent');
    expect(rpc).toHaveBeenNthCalledWith(1, 'list_my_work_workspaces', {
      p_search: 'Dự án',
      p_kind: 'department',
      p_cursor: { sortAt: '2026-09-07T00:00:00Z', id: 'w-1' },
      p_pinned_only: true,
      p_sort: 'recent',
      p_limit: 24,
    });

    await service.members('workspace-1', 'An', { sortAt: '2026-09-06T00:00:00Z', id: 'u-1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'list_work_workspace_members', {
      p_workspace_id: 'workspace-1',
      p_search: 'An',
      p_cursor: { sortAt: '2026-09-06T00:00:00Z', id: 'u-1' },
      p_limit: 30,
    });

    await service.sources('project', 'Pilot');
    expect(rpc).toHaveBeenNthCalledWith(3, 'list_work_workspace_sources', {
      p_kind: 'project',
      p_search: 'Pilot',
      p_cursor: null,
      p_limit: 50,
    });
  });

  it('sends create, preview, apply, command, recovery and preference contracts exactly', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { lockVersion: 2 },
      error: null,
    });
    const service = createWorkWorkspaceService({ rpc } as any);
    const changes = [{ operation: 'set_role' as const, userId: 'user-2', role: 'member' as const }];
    const preview = { fingerprint: 'fp-1', changes, blockers: [] };

    await service.create(input, 'create-key');
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_work_workspace', {
      p_input: input,
      p_key: 'create-key',
    });

    await service.previewMembers('workspace-1', changes);
    expect(rpc).toHaveBeenNthCalledWith(2, 'preview_work_workspace_members', {
      p_workspace_id: 'workspace-1',
      p_changes: changes,
    });

    await service.applyMembers('workspace-1', preview, 1, 'Duyệt thay đổi', 'apply-key');
    expect(rpc).toHaveBeenNthCalledWith(3, 'apply_work_workspace_members', {
      p_workspace_id: 'workspace-1',
      p_preview: preview,
      p_expected_version: 1,
      p_reason: 'Duyệt thay đổi',
      p_key: 'apply-key',
    });

    await service.command('workspace-1', 'update_profile', { name: 'Mới' }, 2, 'Đổi tên', 'command-key');
    expect(rpc).toHaveBeenNthCalledWith(4, 'command_work_workspace', {
      p_workspace_id: 'workspace-1',
      p_command: 'update_profile',
      p_payload: { name: 'Mới' },
      p_expected_version: 2,
      p_reason: 'Đổi tên',
      p_key: 'command-key',
    });

    await service.recover('workspace-1', 'user-2', 'Khôi phục quản trị', 'recover-key');
    expect(rpc).toHaveBeenNthCalledWith(5, 'recover_work_workspace_admin', {
      p_workspace_id: 'workspace-1',
      p_user_id: 'user-2',
      p_reason: 'Khôi phục quản trị',
      p_key: 'recover-key',
    });

    await service.setPreference('workspace-1', true, true);
    expect(rpc).toHaveBeenNthCalledWith(6, 'set_work_workspace_preference', {
      p_workspace_id: 'workspace-1',
      p_pinned: true,
      p_opened: true,
    });
  });

  it('retains the same mutation key and payload for an ambiguous response', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'network unavailable' } })
      .mockResolvedValueOnce({ data: { id: 'workspace-1' }, error: null });
    const service = createWorkWorkspaceService({ rpc } as any);

    await expect(service.create(input, 'stable-key')).rejects.toMatchObject({
      name: 'WorkWorkspaceRpcError',
      code: 'WORK_WORKSPACE_RPC_FAILED',
    });
    await service.create(input, 'stable-key');
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });

  it('rejects unsafe search and membership batch sizes before an RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    const service = createWorkWorkspaceService({ rpc } as any);
    await expect(service.list('x'.repeat(101))).rejects.toMatchObject({
      code: 'WORK_WORKSPACE_SEARCH_TOO_LONG',
    });
    const changes = Array.from({ length: 101 }, (_, index) => ({
      operation: 'add' as const,
      userId: `user-${index}`,
    }));
    await expect(service.previewMembers('workspace-1', changes)).rejects.toMatchObject({
      code: 'WORK_MEMBERSHIP_BATCH_TOO_LARGE',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('extracts structured business codes from Postgres error fields', () => {
    const error = mapWorkWorkspaceError({
      code: 'P0001',
      message: 'workspace changed: WORK_VERSION_CONFLICT',
      details: 'Retry from the latest version.',
      hint: 'Reload Workspace',
    });
    expect(error).toMatchObject({
      name: 'WorkWorkspaceRpcError',
      code: 'WORK_VERSION_CONFLICT',
      message: 'workspace changed: WORK_VERSION_CONFLICT',
      details: 'Retry from the latest version.',
      hint: 'Reload Workspace',
    });
  });
});
