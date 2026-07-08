import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import {
  buildDailyLogSourceSnapshot,
  buildDailyLogSummaryVolumes,
  canReturnDailyLogSource,
  DAILY_SUMMARY_SOURCE_TYPE,
  getDefaultDailyLogSummaryApprover,
  getDailyLogSourceReviewState,
  getDailyLogSummarySourceLogs,
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
  it('allows KTT to return a submitted source when the linked summary is editable', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog(),
      sourceSummaryLog: summaryLog({ status: 'rejected' }),
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['verify']),
    })).toBe(true);
  });

  it('does not allow returning a source while the linked summary is waiting for CHT', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog(),
      sourceSummaryLog: summaryLog({ status: 'submitted', submittedToPermission: 'approve' }),
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['verify']),
    })).toBe(false);
  });

  it('requires the current KTT handler when the source is assigned to a specific verifier', () => {
    expect(canReturnDailyLogSource({
      sourceLog: sourceLog({ requestedVerifierId: 'ktt-2', submittedToUserId: 'ktt-2' }),
      sourceSummaryLog: null,
      userId: 'ktt-1',
      isAdmin: false,
      permissions: new Set(['verify']),
    })).toBe(false);
  });

  it('builds summary volumes from source logs without duplicating the same daily progress item', () => {
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
          { taskId: 'task-2', taskName: 'Lap dung cot', quantity: 4, unit: 'tan' },
        ],
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map(row => row.taskId)).toEqual(['task-1', 'task-2']);
    expect(result[0].quantity).toBe(12);
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
