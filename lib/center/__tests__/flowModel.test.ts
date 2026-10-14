import { describe, expect, it } from 'vitest';
import type { FlowDataset } from '../centerFlowService';
import {
  drillOutcomes, drillStuckByPerson, drillWaitingByUnit, flowParticles, hoursText, sankeyLayout, shortUnitName, stampText, unitBars, unitSummary, type SankeyColors,
} from '../flowModel';

const COLORS: SankeyColors = { unit: 'u', gap: 'g', done: 'd', waiting: 'w', returned: 'r', rejected: 'x', other: 'o', stuck: 's' };
const NOW = new Date(2026, 9, 13, 9, 0);

const DATA: FlowDataset = {
  access: true, generatedAt: '2026-10-13T09:41:00+07:00', rangeDays: 90, from: '2026-07-15',
  scope: { kind: 'company', canCompany: true, unitIds: [], projectIds: [], managedUnitIds: [], ledProjectIds: [] },
  thresholds: { stuckBusinessDays: 3, pilePerson: 5, deadDays: 30, unreadDays: 7, slaDefaultHours: 48, weekDays: 6 },
  units: [{ id: 'pm', name: 'Phòng Quản lý dự án', type: 'department', parentId: null, people: 10, active: true },
    { id: 'vt', name: 'Phòng Vật tư - Thiết bị', type: 'department', parentId: null, people: 3, active: true },
    { id: 'unassigned', name: 'Chưa gắn phòng ban', type: 'gap', parentId: null, people: 44, active: true }],
  links: [{ from: 'pm', to: 'pm', n: 155, done: 150, waiting: 5, medHours: 8 }, { from: 'pm', to: 'vt', n: 60, done: 50, waiting: 10, medHours: 26.4 },
    { from: 'unassigned', to: 'vt', n: 14, done: 14, waiting: 0, medHours: null }, { from: 'vt', to: 'pm', n: 2, done: 2, waiting: 0, medHours: 1 }],
  outcomes: [{ outcome: 'done', n: 216, avgHours: 56.5, medHours: 19.5 }, { outcome: 'waiting', n: 15, avgHours: null, medHours: 92.3 }],
  unitOutcomes: [{ unit: 'pm', outcome: 'done', n: 152 }, { unit: 'pm', outcome: 'waiting', n: 5 }, { unit: 'vt', outcome: 'done', n: 64 }, { unit: 'vt', outcome: 'waiting', n: 10 }],
  people: [], creators: [],
  daily: [{ d: '2026-10-12', n: 18 }, { d: '2026-10-13', n: 1 }],
  waiting: {
    total: 15, stuck: 9, overdue: 7, overdueByDefaultSla: 2, unassigned: 1, dead: 4,
    byUnit: [{ unit: 'vt', n: 10, stuck: 5, overdue: 5, dead: 3 }, { unit: 'pm', n: 5, stuck: 4, overdue: 2, dead: 1 }],
    byRole: [{ role: 'Thủ kho', n: 23, stuck: 9 }],
    age: [{ bucket: 'd1', n: 3 }, { bucket: 'd3', n: 0 }, { bucket: 'd7', n: 4 }, { bucket: 'd30', n: 4 }, { bucket: 'd30p', n: 4 }],
    byKind: [], bySource: [],
    byPerson: [{ userId: 'a', name: 'Nguyễn Văn Luật', unitId: 'pm', n: 6, stuck: 6, overdue: 2, oldestAt: '2026-06-16T03:00:00+07:00', pile: true },
      { userId: 'b', name: 'Hoàng Công Minh', unitId: 'vt', n: 1, stuck: 0, overdue: 0, oldestAt: '2026-10-12T03:00:00+07:00', pile: false }],
    byProject: [],
  },
  projects: [], notifications: null,
  gaps: { employeesWithoutUnit: 44, employeesActive: 87, assignmentsWithoutSla: 101, assignments: 366, unitsWithoutManager: 15 },
};

