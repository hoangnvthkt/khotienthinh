import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const rows = [
    { id: '3', timestamp: '2026-09-03T03:00:00.000Z', type: 'system', status: 'success' },
    { id: '2', timestamp: '2026-09-03T02:00:00.000Z', type: 'system', status: 'success' },
    { id: '1', timestamp: '2026-09-03T01:00:00.000Z', type: 'system', status: 'success' },
  ];
  const query: Record<string, any> = {};
  for (const method of ['select', 'order', 'limit', 'eq', 'or']) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return { from: vi.fn(() => query), query };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));

import { activityService } from '../activityService';

describe('activityService.listPage', () => {
  beforeEach(() => {
    mocks.from.mockClear();
    for (const method of ['select', 'order', 'limit', 'eq', 'or']) mocks.query[method].mockClear();
  });

  it('keeps the existing stable order and derives the cursor from limit plus one', async () => {
    const page = await activityService.listPage({
      limit: 2,
      warehouseId: 'warehouse-1',
      cursor: { timestamp: '2026-09-04T00:00:00.000Z', id: '4' },
    });

    expect(mocks.query.order).toHaveBeenNthCalledWith(1, 'timestamp', { ascending: false });
    expect(mocks.query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(mocks.query.limit).toHaveBeenCalledWith(3);
    expect(mocks.query.eq).toHaveBeenCalledWith('warehouse_id', 'warehouse-1');
    expect(mocks.query.or).toHaveBeenCalledWith(
      'timestamp.lt.2026-09-04T00:00:00.000Z,and(timestamp.eq.2026-09-04T00:00:00.000Z,id.lt.4)',
    );
    expect(page.items.map(row => row.id)).toEqual(['3', '2']);
    expect(page.nextCursor).toEqual({ timestamp: '2026-09-03T02:00:00.000Z', id: '2' });
  });
});
