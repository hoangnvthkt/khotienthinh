import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requestIds = Array.from({ length: 125 }, (_, index) => `request-${String(index).padStart(3, '0')}`);
  const batches = requestIds.map((requestId, index) => ({
    id: `batch-${String(index).padStart(3, '0')}`,
    material_request_id: requestId,
    batch_date: `2026-09-03T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    status: 'issued',
    fulfillment_mode: 'RECEIVE_TO_STOCK',
    source_type: 'stock',
  }));
  const lines = Array.from({ length: 1200 }, (_, index) => ({
    id: `line-${String(index).padStart(4, '0')}`,
    batch_id: batches[0].id,
    material_request_id: batches[0].material_request_id,
    request_line_id: `request-line-${index}`,
    item_id: `item-${index}`,
    requested_qty_snapshot: 1,
    committed_qty_snapshot: 1,
    issued_qty: 1,
    received_qty: 0,
    created_at: `2026-09-03T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  const calls: Array<{ table: string; method: string; args: unknown[]; projection?: string }> = [];
  let maxInValues = 0;
  let linePagesRequested = 0;

  const from = vi.fn((table: string) => {
    let projection = '';
    let inFilter: { column: string; values: string[] } | null = null;
    let afterId: string | null = null;
    let limitValue = 1000;
    const query: Record<string, any> = {};
    query.select = vi.fn((value: string) => {
      projection = value;
      calls.push({ table, method: 'select', args: [value], projection });
      return query;
    });
    query.in = vi.fn((column: string, values: string[]) => {
      inFilter = { column, values };
      maxInValues = Math.max(maxInValues, values.length);
      calls.push({ table, method: 'in', args: [column, values], projection });
      return query;
    });
    query.order = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: 'order', args, projection });
      return query;
    });
    query.limit = vi.fn((value: number) => {
      limitValue = value;
      calls.push({ table, method: 'limit', args: [value], projection });
      return query;
    });
    query.gt = vi.fn((_column: string, value: string) => {
      afterId = value;
      calls.push({ table, method: 'gt', args: [_column, value], projection });
      return query;
    });
    query.then = (resolve: (value: unknown) => unknown) => {
      const source = table === 'material_request_fulfillment_batches' ? batches : lines;
      if (table === 'material_request_fulfillment_lines') linePagesRequested += 1;
      const filtered = source
        .filter(row => !inFilter || inFilter.values.includes(String((row as any)[inFilter.column])))
        .filter(row => !afterId || row.id > afterId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limitValue);
      return Promise.resolve({ data: filtered, error: null }).then(resolve);
    };
    return query;
  });

  return {
    calls,
    from,
    requestIds,
    get maxInValues() { return maxInValues; },
    get linePagesRequested() { return linePagesRequested; },
    reset() { calls.length = 0; maxInValues = 0; linePagesRequested = 0; },
  };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));

import { materialRequestFulfillmentService } from '../materialRequestFulfillmentService';

describe('procurement complete reads', () => {
  beforeEach(() => mocks.reset());

  it('loads more than 1,000 fulfillment lines with chunked filters and keyset pages', async () => {
    const grouped = await materialRequestFulfillmentService.listByRequests(mocks.requestIds);
    const loadedLines = Object.values(grouped).flatMap(batches => batches.flatMap(batch => batch.lines));

    expect(loadedLines).toHaveLength(1200);
    expect(mocks.maxInValues).toBeLessThanOrEqual(100);
    expect(mocks.linePagesRequested).toBeGreaterThan(2);
    expect(mocks.calls.filter(call => call.method === 'select').every(call => call.projection !== '*')).toBe(true);
    expect(mocks.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'material_request_fulfillment_lines', method: 'limit', args: [1000] }),
      expect.objectContaining({ table: 'material_request_fulfillment_lines', method: 'gt' }),
    ]));
  });
});
