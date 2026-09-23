import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { projectV2CommandService } from '../projectV2/commandService';

const command = { planId: 'plan-1', expectedVersion: 3, idempotencyKey: 'key-1' };

describe('projectV2CommandService', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: { planId: 'plan-1', version: 4, outcome: 'committed' }, error: null });
  });

  it('submits the exact command shape without a client actor claim', async () => {
    await projectV2CommandService.submit({ ...command, reason: 'Đủ hồ sơ' });
    expect(mocks.rpc).toHaveBeenCalledWith('submit_project_v2_plan_v1', {
      p_plan_id: 'plan-1', p_expected_version: 3, p_idempotency_key: 'key-1', p_reason: 'Đủ hồ sơ',
    });
  });

  it.each(['return', 'cancel'] as const)('requires a reason for %s', async operation => {
    expect(() => projectV2CommandService[operation]({ ...command, reason: '   ' }))
      .toThrow('PROJECT_V2_REASON_REQUIRED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends an expected version and idempotency key for every mutation', async () => {
    await projectV2CommandService.approve(command);
    await projectV2CommandService.createRevision(command);
    await projectV2CommandService.deleteDraft(command);
    await projectV2CommandService.addComment({ ...command, body: 'Cần kiểm tra' });
    for (const [, payload] of mocks.rpc.mock.calls) {
      expect(payload).toMatchObject({ p_plan_id: command.planId, p_expected_version: 3, p_idempotency_key: 'key-1' });
      expect(payload).not.toHaveProperty('p_actor_user_id');
    }
  });

  it('preserves stale version and idempotency conflict errors from the server', async () => {
    const stale = { code: '40001', message: 'PROJECT_V2_VERSION_STALE' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: stale });
    await expect(projectV2CommandService.approve(command)).rejects.toBe(stale);
    const conflict = { code: '23505', message: 'PROJECT_V2_IDEMPOTENCY_CONFLICT' };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: conflict });
    await expect(projectV2CommandService.approve(command)).rejects.toBe(conflict);
  });

  it('rejects malformed quantities before saving', async () => {
    expect(() => projectV2CommandService.save({ workspaceId: 'workspace-1', planId: null,
      expectedVersion: null, idempotencyKey: 'key-1', planType: 'month', code: 'M-1', title: 'Tháng 10',
      periodStart: '2026-10-01', periodEnd: '2026-10-31', lines: [{ id: 'line-1', contractItemId: 'item-1',
        baselineRevision: 'rev-1', unit: 'm3', quantity: '1.0000001' }],
    })).toThrow('PROJECT_V2_QUANTITY_INVALID');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends valid save payload to the server for authoritative checks', async () => {
    const lines = [{ id: 'line-1', contractItemId: 'item-1', baselineRevision: 'rev-1', unit: 'm3', quantity: '10.000000' }];
    await projectV2CommandService.save({ workspaceId: 'workspace-1', planId: null,
      expectedVersion: null, idempotencyKey: 'key-1', planType: 'month', code: 'M-1', title: 'Tháng 10',
      periodStart: '2026-10-01', periodEnd: '2026-10-31', lines });
    expect(mocks.rpc).toHaveBeenCalledWith('save_project_v2_plan_v1', {
      p_workspace_id: 'workspace-1', p_plan_id: null, p_expected_version: null,
      p_idempotency_key: 'key-1', p_plan_type: 'month', p_code: 'M-1', p_title: 'Tháng 10',
      p_period_start: '2026-10-01', p_period_end: '2026-10-31', p_lines: lines,
    });
  });

  it('activates an existing project without a client actor claim', async () => {
    await projectV2CommandService.activateWorkspace({ projectId: 'project-1',
      primaryConstructionSiteId: null, idempotencyKey: 'activate-1' });
    expect(mocks.rpc).toHaveBeenCalledWith('activate_project_v2_workspace_v1', {
      p_project_id: 'project-1', p_primary_construction_site_id: null,
      p_idempotency_key: 'activate-1',
    });
  });
});