describe('sankeyLayout', () => {
  it('keeps every column summing to the same total and sizes nodes by volume', () => {
    const layout = sankeyLayout(DATA, 880, 560, COLORS);
    expect(layout.empty).toBe(false);
    const col = (c: number) => layout.nodes.filter(node => node.col === c);
    expect(col(0).map(node => node.id)).toEqual(['pm', 'unassigned', 'vt']);
    expect(col(1).map(node => node.id)).toEqual(['pm', 'vt']);
    expect(col(2).map(node => node.id)).toEqual(['done', 'waiting']);
    const sum = (c: number) => col(c).reduce((s, node) => s + node.value, 0);
    expect(sum(0)).toBe(231); expect(sum(1)).toBe(231); expect(sum(2)).toBe(231);
    const pm = col(0)[0]; const vt = col(0)[2];
    expect(pm.h / vt.h).toBeCloseTo(215 / 2, 0);
    // Vạch đỏ ở Nơi xử lý theo tỷ lệ đứng yên; phòng chưa gắn vẽ nét đứt.
    expect(col(1).find(node => node.id === 'vt')!.stuckH).toBeGreaterThan(0);
    expect(col(0).find(node => node.id === 'unassigned')!.dashed).toBe(true);
    // Mỗi liên kết phòng → phòng và phòng → kết quả thành một dải; dải đang chờ mang màu đang chờ.
    expect(layout.links.filter(link => link.col === 0)).toHaveLength(4);
    expect(layout.links.filter(link => link.col === 1)).toHaveLength(4);
    expect(layout.links.find(link => link.col === 1 && link.to === 'waiting')!.color).toBe('w');
    // Nhãn không đè nhau trong cùng cột.
    for (const c of [0, 1, 2]) {
      const ys = col(c).map(node => node.ly);
      ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeGreaterThanOrEqual(15));
    }
  });

  it('puts one particle on each of the biggest ribbons, faster on bigger ones, waiting ribbons in the waiting colour', () => {
    const layout = sankeyLayout(DATA, 880, 560, COLORS);
    const particles = flowParticles(layout, 4);
    expect(particles).toHaveLength(4);
    expect(particles[0].key).toBe('0:pm>1:pm');
    expect(particles[0].dur).toBeLessThan(particles[3].dur);
    expect(particles.every(p => p.path.startsWith('M') && p.path.includes('C'))).toBe(true);
    expect(particles[0].points).toHaveLength(17);
    expect(particles[0].points[0][0]).toBeLessThan(particles[0].points[16][0]);
    expect(flowParticles(layout).find(p => p.key === '1:vt>2:waiting')?.color).toBe('w');
    expect(flowParticles({ ...layout, links: [] })).toEqual([]);
  });

  it('reports an empty layout instead of drawing nothing', () => {
    expect(sankeyLayout({ ...DATA, links: [], unitOutcomes: [] }, 880, 560, COLORS).empty).toBe(true);
  });
});

describe('unit bars, unit summary, drills', () => {
  it('orders bars by waiting then received and flags the gap unit', () => {
    const bars = unitBars(DATA);
    expect(bars.map(bar => bar.id)).toEqual(['vt', 'pm']);
    expect(bars[0]).toMatchObject({ received: 74, waiting: 10, stuck: 5 });
    expect(unitBars({ ...DATA, links: [...DATA.links, { from: 'pm', to: 'unassigned', n: 3, done: 3, waiting: 0, medHours: null }] }).find(bar => bar.gap)?.name).toBe('Chưa gắn phòng ban');
  });

  it('summarises a unit from links, outcomes and holders', () => {
    const vt = unitSummary(DATA, 'vt');
    expect(vt).toMatchObject({ name: 'Phòng Vật tư - Thiết bị', people: 3, waiting: 10, stuck: 5, received: 74, sent: 2, internal: 0 });
    expect(vt.partners.map(p => [p.id, p.received, p.sent])).toEqual([['pm', 60, 2], ['unassigned', 14, 0]]);
    expect(vt.holders.map(p => p.userId)).toEqual(['b']);
    expect(unitSummary(DATA, 'pm').internal).toBe(155);
  });

  it('builds drill tables whose totals match the headline numbers', () => {
    const byUnit = drillWaitingByUnit(DATA);
    expect(byUnit.total).toEqual({ n: 15, stuck: 9, overdue: 7, dead: 4 });
    expect(byUnit.rows.map(row => row.cells.unit)).toEqual(['Phòng Vật tư - Thiết bị', 'Phòng Quản lý dự án', 'Chờ Thủ kho']);
    const stuck = drillStuckByPerson(DATA, NOW);
    expect(stuck.rows).toHaveLength(1);
    expect(stuck.rows[0].cells).toMatchObject({ name: 'Nguyễn Văn Luật', stuck: 6, oldest: 119 });
    const outcomes = drillOutcomes(DATA);
    expect(outcomes.rows.map(row => row.cells.outcome)).toEqual(['Đã xử lý', 'Đang chờ']);
    expect(outcomes.rows[0].cells.med).toBe('19,5 giờ');
    expect(outcomes.total).toEqual({ n: 231 });
  });
});

describe('formatting', () => {
  it('shows hours under three days, days above, and a dash for unknown', () => {
    expect(hoursText(19.5)).toBe('19,5 giờ');
    expect(hoursText(96)).toBe('4 ngày');
    expect(hoursText(null)).toBe('—');
  });
  it('shortens unit names for chart labels', () => {
    expect(shortUnitName('Phòng Quản lý dự án')).toBe('Quản lý dự án');
    expect(shortUnitName('Văn phòng nhà máy')).toBe('VP nhà máy');
    expect(shortUnitName('Ban chỉ huy công trình Sơn Miền Bắc', 12)).toBe('Sơn Miền Bắc');
    expect(shortUnitName('Ban chỉ huy công trình Sơn Miền Bắc', 10)).toBe('Sơn Miền …');
  });
  it('stamps today as time only, other days with the date', () => {
    // Dựng mốc theo giờ máy chạy test: stampText in giờ địa phương, CI chạy UTC (13/10: +07:00 cố định ra 02:41 trên CI).
    expect(stampText(new Date(2026, 9, 13, 9, 41).toISOString(), NOW)).toBe('09:41');
    expect(stampText(new Date(2026, 9, 12, 16, 40).toISOString(), NOW)).toBe('16:40 12/10');
    expect(stampText('garbage', NOW)).toBeNull();
  });
});
