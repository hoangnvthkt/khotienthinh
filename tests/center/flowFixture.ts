// Dữ liệu minh họa cho tab Dòng chảy công việc (không gọi Supabase). Hình dạng y hệt vcc_flow_v1; con số cấp phòng lấy theo
// số thật 13/10/2026 (docs/command-center/evidence/2026-10-13-dong-chay-so-lieu.md), tên người là tên minh họa.
// ?flow=bgd (toàn công ty, mặc định) | head (trưởng phòng Vật tư) | lead (giám đốc một dự án) | none | error | slow | off
import type { FlowDataset, FlowRange } from '../../lib/center/centerFlowService';

const U = {
  pm: 'u-pm', vt: 'u-vt', hr: 'u-hr', bld: 'u-bld', tc: 'u-tc', nm: 'u-nm',
} as const;
const UNITS = [
  { id: U.pm, name: 'Phòng Quản lý dự án', type: 'department', parentId: null, people: 10, active: true },
  { id: U.hr, name: 'Phòng Hành chính - Nhân sự', type: 'department', parentId: null, people: 8, active: true },
  { id: U.tc, name: 'Phòng Tài chính - Kế toán', type: 'department', parentId: null, people: 5, active: true },
  { id: U.bld, name: 'Ban lãnh đạo', type: 'department', parentId: null, people: 5, active: true },
  { id: U.nm, name: 'Văn phòng nhà máy', type: 'factory', parentId: null, people: 5, active: true },
  { id: U.vt, name: 'Phòng Vật tư - Thiết bị', type: 'department', parentId: null, people: 3, active: true },
  { id: 'unassigned', name: 'Chưa gắn phòng ban', type: 'gap', parentId: null, people: 44, active: true },
];
const LINKS = [
  [U.pm, U.pm, 155], [U.pm, U.vt, 60], [U.hr, U.hr, 26], [U.pm, 'unassigned', 24], [U.hr, U.bld, 15], ['unassigned', U.pm, 15], [U.pm, U.hr, 15],
  ['unassigned', U.vt, 14], ['unassigned', U.hr, 8], [U.hr, U.pm, 7], ['unassigned', U.bld, 7], [U.vt, U.vt, 6], [U.pm, U.bld, 2], [U.vt, U.pm, 2],
  [U.hr, U.vt, 2], [U.vt, 'unassigned', 1], [U.hr, 'unassigned', 1], [U.tc, U.pm, 1], [U.bld, U.bld, 1], [U.hr, U.nm, 1],
] as const;
const WAITING = { [U.vt]: [13, 5, 5, 4], [U.pm]: [11, 8, 2, 6], [U.bld]: [7, 7, 1, 6], [U.hr]: [6, 6, 6, 4], unassigned: [3, 3, 0, 1], [U.tc]: [1, 1, 0, 0], [U.nm]: [1, 1, 0, 0] } as Record<string, number[]>;
const DAILY = [1, 6, 0, 0, 0, 4, 1, 1, 3, 8, 8, 4, 7, 12, 3, 5, 7, 9, 8, 0, 1, 4, 5, 12, 12, 12, 17, 7, 1, 18];
const PEOPLE = [
  ['p-do', 'Nguyễn Thành Đô', U.pm, 73, 70, 20.3, 88, 2, 0, 2], ['p-son', 'Phạm Ngọc Sơn', U.pm, 45, 45, 0.6, 97, 0, 0, 0], ['p-nam', 'Nguyễn Văn Năm', U.vt, 43, 43, 1.3, 95, 1, 0, 0],
  ['p-chung', 'Bùi Quang Chung', U.vt, 35, 30, 65.3, 54, 3, 1, 5], ['p-giang', 'Nguyễn Thị Giang', U.hr, 28, 28, 4.6, 90, 0, 0, 0], ['p-linh', 'Bùi Thuỳ Linh', 'unassigned', 27, 21, 89.6, 41, 2, 0, 6],
  ['p-thien', 'Phạm Đức Thiện', U.bld, 23, 23, 51.1, 62, 1, 1, 0], ['p-mo', 'Nguyễn Thị Mơ', U.bld, 17, 17, 50.2, 60, 0, 0, 0], ['p-huong', 'Đặng Thị Hương', U.hr, 16, 16, 53.8, 71, 1, 0, 0],
  ['p-ha', 'Đặng Thị Thu Hà', U.hr, 10, 8, 65.0, 50, 0, 0, 2], ['p-luat', 'Nguyễn Văn Luật', U.pm, 8, 2, 30.1, 50, 0, 0, 6], ['p-thao', 'Nguyễn Phương Thảo', U.pm, 6, 6, 0.1, 100, 0, 0, 0],
] as const;
const BY_PERSON = [
  ['p-luat', 'Nguyễn Văn Luật', U.pm, 6, 6, 2, '2026-06-16T03:10:00+07:00', true], ['p-linh', 'Bùi Thuỳ Linh', 'unassigned', 6, 6, 3, '2026-06-16T08:00:00+07:00', true],
  ['p-hoang', 'Admin Hoàng', U.hr, 6, 6, 6, '2026-06-04T09:00:00+07:00', true], ['p-thinh', 'Dương Xuân Thịnh', U.bld, 5, 5, 1, '2026-09-07T10:00:00+07:00', true],
  ['p-chung', 'Bùi Quang Chung', U.vt, 5, 4, 2, '2026-10-08T14:00:00+07:00', true], ['p-ha', 'Đặng Thị Thu Hà', U.hr, 2, 0, 0, '2026-10-12T09:00:00+07:00', false],
  ['p-thuan', 'Nguyễn Quang Thuận', U.bld, 2, 2, 0, '2026-07-08T09:00:00+07:00', false], ['p-do', 'Nguyễn Thành Đô', U.pm, 2, 0, 0, '2026-10-12T15:00:00+07:00', false],
  ['p-minh', 'Hoàng Công Minh', U.vt, 1, 1, 1, '2026-10-09T09:00:00+07:00', false], ['p-duong', 'Đoàn Văn Dương', U.vt, 1, 1, 1, '2026-10-01T09:00:00+07:00', false],
] as const;

