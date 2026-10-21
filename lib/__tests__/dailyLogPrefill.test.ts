import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import { buildDailyLogPrefill, shortDate } from '../dailyLogPrefill';

const log = (over: Partial<DailyLog>): DailyLog => ({
  id: over.id || 'log', date: '2026-10-10', weather: 'sunny', workerCount: 0, description: '', createdBy: 'x', createdAt: '2026-10-10T08:00:00Z',
  ...over,
} as DailyLog);

const crew = { laborType: 'Tổ đội', groupName: 'Tổ anh Minh', partnerId: 'p1', partnerName: 'Tổ anh Minh', taskId: 't1', taskName: 'Bê tông móng', count: 8, hours: 8, unit: 'người' };
const excavator = { machineName: 'Máy đào', machineType: 'excavator', catalogItemId: 'c1', catalogCode: 'MD', catalogName: 'Máy đào', shifts: 1, hours: 8 };

describe('buildDailyLogPrefill', () => {
  it('không có nhật ký trước ngày đang ghi thì không gợi ý', () => {
    expect(buildDailyLogPrefill([log({ date: '2026-10-11' })], { date: '2026-10-11' })).toBeNull();
    expect(buildDailyLogPrefill([log({ date: '2026-10-12' })], { date: '2026-10-11' })).toBeNull();
  });

  it('ưu tiên nhật ký có dòng của chính người ghi, thời tiết theo nhật ký gần nhất của công trường', () => {
    const logs = [
      log({ id: 'other-newest', date: '2026-10-10', weather: 'rainy', createdById: 'u2', laborDetails: [{ ...crew, groupName: 'Tổ khác', partnerName: 'Tổ khác' }] }),
      log({ id: 'mine', date: '2026-10-09', weather: 'sunny', createdById: 'u1', laborDetails: [crew], machines: [excavator] }),
    ];
    const prefill = buildDailyLogPrefill(logs, { date: '2026-10-11', userId: 'u1' });
    expect(prefill).toMatchObject({ sourceLogId: 'mine', sourceDate: '2026-10-09', byMe: true, weather: 'rainy', weatherDate: '2026-10-10' });
    expect(prefill?.labor).toEqual([crew]);
    expect(prefill?.machines).toEqual([excavator]);
  });

  it('không có nhật ký của mình thì lấy nhật ký gần nhất có dòng', () => {
    const logs = [
      log({ id: 'empty', date: '2026-10-10', createdById: 'u3' }),
      log({ id: 'rows', date: '2026-10-08', createdById: 'u2', machines: [excavator] }),
    ];
    const prefill = buildDailyLogPrefill(logs, { date: '2026-10-11', userId: 'u1' });
    expect(prefill).toMatchObject({ sourceLogId: 'rows', byMe: false, weatherDate: '2026-10-10' });
    expect(prefill?.labor).toEqual([]);
    expect(prefill?.machines).toEqual([excavator]);
  });

  it('bỏ dòng trống, bỏ id và thành tiền của nhật ký cũ', () => {
    const dirty = { ...crew, id: 'row-1', dailyLogId: 'old', sourceIndex: 3, totalCost: 4_000_000, unitCost: 500_000 } as any;
    const zero = { ...crew, count: 0 };
    const idleMachine = { ...excavator, shifts: 0, hours: 0 };
    const prefill = buildDailyLogPrefill([log({ laborDetails: [dirty, zero], machines: [idleMachine, excavator] })], { date: '2026-10-11' });
    expect(prefill?.labor).toEqual([{ ...crew, unitCost: 500_000 }]);
    expect(prefill?.machines).toEqual([excavator]);
  });

  it('nhật ký là ngày hôm sau của một ngày khác: so theo ngày, không theo giờ tạo', () => {
    const logs = [log({ id: 'a', date: '2026-10-10T17:00:00', createdAt: '2026-10-11T01:00:00Z', laborDetails: [crew] })];
    expect(buildDailyLogPrefill(logs, { date: '2026-10-11' })?.sourceLogId).toBe('a');
  });

  it('kế hoạch ngày hôm sau của nhật ký trước → gợi ý công việc hôm nay; ưu tiên nhật ký của mình', () => {
    const logs = [
      log({ id: 'other', date: '2026-10-10', createdById: 'u2', nextDayPlan: '- Đổ bê tông sàn tầng 2' }),
      log({ id: 'mine', date: '2026-10-09', createdById: 'u1', nextDayPlan: '  - Lắp cốp pha cột trục 3\n- Nghiệm thu thép  ' }),
    ];
    expect(buildDailyLogPrefill(logs, { date: '2026-10-11', userId: 'u1' })?.plan).toEqual({
      text: '- Lắp cốp pha cột trục 3\n- Nghiệm thu thép', logId: 'mine', date: '2026-10-09', byMe: true,
    });
    expect(buildDailyLogPrefill(logs, { date: '2026-10-11', userId: 'u3' })?.plan).toMatchObject({ logId: 'other', byMe: false });
  });

  it('kế hoạch quá 3 ngày hoặc để trống thì không gợi ý', () => {
    const stale = [log({ id: 'old', date: '2026-10-06', nextDayPlan: '- Việc cũ', laborDetails: [crew] })];
    expect(buildDailyLogPrefill(stale, { date: '2026-10-11' })?.plan).toBeNull();
    expect(buildDailyLogPrefill([log({ id: 'friday', date: '2026-10-09', nextDayPlan: '- Qua cuối tuần' })], { date: '2026-10-12' })?.plan?.logId).toBe('friday');
    expect(buildDailyLogPrefill([log({ id: 'blank', date: '2026-10-10', nextDayPlan: '   ' })], { date: '2026-10-11' })?.plan).toBeNull();
  });
});

describe('shortDate', () => {
  it('11/10', () => { expect(shortDate('2026-10-11')).toBe('11/10'); });
});
