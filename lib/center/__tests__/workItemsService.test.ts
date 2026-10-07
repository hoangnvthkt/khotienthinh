import { describe, expect, it } from 'vitest';
import { dueInfo, parseWorkItem, parseWorkItemsPage, sortWorkItems, type WorkItem } from '../workItemsService';

const NOW = new Date(2026, 9, 7, 8, 30);
const at = (y: number, m: number, d: number, h = 17, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

describe('work items payload', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const page = parseWorkItemsPage({
      total: 3, truncatedSources: ['office'], generatedAt: '2026-10-07T01:00:00Z',
      items: [
        { source: 'rq', module: 'request', kind: 'approve', id: '1', code: 'RQ-1', title: 'A', who: 'B lập', ref: { requestId: '1' } },
        { source: 'mystery', module: 'nope', kind: 'approve', id: '2', code: 'X', title: 'B' },
        { source: 'leave', module: 'hrm', kind: 'bogus', id: '3', code: '', title: '', ref: null },
        null,
      ],
    }, 'mine');
    expect(page.total).toBe(3);
    expect(page.truncatedSources).toEqual(['office']);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ source: 'rq', module: 'request', kind: 'approve', who: 'B lập', ref: { requestId: '1' } });
    // Thiếu mã / tiêu đề thì vẫn mở được, không rơi dòng; kind lạ → "do".
    expect(page.items[1]).toMatchObject({ source: 'leave', kind: 'do', code: '—', title: 'Hồ sơ', ref: {} });
  });

  it('fails closed on garbage', () => {
    expect(parseWorkItem('x')).toBeNull();
    expect(parseWorkItemsPage(undefined, 'sent')).toEqual({ tab: 'sent', generatedAt: expect.any(String), total: 0, truncatedSources: [], items: [] });
  });
});

describe('due labels', () => {
  it('reads overdue, today, tomorrow, soon and dated', () => {
    expect(dueInfo(at(2026, 10, 5), NOW)).toEqual({ label: 'quá hạn 2 ngày', tone: 'hot' });
    expect(dueInfo(at(2026, 10, 7, 13), NOW)).toEqual({ label: 'còn 5 giờ', tone: 'hot' });
    expect(dueInfo(at(2026, 10, 7, 0), NOW)).toEqual({ label: 'hôm nay', tone: 'hot' });
    expect(dueInfo(at(2026, 10, 8), NOW)).toEqual({ label: 'ngày mai', tone: 'soon' });
    expect(dueInfo(at(2026, 10, 10), NOW)).toEqual({ label: 'còn 3 ngày', tone: 'soon' });
    expect(dueInfo(at(2026, 10, 21), NOW)).toEqual({ label: '21/10', tone: 'normal' });
    expect(dueInfo(null, NOW)).toBeNull();
    expect(dueInfo('not a date', NOW)).toBeNull();
  });
});

describe('ordering', () => {
  const item = (code: string, dueAt: string | null): WorkItem => ({
    source: 'rq', module: 'request', kind: 'approve', id: code, code, title: code, who: null, whoId: null, meta: null, dueAt, status: null, ref: {},
  });
  it('puts the nearest deadline first and undated items last', () => {
    expect(sortWorkItems([item('C', null), item('B', at(2026, 10, 9)), item('A', at(2026, 10, 8)), item('D', null)]).map(i => i.code))
      .toEqual(['A', 'B', 'C', 'D']);
  });
});