const outcomesOf = (unit: string, received: number, waiting: number) => {
  // Kết quả theo phòng: đang chờ theo số thật của phòng; phần còn lại chia theo tỷ lệ chung (282/22/17/12/5 trên 338).
  const rest = Math.max(0, received - waiting);
  const share = (n: number) => Math.round((rest * n) / 338);
  const rows = [['done', share(282)], ['skipped', share(22)], ['cancelled', share(17)], ['returned', share(12)], ['rejected', share(5)]] as Array<[string, number]>;
  const sum = rows.reduce((s, [, n]) => s + n, 0);
  rows[0][1] += rest - sum;
  return [['waiting', waiting] as [string, number], ...rows].filter(([, n]) => n > 0).map(([outcome, n]) => ({ unit, outcome, n }));
};

export const buildFlowFixture = (mode: string, range: FlowRange = 90, generatedAt = '2026-10-07T08:25:00+07:00'): FlowDataset => {
  const kind = mode === 'head' ? 'unit' : mode === 'lead' ? 'project' : 'company';
  const scopeUnits = kind === 'unit' ? [U.vt] : [];
  const scopeProjects = kind === 'project' ? ['smb'] : [];
  const factor = range === 7 ? 0.12 : range === 30 ? 0.45 : 1;
  const keepLink = (from: string, to: string) => kind !== 'unit' || from === U.vt || to === U.vt;
  const links = LINKS.filter(([from, to]) => keepLink(from, to)).map(([from, to, n]) => {
    const scaled = Math.max(1, Math.round(n * factor));
    const waiting = WAITING[to] ? Math.min(scaled, Math.round(WAITING[to][0] * (scaled / n))) : 0;
    return { from, to, n: scaled, done: scaled - waiting, waiting, medHours: from === U.pm && to === U.vt ? 26.4 : from === to ? 8.2 : 19.5 };
  });
  const received: Record<string, number> = {};
  links.forEach(link => { received[link.to] = (received[link.to] || 0) + link.n; });
  const byUnit = Object.entries(WAITING).filter(([unit]) => kind !== 'unit' || unit === U.vt).map(([unit, [n, stuck, overdue, dead]]) => ({ unit, n, stuck, overdue, dead }));
  const waitingTotal = byUnit.reduce((s, row) => s + row.n, 0);
  const unitOutcomes = Object.keys(received).flatMap(unit => outcomesOf(unit, received[unit], Math.min(received[unit], byUnit.find(row => row.unit === unit)?.n ?? 0)));
  const outcomeTotals: Record<string, number> = {};
  unitOutcomes.forEach(row => { outcomeTotals[row.outcome] = (outcomeTotals[row.outcome] || 0) + row.n; });
  const people = PEOPLE.filter(([, , unit]) => kind !== 'unit' || unit === U.vt).map(([userId, name, unitId, rec, done, med, onTime, returned, rejected, holding]) => ({
    userId, name, unitId, received: Math.max(1, Math.round(rec * factor)), done: Math.round(done * factor), medHours: med, onTimePct: onTime, returned, rejected, holding,
  }));
  const byPerson = BY_PERSON.filter(([, , unit]) => kind !== 'unit' || unit === U.vt).map(([userId, name, unitId, n, stuck, overdue, oldestAt, pile]) => ({ userId, name, unitId, n, stuck, overdue, oldestAt, pile }));
  const projects = [
    { id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', status: 'active', waiting: 9, stuck: 4, mrPending: 4, mrApproved: 30, mrTransit: 3, mrAvgDays: 53.5 },
    { id: 'tnb', code: 'TNB-GĐ2', name: 'Nhà máy thú nhồi bông giai đoạn 2', status: 'active', waiting: 6, stuck: 2, mrPending: 8, mrApproved: 21, mrTransit: 0, mrAvgDays: 37.8 },
    { id: 'g3', code: 'G3-BOQ', name: 'G3 BOQ project', status: 'active', waiting: 2, stuck: 0, mrPending: 3, mrApproved: 1, mrTransit: 1, mrAvgDays: 20.6 },
  ].filter(project => kind !== 'project' || project.id === 'smb');
  return {
    access: true, generatedAt, rangeDays: range, from: '2026-07-09T08:25:00+07:00',
    scope: { kind, canCompany: kind === 'company', unitIds: scopeUnits, projectIds: scopeProjects, managedUnitIds: scopeUnits, ledProjectIds: scopeProjects },
    thresholds: { stuckBusinessDays: 3, pilePerson: 5, deadDays: 30, unreadDays: 7, slaDefaultHours: 48, weekDays: 6 },
    units: UNITS,
    links,
    outcomes: Object.entries(outcomeTotals).map(([outcome, n]) => ({ outcome, n, avgHours: outcome === 'done' ? 56.5 : outcome === 'returned' ? 16.6 : null, medHours: outcome === 'done' ? 19.5 : outcome === 'waiting' ? 92.3 : null })),
    unitOutcomes,
    people, creators: [{ userId: 'p-luat', name: 'Nguyễn Văn Luật', unitId: U.pm, n: 45 }, { userId: 'p-thao', name: 'Nguyễn Phương Thảo', unitId: U.pm, n: 26 }],
    daily: DAILY.map((n, i) => { const day = new Date(2026, 8, 13 + i); return { d: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, n: range === 7 && i < 23 ? 0 : n }; }),
    waiting: {
      total: waitingTotal, stuck: byUnit.reduce((s, r) => s + r.stuck, 0), overdue: byUnit.reduce((s, r) => s + r.overdue, 0), overdueByDefaultSla: kind === 'unit' ? 2 : 6,
      unassigned: kind === 'unit' ? 0 : 1, dead: byUnit.reduce((s, r) => s + r.dead, 0),
      byUnit, byRole: kind === 'unit' ? [] : [{ role: 'Kế toán', n: 2, stuck: 1 }, { role: 'Thủ kho', n: 23, stuck: 9 }],
      age: [{ bucket: 'd1', n: 11 }, { bucket: 'd3', n: 0 }, { bucket: 'd7', n: 7 }, { bucket: 'd30', n: 3 }, { bucket: 'd30p', n: 21 }],
      byKind: [{ name: 'Quy trình cấp vật tư công trường', source: 'wf', n: 30, stuck: 24 }, { name: 'Quy trình cấp vật tư công trường (riêng SMB-2026)', source: 'wf', n: 6, stuck: 3 },
        { name: 'Phiếu kho', source: 'wms_tx', n: 23, stuck: 9 }, { name: 'Đơn hàng', source: 'po', n: 32, stuck: 11 }, { name: '[Request] Đề xuất trực tiếp', source: 'wf', n: 3, stuck: 2 },
        { name: 'Nhật ký thi công', source: 'daily_log', n: 6, stuck: 1 }],
      bySource: [{ source: 'wf', module: 'workflow', n: 42, stuck: 31, withPerson: 41 }, { source: 'po', module: 'procurement', n: 32, stuck: 11, withPerson: 32 }, { source: 'wms_tx', module: 'warehouse', n: 23, stuck: 9, withPerson: 0 },
        { source: 'mr', module: 'project', n: 3, stuck: 1, withPerson: 3 }, { source: 'daily_log', module: 'project', n: 6, stuck: 1, withPerson: 6 }, { source: 'leave', module: 'hrm', n: 4, stuck: 0, withPerson: 4 },
        { source: 'office', module: 'office', n: 2, stuck: 0, withPerson: 1 }],
      byPerson,
      byProject: [{ projectId: 'smb', n: 9, stuck: 4 }, { projectId: 'tnb', n: 6, stuck: 2 }, { projectId: 'g3', n: 2, stuck: 0 }],
    },
    projects,
    notifications: kind === 'company' ? { total30: 3749, unread30: 3170, unread7d: 1111, people7d: 34, noModule: 2497 } : null,
    gaps: { employeesWithoutUnit: 44, employeesActive: 87, assignmentsWithoutSla: 101, assignments: 366, unitsWithoutManager: 15 },
  };
};
