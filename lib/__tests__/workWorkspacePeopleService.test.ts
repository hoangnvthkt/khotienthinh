import { describe, expect, it, vi } from 'vitest';
import { createWorkWorkspacePeopleService } from '../work/workWorkspacePeopleService';

describe('Workspace people projection service', () => {
  it('uses guarded, bounded people and source-diff RPCs with unchanged cursors', async () => {
    const page = { items: [], nextCursor: null };
    const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
    const service = createWorkWorkspacePeopleService({ rpc } as any);
    const cursor = { sortAt: '2026-09-07T01:00:00Z', id: 'person-id' };
    expect(await service.people('workspace-a', 'organization', 'Sơn', cursor)).toBe(page);
    expect(rpc).toHaveBeenCalledWith('list_work_workspace_people', {
      p_workspace_id: 'workspace-a', p_source: 'organization', p_search: 'Sơn', p_cursor: cursor, p_limit: 30,
    });
    await service.sourceDiff('workspace-a', cursor);
    expect(rpc).toHaveBeenLastCalledWith('preview_work_workspace_source_diff', {
      p_workspace_id: 'workspace-a', p_cursor: cursor, p_limit: 30,
    });
  });

  it('keeps people without accounts as disabled suggestions', async () => {
    const row = { userId: null, employeeId: 'employee-a', name: 'Nhân viên mới', eligibility: 'NO_APP_ACCOUNT', alreadyMember: false };
    const rpc = vi.fn().mockResolvedValue({ data: { items: [row], nextCursor: null }, error: null });
    const service = createWorkWorkspacePeopleService({ rpc } as any);
    expect((await service.people('workspace-a', 'organization')).items[0]).toEqual(row);
  });

  it('propagates permission and stale-source business errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'WORK_MEMBERSHIP_PREVIEW_STALE' } });
    const service = createWorkWorkspacePeopleService({ rpc } as any);
    await expect(service.sourceDiff('workspace-a')).rejects.toMatchObject({ code: 'WORK_MEMBERSHIP_PREVIEW_STALE' });
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'WORK_WORKSPACE_ADMIN_REQUIRED' } });
    await expect(service.people('workspace-a', 'directory')).rejects.toMatchObject({ code: 'WORK_WORKSPACE_ADMIN_REQUIRED' });
  });

  it('rejects empty scope and oversized search before contacting the server', async () => {
    const rpc = vi.fn();
    const service = createWorkWorkspacePeopleService({ rpc } as any);
    await expect(service.people('', 'directory')).rejects.toMatchObject({ code: 'WORK_INVALID_SCOPE' });
    await expect(service.people('workspace-a', 'directory', 'a'.repeat(101))).rejects.toMatchObject({ code: 'WORK_INVALID_FILTER' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
