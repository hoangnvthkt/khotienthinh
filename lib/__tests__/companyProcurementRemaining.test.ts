import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

type Row = Record<string, any>;

const mocks = vi.hoisted(() => {
  const state: {
    tables: Record<string, Row[]>;
    errors: Record<string, unknown>;
    summaries: Record<string, any>;
    calls: Array<{ table: string; filters: Array<[string, string, unknown]> }>;
  } = {
    tables: {},
    errors: {},
    summaries: {},
    calls: [],
  };

  const from = vi.fn((table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    const orders: Array<[string, { ascending?: boolean } | undefined]> = [];
    let limit = Number.POSITIVE_INFINITY;
    state.calls.push({ table, filters });
    const query: Record<string, any> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn((column: string, value: unknown) => {
      filters.push(['eq', column, value]);
      return query;
    });
    query.in = vi.fn((column: string, values: unknown[]) => {
      filters.push(['in', column, values]);
      return query;
    });
    query.gt = vi.fn((column: string, value: unknown) => {
      filters.push(['gt', column, value]);
      return query;
    });
    query.or = vi.fn(() => query);
    query.order = vi.fn((column: string, options?: { ascending?: boolean }) => {
      orders.push([column, options]);
      return query;
    });
    query.limit = vi.fn((value: number) => {
      limit = value;
      return query;
    });
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const configuredError = state.errors[table];
      if (configuredError) return Promise.resolve({ data: null, error: configuredError }).then(resolve, reject);
      let rows = [...(state.tables[table] || [])];
      filters.forEach(([operator, column, value]) => {
        if (operator === 'eq') rows = rows.filter(row => row[column] === value);
        if (operator === 'in') rows = rows.filter(row => (value as unknown[]).includes(row[column]));
        if (operator === 'gt') rows = rows.filter(row => String(row[column]) > String(value));
      });
      orders.slice().reverse().forEach(([column, options]) => {
        rows.sort((left, right) => {
          const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
          return options?.ascending === false ? -comparison : comparison;
        });
      });
      return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(resolve, reject);
    };
    return query;
  });

  const listSummariesByRequests = vi.fn(async (requests: Array<{ id: string }>) => ({
    summariesByRequestId: Object.fromEntries(requests.map(request => [request.id, state.summaries[request.id]])),
    batchCountsByRequestId: {},
    activeBatchCountsByRequestId: {},
  }));

  return { state, from, listSummariesByRequests };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../materialRequestFulfillmentService', () => ({
  getRequestLineId: (_request: unknown, line: { lineId?: string }, index: number) => line.lineId || `line-${index}`,
  materialRequestFulfillmentService: {
    listSummariesByRequests: mocks.listSummariesByRequests,
  },
}));

import { companyProcurementService } from '../companyProcurementService';

const companyProcurementSource = readFileSync(
  new URL('../../pages/procurement/CompanyProcurement.tsx', import.meta.url),
  'utf8',
);

const requestRow = (quantity = 100): Row => ({
  id: 'mr-1',
  code: 'MR-001',
  title: 'Need material',
  site_warehouse_id: 'warehouse-1',
  requester_id: 'user-1',
  status: 'APPROVED',
  items: [{
    lineId: 'mr-line-1',
    itemId: 'item-1',
    requestQty: quantity,
    approvedQty: quantity,
    unitSnapshot: 'kg',
  }],
  created_date: '2026-09-19T00:00:00.000Z',
  expected_date: '2026-09-20',
  project_id: 'project-1',
  construction_site_id: 'site-1',
  request_origin: 'project',
  workflow_step: 'batch_planning',
});

const linkRow = (patch: Row = {}): Row => ({
  id: 'link-1',
  project_id: 'project-1',
  construction_site_id: 'site-1',
  purchase_order_id: 'po-1',
  purchase_order_line_id: 'po-line-1',
  material_request_id: 'mr-1',
  material_request_code: 'MR-001',
  request_line_id: 'mr-line-1',
  item_id: 'item-1',
  requested_qty: 100,
  ordered_qty: 80,
  requested_qty_snapshot: 100,
  ordered_stock_qty_snapshot: 80,
  actual_received_qty_snapshot: 0,
  allocation_status: 'open',
  unit: 'kg',
  ...patch,
});

