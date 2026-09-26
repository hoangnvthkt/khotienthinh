import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyLog } from '../../types';
import { dailyLogSummaryService } from '../dailyLogSummaryService';

const database = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, error: null as any }));
vi.mock('../supabase', () => ({ supabase: { rpc: (_name: string, _args: unknown) => Promise.resolve({ data: database.rows.normalized_resource_rows || [], error: null }), from: (table: string) => {
  let ids: string[] = [];
  const query = {
    select: () => query, order: () => query, limit: () => query,
    in: (_key: string, value: string[]) => { ids = value; return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: (database.rows[table] || []).filter(row => ids.includes(row.daily_log_id)),
      error: table === 'daily_log_work_items' ? database.error : null,
    }).then(resolve),
  };
  return query;
} } }));
import { dailyLogDetailService } from '../dailyLogDetailService';

const log = (id: string, patch: Partial<DailyLog> = {}): DailyLog => ({
  id, projectId: 'p1', date: '2026-09-23', weather: 'sunny', workerCount: 0,
  description: id, status: 'verified', createdBy: 'CHT', createdAt: '2026-09-23T01:00:00Z',
  summarySourceType: 'member_contributions', summarySourceMetadata: { aggregationVersion: 2 }, ...patch,
});
const summarize = (logs: DailyLog[]) => dailyLogSummaryService.summarize(logs, {
  fromDate: '2026-09-23', toDate: '2026-09-23', mode: 'day', statusScope: 'verified',
});

describe('Daily Log WBS / legacy compatibility', () => {
  beforeEach(() => { database.rows = {}; database.error = null; });

  it('counts the published revision once, excludes linked sources and retains unresolved legacy evidence', () => {
    const result = summarize([
      log('summary-old', { supersededByDailyLogId: 'summary-new' }),
      log('summary-new', { supersedesDailyLogId: 'summary-old', revisionNo: 2,
        summarySourceMetadata: { aggregationVersion: 2, legacyDailyLogIds: ['source-only'] } }),
      log('summary-legacy', { summarySourceMetadata: { legacyDailyLogIds: ['missing-source'] },
        volumes: [{ taskName: 'Legacy snapshot', quantity: 12, unit: 'm3' }] }),
      log('source-only', { summarySourceType: null, volumes: [{ taskName: 'source-only', quantity: 99, unit: 'm3' }] }),
    ]);
    expect(result.filteredLogs.map(row => row.id)).toEqual(['summary-new', 'summary-legacy']);
    expect(result.overview.unresolvedLegacySummaryCount).toBe(1);
    expect(result.periods[0].volumes).toEqual([{ key: 'Legacy snapshot_m3', label: 'Legacy snapshot', value: 12, unit: 'm3' }]);
  });

  it('keeps the old official version while its revision is only a draft', () => {
    expect(summarize([log('old', { supersededByDailyLogId: 'draft' }),
      log('draft', { status: 'draft', supersedesDailyLogId: 'old' })]).filteredLogs.map(row => row.id)).toEqual(['old']);
  });

  it('reads normalized WBS and uses the official decision once instead of adding area cumulative quantities', async () => {
    database.rows = {
      daily_log_work_items: ['A', 'B'].map((area, index) => ({ id: `w${index}`, daily_log_id: 'new',
        task_id: 't1', task_name_snapshot: 'Bê tông móng', unit_snapshot: 'm3',
        work_area_code: area, work_area_name_snapshot: `Khu ${area}`, cumulative_quantity_done: 30, daily_quantity_done: 30 })),
      daily_log_wbs_decisions: [{ id: 'd1', daily_log_id: 'new', task_id: 't1', official_daily_quantity: 40, official_cumulative_quantity: 40 }],
      daily_log_volumes: [{ daily_log_id: 'new', task_name: 'Stale JSON projection', quantity: 99, unit: 'm3' },
        { daily_log_id: 'legacy', task_name: 'Legacy concrete', quantity: 12, unit: 'm3' }],
    };
    const details = await dailyLogDetailService.listByLogIds(['new', 'legacy']);
    expect(details.new.volumes).toEqual([expect.objectContaining({ taskId: 't1', taskName: 'Bê tông móng', quantity: 40, unit: 'm3' })]);
    expect(details.legacy.volumes).toEqual([expect.objectContaining({ taskName: 'Legacy concrete', quantity: 12 })]);
  });

  it('does not turn a denied normalized read into empty legacy data', async () => {
    database.error = { code: '42501', message: 'permission denied' };
    await expect(dailyLogDetailService.listByLogIds(['new'])).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps unknown WBS quantity out of numeric totals and never resurrects a stale legacy value', async () => {
    database.rows = {
      daily_log_work_items: [{ id: 'w1', daily_log_id: 'new', task_id: 't1', task_name_snapshot: 'Unknown' }],
      daily_log_wbs_decisions: [{ id: 'd1', daily_log_id: 'new', task_id: 't1', official_daily_quantity: null }],
      daily_log_volumes: [{ daily_log_id: 'new', task_name: 'Stale', quantity: 99, unit: 'm3' }],
    };
    const details = await dailyLogDetailService.listByLogIds(['new']);
    expect(details.new.normalizedWbs).toBe(true);
    expect(details.new.volumes).toEqual([]);
    const report = summarize([log('new', { ...details.new, summarySourceMetadata: {} })]);
    expect(report.overview.unresolvedLegacySummaryCount).toBe(0);
    expect(report.periods[0].volumes).toEqual([]);
  });

  it('reads normalized physical resources through the scoped RPC while legacy stays on direct table reads', async () => {
    database.rows = {
      daily_log_work_items: [{ id: 'w1', daily_log_id: 'new', task_id: 't1', task_name_snapshot: 'Task' }],
      daily_log_labor: [{ daily_log_id: 'legacy', labor_type: 'Legacy', count: 1, hours: 8, unit_cost: 10 }],
      normalized_resource_rows: [{ resource_type: 'labor', daily_log_id: 'new', labor_type: 'Crew', people_count: 2, total_labor_hours: 12 }],
    };
    const details = await dailyLogDetailService.listByLogIds(['new', 'legacy']);
    expect(details.new.laborDetails).toEqual([expect.objectContaining({ laborType: 'Crew', peopleCount: 2, totalLaborHours: 12 })]);
    expect(details.new.laborDetails[0]).not.toHaveProperty('unitCost');
    expect(details.legacy.laborDetails).toEqual([expect.objectContaining({ laborType: 'Legacy', unitCost: 10 })]);
  });
});
