import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import { computeScheduleVariance, varianceDataDate, varianceSlackDays, varianceStatus } from '../projectScheduleVariance';

const task = (id: string, startDate: string, endDate: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id, name: id, wbsCode: id, startDate, endDate, duration: 0, progress: 0, isMilestone: false, order: 0, ...extra,
} as ProjectTask);

// Rút gọn từ DA29: móng phân đoạn chậm bị "che" bởi một việc dài trong hạng mục Móng.
const plant = () => [
  task('NX', '2026-08-25', '2027-01-10', { order: 1 }),
  task('M', '2026-08-25', '2026-11-17', { parentId: 'NX', order: 1 }),
  task('M1', '2026-09-20', '2026-09-30', { parentId: 'M', order: 1, progress: 0 }), // quá hạn, chưa làm
  task('M3', '2026-09-25', '2026-11-17', { parentId: 'M', order: 2, progress: 30 }), // việc dài chạy song song, đúng nhịp
  task('KCT', '2026-10-23', '2026-11-26', { parentId: 'NX', order: 2 }),
  task('TM', '2026-11-27', '2027-01-10', { parentId: 'NX', order: 3 }),
  task('BG', '2027-01-11', '2027-01-15', { order: 2 }),
];

describe('nhanh / chậm so với tiến độ tổng', () => {
  it('không khai báo mốc thì việc con chậm bị che, hạng mục vẫn đúng hạn', () => {
    const result = computeScheduleVariance(plant(), '2026-10-09');
    expect(result.nodes.get('M1')).toMatchObject({ forecastEnd: '2026-10-20', lagDays: -20 });
    expect(varianceStatus(result.nodes.get('M')!.lagDays)).toBe('on_time');
    expect(result.nodes.get('NX')!.lagDays).toBe(0);
    expect(result.projectLagDays).toBe(0);
    // Nối tự động: M1 → M3 không có (chồng ngày); KCT → TM có (liền nhau), NX → BG ở gốc.
    expect(result.links.filter(link => link.kind === 'auto').map(link => `${link.predId}>${link.succId}`).sort())
      .toEqual(['KCT>TM', 'NX>BG']);
  });

  it('mốc "móng xong mới lắp KCT" làm chậm dồn tới về đích, trừ khoảng trống kế hoạch', () => {
    const tasks = plant().map(item => item.id === 'KCT' ? { ...item, dependencies: [{ taskId: 'M1', type: 'FS' as const }] } : item);
    const result = computeScheduleVariance(tasks, '2026-10-09');
    const link = result.links.find(item => item.kind === 'manual')!;
    expect(link).toMatchObject({ predId: 'M1', succId: 'KCT', gapDays: 22, predDelayDays: 20, succShiftDays: 0 });
    expect(result.projectLagDays).toBe(0);

    const later = computeScheduleVariance(tasks, '2026-10-20'); // thêm 11 ngày vẫn chưa làm
    expect(later.nodes.get('M1')!.lagDays).toBe(-31);
    expect(later.nodes.get('KCT')).toMatchObject({ lagDays: -9, blockerIds: ['M1'] });
    expect(later.nodes.get('TM')!.lagDays).toBe(-9);
    expect(later.nodes.get('NX')!.lagDays).toBe(-9);
    expect(later.nodes.get('BG')!.lagDays).toBe(-9);
    expect(later.projectForecastEnd).toBe('2027-01-24');
    expect(varianceStatus(later.projectLagDays)).toBe('late');
  });

  it('phụ thuộc khác FS = làm song song, bỏ nối tự động', () => {
    const tasks = plant().map(item => item.id === 'TM' ? { ...item, dependencies: [{ taskId: 'KCT', type: 'SS' as const }] } : item);
    const result = computeScheduleVariance(tasks, '2026-10-09');
    expect(result.links.some(link => link.predId === 'KCT' && link.succId === 'TM')).toBe(false);
    expect(result.parallelPairs).toEqual([['KCT', 'TM']]);
  });

  it('việc đang làm tính phần còn lại theo nhịp kế hoạch; xong rồi lấy ngày xong thật', () => {
    const result = computeScheduleVariance([
      task('A', '2026-10-01', '2026-10-10', { progress: 80 }),
      task('B', '2026-09-01', '2026-09-10', { progress: 100, actualEndDate: '2026-09-18' }),
      task('C', '2026-11-01', '2026-11-05'),
    ], '2026-10-03');
    expect(result.nodes.get('A')).toMatchObject({ forecastEnd: '2026-10-05', lagDays: 5 });
    expect(varianceStatus(5)).toBe('early');
    expect(result.nodes.get('B')).toMatchObject({ forecastEnd: '2026-09-18', lagDays: -8, done: true });
    expect(result.nodes.get('C')!.lagDays).toBe(0);
    expect(result.volume).toEqual({ actualPercent: 72, plannedPercent: 52 });
    expect(varianceSlackDays(result, 'C')).toBe(0);
  });

  it('ngày số liệu = nhật ký tổng hợp duyệt gần nhất khi dùng Nhật ký chính thức', () => {
    const logs = [
      { date: '2026-10-09', status: 'verified', summarySourceType: 'member_contributions' },
      { date: '2026-10-12', status: 'submitted', summarySourceType: 'member_contributions' },
      { date: '2026-10-11', status: 'verified', summarySourceType: 'manual' },
    ];
    expect(varianceDataDate({ today: '2026-10-15', authoritative: true, logs })).toBe('2026-10-09');
    expect(varianceDataDate({ today: '2026-10-15', authoritative: false, logs })).toBe('2026-10-15');
    expect(varianceDataDate({ today: '2026-10-15', authoritative: true, logs: [] })).toBe('2026-10-15');
  });
});
