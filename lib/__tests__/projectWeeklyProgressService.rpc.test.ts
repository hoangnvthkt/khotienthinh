import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: supabaseMocks.rpc },
}));

import { projectWeeklyProgressService } from '../projectWeeklyProgressService';
import * as weeklyProgressServiceModule from '../projectWeeklyProgressService';

const openState = {
  id: 'state-1',
  scopeKey: 'project-1_site-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  periodType: 'daily',
  periodStart: '2026-08-08',
  isLocked: false,
  lockedBy: null,
  lockedAt: null,
  unlockedBy: null,
  unlockedAt: null,
  unlockReason: null,
  createdAt: '2026-08-08T01:00:00.000Z',
  updatedAt: '2026-08-08T01:00:00.000Z',
};

const snapshot = {
  constructionProgressPercent: 42,
  valueProgressPercent: 35,
  progressMode: 'daily_report',
  suppliedValue: 350,
  contractTotalValue: 1000,
  purchasedValue: 500,
  issuedValue: 350,
  recognizedValue: 350,
  ganttPercent: 42,
  calculatedAt: '2026-08-08T02:00:00.000Z',
};

describe('projectWeeklyProgressService authoritative RPC contract', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset();
  });

  it('reads the selected period state through the scoped state RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: openState, error: null });

    const state = await (projectWeeklyProgressService as any).getPeriodState({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      periodType: 'daily',
      periodStart: '2026-08-08',
    });

    expect(state).toEqual(openState);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_project_progress_period_state', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_period_type: 'daily',
      p_period_start: '2026-08-08',
    });
  });

  it('saves only the daily row fields accepted by the atomic period RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { state: openState, savedRowCount: 1, weeklyAggregateFrozen: true },
      error: null,
    });

    const result = await (projectWeeklyProgressService as any).savePeriod({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      periodType: 'daily',
      periodStart: '2026-08-08',
      rows: [{
        id: 'daily-row-1',
        scopeKey: 'project-1_site-1',
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        taskId: 'task-1',
        progressDate: '2026-08-08',
        weekStart: '2026-08-03',
        progressPercent: 42,
        quantityDone: 21,
        dailyQuantityDone: 4,
        note: 'Đã nghiệm thu',
        attachments: [],
        sourceDailyLogId: null,
        updatedBy: 'user-1',
        updatedAt: '2026-08-08T02:00:00.000Z',
      }],
      snapshot,
    });

    expect(result.weeklyAggregateFrozen).toBe(true);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('save_project_progress_period', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_period_type: 'daily',
      p_period_start: '2026-08-08',
      p_rows: [{
        taskId: 'task-1',
        progressPercent: 42,
        quantityDone: 21,
        dailyQuantityDone: 4,
        note: 'Đã nghiệm thu',
        attachments: [],
        sourceDailyLogId: null,
      }],
      p_snapshot: snapshot,
    });
  });

  it('closes unchanged persisted data with JSON null rows and snapshot', async () => {
    const lockedState = {
      ...openState,
      isLocked: true,
      lockedBy: 'user-2',
      lockedAt: '2026-08-08T03:00:00.000Z',
    };
    supabaseMocks.rpc.mockResolvedValueOnce({ data: lockedState, error: null });

    const state = await (projectWeeklyProgressService as any).closePeriod({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      periodType: 'daily',
      periodStart: '2026-08-08',
      rows: null,
      snapshot: null,
    });

    expect(state).toEqual(lockedState);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('close_project_progress_period', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_period_type: 'daily',
      p_period_start: '2026-08-08',
      p_rows: null,
      p_snapshot: null,
    });
  });

  it('requires a non-blank reopen reason before calling Supabase', async () => {
    await expect((projectWeeklyProgressService as any).reopenPeriod({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      periodType: 'weekly',
      periodStart: '2026-08-03',
      reason: '   ',
    })).rejects.toThrow('Vui lòng nhập lý do mở chốt.');

    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('refreshes Opening Balance through the dedicated snapshot RPC', async () => {
    const openingSnapshot = { ...snapshot, progressMode: 'opening_balance' };
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { id: 'snapshot-1', weekStart: '2026-08-03', ...openingSnapshot },
      error: null,
    });

    const result = await (projectWeeklyProgressService as any).refreshSnapshot({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      weekStart: '2026-08-03',
      snapshot: openingSnapshot,
    });

    expect(result).toEqual(expect.objectContaining({ id: 'snapshot-1', progressMode: 'opening_balance' }));
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('refresh_project_progress_snapshot', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_week_start: '2026-08-03',
      p_snapshot: openingSnapshot,
    });
  });

  it('does not expose protected-table mutation helpers', () => {
    expect(projectWeeklyProgressService).not.toHaveProperty('upsertDailyMany');
    expect(projectWeeklyProgressService).not.toHaveProperty('upsertMany');
    expect(projectWeeklyProgressService).not.toHaveProperty('upsertSnapshot');
  });

  it('maps known RPC failures to approved Vietnamese messages without exposing raw errors', () => {
    const getMessage = (weeklyProgressServiceModule as any).getProjectProgressMutationErrorMessage;
    expect(getMessage).toBeTypeOf('function');
    if (typeof getMessage !== 'function') return;

    expect(getMessage(
      { message: 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.' },
      'Không thể lưu tiến độ.',
    )).toBe('Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.');
    expect(getMessage(
      { message: 'snapshot contains an unsupported field', code: '23514' },
      'Không thể lưu tiến độ.',
    )).toBe('Không thể lưu tiến độ.');
  });
});
