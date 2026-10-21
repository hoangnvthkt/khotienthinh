import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import { calculateProjectProgress, deriveProjectTaskProgress } from '../projectScheduleRules';

const task = (id: string, parentId: string | undefined, duration: number, progress: number, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id, name: id, parentId, startDate: '2026-10-01', endDate: '2026-10-31', duration, progress, isMilestone: false, order: 0, ...extra,
} as ProjectTask);

const byId = (tasks: ProjectTask[]) => new Map(deriveProjectTaskProgress(tasks, [], '2026-10-21').map(item => [item.id, item.progress]));

describe('% hạng mục cha theo số ngày kế hoạch', () => {
  it('không để khối lượng khác đơn vị (kg át m2) quyết định % cha — DA29 2.3', () => {
    const tasks = [
      task('2', undefined, 0, 0),
      task('2.3', '2', 0, 0),
      task('2.3.4', '2.3', 4, 10, { provisionalQuantity: 1384, fallbackUnit: 'm2' }),
      task('2.3.5', '2.3', 6, 0, { provisionalQuantity: 35654, fallbackUnit: 'kg' }),
      task('2.3.3', '2.3', 3, 0, { provisionalQuantity: 28, fallbackUnit: 'm3' }),
      task('2.4', '2', 7, 50),
    ];
    const progress = byId(tasks);
    expect(progress.get('2.3')).toBe(3); // 10 × 4 / 13
    expect(progress.get('2')).toBe(20); // (40 + 350) / 20 = 19,5 — tính thẳng từ việc lá, không trung bình các nhóm
  });

  it('dòng gốc khớp % dự án', () => {
    const tasks = [task('1', undefined, 0, 0), task('1.1', '1', 10, 80), task('1.2', '1', 2, 0), task('1.3', '1', 5, 30, { resourceCount: 300 })];
    const derived = deriveProjectTaskProgress(tasks, [], '2026-10-21');
    expect(derived.find(item => item.id === '1')!.progress).toBe(calculateProjectProgress(derived).progressPercent);
  });

  it('chỉ 100% khi mọi việc lá xong', () => {
    const tasks = [task('9', undefined, 0, 0), ...Array.from({ length: 13 }, (_, index) => task(`9.${index + 1}`, '9', 50, 100)), task('9.14', '9', 1, 0)];
    expect(byId(tasks).get('9')).toBe(99); // 99,85% làm tròn ra 100 nhưng còn 9.14 chưa làm
    expect(byId(tasks.map(item => item.id === '9.14' ? { ...item, progress: 100 } : item)).get('9')).toBe(100);
  });
});

describe('% dự án theo số ngày kế hoạch', () => {
  it('bỏ hệ số số công nhân và chi phí ngày', () => {
    const tasks = [task('1', undefined, 10, 100, { resourceCount: 778 }), task('2', undefined, 10, 0, { estimatedCostPerDay: 5_000_000 })];
    expect(calculateProjectProgress(tasks).progressPercent).toBe(50);
  });
});