const summary = (receivedQty: number, openNeedQty: number): Row => ({
  materialRequestId: 'mr-1',
  lineSummaries: [{
    materialRequestId: 'mr-1',
    requestLineId: 'mr-line-1',
    itemId: 'item-1',
    requestedQty: 100,
    committedQty: 100,
    orderedQty: 0,
    issuedQty: receivedQty,
    receivedQty,
    netReceivedQty: receivedQty,
    closedNeedQty: 0,
    openNeedQty,
    remainingToIssue: openNeedQty,
    remainingToReceive: openNeedQty,
  }],
});

const setBaseFixture = () => {
  mocks.state.tables = {
    requests: [requestRow()],
    items: [{ id: 'item-1', sku: 'ITEM-1', name: 'Material 1', unit: 'kg', purchase_unit: 'kg', purchase_conversion_factor: 1, stock_by_warehouse: {} }],
    purchase_order_request_lines: [linkRow()],
    purchase_orders: [{ id: 'po-1', status: 'partial', archived_at: null }],
    purchase_order_delivery_batches: [{ id: 'delivery-batch-1', purchase_order_id: 'po-1', status: 'received_short' }],
    purchase_order_delivery_lines: [{
      id: 'delivery-line-1',
      delivery_batch_id: 'delivery-batch-1',
      purchase_order_id: 'po-1',
      purchase_order_line_id: 'po-line-1',
      item_id: 'item-1',
      accepted_stock_qty: 30,
      stock_unit: 'kg',
    }],
    material_request_fulfillment_lines: [],
    material_request_fulfillment_batches: [],
  };
  mocks.state.errors = {};
  mocks.state.summaries = { 'mr-1': summary(30, 70) };
  mocks.state.calls = [];
};

