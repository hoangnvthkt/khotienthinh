import { describe, expect, it } from 'vitest';
import { buildTodayWidgets, daysUntil, ddmm, moneyShort } from '../todayWidgets';
import { parseCenterToday, type CenterToday } from '../centerTodayService';
import { getRouteModuleKey, isAuthenticatedOpenRoute, normalizeRoutePath } from '../../routeAccess';

const NOW = new Date(2026, 9, 7, 8, 30);

const FULL: CenterToday = parseCenterToday({
  generatedAt: '2026-10-07T01:30:00Z', today: '2026-10-07',
  project: { id: 'smb', code: 'SMB-2026', name: 'SMB', status: 'active', endDate: '2026-10-21', source: 'assignment', site: { id: 's1', name: 'Sơn Miền Bắc', latitude: 20.9, longitude: 106 } },
  projectOptions: [{ id: 'smb', code: 'SMB-2026', name: 'SMB', waiting: 3 }],
  widgets: {
    project: { construction: { state: 'ready', slips: 3, fronts: 5, people: 39 }, supply: { state: 'ready', count: 6, amount: 5360000000, nextPo: { poId: 'p', poNumber: 'PO-116', expectedDate: '2026-10-09' } },
      progress: { state: 'ready', percent: 81, total: 332, done: 170, inProgress: 13, overdue: 7, notStarted: 142 }, waiting: 3 },
    hrm: { state: 'ready', attendance: { checkIn: '07:52', checkOut: null }, leave: { availableDays: 6, pendingDays: 0, year: 2026 }, timesheet: { workDays: 4, month: 10, year: 2026, periodStatus: null }, team: { state: 'ready', total: 28, present: 21, assignments: 6 } },
    work: { workEnabled: true, assigned: { active: 3, overdue: 1, nearest: null }, created: { open: 3, awaitingReview: 0 }, requests: { pending: 1, returned: 0, latest: { id: 'r', code: 'RQ-61', title: 't', status: 'PENDING', waitingOn: 'HR' } } },
    office: { documents: { state: 'ready', count: 1, first: { id: 'd', documentNumber: 'TB-12/2026', title: 'x' } }, nextTrip: null },
    supply: { requests: { state: 'ready', pending: 4, supplying: 29, waitingStep: 'Phòng vật tư duyệt' }, orders: { state: 'denied' }, warehouse: { id: 'w', name: 'Kho SMB', canView: false } },
    finance: { projectId: 'smb', contractGross: 105840000000, received: 0, receivable: 0, receivableOverdue: 0, openingTodo: true, cost: 12300000000, eac: 85700000000, payable: 0, payableOverdue: 0, fundBalance: null, progress: 81 },
  },
});

const DENIED: CenterToday = parseCenterToday({
  project: { id: 'p', code: 'P', name: 'P', source: 'member', site: null }, projectOptions: [{ id: 'p', code: 'P', name: 'P', waiting: 0 }],
  widgets: { project: { construction: { state: 'denied' }, supply: { state: 'denied' }, progress: { state: 'empty' }, waiting: 0 },
    hrm: { state: 'ready', attendance: null, leave: null, timesheet: null, team: { state: 'denied' } },
    work: { workEnabled: false, assigned: null, created: null, requests: { pending: 0, returned: 0, latest: null } },
    office: { documents: { state: 'denied' }, nextTrip: null },
    supply: { requests: { state: 'denied' }, orders: { state: 'denied' }, warehouse: null }, finance: null },
});

const ctx = { now: NOW, mineCount: 9 };

