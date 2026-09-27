import type { DailyLogDocumentBundle } from '../../lib/dailyLogWbsService';
export const engineerBundle: DailyLogDocumentBundle = {
  rollout: { mode: 'pilot', cutoverDate: '2026-09-23', enabled: true },
  tasks: [{ id: 'task-1', name: 'Bê tông móng', wbsCode: '1.1', fallbackUnit: 'm³', provisionalQuantity: 100, endDate: '2026-09-30' } as any],
  workBoqItems: [], resourceProviders: [], previousProgressRows: [], nextProgressRows: [],
  contribution: { id: 'source-A', date: '2026-09-27', authorUserId: 'engineer', authorName: 'Kỹ sư Minh',
    workAreaCode: 'A', workAreaName: 'Khu A', content: 'Nội dung cũ', issues: 'Lối vào hẹp',
    photos: [{ name: 'Ảnh hiện trường', url: '/existing-photo.png' }], status: 'draft', rowVersion: 4,
    sourceDocumentVersion: 2, createdAt: '2026-09-27T00:00:00Z',
    sourceDraftPayload: { workAreaCode: 'A', workAreaName: 'Khu A', content: 'Nội dung cũ', issues: 'Lối vào hẹp',
      photos: [{ name: 'Ảnh hiện trường', url: '/existing-photo.png' }], savedRowVersion: 4,
      items: [{ clientKey: 'item-1', taskId: 'task-1', entryMode: 'daily_quantity', enteredValue: '12,5',
        baselineFingerprint: 'qualified-A', note: 'Ghi chú hạng mục', forecastFinishDate: '2026-09-30' }], labor: [], machines: [] } },
  myContributions: [], baselineQuantityStates: { 'task-1': 'known' }, baselineQuantityFingerprints: { 'task-1': 'qualified-A' },
  quantityBaselines: { 'task-1': { state: 'known', fingerprint: 'qualified-A', allowOver100: true, priorRowId: 'prior',
    previousItem: { cumulativeQuantityDone: 40, areaPlannedQuantitySnapshot: 100, unitSnapshot: 'm³' }, nextItem: null } },
  contributionsForSummary: [], summaryLog: null, summarySources: [], workItems: [], decisions: [], labor: [], machines: [], periodState: null,
  permissions: { canCreateSource: true, canSubmitSource: true, canEditSource: true, canSummarize: false, canApprove: false, canPublishProgress: false },
};
