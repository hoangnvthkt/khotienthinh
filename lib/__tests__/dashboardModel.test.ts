import { describe, expect, it } from 'vitest';
import {
  drillByProject, drillMonth, gapsFor, lastMonths, recordCount, monthTotals, projectHealth, routeTitle, shortMoney, sumFinance,
} from '../dashboard/dashboardModel';
import type { DashProject } from '../dashboard/dashboardTypes';
import { buildDashboardFixture } from '../../tests/center/dashboardFixture';

const base = (overrides: Partial<DashProject> = {}): DashProject => ({
  id: 'p', code: 'P', name: 'Dự án', status: 'active', createdAt: null, director: null, site: null, start: '2026-01-01', end: '2026-12-31',
  plannedProgress: 50, actualProgress: 48, updatedAt: null, finance: null, materials: null, gaps: [], ...overrides,
});

describe('dashboard formatting', () => {
  it('shortens money like the reference dashboards', () => {
    expect(shortMoney(285_248_000_000)).toBe('285,248 tỷ');
    expect(shortMoney(200_000_000)).toBe('200 triệu');
    expect(shortMoney(850_000)).toBe('850.000 đ');
    expect(shortMoney(null)).toBe('—');
  });

  it('lists the last 12 months ending this month', () => {
    const months = lastMonths('2026-10-07');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11');
    expect(months[11]).toBe('2026-10');
  });

  it('names the tab opened from a dashboard', () => {
    expect(routeTitle('/finance/receivables')).toBe('Phải thu');
    expect(routeTitle('/da?projectId=x&tab=gantt')).toBe('Tiến độ');
    expect(routeTitle('/da?projectId=x&tab=material&materialTab=request&requestId=r')).toBe('Đề xuất vật tư');
  });
});

describe('project health', () => {
  const today = '2026-10-07';
  it('is late when actual trails plan by 10 points or more', () => {
    expect(projectHealth(base({ plannedProgress: 61, actualProgress: 42 }), today)).toBe('late');
    expect(projectHealth(base({ plannedProgress: 55, actualProgress: 48 }), today)).toBe('on_track');
  });
  it('is overdue after the end date, done at 100%', () => {
    expect(projectHealth(base({ end: '2026-09-15', actualProgress: 86 }), today)).toBe('overdue');
    expect(projectHealth(base({ end: '2026-06-30', actualProgress: 100 }), today)).toBe('done');
  });
  it('is at risk when cost runs over budget', () => {
    const finance = buildDashboardFixture('bgd').projects.find(project => project.id === 'xhv')!.finance!;
    expect(projectHealth(base({ finance: { ...finance, budget: 1, cost: 2 } }), today)).toBe('risk');
  });
  it('says unknown instead of pretending to be on track without progress', () => {
    expect(projectHealth(base({ actualProgress: null, plannedProgress: null }), today)).toBe('unknown');
  });
});

describe('aggregation and drill-down', () => {
  const data = buildDashboardFixture('bgd');

  it('never turns hidden finance into zero', () => {
    const hidden = data.projects.filter(project => !project.finance);
    expect(hidden.length).toBeGreaterThan(0);
    expect(sumFinance(hidden, finance => finance.cost)).toBeNull();
  });

  it('breaks a number down by project, biggest first, with a total and a route per row', () => {
    const drill = drillByProject('Giá trị hợp đồng', data.projects, finance => finance.contractValue);
    const values = drill.rows.map(row => Number(row.cells.value));
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(drill.total?.value).toBe(sumFinance(data.projects, finance => finance.contractValue));
    expect(drill.rows[0].route).toMatch(/^\/finance\/project\?project=/);
  });

  it('adds months up to the same totals the projects report', () => {
    const ids = new Set(data.projects.filter(project => project.finance).map(project => project.id));
    const months = monthTotals(data, ids);
    const revenue = months.reduce((sum, row) => sum + row.revenue, 0);
    const accepted = sumFinance(data.projects, finance => finance.accepted) as number;
    expect(Math.abs(revenue - accepted) / accepted).toBeLessThan(0.001);
    const month = drillMonth(data, data.projects, '2026-09', [{ key: 'cashIn', label: 'Thu' }]);
    expect(month.rows.length).toBeGreaterThan(0);
    expect(month.total?.cashIn).toBe(months.find(row => row.month === '2026-09')!.cashIn);
  });

  it('keeps the inflow consistent: revenue = paid + owed + retention + recovered advance', () => {
    data.projects.filter(project => project.finance).forEach(project => {
      const { flow } = project.finance!.ar;
      expect(flow.paid + flow.outstanding + flow.retention + flow.recovered).toBeCloseTo(project.finance!.accepted, -3);
    });
  });

  it('tells "no records yet" apart from a real zero', () => {
    const ql1a = data.projects.filter(project => project.id === 'ql1a');
    expect(recordCount(ql1a, 'arRounds')).toBe(0);
    expect(recordCount(data.projects, 'arRounds')).toBeGreaterThan(0);
    // Không được xem tiền: không biết → null.
    expect(recordCount(buildDashboardFixture('muahang').projects, 'arRounds')).toBeNull();
  });

  it('lists missing data per board with a screen to fix it', () => {
    const portfolio = gapsFor('portfolio', data.projects);
    expect(portfolio.rows.map(row => row.id)).toEqual(['da29', 'ql1a']);
    expect(portfolio.rows.find(row => row.id === 'ql1a')!.cells.missing).toContain('Tọa độ công trường');
    expect(portfolio.rows.find(row => row.id === 'da29')!.route).toBe('/da?projectId=da29&tab=gantt');
    expect(gapsFor('materials', data.projects).rows.map(row => row.id)).toEqual(['ql1a']);
    expect(gapsFor('debt', data.projects).rows.map(row => row.id)).toEqual(['da29']);
    // Không xem tiền → không có thiếu sót tài chính.
    expect(gapsFor('debt', buildDashboardFixture('muahang').projects).rows).toEqual([]);
  });

  it('gives each role only its dashboards', () => {
    expect(buildDashboardFixture('muahang').access).toEqual(['materials']);
    expect(buildDashboardFixture('muahang').projects.every(project => project.finance === null)).toBe(true);
    expect(buildDashboardFixture('cht').projects.map(project => project.id)).toEqual(['da29', 'vphn']);
  });
});
