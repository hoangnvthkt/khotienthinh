import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: unknown[][] = [];
  let result: { data: any; error: any } = { data: [], error: null };
  const query: Record<string, any> = {};
  for (const method of ['select', 'order', 'limit', 'eq', 'in', 'gte', 'lte', 'or', 'maybeSingle']) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    });
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return {
    calls,
    from: vi.fn(() => query),
    query,
    setResult(next: typeof result) { result = next; },
  };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));

import {
  WMS_TRANSACTION_DETAIL_SELECT,
  WMS_TRANSACTION_LIST_SELECT,
  wmsTransactionListService,
} from '../wmsTransactionListService';

describe('wmsTransactionListService', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.from.mockClear();
    mocks.setResult({ data: [], error: null });
  });

  it('uses an explicit stable cursor page and limit plus one', async () => {
    mocks.setResult({
      data: [
        { id: '3', date: '2026-09-03T02:00:00.000Z', items: [], status: 'PENDING' },
        { id: '2', date: '2026-09-03T02:00:00.000Z', items: [], status: 'PENDING' },
        { id: '1', date: '2026-09-03T01:00:00.000Z', items: [], status: 'PENDING' },
      ],
      error: null,
    });

    const page = await wmsTransactionListService.listPage({
      limit: 2,
      cursor: { date: '2026-09-04T00:00:00.000Z', id: '4' },
      statuses: ['PENDING'],
      warehouseId: 'warehouse-1',
    });

    expect(WMS_TRANSACTION_LIST_SELECT).not.toBe('*');
    expect(WMS_TRANSACTION_LIST_SELECT).not.toContain('attachments');
    expect(mocks.calls).toContainEqual(['select', WMS_TRANSACTION_LIST_SELECT]);
    expect(mocks.calls).toContainEqual(['order', 'date', { ascending: false }]);
    expect(mocks.calls).toContainEqual(['order', 'id', { ascending: false }]);
    expect(mocks.calls).toContainEqual(['limit', 3]);
    expect(mocks.calls).toContainEqual(['in', 'status', ['PENDING']]);
    expect(mocks.calls).toContainEqual([
      'or',
      'date.lt.2026-09-04T00:00:00.000Z,and(date.eq.2026-09-04T00:00:00.000Z,id.lt.4)',
    ]);
    expect(page.items.map(row => row.id)).toEqual(['3', '2']);
    expect(page.nextCursor).toEqual({ date: '2026-09-03T02:00:00.000Z', id: '2' });
  });

  it('loads full transaction detail separately by id', async () => {
    mocks.setResult({ data: { id: 'tx-1', date: '2026-09-03', items: [], attachments: [] }, error: null });

    await expect(wmsTransactionListService.getById('tx-1')).resolves.toMatchObject({ id: 'tx-1' });
    expect(WMS_TRANSACTION_DETAIL_SELECT).toContain('items');
    expect(WMS_TRANSACTION_DETAIL_SELECT).toContain('attachments');
    expect(mocks.calls).toContainEqual(['select', WMS_TRANSACTION_DETAIL_SELECT]);
    expect(mocks.calls).toContainEqual(['eq', 'id', 'tx-1']);
    expect(mocks.calls).toContainEqual(['maybeSingle']);
  });
});
