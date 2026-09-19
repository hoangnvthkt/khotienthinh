import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type QueryResponse = { data: any[] | null; error: any };
  type QueryState = {
    table: string;
    projection?: string;
    filters: Array<{ column: string; value: unknown }>;
    nullFilters: string[];
  };

  const responses = new Map<string, QueryResponse>();
  const queries: QueryState[] = [];

  const from = vi.fn((table: string) => {
    const state: QueryState = { table, filters: [], nullFilters: [] };
    queries.push(state);

    const query: Record<string, any> = {};
    query.select = vi.fn((projection: string) => {
      state.projection = projection;
      return query;
    });
    query.eq = vi.fn((column: string, value: unknown) => {
      state.filters.push({ column, value });
      return query;
    });
    query.is = vi.fn((column: string, value: unknown) => {
      if (value === null) state.nullFilters.push(column);
      return query;
    });
    query.order = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.then = (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(responses.get(table) ?? { data: [], error: null }).then(resolve, reject);
    return query;
  });

  return {
    from,
    queries,
    responses,
    customerContracts: vi.fn(),
    subcontractorContracts: vi.fn(),
    contractItems: vi.fn(),
    paymentCertificates: vi.fn(),
    advanceBalance: vi.fn(),
    costSummary: vi.fn(),
  };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../hdService', () => ({
  customerContractService: { listBySite: mocks.customerContracts },
  subcontractorContractService: { listBySite: mocks.subcontractorContracts },
}));
vi.mock('../contractItemService', () => ({
  contractItemService: { listBySite: mocks.contractItems },
}));
vi.mock('../paymentCertificateService', () => ({
  paymentCertificateService: { listBySite: mocks.paymentCertificates },
}));
vi.mock('../advancePaymentService', () => ({
  advancePaymentService: { getBalance: mocks.advanceBalance },
}));
vi.mock('../projectCostItemService', () => ({
  projectCostItemService: { getSummary: mocks.costSummary },
}));

import { projectFinancialService } from '../projectFinancialService';

const databaseError = (code: string, message: string) => ({ code, message });

describe('projectFinancialService.getKPIs', () => {
  beforeEach(() => {
    mocks.from.mockClear();
    mocks.queries.length = 0;
    mocks.responses.clear();
    mocks.responses.set('project_transactions', { data: [], error: null });
    mocks.responses.set('purchase_orders', { data: [], error: null });

    mocks.customerContracts.mockReset().mockResolvedValue([]);
    mocks.subcontractorContracts.mockReset().mockResolvedValue([]);
    mocks.contractItems.mockReset().mockResolvedValue([]);
    mocks.paymentCertificates.mockReset().mockResolvedValue([]);
    mocks.advanceBalance.mockReset().mockResolvedValue({
      totalAdvance: 0,
      totalRecovered: 0,
      totalRemaining: 0,
      count: 0,
    });
    mocks.costSummary.mockReset().mockResolvedValue({ totalBudget: 0, totalActual: 0 });
  });

  it('reads active purchase orders from the real table in project scope', async () => {
    mocks.responses.set('purchase_orders', {
      data: [{ id: 'po-1', total_amount: 100, status: 'confirmed', archived_at: null }],
      error: null,
    });

    const result = await projectFinancialService.getKPIs('site-a', [], 'project-a');

    expect(result.committedCost).toBe(100);
    const poQuery = mocks.queries.find(query => query.table === 'purchase_orders');
    expect(poQuery).toMatchObject({
      projection: 'id,total_amount,status,archived_at',
      filters: [{ column: 'project_id', value: 'project-a' }],
      nullFilters: ['archived_at'],
    });
  });

  it('scopes purchase orders by construction site when project id is absent', async () => {
    await projectFinancialService.getKPIs('site-a');

    const poQuery = mocks.queries.find(query => query.table === 'purchase_orders');
    expect(poQuery?.filters).toEqual([{ column: 'construction_site_id', value: 'site-a' }]);
  });

  it('rejects instead of reporting zero when the purchase-order read is denied', async () => {
    const error = databaseError('42501', 'permission denied for purchase_orders');
    mocks.responses.set('purchase_orders', { data: null, error });

    await expect(projectFinancialService.getKPIs('site-a', [], 'project-a'))
      .rejects.toMatchObject(error);
  });

  it('rejects instead of reporting zero when the transaction read fails', async () => {
    const error = databaseError('57014', 'statement timeout');
    mocks.responses.set('project_transactions', { data: null, error });

    await expect(projectFinancialService.getKPIs('site-a', [], 'project-a'))
      .rejects.toMatchObject(error);
  });

  it('keeps a legitimate empty result distinct from a failed read', async () => {
    const result = await projectFinancialService.getKPIs('site-a');

    expect(result.committedCost).toBe(0);
    expect(result.cashIn).toBe(0);
    expect(result.cashOut).toBe(0);
  });

  it('propagates advance-balance failures instead of treating them as no advances', async () => {
    mocks.customerContracts.mockResolvedValue([{ id: 'contract-1', status: 'active', value: 1_000 }]);
    const error = databaseError('42501', 'permission denied for advance payments');
    mocks.advanceBalance.mockRejectedValue(error);

    await expect(projectFinancialService.getKPIs('site-a'))
      .rejects.toMatchObject(error);
  });
});
