import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: supabaseMock,
}));

vi.mock('../featureFlags', () => ({
  isPurchasePackageV2Enabled: true,
  isPurchasePackageV2EnabledForSite: vi.fn(() => true),
}));

const selectProjectedColumns = (row: Record<string, unknown>, projection: string) =>
  Object.fromEntries(
    projection
      .split(',')
      .map(column => column.trim())
      .filter(column => Object.prototype.hasOwnProperty.call(row, column))
      .map(column => [column, row[column]]),
  );

describe('PO delivery schedule read model', () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
    supabaseMock.rpc.mockReset();
  });

  it('preserves delivered quantities and unknowns across every line page', async () => {
    const batchRows = [{
      id: 'batch-1',
      purchase_order_id: 'po-1',
      delivery_no: 1,
      status: 'quality_approved',
      quality_result: 'partial',
      quality_approved_at: '2026-09-19T01:00:00Z',
    }];
    const deliveryRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `line-${String(index).padStart(4, '0')}`,
      delivery_batch_id: 'batch-1',
      purchase_order_id: 'po-1',
      purchase_order_line_id: `po-line-${index}`,
      item_id: `item-${index}`,
      planned_qty: '100',
      delivered_qty: index === 0 ? '98.5' : index === 1 ? '0' : index === 2 ? null : '100',
      accepted_qty: index === 0 ? '98' : index === 2 ? '7' : '0',
      delivered_stock_qty: index === 0 ? '197' : index === 1 ? '0' : index === 2 ? null : '200',
      accepted_stock_qty: index === 0 ? '196' : index === 2 ? '14' : '0',
      returned_qty: '0',
      unit: 'bao',
      stock_planned_qty: '200',
      stock_unit: 'kg',
      delivery_unit_price: '250000',
      created_at: `2026-09-19T00:${String(Math.min(index, 59)).padStart(2, '0')}:00Z`,
      updated_at: '2026-09-19T00:00:00Z',
    }));
    const selectedLineProjections: string[] = [];

    supabaseMock.from.mockImplementation((table: string) => {
      let projection = '';
      let cursor: string | undefined;
      const rows = table === 'purchase_order_delivery_batches' ? batchRows : deliveryRows;
      const query: any = {
        select: vi.fn((value: string) => {
          projection = value;
          if (table === 'purchase_order_delivery_lines') selectedLineProjections.push(value);
          return query;
        }),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        gt: vi.fn((_column: string, value: string) => {
          cursor = value;
          return query;
        }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const page = cursor
            ? rows.filter(row => row.id > cursor).slice(0, 1000)
            : rows.slice(0, 1000);
          return Promise.resolve({
            data: page.map(row => selectProjectedColumns(row, projection)),
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    });

    const { poDeliveryScheduleService } = await import('../projectService');
    const result = await poDeliveryScheduleService.listByPurchaseOrderIds(['po-1']);

    expect(result['po-1'][0].lines).toHaveLength(1001);
    expect(result['po-1'][0].lines[0]).toEqual(expect.objectContaining({
      deliveredQty: 98.5,
      acceptedQty: 98,
      deliveredStockQty: 197,
      acceptedStockQty: 196,
    }));
    expect(result['po-1'][0].lines[1]).toEqual(expect.objectContaining({
      deliveredQty: 0,
      deliveredStockQty: 0,
    }));
    expect(result['po-1'][0].lines[2]).toEqual(expect.objectContaining({
      deliveredQty: undefined,
      acceptedQty: 7,
      deliveredStockQty: undefined,
      acceptedStockQty: 14,
    }));
    expect(result['po-1'][0].lines.at(-1)?.id).toBe('line-1000');
    expect(selectedLineProjections).toHaveLength(2);
    expect(selectedLineProjections[0].split(',')).toEqual(expect.arrayContaining([
      'delivered_qty',
      'delivered_stock_qty',
    ]));
  });
});
