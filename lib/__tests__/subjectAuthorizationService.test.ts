import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

beforeEach(() => {
  supabaseMock.rpc.mockReset();
});

describe('subjectAuthorizationService', () => {
  it('uses the actor-bound view RPC without accepting a client actor id', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
    const { subjectAuthorizationService } = await import('../subjectAuthorizationService');

    await expect(subjectAuthorizationService.canView('daily_log', 'log-1')).resolves.toBe(true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('can_view_subject', {
      p_subject_type: 'daily_log',
      p_subject_id: 'log-1',
    });
  });

  it('uses the assignment-aware action RPC without client-supplied permission facts', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: false, error: null });
    const { subjectAuthorizationService } = await import('../subjectAuthorizationService');

    await expect(subjectAuthorizationService.canAct('daily_log', 'log-1', 'verify')).resolves.toBe(false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('can_act_on_subject', {
      p_subject_type: 'daily_log',
      p_subject_id: 'log-1',
      p_action: 'verify',
    });
  });

  it('returns only a resolver-owned Daily Log responsibility target', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        userId: 'cht-1',
        name: 'Chỉ huy trưởng',
        responsibility: 'current_verifier',
        permissionCode: 'project.daily_log.verify',
        scopeType: 'construction_site',
        scopeId: 'site-1',
        resolvedBy: 'responsibility_slot',
      },
      error: null,
    });
    const { subjectAuthorizationService } = await import('../subjectAuthorizationService');

    await expect(subjectAuthorizationService.getDailyLogResponsibilityTarget('log-1')).resolves.toMatchObject({
      userId: 'cht-1',
      responsibility: 'current_verifier',
      permissionCode: 'project.daily_log.verify',
      resolvedBy: 'responsibility_slot',
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_daily_log_responsibility_target', {
      p_log_id: 'log-1',
    });
  });

  it('rejects an incomplete target payload instead of allowing the UI to guess an assignee', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { userId: 'cht-1' }, error: null });
    const { subjectAuthorizationService } = await import('../subjectAuthorizationService');

    await expect(subjectAuthorizationService.getDailyLogResponsibilityTarget('log-1'))
      .rejects.toThrow('Responsibility target không hợp lệ');
  });
});
