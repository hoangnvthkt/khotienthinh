import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { projectV2ReadService } from '../projectV2/readService';

const workspace = { id: 'workspace-1', project_id: 'project-1', project_name: 'Dự án Một',
  project_code: 'DA-01', client_name: 'Khách hàng A', construction_site_name: 'Công trường A',
  primary_construction_site_id: null, lifecycle: 'pilot', version: 1 };
const plan = { id: 'plan-1', workspace_id: 'workspace-1', plan_type: 'month', code: 'M-1',
  title: 'Kế hoạch tháng', status: 'draft', period_start: '2026-10-01', period_end: '2026-10-31',
  owner_user_id: null, creator_user_id: 'user-1', submitter_user_id: null,
  approver_user_id: null, revision_no: 1, version: 1,
  created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z' };

describe('projectV2ReadService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('maps scoped workspaces and refuses duplicate IDs', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: '2026-09-23T00:00:00Z', workspaces: [workspace] }, error: null });
    await expect(projectV2ReadService.listWorkspaces()).resolves.toMatchObject({
      workspaces: [{ id: 'workspace-1', projectId: 'project-1', projectName: 'Dự án Một',
        projectCode: 'DA-01', clientName: 'Khách hàng A', siteName: 'Công trường A' }],
    });
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: '2026-09-23T00:00:00Z', workspaces: [workspace, workspace] }, error: null });
    await expect(projectV2ReadService.listWorkspaces()).rejects.toThrow('PROJECT_V2_DUPLICATE_ID');
  });

  it('checks exact workspace scope and a stable snapshot cursor', async () => {
    mocks.rpc.mockResolvedValue({ data: { asOf: '2026-09-23T00:00:00Z', snapshotToken: '2026-09-23T00:00:00Z',
      totalCount: 1, statusCounts: { draft: 1 }, capabilities: {}, plans: [plan] }, error: null });
    const result = await projectV2ReadService.listPlans({ workspaceId: 'workspace-1', planType: 'month',
      status: null, limit: 30, cursor: null, snapshotToken: null });
    expect(result.plans[0].status).toBe('draft');
    expect(mocks.rpc).toHaveBeenCalledWith('list_project_v2_plans_v1', expect.objectContaining({
      p_workspace_id: 'workspace-1', p_plan_type: 'month', p_limit: 30,
      p_before_created_at: null, p_before_id: null,
    }));
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: '2026-09-23T00:00:00Z', snapshotToken: '2026-09-24T00:00:00Z',
      totalCount: 1, statusCounts: { draft: 1 }, capabilities: {}, plans: [plan] }, error: null });
    await expect(projectV2ReadService.listPlans({ workspaceId: 'workspace-1', planType: 'month',
      status: null, limit: 30, cursor: { createdAt: plan.created_at, id: plan.id },
      snapshotToken: '2026-09-23T00:00:00Z' })).rejects.toThrow('PROJECT_V2_SNAPSHOT_STALE');
  });

  it('rejects a cross-workspace row, duplicate plan, and malformed count', async () => {
    for (const plans of [[{ ...plan, workspace_id: 'workspace-2' }], [plan, plan]]) {
      mocks.rpc.mockResolvedValueOnce({ data: { asOf: plan.created_at, snapshotToken: plan.updated_at,
        totalCount: plans.length, statusCounts: {}, capabilities: {}, plans }, error: null });
      await expect(projectV2ReadService.listPlans({ workspaceId: 'workspace-1', planType: null,
        status: null, limit: 30, cursor: null, snapshotToken: null })).rejects.toThrow();
    }
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: plan.created_at, snapshotToken: plan.updated_at,
      totalCount: '0', statusCounts: {}, capabilities: {}, plans: [] }, error: null });
    await expect(projectV2ReadService.listPlans({ workspaceId: 'workspace-1', planType: null,
      status: null, limit: 30, cursor: null, snapshotToken: null })).rejects.toThrow('PROJECT_V2_COUNT_INVALID');
  });

  it('preserves null quantity and rejects malformed decimals in detail', async () => {
    const response = { asOf: plan.updated_at, plan, capabilities: {},
      lines: [{ id: 'line-1', plan_id: 'plan-1', revision_no: 1, plan_type: 'month',
        sort_order: 1, contract_item_id: 'contract-1', baseline_revision: null,
        unit: 'm3', quantity: null }], sources: [] };
    mocks.rpc.mockResolvedValueOnce({ data: response, error: null });
    await expect(projectV2ReadService.getPlan('plan-1')).resolves.toMatchObject({
      lines: [{ id: 'line-1', quantity: null }],
    });
    mocks.rpc.mockResolvedValueOnce({ data: { ...response, lines: [{ ...response.lines[0], quantity: '1.0000001' }] }, error: null });
    await expect(projectV2ReadService.getPlan('plan-1')).rejects.toThrow('PROJECT_V2_DECIMAL_INVALID');
  });

  it('propagates denied, stale and network errors', async () => {
    for (const error of [{ code: '42501', message: 'PROJECT_V2_READ_DENIED' },
      { code: '40001', message: 'PROJECT_V2_SNAPSHOT_STALE' },
      { message: 'network unavailable' }]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error });
      await expect(projectV2ReadService.listWorkspaces()).rejects.toBe(error);
    }
  });

  it('returns exact active cohort IDs for a legacy picker page', async () => {
    mocks.rpc.mockResolvedValue({ data: { projectIds: ['project-2'] }, error: null });
    await expect(projectV2ReadService.listActiveCohortIds(['project-1', 'project-2']))
      .resolves.toEqual(['project-2']);
    expect(mocks.rpc).toHaveBeenCalledWith('list_project_v2_cohort_ids_v1', {
      p_project_ids: ['project-1', 'project-2'],
    });
  });

  it('pages persisted comments with a guarded cursor and server actor/time', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: plan.updated_at,
      items: [{ id: 'comment-1', revision: 2, authorUserId: 'user-2',
        body: 'Đã kiểm tra', createdAt: plan.updated_at }],
      nextCursor: { at: plan.updated_at, id: 'comment-1' } }, error: null });
    await expect(projectV2ReadService.getCollaborationPage('plan-1', 'comments', 20, null))
      .resolves.toMatchObject({ items: [{ authorUserId: 'user-2', body: 'Đã kiểm tra' }],
        nextCursor: { id: 'comment-1' } });
    expect(mocks.rpc).toHaveBeenCalledWith('list_project_v2_plan_collaboration_v1', {
      p_plan_id: 'plan-1', p_kind: 'comments', p_limit: 20,
      p_before_at: null, p_before_id: null,
    });
    const denied = { code: '42501', message: 'PROJECT_V2_READ_DENIED' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: denied });
    await expect(projectV2ReadService.getCollaborationPage('plan-1', 'events', 20, null))
      .rejects.toBe(denied);
  });

  it('reads an exact approved revision and never treats a protected related plan as a route', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { asOf: plan.updated_at,
      plan: { ...plan, status: 'approved', revision_no: 2 }, capabilities: { view: true },
      lines: [], sources: [], historical: true }, error: null });
    await expect(projectV2ReadService.getPlan('plan-1', 2)).resolves.toMatchObject({
      plan: { revision: 2, status: 'approved' }, historical: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('get_project_v2_plan_revision_v1', {
      p_plan_id: 'plan-1', p_revision_no: 2,
    });
    mocks.rpc.mockResolvedValueOnce({ data: { sources: [{ canOpen: false }], downstream: [] }, error: null });
    await expect(projectV2ReadService.getLineage('plan-1', 2)).resolves.toEqual({
      sources: [{ canOpen: false }], downstream: [],
    });
  });
});