describe('Today widgets (drill-down contract)', () => {
  it('gives every stat a target that the app can open', () => {
    for (const today of [FULL, DENIED]) {
      for (const view of buildTodayWidgets(today, ctx)) {
        expect(view.stats.length + (view.empty ? 1 : 0), view.id).toBeGreaterThan(0);
        for (const stat of view.stats) {
          expect(stat.value, `${view.id}.${stat.key}`).not.toBe('');
          expect(stat.target.title, `${view.id}.${stat.key}`).toBeTruthy();
          if (stat.target.kind === 'route') {
            const path = normalizeRoutePath(stat.target.path);
            expect(Boolean(getRouteModuleKey(path)) || isAuthenticatedOpenRoute(path), `${view.id}.${stat.key} → ${path}`).toBe(true);
          }
        }
      }
    }
  });

  it('reads the approved numbers the way the mockup shows them', () => {
    const views = buildTodayWidgets(FULL, ctx);
    const stat = (id: string, key: string) => views.find(v => v.id === id)!.stats.find(s => s.key === key)!;
    expect(views.map(v => v.id)).toEqual(['project', 'hrm', 'work', 'office', 'supply', 'finance']);
    expect(stat('project', 'construction').value).toBe('3/5 mũi đã gửi phiếu · 39 công');
    expect(stat('project', 'supply').value).toBe('6 PO · 5,36 tỷ · PO-116 09/10');
    expect(stat('project', 'progress')).toMatchObject({ value: '81% · hạn HĐ 21/10 · 7 việc trễ', tone: 'danger' });
    expect(stat('project', 'waiting')).toMatchObject({ value: '3 việc của dự án', target: { kind: 'inbox' } });
    expect(stat('hrm', 'attendance').value).toBe('Vào 07:52 · chưa chấm ra');
    expect(stat('hrm', 'team').value).toBe('21/28 đã chấm công · 6 điều động hiệu lực');
    expect(stat('work', 'assigned')).toMatchObject({ value: '3 đang làm · 1 trễ hạn', tone: 'danger' });
    expect(stat('work', 'requests').value).toBe('1 đang chờ · RQ-61 đang ở HR');
    expect(stat('office', 'documents')).toMatchObject({ value: '1 cần xác nhận đã đọc · TB-12/2026', target: { kind: 'route', path: '/office/documents/d' } });
    expect(views.find(v => v.id === 'office')!.stats.some(s => s.key === 'weather')).toBe(false);
    expect(stat('supply', 'requests').value).toBe('4 chờ duyệt (Phòng vật tư duyệt) · 29 đang cung ứng');
    expect(stat('supply', 'orders')).toMatchObject({ locked: expect.stringContaining('quyền'), value: 'Cần quyền xem đơn hàng' });
    expect(stat('supply', 'warehouse')).toMatchObject({ locked: expect.any(String) });
    expect(stat('finance', 'contract').value).toBe('105,84 tỷ');
    expect(stat('finance', 'received')).toMatchObject({ value: 'chưa khai đầu kỳ', tone: 'warn' });
    expect(stat('finance', 'fund')).toMatchObject({ value: 'chưa khai', target: { kind: 'route', path: '/site-fund' } });
  });

  it('never prints 0 for something it was not allowed to read', () => {
    const views = buildTodayWidgets(DENIED, { ...ctx, mineCount: 0 });
    const locked = views.flatMap(v => v.stats).filter(s => s.locked);
    expect(locked.map(s => `${s.key}`)).toEqual(['construction', 'supply', 'team', 'assigned', 'created', 'documents', 'requests', 'orders']);
    for (const stat of locked) expect(stat.value).not.toMatch(/\d/);
    expect(views.find(v => v.id === 'finance')).toBeUndefined();
    expect(views.find(v => v.id === 'hrm')!.stats.find(s => s.key === 'attendance')).toMatchObject({ value: 'Chưa chấm công', tone: 'warn' });
  });

  it('shows where to go when the person belongs to no project', () => {
    const views = buildTodayWidgets(parseCenterToday({ project: null, projectOptions: [], widgets: { hrm: { state: 'empty' }, work: {}, office: {} } }), ctx);
    expect(views.find(v => v.id === 'project')!.empty).toMatchObject({ target: { kind: 'route', path: '/da' } });
    expect(views.find(v => v.id === 'hrm')!.empty?.text).toContain('hồ sơ nhân viên');
    expect(views.find(v => v.id === 'supply')!.empty).toBeTruthy();
  });

  it('counts days to a contract deadline', () => {
    expect(daysUntil('2026-10-05', NOW)).toBe(-2);
  });
});

describe('Today helpers', () => {
  it('formats money like the server', () => {
    expect(moneyShort(5360000000)).toBe('5,36 tỷ');
    expect(moneyShort(12000000)).toBe('12 tr');
    expect(moneyShort(850000)).toBe('850.000 đ');
    expect(moneyShort(null)).toBe('—');
    expect(ddmm('2026-10-21')).toBe('21/10');
    expect(ddmm('bad')).toBeNull();
  });

  it('parses the payload fail-closed', () => {
    const today = parseCenterToday({ project: { id: 'x', code: 'X', source: 'weird' }, widgets: { project: { construction: { state: 'nope' } } } });
    expect(today.project?.source).toBeNull();
    expect(today.widgets.project?.construction.state).toBe('error');
    expect(today.widgets.hrm.state).toBe('error');
    expect(today.widgets.finance).toBeNull();
  });
});
