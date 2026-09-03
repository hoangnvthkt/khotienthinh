import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: unknown[][] = [];
  let data: any[] = [];
  const query: Record<string, any> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'or', 'range']) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    });
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return {
    calls,
    from: vi.fn(() => query),
    setData(rows: any[]) { data = rows; },
  };
});

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: mocks.from },
}));

import { materialRequestService } from '../materialRequestService';

describe('materialRequestService.listByProjectPage', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.from.mockClear();
    mocks.setData([]);
  });

  it('uses a deterministic keyset cursor instead of an offset range', async () => {
    mocks.setData([
      { id: '3', created_date: '2026-09-03T02:00:00.000Z' },
      { id: '2', created_date: '2026-09-03T02:00:00.000Z' },
      { id: '1', created_date: '2026-09-03T01:00:00.000Z' },
    ]);
    const first = await materialRequestService.listByProjectPage({ projectId: 'project-1', limit: 2 });

    expect(mocks.calls).toContainEqual(['limit', 3]);
    expect(mocks.calls.some(call => call[0] === 'range')).toBe(false);
    expect(first.rows.map(row => row.id)).toEqual(['3', '2']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    mocks.calls.length = 0;
    mocks.setData([]);
    await materialRequestService.listByProjectPage({
      projectId: 'project-1',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(mocks.calls).toContainEqual([
      'or',
      'created_date.lt.2026-09-03T02:00:00.000Z,and(created_date.eq.2026-09-03T02:00:00.000Z,id.lt.2)',
    ]);
  });
});
