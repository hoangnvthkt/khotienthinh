import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { dailyLogWbsService } from '../dailyLogWbsService';

describe('dailyLogWbsService', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it('saves contribution work with server-owned physical resource totals', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        row_version: 4,
        updated_at: '2026-09-23T02:30:00Z',
        source_fingerprint: 'fingerprint-4',
        conflicts: [],
      },
      error: null,
    });

    const receipt = await dailyLogWbsService.saveContribution({
      contributionId: 'contribution-1',
      expectedRowVersion: 3,
      workAreaCode: 'A',
      workAreaName: 'Khu A',
      items: [{ clientKey: 'work-1', taskId: 'task-1', cumulativeProgressPercent: 35 }],
      labor: [{
        workItemClientKey: 'work-1',
        laborType: 'Tổ xây dựng',
        peopleCount: 5,
        hoursPerPerson: 8,
        provider: {
          entryMode: 'manual',
          manualProviderType: 'free_crew',
          manualProviderName: 'Tổ anh Minh',
        },
      }],
      machines: [],
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_daily_log_contribution_work_v1', {
      p_contribution_id: 'contribution-1',
      p_expected_row_version: 3,
      p_work_area_code: 'A',
      p_work_area_name: 'Khu A',
      p_items: [{ clientKey: 'work-1', taskId: 'task-1', cumulativeProgressPercent: 35 }],
      p_labor: [{
        workItemClientKey: 'work-1',
        laborType: 'Tổ xây dựng',
        peopleCount: 5,
        hoursPerPerson: 8,
        provider: {
          entryMode: 'manual',
          manualProviderType: 'free_crew',
          manualProviderName: 'Tổ anh Minh',
        },
      }],
      p_machines: [],
    });
    expect(receipt).toEqual({
      rowVersion: 4,
      updatedAt: '2026-09-23T02:30:00Z',
      sourceFingerprint: 'fingerprint-4',
      conflicts: [],
    });
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toMatch(/cost|price|amount/i);
  });

  it('maps the bundle deeply from database keys to application keys', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        rollout: { mode: 'pilot', cutover_date: '2026-09-23', enabled: true },
        leaf_tasks: [{ id: 'task-1', wbs_code: '1.1' }],
        work_boq_items: [],
        resource_providers: [],
        previous_progress_rows: [],
        next_progress_rows: [],
        contribution: null,
        contributions_for_summary: [],
        summary_log: null,
        summary_sources: [],
        work_items: [{ task_id: 'task-1', work_area_code: 'A' }],
        decisions: [],
        labor: [],
        machines: [],
        period_state: null,
        permissions: { can_edit_source: true, can_summarize: false, can_approve: false, can_publish_progress: false },
      },
      error: null,
    });

    const bundle = await dailyLogWbsService.getBundle({
      projectId: 'project-1', constructionSiteId: 'site-1', logDate: '2026-09-23',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('get_daily_log_wbs_bundle_v1', {
      p_project_id: 'project-1',
      p_construction_site_id: 'site-1',
      p_log_date: '2026-09-23',
      p_daily_log_id: null,
    });
    expect(bundle.rollout.cutoverDate).toBe('2026-09-23');
    expect(bundle.tasks[0]).toMatchObject({ id: 'task-1', wbsCode: '1.1' });
    expect(bundle.workItems[0]).toMatchObject({ taskId: 'task-1', workAreaCode: 'A' });
    expect(bundle.permissions.canEditSource).toBe(true);
  });

  it.each([
    ['ROW_VERSION_CONFLICT', 'người khác vừa cập nhật'],
    ['SOURCE_CHANGED', 'nguồn đã thay đổi'],
    ['SOURCE_RETURNED', 'đã bị trả lại'],
    ['PERIOD_LOCKED', 'đã khóa'],
  ])('maps %s to an actionable Vietnamese error', async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
    await expect(dailyLogWbsService.saveContribution({
      contributionId: 'contribution-1', expectedRowVersion: 1,
      workAreaCode: 'A', workAreaName: 'Khu A', items: [], labor: [], machines: [],
    })).rejects.toThrow(message);
  });
});
