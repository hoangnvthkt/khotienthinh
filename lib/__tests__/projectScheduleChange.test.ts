import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../../types';
import {
  applyLinesToTasks, buildDraftLines, mapScheduleError, rollupAncestors, summarizeDraft, toScheduleParty,
  type ScheduleChangeLine,
} from '../projectScheduleChangeService';

const task = (id: string, startDate: string, endDate: string, extra: Partial<ProjectTask> = {}): ProjectTask => ({
  id, name: id, startDate, endDate, duration: 0, progress: 0, isMilestone: false, order: 0, ...extra,
} as ProjectTask);

// Nhà xưởng số 3 (SMB-2026) rút gọn: 16 là cha của 16.1, 16.11.
const current = [
  task('16', '2026-08-13', '2026-10-05', { wbsCode: '16' }),
  task('16.1', '2026-08-13', '2026-08-19', { parentId: '16', wbsCode: '16.1', provisionalQuantity: 1284 }),
  task('16.11', '2026-09-21', '2026-10-05', { parentId: '16', wbsCode: '16.11', provisionalQuantity: 5500 }),
  task('15.3', '2026-08-14', '2026-10-22', { wbsCode: '15.3', progress: 100 }),
];

describe('bản nháp điều chỉnh tiến độ', () => {
  it('cập nhật việc cha theo việc con đổi ngày', () => {
    const moved = current.map(item => item.id === '16.11' ? { ...item, startDate: '2026-11-27', endDate: '2026-12-09' } : item);
    const rolled = rollupAncestors(moved, ['16.11']);
    const parent = rolled.find(item => item.id === '16')!;
    expect(parent.startDate).toBe('2026-08-13');
    expect(parent.endDate).toBe('2026-12-09');
    expect(parent.duration).toBe(118);
  });

  it('chỉ lấy ngày, khối lượng, thêm và xóa làm dòng phiếu', () => {
    const draft = rollupAncestors(current
      .filter(item => item.id !== '16.1')
      .map(item => item.id === '16.11' ? { ...item, startDate: '2026-11-27', endDate: '2026-12-09', provisionalQuantity: 5200, name: 'đổi tên' } : item)
      .concat(task('new', '2026-12-01', '2026-12-06', { parentId: '16', wbsCode: '16.12', provisionalQuantity: 640, fallbackUnit: 'm2' })), ['16.11', 'new']);
    const lines = buildDraftLines(current, draft, { '16.11': { reasonCode: 'scope', responsibleParty: 'owner' } });
    expect(lines.map(line => `${line.action}:${line.taskId}`).sort()).toEqual(['add:new', 'delete:16.1', 'update:16', 'update:16.11']);
    expect(lines.find(line => line.taskId === '16.11')).toMatchObject({ afterEnd: '2026-12-09', afterQty: 5200, reasonCode: 'scope', responsibleParty: 'owner' });
    expect(lines.find(line => line.taskId === 'new')).toMatchObject({ name: 'new', parentId: '16', wbsCode: '16.12', unit: 'm2', afterQty: 640 });

    const summary = summarizeDraft(current, draft);
    expect(summary).toMatchObject({ moved: 1, added: 1, deleted: 1, qtyChanged: 1, finishBefore: '2026-10-22', finishAfter: '2026-12-09', finishDelta: 48 });
    expect(summary.rows.find(row => row.taskId === '16.11')).toMatchObject({ deltaDays: 65, setsFinish: true, isLeaf: true });
    expect(summary.rows.find(row => row.taskId === '16')?.isLeaf).toBe(false);
  });

  it('không có thay đổi thì không có dòng', () => {
    expect(buildDraftLines(current, current.map(item => ({ ...item, notes: 'x' })))).toEqual([]);
    expect(summarizeDraft(current, current).finishDelta).toBe(0);
  });

  it('dựng lại bản nháp từ dòng đã lưu', () => {
    const lines: ScheduleChangeLine[] = [
      { taskId: '16.11', action: 'update', parentId: '16', wbsCode: '16.11', taskName: '16.11', isLeaf: true, beforeStart: '2026-09-21', beforeEnd: '2026-10-05', beforeQty: 5500, afterStart: '2026-11-27', afterEnd: '2026-12-09', afterQty: 5500, deltaDays: 65, reasonCode: null, responsibleParty: null, note: null, payload: {} },
      { taskId: '16.1', action: 'delete', parentId: '16', wbsCode: '16.1', taskName: '16.1', isLeaf: true, beforeStart: '2026-08-13', beforeEnd: '2026-08-19', beforeQty: 1284, afterStart: null, afterEnd: null, afterQty: null, deltaDays: null, reasonCode: null, responsibleParty: null, note: null, payload: {} },
      { taskId: 'new', action: 'add', parentId: '16', wbsCode: '16.12', taskName: 'Sơn epoxy', isLeaf: true, beforeStart: null, beforeEnd: null, beforeQty: null, afterStart: '2026-12-01', afterEnd: '2026-12-06', afterQty: 640, deltaDays: null, reasonCode: null, responsibleParty: null, note: null, payload: { unit: 'm2', sortOrder: 9 } },
    ];
    const draft = applyLinesToTasks(current, lines, { projectId: 'p', constructionSiteId: 's' });
    expect(draft.map(item => item.id).sort()).toEqual(['15.3', '16', '16.11', 'new']);
    expect(draft.find(item => item.id === '16.11')).toMatchObject({ startDate: '2026-11-27', endDate: '2026-12-09', duration: 12 });
    expect(draft.find(item => item.id === 'new')).toMatchObject({ name: 'Sơn epoxy', parentId: '16', fallbackUnit: 'm2', provisionalQuantity: 640, order: 9, progress: 0 });
  });

  it('báo lỗi máy chủ bằng lời dễ hiểu', () => {
    expect(mapScheduleError({ message: 'SCHEDULE_BACKDATE', details: '16.9 Chạy thử' }).message).toContain('16.9 Chạy thử');
    expect(mapScheduleError({ message: 'SCHEDULE_SELF_APPROVAL' }).code).toBe('SCHEDULE_SELF_APPROVAL');
    expect(mapScheduleError({ message: 'boom' }).code).toBe('UNKNOWN');
    expect(toScheduleParty('vendor')).toBe('company');
  });
});