describe('company procurement remaining from open commitments', () => {
  beforeEach(() => {
    mocks.from.mockClear();
    mocks.listSummariesByRequests.mockClear();
    setBaseFixture();
  });

  it('uses attributed receipts when deriving remaining demand through listOpenDemand', async () => {
    const [row] = await companyProcurementService.listOpenDemand();

    expect(row).toMatchObject({
      requestedQty: 100,
      actualReceivedQty: 30,
      orderedQty: 80,
      openCommitmentQty: 50,
      remainingKnown: true,
      remainingQty: 20,
    });
  });

  it('keeps separate PO commitments and releases a terminal PO without reallocating its shortfall', async () => {
    mocks.state.tables.purchase_order_request_lines = [
      linkRow({ id: 'link-1', purchase_order_id: 'po-1', purchase_order_line_id: 'po-line-1', ordered_stock_qty_snapshot: 40, ordered_qty: 40 }),
      linkRow({ id: 'link-2', purchase_order_id: 'po-2', purchase_order_line_id: 'po-line-2', ordered_stock_qty_snapshot: 40, ordered_qty: 40 }),
    ];
    mocks.state.tables.purchase_orders = [
      { id: 'po-1', status: 'partial', archived_at: null },
      { id: 'po-2', status: 'confirmed', archived_at: null },
    ];

    const [activeRow] = await companyProcurementService.listOpenDemand();
    expect(activeRow).toMatchObject({ openCommitmentQty: 50, remainingQty: 20 });

    mocks.state.tables.purchase_orders[0].status = 'delivered';
    const [terminalRow] = await companyProcurementService.listOpenDemand();
    expect(terminalRow).toMatchObject({ openCommitmentQty: 40, remainingQty: 30 });
  });

  it('uses explicit quantity attribution for shared PO lines without spreading the receipt', async () => {
    mocks.state.tables.purchase_order_request_lines = [
      linkRow({ id: 'link-1', ordered_stock_qty_snapshot: 40, ordered_qty: 40 }),
      linkRow({ id: 'link-2', ordered_stock_qty_snapshot: 40, ordered_qty: 40 }),
    ];
    mocks.state.tables.material_request_fulfillment_lines = [{
      id: 'fulfillment-line-1', batch_id: 'fulfillment-batch-1', material_request_id: 'mr-1', request_line_id: 'mr-line-1',
      item_id: 'item-1', po_id: 'po-1', po_line_id: 'po-line-1', purchase_order_request_line_id: 'link-1', received_qty: 30, unit: 'kg',
    }];
    mocks.state.tables.material_request_fulfillment_batches = [{ id: 'fulfillment-batch-1', status: 'received', source_type: 'po_receipt' }];

    const [row] = await companyProcurementService.listOpenDemand();
    expect(row).toMatchObject({
      orderedQty: 80,
      openCommitmentQty: 50,
      remainingKnown: true,
      remainingQty: 20,
    });
  });

  it('uses stock snapshots, preserves literal zero, and never falls back with truthiness', async () => {
    mocks.state.tables.purchase_order_request_lines = [linkRow({
      ordered_qty: 2,
      ordered_stock_qty_snapshot: 50,
    })];
    mocks.state.tables.purchase_order_delivery_lines[0].accepted_stock_qty = 25;
    mocks.state.summaries['mr-1'] = summary(25, 75);

    const [converted] = await companyProcurementService.listOpenDemand();
    expect(converted).toMatchObject({ orderedQty: 50, openCommitmentQty: 25, remainingQty: 50 });

    mocks.state.tables.purchase_order_request_lines[0].ordered_stock_qty_snapshot = 0;
    mocks.state.tables.purchase_order_delivery_batches = [];
    mocks.state.tables.purchase_order_delivery_lines = [];
    mocks.state.summaries['mr-1'] = summary(0, 100);
    const [zeroSnapshot] = await companyProcurementService.listOpenDemand();
    expect(zeroSnapshot).toMatchObject({ orderedQty: 0, openCommitmentQty: 0, remainingQty: 100 });
  });

  it('does not open procurement for a fully received request line', async () => {
    mocks.state.tables.purchase_order_request_lines = [];
    mocks.state.tables.purchase_orders = [];
    mocks.state.tables.purchase_order_delivery_batches = [];
    mocks.state.tables.purchase_order_delivery_lines = [];
    mocks.state.summaries['mr-1'] = summary(100, 0);

    await expect(companyProcurementService.listOpenDemand()).resolves.toEqual([]);
  });

  it.each([
    {
      name: 'shared PO line without quantity attribution',
      configure: () => {
        mocks.state.tables.purchase_order_request_lines.push(linkRow({ id: 'link-2' }));
      },
      issue: 'missing_receipt_attribution',
    },
    {
      name: 'received quantity returned without a mapped disposition',
      configure: () => {
        mocks.state.tables.material_request_fulfillment_lines = [{
          id: 'fulfillment-line-1', batch_id: 'fulfillment-batch-1', material_request_id: 'mr-1', request_line_id: 'mr-line-1',
          item_id: 'item-1', po_id: 'po-1', po_line_id: 'po-line-1', purchase_order_request_line_id: 'link-1', received_qty: 30, unit: 'kg',
        }];
        mocks.state.tables.material_request_fulfillment_batches = [{ id: 'fulfillment-batch-1', status: 'returned', source_type: 'po_receipt' }];
      },
      issue: 'return_disposition_unknown',
    },
    {
      name: 'delivery evidence in a different stock unit',
      configure: () => {
        mocks.state.tables.purchase_order_delivery_lines[0].stock_unit = 'cây';
      },
      issue: 'quantity_or_unit_mismatch',
    },
    {
      name: 'fulfillment attribution greater than the accepted delivery',
      configure: () => {
        mocks.state.tables.material_request_fulfillment_lines = [{
          id: 'fulfillment-line-1', batch_id: 'fulfillment-batch-1', material_request_id: 'mr-1', request_line_id: 'mr-line-1',
          item_id: 'item-1', po_id: 'po-1', po_line_id: 'po-line-1', purchase_order_request_line_id: 'link-1', received_qty: 31, unit: 'kg',
        }];
        mocks.state.tables.material_request_fulfillment_batches = [{ id: 'fulfillment-batch-1', status: 'received', source_type: 'po_receipt' }];
      },
      issue: 'receipt_attribution_exceeds_delivery',
    },
  ])('marks $name as unknown instead of zero', async ({ configure, issue }) => {
    configure();

    const [row] = await companyProcurementService.listOpenDemand();
    expect(row.remainingKnown).toBe(false);
    expect(row.openCommitmentQty).toBeNull();
    expect(row.remainingQty).toBeNull();
    expect(row.reconciliationIssues).toContain(issue);
  });

  it('ignores fulfillment received from a different source', async () => {
    mocks.state.tables.purchase_order_delivery_batches = [];
    mocks.state.tables.purchase_order_delivery_lines = [];
    mocks.state.tables.material_request_fulfillment_lines = [{
      id: 'stock-line-1', batch_id: 'stock-batch-1', material_request_id: 'mr-1', request_line_id: 'mr-line-1',
      item_id: 'item-1', po_id: 'po-1', po_line_id: 'po-line-1', purchase_order_request_line_id: 'link-1', received_qty: 30, unit: 'kg',
    }];
    mocks.state.tables.material_request_fulfillment_batches = [{ id: 'stock-batch-1', status: 'received', source_type: 'stock' }];

    const [row] = await companyProcurementService.listOpenDemand();
    expect(row).toMatchObject({ openCommitmentQty: 80, remainingQty: 0 });
  });

  it('propagates adapter query failures instead of treating them as no commitment', async () => {
    const error = { code: '42501', message: 'denied' };
    mocks.state.errors.purchase_order_delivery_lines = error;

    await expect(companyProcurementService.listOpenDemand()).rejects.toBe(error);
  });

  it('blocks PO creation when receipt attribution is unknown', async () => {
    mocks.state.tables.purchase_order_request_lines.push(linkRow({ id: 'link-2' }));

    await expect(companyProcurementService.createConsolidatedPurchaseOrders({
      actorUserId: 'buyer-1',
      lines: [{
        demandKey: 'mr-1:mr-line-1',
        vendorId: 'supplier-1',
        orderStockQty: 20,
        stockUnitPrice: 1,
      }],
    })).rejects.toThrow('chưa đủ dữ liệu đối chiếu nhận hàng');
  });

  it('reads every page of PO links', async () => {
    mocks.state.tables.requests = [requestRow(2_000)];
    mocks.state.summaries['mr-1'] = summary(0, 2_000);
    mocks.state.tables.purchase_order_request_lines = Array.from({ length: 1_001 }, (_, index) => linkRow({
      id: `link-${String(index).padStart(4, '0')}`,
      ordered_qty: 1,
      ordered_stock_qty_snapshot: 1,
    }));
    mocks.state.tables.purchase_order_delivery_batches = [];
    mocks.state.tables.purchase_order_delivery_lines = [];

    const [row] = await companyProcurementService.listOpenDemand();
    expect(row).toMatchObject({ orderedQty: 1_001, openCommitmentQty: 1_001, remainingQty: 999 });
    expect(mocks.state.calls.filter(call => call.table === 'purchase_order_request_lines')).toHaveLength(2);
  });

  it('renders unknown commitment quality without allowing row selection', () => {
    expect(companyProcurementSource).toContain('disabled={remainingUnknown}');
    expect(companyProcurementSource).toContain('Chưa đủ dữ liệu đối chiếu nhận hàng');
    expect(companyProcurementSource).toContain("row.openCommitmentQty == null ? 'Chưa xác định'");
    expect(companyProcurementSource).toContain("row.remainingQty == null ? 'Chưa xác định'");
  });
});
