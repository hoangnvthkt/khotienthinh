import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import {
  buildDailyLogSourceSnapshot,
  buildDailyLogSummaryDetails,
  buildDailyLogSummaryVolumes,
  canReturnDailyLogSource,
  DAILY_SUMMARY_SOURCE_TYPE,
  getDefaultDailyLogSummaryApprover,
  getDailyLogSourceReviewState,
  getMissingDailyLogSummarySourceIds,
  getDailyLogTargetPermission,
  getDailyLogSummarySourceLogs,
  resolveDailyLogSummaryDetails,
  withDailyLogSummaryDetails,
} from '../dailyLogWorkflow';

const sourceLog = (patch: Partial<DailyLog> = {}): DailyLog => ({
  id: 'source-1',
  projectId: 'project-1',
  constructionSiteId: null,
  date: '2026-07-05',
  weather: 'sunny',
  workerCount: 0,
  description: 'Nguon bao cao',
  status: 'submitted',
  submittedToPermission: 'verify',
  submittedToUserId: 'ktt-1',
  requestedVerifierId: 'ktt-1',
  createdBy: 'Nhan vien',
  createdById: 'member-1',
  createdAt: '2026-07-05T08:00:00.000Z',
  ...patch,
});

const summaryLog = (patch: Partial<DailyLog> = {}): DailyLog => ({
  id: 'summary-1',
  projectId: 'project-1',
  constructionSiteId: null,
  date: '2026-07-05',
  weather: 'sunny',
  workerCount: 0,
  description: 'Ban tong hop',
  status: 'rejected',
  summarySourceType: DAILY_SUMMARY_SOURCE_TYPE,
  createdBy: 'KTT',
  createdById: 'ktt-1',
  createdAt: '2026-07-05T09:00:00.000Z',
  ...patch,
});

