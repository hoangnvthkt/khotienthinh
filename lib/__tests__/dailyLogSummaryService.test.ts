import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import {
  buildDailyLogSourceSnapshot,
  DAILY_SUMMARY_SOURCE_TYPE,
} from '../dailyLogWorkflow';
import { dailyLogSummaryService } from '../dailyLogSummaryService';

const sourceLog = (id: string, patch: Partial<DailyLog> = {}): DailyLog => ({
  id,
  projectId: 'project-1',
  constructionSiteId: null,
  date: '2026-07-05',
  weather: 'sunny',
  workerCount: 0,
  description: `Nguon ${id}`,
  status: 'submitted',
  submittedAt: `2026-07-05T0${id === 'source-1' ? '8' : '9'}:15:00.000Z`,
  updatedAt: `2026-07-05T0${id === 'source-1' ? '8' : '9'}:20:00.000Z`,
  createdBy: id,
  createdAt: '2026-07-05T07:00:00.000Z',
  ...patch,
});

const verifiedSummary = (patch: Partial<DailyLog> = {}): DailyLog => ({
  id: 'summary-1',
  projectId: 'project-1',
  constructionSiteId: null,
  date: '2026-07-05',
  weather: 'sunny',
  workerCount: 0,
  description: 'Ban tong hop',
  status: 'verified',
  summarySourceType: DAILY_SUMMARY_SOURCE_TYPE,
  createdBy: 'KTT',
  createdAt: '2026-07-05T10:00:00.000Z',
  ...patch,
});

const summarizeDay = (logs: DailyLog[], statusScope: 'verified' | 'all' = 'verified') => dailyLogSummaryService.summarize(logs, {
  fromDate: '2026-07-05',
  toDate: '2026-07-05',
  mode: 'day',
  statusScope,
});

describe('dailyLogSummaryService legacy summary details', () => {
  it('uses one hydrated official summary without counting its submitted sources twice', () => {
    const first = sourceLog('source-1', {
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 10, unit: 'm3' }],
      laborDetails: [{ laborType: 'Tho xay', count: 3, hours: 8, unit: 'nguoi' }],
      machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 1, hours: 7, unit: 'ca' }],
    });
    const second = sourceLog('source-2', {
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 20, unit: 'm3' }],
      laborDetails: [{ laborType: 'Tho xay', count: 4, hours: 6, unit: 'nguoi' }],
      machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 0.5, hours: 3, unit: 'ca' }],
    });
    const summaryLog = verifiedSummary({
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 20, unit: 'm3' }],
      summarySourceMetadata: {
        legacyDailyLogIds: [first.id, second.id],
        sourceSnapshots: {
          [first.id]: buildDailyLogSourceSnapshot(first),
          [second.id]: buildDailyLogSourceSnapshot(second),
        },
      },
    });

    const result = summarizeDay([first, second, summaryLog]);
    const period = result.periods[0];

    expect(result.filteredLogs.map(log => log.id)).toEqual(['summary-1']);
    expect(period.volumes).toEqual([{ key: 'Be tong_m3', label: 'Be tong', value: 30, unit: 'm3' }]);
    expect(period.workers.total).toBe(7);
    expect(period.machines[0]).toMatchObject({ label: 'May dao', value: 1.5, unit: 'ca' });
    expect(period.machineHours[0]).toMatchObject({ label: 'May dao', value: 10, unit: 'giờ' });
    expect(result.overview.totalMachineShifts).toBe(1.5);
    expect(result.overview.totalMachineHours).toBe(10);
    expect(result.overview.unresolvedLegacySummaryCount).toBe(0);

    const allStatuses = summarizeDay([first, second, summaryLog], 'all');
    expect(allStatuses.filteredLogs.map(log => log.id)).toEqual(['summary-1']);
    expect(allStatuses.periods[0].volumes[0].value).toBe(30);
    expect(allStatuses.overview.totalMachineHours).toBe(10);
  });

  it('keeps stored values and reports a legacy summary whose source snapshot changed', () => {
    const reviewed = sourceLog('source-1');
    const changed = { ...reviewed, updatedAt: '2026-07-05T11:20:00.000Z' };
    const summaryLog = verifiedSummary({
      workerCount: 2,
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 12, unit: 'm3' }],
      machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 1, hours: 2, unit: 'ca' }],
      summarySourceMetadata: {
        legacyDailyLogIds: [reviewed.id],
        sourceSnapshots: { [reviewed.id]: buildDailyLogSourceSnapshot(reviewed) },
      },
    });

    const result = summarizeDay([changed, summaryLog]);

    expect(result.periods[0].volumes[0].value).toBe(12);
    expect(result.overview.totalMachineHours).toBe(2);
    expect(result.overview.unresolvedLegacySummaryCount).toBe(1);
  });
});
