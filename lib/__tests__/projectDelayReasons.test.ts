import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import { computeScheduleVariance } from '../projectScheduleVariance';
import {
  delayPartyTally, delayReasonTargets, inheritedDelayReason, initialDelayReasonDraft, nodeDelayReasons, partyOfReason,
  tasksAfterDailyLog, type DelayReasonEntry,
} from '../projectDelayReasons';

const task = (id: string, startDate: string, endDate: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id, name: id, wbsCode: id, startDate, endDate, duration: 0, progress: 0, isMilestone: false, order: 0, ...extra,
} as ProjectTask);

// Rút gọn từ DA29 ngày 13/10: móng PĐ1 chậm vì đổi chiều dài cọc, san lấp chờ móng, nhà văn phòng chậm vì nhân công.
const site = () => [
  task('4', '2026-08-25', '2027-01-10', { order: 1 }),
  task('4.1', '2026-08-25', '2026-11-17', { parentId: '4', order: 1 }),
  task('4.1.1', '2026-08-25', '2026-09-30', { parentId: '4.1', order: 1 }),
  task('4.1.1.1', '2026-08-25', '2026-08-27', { parentId: '4.1.1', order: 1, progress: 30 }),
  task('4.1.1.3', '2026-08-28', '2026-08-31', { parentId: '4.1.1', order: 2 }), // chờ 4.1.1.1
  task('4.1.3', '2026-08-26', '2026-11-17', { parentId: '4.1', order: 2, progress: 60 }),
  task('4.2', '2026-10-01', '2026-10-22', { parentId: '4', order: 2 }),
  task('4.2.1', '2026-10-01', '2026-10-04', { parentId: '4.2', order: 1 }),
  task('4.2.4', '2026-10-10', '2026-10-17', { parentId: '4.2', order: 2 }), // chờ 4.2.1
  task('4.3', '2026-11-18', '2027-01-10', { parentId: '4', order: 3 }),
  task('9', '2027-01-11', '2027-01-15', { order: 2 }),
];
const reason = (taskId: string, reasonCode: string, responsibleParty: DelayReasonEntry['responsibleParty']): DelayReasonEntry => ({ taskId, reasonCode, responsibleParty });

describe('lý do chậm ở Nhật ký', () => {
  const result = computeScheduleVariance(site(), '2026-10-13');

  it('chỉ bắt chọn lý do cho việc gây chậm; việc chậm theo việc trước thì không', () => {
    const { required, chained } = delayReasonTargets(result);
    expect(required.map(node => node.id)).toEqual(['4.1.1.1', '4.2.1']);
    expect(chained.map(node => node.id)).toEqual(['4.1.1.3', '4.2.4']);
  });

  it('việc chậm theo lấy lý do của việc trước', () => {
    const reasons = new Map([['4.1.1.1', reason('4.1.1.1', 'design', 'owner')]]);
    expect(inheritedDelayReason(result, '4.1.1.3', reasons)).toMatchObject({ reasonCode: 'design', responsibleParty: 'owner', fromTaskId: '4.1.1.1' });
    expect(inheritedDelayReason(result, '4.2.4', reasons)).toBeNull();
  });

  it('thẻ Tiến độ tổng gộp lý do theo hạng mục và đếm việc chưa có lý do', () => {
    const reasons = new Map([['4.1.1.1', reason('4.1.1.1', 'design', 'owner')]]);
    expect(nodeDelayReasons(result, '4.1', reasons)).toEqual({
      items: [{ reasonCode: 'design', responsibleParty: 'owner', count: 1 }], inherited: false, followCount: 1, missingCount: 0,
    });
    expect(nodeDelayReasons(result, '4.2', reasons)).toMatchObject({ items: [], missingCount: 1 });
    expect(nodeDelayReasons(result, '4.3', reasons)).toBeNull();
    reasons.set('4.2.1', reason('4.2.1', 'site', 'company'));
    expect(delayPartyTally(result, reasons)).toEqual({
      parties: [
        { party: 'owner', count: 1, maxLagDays: 50, reasonCodes: ['design'] },
        { party: 'company', count: 1, maxLagDays: 13, reasonCodes: ['site'] },
      ],
      total: 2, missing: 0, chained: 2,
    });
  });

  it('hôm sau giữ lý do đã công bố, nháp của bản tổng hợp được ưu tiên', () => {
    const { required } = delayReasonTargets(result);
    const latest = [{ ...reason('4.1.1.1', 'design', 'owner'), logDate: '2026-10-12' }];
    expect(initialDelayReasonDraft(required, [], latest)).toEqual({ '4.1.1.1': { ...latest[0], kept: true } });
    const draft = [reason('4.1.1.1', 'labor', 'company')];
    expect(initialDelayReasonDraft(required, draft, latest)['4.1.1.1']).toMatchObject({ reasonCode: 'labor', kept: false });
  });

  it('tính theo % của bản tổng hợp sắp công bố; NCC tính Công ty', () => {
    const after = tasksAfterDailyLog(site(), new Map([['4.2.1', 100]]), '2026-10-13');
    expect(after.find(item => item.id === '4.2.1')).toMatchObject({ progress: 100, actualEndDate: '2026-10-13' });
    expect(delayReasonTargets(computeScheduleVariance(after, '2026-10-13')).required.map(node => node.id)).toEqual(['4.1.1.1']);
    const catalog = [{ code: 'material', label: 'Chậm do vật tư', defaultParty: 'vendor' }, { code: 'weather', label: 'Thời tiết', defaultParty: 'objective' }];
    expect(partyOfReason(catalog, 'material')).toBe('company');
    expect(partyOfReason(catalog, 'weather')).toBe('objective');
  });
});