describe('daily log source workflow', () => {
  it('keeps a returned member-contribution summary on the approver route', () => {
    expect(getDailyLogTargetPermission(summaryLog({
      status: 'rejected',
      submittedToPermission: 'edit',
    }))).toBe('approve');
  });

  it('routes a returned detail log back to a verifier', () => {
    expect(getDailyLogTargetPermission(sourceLog({
      status: 'rejected',
      submittedToPermission: 'edit',
    }))).toBe('verify');
  });

  it('reports a linked source that was deleted after the summary was saved', () => {
    expect(getMissingDailyLogSummarySourceIds(summaryLog({
      summarySourceMetadata: {
        legacyDailyLogIds: ['source-1', 'deleted-source'],
      },
    }), [sourceLog()])).toEqual(['deleted-source']);
  });

  it('allows KTT to return a submitted source when the linked summary is editable', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog(),
      sourceSummaryLog: summaryLog({ status: 'rejected' }),
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['project.daily_log.return']),
    })).toBe(true);
  });

  it('does not allow returning a source while the linked summary is waiting for CHT', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog(),
      sourceSummaryLog: summaryLog({ status: 'submitted', submittedToPermission: 'approve' }),
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['project.daily_log.return']),
    })).toBe(false);
  });

  it('requires the current KTT handler when the source is assigned to a specific verifier', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog({ requestedVerifierId: 'ktt-2', submittedToUserId: 'ktt-2' }),
      sourceSummaryLog: null,
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['project.daily_log.return']),
    })).toBe(false);
  });

  it('sums matching progress rows and keeps different units separate', () => {
    const result = buildDailyLogSummaryVolumes([
      sourceLog({
        id: 'source-1',
        volumes: [
          { taskId: 'task-1', taskName: 'Be tong mong', workBoqItemId: 'boq-1', workBoqItemName: 'BOQ be tong mong', quantity: 12, unit: 'm3' },
        ],
      }),
      sourceLog({
        id: 'source-2',
        volumes: [
          { taskId: 'task-1', taskName: 'Be tong mong', workBoqItemId: 'boq-1', workBoqItemName: 'BOQ be tong mong', quantity: 12, unit: 'm3' },
          { taskId: 'task-1', taskName: 'Be tong mong', workBoqItemId: 'boq-1', workBoqItemName: 'BOQ be tong mong', quantity: 2, unit: 'tan' },
          { taskId: 'task-2', taskName: 'Lap dung cot', quantity: 4, unit: 'tan' },
        ],
      }),
    ]);

    expect(result).toHaveLength(3);
    expect(result.map(row => `${row.taskId}:${row.unit}`)).toEqual(['task-1:m3', 'task-1:tan', 'task-2:tan']);
    expect(result[0].quantity).toBe(24);
  });

  it('merges volume evidence by id or url and keeps the first non-empty note', () => {
    const result = buildDailyLogSummaryDetails([
      sourceLog({
        volumes: [{
          taskId: 'task-1',
          taskName: 'Be tong mong',
          quantity: 10,
          unit: 'm3',
          note: '',
          attachments: [
            { id: 'photo-1', name: 'Anh 1', url: '/photo-1.jpg' },
            { name: 'Anh 2', url: '/photo-2.jpg' },
          ],
        }],
      }),
      sourceLog({
        id: 'source-2',
        volumes: [{
          taskId: 'task-1',
          taskName: 'Be tong mong',
          quantity: 20,
          unit: 'm3',
          note: 'Da nghiem thu noi bo',
          attachments: [
            { id: 'photo-1', name: 'Anh 1 trung', url: '/photo-1-copy.jpg' },
            { id: 'photo-2-copy', name: 'Anh 2 trung URL', url: '/photo-2.jpg' },
            { name: 'Anh 3', url: '/photo-3.jpg' },
          ],
        }],
      }),
    ]);

    expect(result.volumes[0]).toMatchObject({ quantity: 30, note: 'Da nghiem thu noi bo' });
    expect(result.volumes[0].attachments?.map(item => item.url)).toEqual([
      '/photo-1.jpg',
      '/photo-2.jpg',
      '/photo-3.jpg',
    ]);
  });

  it('sums labor count and hours only inside the same task, catalog, partner and unit', () => {
    const result = buildDailyLogSummaryDetails([
      sourceLog({
        laborDetails: [{
          laborType: 'Tho xay', catalogItemId: 'labor-1', partnerId: 'partner-1',
          taskId: 'task-1', count: 3, hours: 8, unit: 'nguoi', unitCost: 500_000,
        }],
      }),
      sourceLog({
        id: 'source-2',
        laborDetails: [
          {
            laborType: 'Tho xay', catalogItemId: 'labor-1', partnerId: 'partner-1',
            taskId: 'task-1', count: 4, hours: 6, unit: 'nguoi', unitCost: 600_000,
            note: 'Tang ca',
          },
          {
            laborType: 'Tho xay', catalogItemId: 'labor-1', partnerId: 'partner-2',
            taskId: 'task-1', count: 2, hours: 5, unit: 'nguoi',
          },
        ],
      }),
    ]);

    expect(result.workerCount).toBe(9);
    expect(result.laborDetails).toHaveLength(2);
    expect(result.laborDetails[0]).toMatchObject({ count: 7, hours: 14, unitCost: 500_000, note: 'Tang ca' });
    expect(result.laborDetails[1]).toMatchObject({ partnerId: 'partner-2', count: 2, hours: 5 });
  });

  it('sums machine shifts and actual hours only inside the same machine group', () => {
    const result = buildDailyLogSummaryDetails([
      sourceLog({
        machines: [{
          machineName: 'May dao 01', machineType: 'excavator', catalogItemId: 'machine-1',
          partnerId: 'partner-1', taskId: 'task-1', shifts: 1, hours: 7, unit: 'ca', unitCost: 2_000_000,
        }],
      }),
      sourceLog({
        id: 'source-2',
        machines: [
          {
            machineName: 'May dao 01', machineType: 'excavator', catalogItemId: 'machine-1',
            partnerId: 'partner-1', taskId: 'task-1', shifts: 0.5, hours: 3, unit: 'ca',
          },
          {
            machineName: 'May dao 01', machineType: 'excavator', catalogItemId: 'machine-1',
            partnerId: 'partner-2', taskId: 'task-1', shifts: 1, hours: 4, unit: 'ca',
          },
        ],
      }),
    ]);

    expect(result.machines).toHaveLength(2);
    expect(result.machines[0]).toMatchObject({ shifts: 1.5, hours: 10, unitCost: 2_000_000 });
    expect(result.machines[1]).toMatchObject({ partnerId: 'partner-2', shifts: 1, hours: 4 });
  });

  it('rebuilds a legacy summary only when every linked source snapshot still matches', () => {
    const first = sourceLog({
      id: 'source-1',
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 10, unit: 'm3' }],
      laborDetails: [{ laborType: 'Tho xay', count: 3, hours: 8, unit: 'nguoi' }],
      machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 1, hours: 7, unit: 'ca' }],
    });
    const second = sourceLog({
      id: 'source-2',
      submittedAt: '2026-07-05T09:15:00.000Z',
      updatedAt: '2026-07-05T09:20:00.000Z',
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 20, unit: 'm3' }],
      laborDetails: [{ laborType: 'Tho xay', count: 4, hours: 6, unit: 'nguoi' }],
      machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 0.5, hours: 3, unit: 'ca' }],
    });
    const legacySummary = summaryLog({
      status: 'verified',
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 20, unit: 'm3' }],
      laborDetails: [],
      machines: [],
      summarySourceMetadata: {
        legacyDailyLogIds: ['source-1', 'source-2'],
        sourceSnapshots: {
          'source-1': buildDailyLogSourceSnapshot(first),
          'source-2': buildDailyLogSourceSnapshot(second),
        },
      },
    });

    const resolution = resolveDailyLogSummaryDetails(legacySummary, [legacySummary, first, second]);

    expect(resolution.source).toBe('legacy_fallback');
    expect(resolution.details.volumes[0].quantity).toBe(30);
    expect(resolution.details.workerCount).toBe(7);
    expect(resolution.details.machines[0]).toMatchObject({ shifts: 1.5, hours: 10 });
  });

  it('keeps stored legacy details and reports unresolved when a linked source changed', () => {
    const reviewedSource = sourceLog({
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
    });
    const changedSource = { ...reviewedSource, updatedAt: '2026-07-05T10:20:00.000Z' };
    const legacySummary = summaryLog({
      status: 'verified',
      workerCount: 2,
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 12, unit: 'm3' }],
      summarySourceMetadata: {
        legacyDailyLogIds: ['source-1'],
        sourceSnapshots: { 'source-1': buildDailyLogSourceSnapshot(reviewedSource) },
      },
    });

    const resolution = resolveDailyLogSummaryDetails(legacySummary, [legacySummary, changedSource]);

    expect(resolution.source).toBe('unresolved');
    expect(resolution.details.volumes[0].quantity).toBe(12);
    expect(resolution.details.workerCount).toBe(2);
  });

  it('uses persisted version 2 details without rebuilding from linked sources', () => {
    const source = sourceLog({
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 99, unit: 'm3' }],
    });
    const versionedSummary = summaryLog({
      workerCount: 5,
      volumes: [{ taskId: 'task-1', taskName: 'Be tong', quantity: 30, unit: 'm3' }],
      summarySourceMetadata: {
        aggregationVersion: 2,
        legacyDailyLogIds: ['source-1'],
        sourceSnapshots: { 'source-1': buildDailyLogSourceSnapshot(source) },
      },
    });

    const resolution = resolveDailyLogSummaryDetails(versionedSummary, [versionedSummary, source]);

    expect(resolution.source).toBe('persisted');
    expect(resolution.details.volumes[0].quantity).toBe(30);
    expect(resolution.details.workerCount).toBe(5);
  });

  it('replaces every persisted summary detail group and always removes materials', () => {
    const staleSummary = summaryLog({
      workerCount: 1,
      volumes: [{ taskId: 'old-task', taskName: 'Cu', quantity: 1, unit: 'm3' }],
      materials: [{ materialId: 'material-1', itemName: 'Xi mang', quantity: 5, unit: 'bao' }],
      laborDetails: [{ laborType: 'Cu', count: 1, hours: 1 }],
      machines: [{ machineName: 'May cu', machineType: 'other', shifts: 1 }],
    });
    const details = buildDailyLogSummaryDetails([
      sourceLog({
        volumes: [{ taskId: 'task-1', taskName: 'Moi', quantity: 30, unit: 'm3' }],
        laborDetails: [{ laborType: 'Tho xay', count: 7, hours: 14 }],
        machines: [{ machineName: 'May dao', machineType: 'excavator', shifts: 1.5, hours: 10 }],
      }),
    ]);

    const result = withDailyLogSummaryDetails(staleSummary, details);

    expect(result.workerCount).toBe(7);
    expect(result.volumes[0].taskId).toBe('task-1');
    expect(result.laborDetails?.[0].count).toBe(7);
    expect(result.machines?.[0]).toMatchObject({ machineName: 'May dao', shifts: 1.5, hours: 10 });
    expect(result.materials).toEqual([]);
  });

  it('marks submitted sources outside the summary as waiting for KTT review', () => {
    expect(getDailyLogSourceReviewState({
      sourceLog: sourceLog({ submittedAt: '2026-07-05T08:15:00.000Z' }),
      included: false,
      snapshot: null,
    })).toBe('waiting_review');
  });

  it('keeps an included source clean while its submission matches the snapshot', () => {
    const log = sourceLog({
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
    });

    expect(buildDailyLogSourceSnapshot(log)).toEqual({
      sourceLogId: 'source-1',
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
      lastActionAt: null,
      status: 'submitted',
    });
    expect(getDailyLogSourceReviewState({
      sourceLog: log,
      included: true,
      snapshot: buildDailyLogSourceSnapshot(log),
    })).toBe('included');
  });

  it('marks an included source as needing review again when the employee resubmits it', () => {
    const reviewedLog = sourceLog({
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
    });
    const resubmittedLog = sourceLog({
      submittedAt: '2026-07-05T10:00:00.000Z',
      updatedAt: '2026-07-05T10:05:00.000Z',
    });

    expect(getDailyLogSourceReviewState({
      sourceLog: resubmittedLog,
      included: true,
      snapshot: buildDailyLogSourceSnapshot(reviewedLog),
    })).toBe('needs_rereview');
  });

  it('marks returned sources as returned even when they were already selected', () => {
    const returnedLog = sourceLog({
      status: 'rejected',
      submittedAt: '2026-07-05T08:15:00.000Z',
      updatedAt: '2026-07-05T08:20:00.000Z',
      rejectedAt: '2026-07-05T09:00:00.000Z',
    });

    expect(getDailyLogSourceReviewState({
      sourceLog: returnedLog,
      included: true,
      snapshot: buildDailyLogSourceSnapshot(returnedLog),
    })).toBe('returned');
  });

  it('keeps new member detail logs visible after a KTT summary has already selected other sources', () => {
    const existingSummary = summaryLog({
      status: 'draft',
      summarySourceMetadata: {
        legacyDailyLogIds: ['source-1'],
      },
    });
    const newMemberDraft = sourceLog({
      id: 'source-2',
      status: 'draft',
      createdBy: 'Nhan vien moi',
      createdById: 'member-2',
      submittedAt: null,
      submittedToUserId: null,
      requestedVerifierId: null,
    });

    const result = getDailyLogSummarySourceLogs(
      [existingSummary, sourceLog(), newMemberDraft],
      {
        canReviewSources: true,
        currentUserId: 'ktt-1',
        sourceSummaryLogIds: new Set(['source-1']),
      },
    );

    expect(result.map(log => log.id)).toEqual(['source-1', 'source-2']);
  });

  it('does not preselect a CHT approver by default', () => {
    expect(getDefaultDailyLogSummaryApprover([{ userId: 'cht-1' } as any])).toBeNull();
  });
});
