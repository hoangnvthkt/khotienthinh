import { describe, expect, it } from 'vitest';
import { FLOW_UNASSIGNED, isFlowScopeDenied, parseFlowResult } from '../centerFlowService';

// Hình dạng JSON của vcc_flow_v1 (migration 20261013141500); smoke SQL kiểm số, test này kiểm bộ đọc không bịa số.
const SERVER = {
  access: true, generatedAt: '2026-10-13T02:30:00+00:00', rangeDays: 90, from: '2026-07-15T02:30:00+00:00',
  scope: { kind: 'unit', canCompany: false, unitIds: ['u1'], projectIds: [], managedUnitIds: ['u1'], ledProjectIds: [] },
  thresholds: { stuckBusinessDays: 3, pilePerson: 5, deadDays: 30, unreadDays: 7, slaDefaultHours: 48, weekDays: 6 },
  units: [{ id: 'u1', name: 'Phòng Vật tư - Thiết bị', type: 'department', parentId: null, people: 3, active: true },
    { id: 'unassigned', name: 'Chưa gắn phòng ban', type: 'gap', parentId: null, people: 44, active: true }],
  links: [{ from: 'u2', to: 'u1', n: 60, done: 50, waiting: 5, medHours: 19.5 }, { from: null, to: 'u1', n: 14, done: 14, waiting: 0, medHours: null }],
  outcomes: [{ outcome: 'done', n: 282, avgHours: 56.5, medHours: 19.5 }, { outcome: 'waiting', n: 28, avgHours: null, medHours: 92.3 }],
  unitOutcomes: [{ unit: 'u1', outcome: 'waiting', n: 13 }],
  people: [{ userId: 'p1', name: 'Nguyễn Văn A', unitId: 'u1', received: 73, done: 70, medHours: 20.3, onTimePct: 88, returned: 2, rejected: 0, holding: 2 },
    { userId: 'p2', name: null, unitId: null, received: 1, done: 0, medHours: null, onTimePct: null, returned: 0, rejected: 0, holding: 1 }],
  creators: [{ userId: 'c1', name: 'Nguyễn Văn Luật', unitId: 'u2', n: 45 }],
  daily: [{ d: '2026-10-12', n: 18 }],
  waiting: {
    total: 13, stuck: 5, overdue: 5, overdueByDefaultSla: 2, unassigned: 1, dead: 3,
    byUnit: [{ unit: 'u1', n: 13, stuck: 5, overdue: 5, dead: 3 }], byRole: [{ role: 'Kế toán', n: 2, stuck: 1 }],
    age: [{ bucket: 'd1', n: 2 }, { bucket: 'd3', n: 0 }, { bucket: 'd7', n: 3 }, { bucket: 'd30', n: 5 }, { bucket: 'd30p', n: 3 }],
    byKind: [{ name: 'Quy trình cấp vật tư công trường', source: 'wf', n: 10, stuck: 4 }],
    bySource: [{ source: 'wf', module: 'project', n: 10, stuck: 4, withPerson: 10 }, { source: 'mr', module: 'project', n: 3, stuck: 1, withPerson: 3 }],
    byPerson: [{ userId: 'p1', name: 'Nguyễn Văn A', unitId: 'u1', n: 6, stuck: 6, overdue: 2, oldestAt: '2026-06-16T03:00:00+00:00', pile: true }],
    byProject: [{ projectId: 'smb', n: 9, stuck: 4 }],
  },
  projects: [{ id: 'smb', code: 'SMB-2026', name: 'Sơn Miền Bắc', status: 'active', waiting: 9, stuck: 4, mrPending: 4, mrApproved: 30, mrTransit: 3, mrAvgDays: 53.5 }],
  notifications: null,
  gaps: { employeesWithoutUnit: 44, employeesActive: 87, assignmentsWithoutSla: 101, assignments: 366, unitsWithoutManager: 15 },
};

describe('parseFlowResult', () => {
  it('keeps every server number and never invents a value for an unknown one', () => {
    const r = parseFlowResult(SERVER);
    expect(r.access).toBe(true);
    if (!r.access) return;
    expect(r.scope).toEqual(SERVER.scope);
    expect(r.rangeDays).toBe(90);
    expect(r.thresholds.slaDefaultHours).toBe(48);
    expect(r.links[0]).toEqual({ from: 'u2', to: 'u1', n: 60, done: 50, waiting: 5, medHours: 19.5 });
    expect(r.links[1].from).toBe(FLOW_UNASSIGNED);
    expect(r.links[1].medHours).toBeNull();
    expect(r.people[1]).toMatchObject({ name: null, unitId: FLOW_UNASSIGNED, medHours: null, onTimePct: null, holding: 1 });
    expect(r.waiting.byPerson[0].pile).toBe(true);
    expect(r.waiting.age.map(a => a.bucket)).toEqual(['d1', 'd3', 'd7', 'd30', 'd30p']);
    expect(r.projects[0].mrAvgDays).toBe(53.5);
    expect(r.notifications).toBeNull();
    expect(r.gaps.employeesWithoutUnit).toBe(44);
  });

  it('accepts company scope with notification stats and falls back to 90 days for unknown ranges', () => {
    const r = parseFlowResult({ ...SERVER, rangeDays: 12, scope: { ...SERVER.scope, kind: 'company', canCompany: true },
      notifications: { total30: 3749, unread30: 3170, unread7d: 1111, people7d: 34, noModule: 2497 } });
    expect(r.access && r.rangeDays).toBe(90);
    expect(r.access && r.scope.kind).toBe('company');
    expect(r.access && r.notifications?.unread7d).toBe(1111);
  });

  it('reports denied access with the server reason and survives garbage', () => {
    expect(parseFlowResult({ access: false, reason: 'no_scope' })).toEqual({ access: false, reason: 'no_scope' });
    expect(parseFlowResult(null)).toEqual({ access: false, reason: 'unknown' });
    const r = parseFlowResult({ access: true });
    expect(r.access && r.waiting.total).toBe(0);
    expect(r.access && r.units).toEqual([]);
    expect(r.access && r.daily).toEqual([]);
  });

  it('recognises scope denials from the server', () => {
    expect(isFlowScopeDenied({ code: '42501', message: 'x' })).toBe(true);
    expect(isFlowScopeDenied({ message: 'FLOW_SCOPE_DENIED' })).toBe(true);
    expect(isFlowScopeDenied({ code: 'PGRST116', message: 'not found' })).toBe(false);
    expect(isFlowScopeDenied(null)).toBe(false);
  });
});
