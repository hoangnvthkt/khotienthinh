import { describe, expect, it } from 'vitest';
import type { CenterToday } from '../centerTodayService';
import type { WorkItem } from '../workItemsService';
import { answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys, pronounOf } from '../assistantBrief';

const NOW = new Date(2026, 9, 7, 8, 30);
const at = (days: number, hour = 17) => new Date(2026, 9, 7 + days, hour, 0).toISOString();
const item = (partial: Partial<WorkItem> & Pick<WorkItem, 'source' | 'module' | 'kind' | 'id' | 'code' | 'title'>): WorkItem => ({
  who: null, whoId: null, meta: null, dueAt: null, status: null, ref: {}, ...partial,
});

// Cùng số liệu với fixture Trung tâm (SMB-2026, mockup v1.1).
const TODAY: CenterToday = {
  generatedAt: NOW.toISOString(), today: '2026-10-07',
  project: { id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', status: 'active', endDate: '2026-10-21', source: 'assignment', site: { id: 'site-smb', name: 'Sơn Miền Bắc', latitude: null, longitude: null } },
  projectOptions: [],
  widgets: {
    project: {
      construction: { state: 'ready', slips: 3, fronts: 5, people: 39, summaryStatus: 'submitted' },
      supply: { state: 'ready', count: 6, amount: 5_360_000_000, nextPo: { poId: 'po-116', poNumber: 'PO-116', expectedDate: '2026-10-09' } },
      progress: { state: 'ready', mode: 'gantt_weighted', percent: 81, total: 332, done: 170, inProgress: 13, overdue: 7, notStarted: 142, endDate: '2026-10-21' },
      waiting: 3,
    },
    hrm: { state: 'ready', attendance: null, leave: { availableDays: 6, pendingDays: 0, year: 2026 }, timesheet: { workDays: 4, month: 10, year: 2026, periodStatus: null }, team: { state: 'ready', total: 28, present: 21, assignments: 6 } },
    work: { workEnabled: true, assigned: { active: 3, overdue: 1, nearest: null }, created: { open: 3, awaitingReview: 0 }, requests: { pending: 1, returned: 0, latest: null } },
    office: { documents: { state: 'ready', count: 1, first: { id: 'tb-12', documentNumber: 'TB-12/2026', title: 'Quy định an toàn' } }, nextTrip: null },
    supply: { requests: { state: 'ready', pending: 4, supplying: 29, waitingStep: 'Phòng vật tư duyệt' }, orders: { state: 'denied' }, warehouse: { id: 'wh', name: 'Kho SMB', canView: false } },
    finance: null,
  },
};
const ITEMS: WorkItem[] = [
  item({ source: 'rq', module: 'request', kind: 'approve', id: 'rq-61', code: 'RQ-2026-000061', title: 'Bổ sung 2 kỹ sư', dueAt: at(2) }),
  item({ source: 'po', module: 'procurement', kind: 'approve', id: 'po-116', code: 'PO-116', title: 'Kết cấu thép 568 · 1,3 tỷ', dueAt: at(-2) }),
  item({ source: 'work_plan', module: 'project', kind: 'approve', id: 'wp-41', code: 'KH-2026-41', title: 'Kế hoạch tuần 06/10–12/10', dueAt: at(0) }),
  item({ source: 'mr', module: 'project', kind: 'approve', id: 'mr-2688', code: 'MR-2026-2688', title: 'Thép D16 + D10 móng nhà xưởng 3', dueAt: at(0, 13) }),
  item({ source: 'work', module: 'work', kind: 'do', id: 'wk-1203', code: 'VW-2026-001203', title: 'Gửi biên bản nghiệm thu', dueAt: at(0, 18) }),
  item({ source: 'leave', module: 'hrm', kind: 'approve', id: 'np-41', code: 'NP-2026-041', title: 'Nghỉ phép 2 ngày', dueAt: at(1) }),
];

describe('buildBrief — bản tin gọn', () => {
  const brief = buildBrief(TODAY, ITEMS, NOW, 'Nam');

  it('câu đầu: tổng việc và số việc phải xong hôm nay (quá hạn + hạn hôm nay), xưng theo giới tính', () => {
    expect(brief.headline).toBe('Anh có 6 việc chờ, 4 việc phải xong hôm nay');
    expect(buildBrief(TODAY, [], NOW, 'Nữ').headline).toBe('Chị không có việc chờ');
    expect(buildBrief(TODAY, [ITEMS[0]], NOW, null).headline).toBe('Bạn có 1 việc chờ, không có việc gấp');
    expect(buildBrief(TODAY, null, NOW, 'Nam')).toMatchObject({ headline: 'Chưa đọc được việc của bạn', total: null, tasks: [] });
    expect(pronounOf('Khác')).toBe('Bạn');
  });

  it('Làm trước: tối đa 3 việc theo hạn; chỉ quá hạn đỏ, hôm nay cam; còn lại gom thành một dòng', () => {
    expect(brief.tasks.map(t => [t.code, t.verb, t.due, t.tone])).toEqual([
      ['PO-116', 'Duyệt', 'quá hạn 2 ngày', 'overdue'],
      ['MR-2026-2688', 'Duyệt', 'còn 5 giờ', 'today'],
      ['KH-2026-41', 'Duyệt', 'còn 9 giờ', 'today'],
    ]);
    expect(brief.tasks[0].item.id).toBe('po-116');
    expect(brief.more).toBe('+ 1 việc khác hạn hôm nay');
    expect(buildBrief(TODAY, [ITEMS[1], ITEMS[0], ITEMS[5], ITEMS[3]], NOW, 'Nam').more).toBe('+ 1 việc khác');
  });

  it('Đáng lo: tối đa 3 điều, đỏ trước rồi cam, câu ngắn; mỗi điều mở đúng màn; không lặp việc ở cột trái', () => {
    expect(brief.worries?.map(w => [w.text, w.tone, w.target.kind])).toEqual([
      ['Tiến độ SMB-2026: 7 việc trễ · hạn HĐ 21/10', 'danger', 'route'],
      ['Thi công hôm nay: 2/5 mũi chưa gửi phiếu', 'warn', 'route'],
      ['4 đề xuất vật tư đang chờ Phòng vật tư duyệt', 'warn', 'route'],
    ]);
    const late: CenterToday = { ...TODAY, widgets: { ...TODAY.widgets, project: { ...TODAY.widgets.project!, supply: { ...TODAY.widgets.project!.supply, nextPo: { poId: 'po-1', poNumber: 'PO-120', expectedDate: '2026-10-05' } } } } };
    expect(buildBrief(late, ITEMS, NOW, 'Nam').worries?.[1]).toMatchObject({ text: 'PO-120 quá ngày hẹn giao 05/10', tone: 'danger' });
    const calm: CenterToday = { ...TODAY, project: null, widgets: { ...TODAY.widgets, project: null, supply: null, hrm: { state: 'ready', attendance: null, leave: null, timesheet: null } } };
    expect(buildBrief(calm, ITEMS, NOW, 'Nam').worries).toEqual([]);
    expect(buildBrief(null, ITEMS, NOW, 'Nam').worries).toBeNull();
  });

  it('hỏi nhanh theo nhóm có số liệu; dòng số liệu cho AI có khóa; tìm lại theo khóa bỏ khóa lạ', () => {
    expect(availableQuickQuestions(brief).map(q => q.id)).toEqual(['project', 'supply', 'hrm']);
    expect(answerQuick(brief, 'project').map(l => l.label)).toEqual(['Thi công hôm nay', 'Vật tư đang về', 'Tiến độ', 'Chờ bạn']);
    expect(answerQuick(brief, 'nope')).toEqual([]);
    const facts = briefFacts(brief);
    expect(facts).toContain('project.progress | Tiến độ: 81% · hạn HĐ 21/10 · 7 việc trễ (170 xong · 13 đang làm · 332 việc)');
    expect(facts).toContain('item.po.po-116 | PO-116 · quá hạn 2 ngày: Duyệt · Kết cấu thép 568 · 1,3 tỷ');
    expect(facts).toContain('[chưa có quyền xem]');
    expect(linesByKeys(brief, ['supply.requests', 'x.y', 'item.po.po-116']).map(l => l.key)).toEqual(['supply.requests', 'item.po.po-116']);
    expect(briefDateLabel(NOW)).toBe('Thứ tư 07/10');
  });
});
