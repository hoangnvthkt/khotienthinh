import { describe, expect, it } from 'vitest';
import type { CenterToday } from '../centerTodayService';
import type { WorkItem } from '../workItemsService';
import { answerQuick, availableQuickQuestions, briefDateLabel, briefFacts, buildBrief, linesByKeys } from '../assistantBrief';

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
  item({ source: 'po', module: 'procurement', kind: 'approve', id: 'po-116', code: 'PO-116', title: 'Kết cấu thép 568 · 1,3 tỷ', dueAt: at(-2) }),
  item({ source: 'mr', module: 'project', kind: 'approve', id: 'mr-2688', code: 'MR-2026-2688', title: 'Thép D16 + D10 móng nhà xưởng 3', who: 'Nguyễn Chấp Việt lập', dueAt: at(0, 13) }),
  item({ source: 'leave', module: 'hrm', kind: 'approve', id: 'np-41', code: 'NP-2026-041', title: 'Trần Văn Hải nghỉ phép 2 ngày', dueAt: at(1) }),
  item({ source: 'rq', module: 'request', kind: 'approve', id: 'rq-61', code: 'RQ-2026-000061', title: 'Bổ sung 2 kỹ sư', dueAt: at(2) }),
];

describe('buildBrief — bản tin hôm nay', () => {
  const brief = buildBrief(TODAY, ITEMS, NOW, 4);

  it('Cần chú ý: số đỏ trước, rồi việc quá hạn / hôm nay, rồi số cam — cùng chữ với ô Hôm nay', () => {
    const attention = brief.sections.find(s => s.id === 'attention')!;
    expect(attention.lines.map(l => l.key)).toEqual([
      'project.progress', 'work.assigned', 'item.po.po-116', 'item.mr.mr-2688',
      'project.construction', 'hrm.attendance', 'hrm.team', 'office.documents', 'supply.requests',
    ]);
    expect(attention.lines[0]).toMatchObject({ label: 'Tiến độ', text: '81% · hạn HĐ 21/10 · 7 việc trễ', tone: 'danger', target: { kind: 'route' } });
    expect(attention.lines[2]).toMatchObject({ label: 'PO-116 · quá hạn 2 ngày', text: 'Kết cấu thép 568 · 1,3 tỷ', tone: 'danger' });
    expect(attention.lines[2].item?.id).toBe('po-116');
    expect(brief.attention).toBe(9);
  });

  it('Việc chờ bạn: tổng + số gấp, rồi các việc còn lại theo hạn gần nhất; nhóm module giữ nguyên dòng số liệu, khóa khi không có quyền', () => {
    const mine = brief.sections.find(s => s.id === 'mine')!;
    expect(mine.lines[0]).toMatchObject({ text: '4 việc · 2 quá hạn hoặc hôm nay · 2 trong 3 ngày tới', tone: 'danger', target: { kind: 'inbox' } });
    expect(mine.lines.slice(1).map(l => l.item?.code)).toEqual(['NP-2026-041', 'RQ-2026-000061']);
    const supply = brief.sections.find(s => s.id === 'supply')!;
    expect(supply.title).toBe('Mua hàng & Kho');
    expect(supply.lines.find(l => l.key === 'supply.orders')).toMatchObject({ text: 'Cần quyền xem đơn hàng', locked: expect.stringContaining('chưa có quyền') });
    expect(supply.routeLabel).toBeTruthy();
  });

  it('không đọc được Việc của tôi: vẫn có bản tin, dòng việc báo rõ; không có gì gấp thì nói vậy', () => {
    const noItems = buildBrief(TODAY, null, NOW, null);
    expect(noItems.sections.find(s => s.id === 'mine')!.lines[0]).toMatchObject({ text: 'Chưa đọc được Việc của tôi', tone: 'muted' });
    const calm: CenterToday = { ...TODAY, project: null, widgets: { ...TODAY.widgets, project: null, supply: null, work: { workEnabled: false, assigned: null, created: null, requests: { pending: 0, returned: 0, latest: null } },
      hrm: { state: 'ready', attendance: { checkIn: '07:52', checkOut: null, locationName: null, status: null }, leave: null, timesheet: null }, office: { documents: { state: 'ready', count: 0, first: null }, nextTrip: null } } };
    const calmBrief = buildBrief(calm, [], NOW, 0);
    expect(calmBrief.sections.find(s => s.id === 'attention')!.lines).toEqual([{ key: 'attention.none', label: 'Hôm nay', text: 'Không có gì gấp', tone: 'muted' }]);
    expect(calmBrief.sections.find(s => s.id === 'project')!.lines[0]).toMatchObject({ key: 'project.empty', tone: 'muted' });
  });

  it('câu hỏi nhanh chỉ hiện khi có nhóm; trả lời = đúng nhóm; dòng số liệu cho AI có khóa; tìm lại theo khóa bỏ khóa lạ', () => {
    expect(availableQuickQuestions(brief).map(q => q.id)).toEqual(['attention', 'mine', 'project', 'supply', 'hrm']);
    expect(answerQuick(brief, 'project').map(s => s.id)).toEqual(['project']);
    expect(answerQuick(brief, 'nope')).toEqual([]);
    const facts = briefFacts(brief);
    expect(facts).toContain('project.progress | Dự án · SMB-2026 · Tiến độ: 81% · hạn HĐ 21/10 · 7 việc trễ (170 xong · 13 đang làm · 332 việc)');
    expect(facts).toContain('[chưa có quyền xem]');
    expect(linesByKeys(brief, ['supply.requests', 'x.y', 'item.po.po-116']).map(l => l.key)).toEqual(['supply.requests', 'item.po.po-116']);
    expect(briefDateLabel(NOW)).toBe('Thứ tư 07/10');
  });
});
