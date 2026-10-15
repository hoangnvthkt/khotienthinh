import { describe, expect, it } from 'vitest';
import {
  addDays, buildActualProgressRows, dayCounts, getActualDayStatus, getConfirmBlock, isoWeekNumber, mondayOf, summarizeActualProgress,
  type ActualProgressWeek, type ActualProgressWeekDay, type ActualProgressWeekTask,
} from '../projectActualProgress';

const day = (date: string, extra: Partial<ActualProgressWeekDay> = {}): ActualProgressWeekDay => ({
  date, summaryId: null, summaryStatus: null, verifiedBy: null, verifiedAt: null, authors: null, photos: 0, progressRows: 0, ...extra,
});
const task = (id: string, extra: Partial<ActualProgressWeekTask> = {}): ActualProgressWeekTask => ({
  id, wbsCode: id, name: `Việc ${id}`, sortOrder: 0, groupId: 'g', groupName: 'Nhóm', groupWbs: '1', unit: 'm2', plannedQuantity: 100,
  currentPercent: 0, progressMode: 'weekly_report', startDate: '2026-10-01', endDate: '2026-10-10', duration: 10, isMilestone: false,
  resourceCount: 1, estimatedCostPerDay: 0, beforePercent: 10, beforeQuantity: 10, ...extra,
});

const week: ActualProgressWeek = {
  weekStart: '2026-10-12', source: 'daily_log', cutoverDate: '2026-10-09', canConfirm: true, canEditException: true, state: null,
  days: [
    day('2026-10-12', { summaryStatus: 'verified', progressRows: 2 }),
    day('2026-10-13', { summaryStatus: 'verified', progressRows: 2 }),
    day('2026-10-14', { summaryStatus: 'submitted' }),
    day('2026-10-15'), day('2026-10-16'), day('2026-10-17'), day('2026-10-18'),
  ],
  tasks: [task('a'), task('b', { beforePercent: 50, beforeQuantity: 50 })],
  entries: [
    { id: 'e1', taskId: 'a', date: '2026-10-12', percent: 20, quantity: 20, dailyQuantity: 10, sourceDailyLogId: 'L1', updatedAt: '1' },
    { id: 'e2', taskId: 'a', date: '2026-10-13', percent: 35, quantity: 35, dailyQuantity: 15, sourceDailyLogId: 'L2', updatedAt: '1' },
    { id: 'e3', taskId: 'b', date: '2026-10-12', percent: 50, quantity: 50, dailyQuantity: 0, sourceDailyLogId: 'L1', updatedAt: '1' },
  ],
  pending: [{ taskId: 'a', date: '2026-10-14', percent: 40, dailyQuantity: 5 }],
};
const counted = new Set(['2026-10-12', '2026-10-13']);

describe('tiến độ thực tế từ nhật ký', () => {
  it('trạng thái ngày theo bản tổng hợp, mốc chính thức và hôm nay', () => {
    const today = '2026-10-15';
    expect(getActualDayStatus(week.days[0], today, '2026-10-09')).toBe('approved');
    expect(getActualDayStatus(week.days[2], today, '2026-10-09')).toBe('pending');
    expect(getActualDayStatus(week.days[3], today, '2026-10-09')).toBe('today');
    expect(getActualDayStatus(week.days[4], today, '2026-10-09')).toBe('future');
    expect(getActualDayStatus(day('2026-10-08', { progressRows: 332 }), today, '2026-10-09')).toBe('before_cutover');
    expect(getActualDayStatus(day('2026-10-11'), today, '2026-10-09')).toBe('off');
    expect(getActualDayStatus(day('2026-10-10'), today, '2026-10-09')).toBe('missing');
    expect(getActualDayStatus(day('2026-10-10', { summaryStatus: 'draft' }), today, '2026-10-09')).toBe('not_sent');
    expect(dayCounts('before_cutover')).toBe(true);
    expect(dayCounts('pending')).toBe(false);
  });

  it('cả tuần: cộng KL các ngày đã duyệt, số chờ duyệt để riêng', () => {
    const [a, b] = buildActualProgressRows(week, counted, null);
    expect(a.beforePercent).toBe(10);
    expect(a.periodQuantity).toBe(25);
    expect(a.afterPercent).toBe(35);
    expect(a.pendingQuantity).toBe(5);
    expect(a.moved).toBe(true);
    expect(a.recordedDates).toEqual(['2026-10-12', '2026-10-13']);
    expect(b.moved).toBe(false);
  });

  it('một ngày: đầu kỳ là lũy kế hết hôm trước', () => {
    const [a] = buildActualProgressRows(week, counted, '2026-10-13');
    expect(a.beforePercent).toBe(20);
    expect(a.periodQuantity).toBe(15);
    expect(a.afterPercent).toBe(35);
    expect(a.pendingQuantity).toBe(0);
  });

  it('không tính ngày chưa duyệt', () => {
    const [a] = buildActualProgressRows(week, new Set(['2026-10-12']), null);
    expect(a.afterPercent).toBe(20);
  });

  it('% dự án theo trọng số Gantt', () => {
    const s = summarizeActualProgress(buildActualProgressRows(week, counted, null));
    expect(s.beforePercent).toBeCloseTo(30);
    expect(s.afterPercent).toBeCloseTo(42.5);
    expect(s.movedCount).toBe(1);
  });

  it('xác nhận tuần chỉ khi hết tuần, chưa khóa, có quyền', () => {
    expect(getConfirmBlock(week, '2026-10-15')).toBe('not_ended');
    expect(getConfirmBlock(week, '2026-10-19')).toBeNull();
    expect(getConfirmBlock({ ...week, canConfirm: false }, '2026-10-19')).toBe('no_permission');
    expect(getConfirmBlock({ ...week, state: { isLocked: true, lockedAt: null, lockedByName: null, unlockedAt: null, unlockReason: null } }, '2026-10-19')).toBe('locked');
    expect(getConfirmBlock({ ...week, source: 'manual' }, '2026-10-19')).toBe('manual');
  });

  it('tuần ISO và ngày', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(addDays('2026-10-12', 6)).toBe('2026-10-18');
    expect(isoWeekNumber('2026-10-12')).toBe(42);
    expect(isoWeekNumber('2026-01-01')).toBe(1);
  });
});
