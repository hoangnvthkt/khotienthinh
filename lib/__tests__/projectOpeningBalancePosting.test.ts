import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  weeklySnapshot: vi.fn(),
}));

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

vi.mock('../projectWeeklyProgressService', () => ({
  getWeekStart: (date: string) => date,
  projectWeeklyProgressService: {
    upsertSnapshot: mocks.weeklySnapshot,
  },
}));

import { projectOpeningBalanceService } from '../projectOpeningBalanceService';

const commandId = '11111111-1111-4111-8111-111111111111';

const existingItem = {
  id: 'item-1',
  sku: 'VT-001',
  accountingCode: '152-VT-001',
  name: 'Vật tư đầu kỳ',
  category: 'Đầu kỳ',
  unit: 'Kg',
  priceIn: 10,
  priceOut: 10,
  minStock: 0,
  stockByWarehouse: {},
};

const existingFinance = {
  id: 'finance-existing',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  contractValue: 900,
  budgetMaterials: 100,
  budgetLabor: 200,
  budgetSubcontract: 0,
  budgetMachinery: 0,
  budgetOverhead: 0,
  actualMaterials: 30,
  actualLabor: 20,
  actualSubcontract: 0,
  actualMachinery: 0,
  actualOverhead: 0,
  revenueReceived: 0,
  revenuePending: 0,
  progressPercent: 20,
  actualProductionValue: 0,
  status: 'planning' as const,
  notes: 'Finance snapshot before opening lock',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

const makeInput = (remainingQty: number, warehouseId = 'warehouse-1') => ({
  commandId,
  openingBalance: {
    scopeKey: ' Project-1_Site-1 ',
    projectId: 'project-1',
    constructionSiteId: 'site-1',
    asOfDate: '2026-07-14',
    contractValue: 1_000,
    constructionProgressPercent: 25,
    purchasedValue: 100,
    issuedValue: 40,
    usedValue: 40,
    recognizedValue: 40,
    status: 'draft' as const,
  },
  lines: [{
    inventoryItemId: existingItem.id,
    accountingCode: existingItem.accountingCode,
    sku: existingItem.sku,
    itemName: existingItem.name,
    unit: existingItem.unit,
    warehouseId,
    purchasedQty: remainingQty,
    issuedQty: 0,
    usedQty: 0,
    remainingQty,
    unitPrice: 10,
    remainingValue: remainingQty * 10,
  }],
  existingItems: [existingItem],
  existingFinance,
  actorUserId: 'spoofed-client-actor',
});

const rpcResult = (overrides: Record<string, unknown> = {}) => ({
  opening_balance: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scope_key: 'project-1_site-1',
    project_id: 'project-1',
    construction_site_id: 'site-1',
    as_of_date: '2026-07-14',
    contract_value: 1_000,
    construction_progress_percent: 25,
    purchased_value: 100,
    issued_value: 40,
    used_value: 40,
    recognized_value: 40,
    status: 'locked',
    stock_transaction_ids: ['opening-balance:aaaaaaaa:warehouse-1'],
    material_project_transaction_id: 'opening-material:aaaaaaaa',
  },
  lines: [{
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    opening_balance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    inventory_item_id: existingItem.id,
    accounting_code: existingItem.accountingCode,
    sku: existingItem.sku,
    item_name: existingItem.name,
    unit: existingItem.unit,
    warehouse_id: 'warehouse-1',
    purchased_qty: 1.25,
    issued_qty: 0,
    used_qty: 0,
    remaining_qty: 1.25,
    unit_price: 10,
    remaining_value: 12.5,
  }],
  project_finance: {
    id: 'opening-finance:project-1-site-1',
    project_id: 'project-1',
    construction_site_id: 'site-1',
    constructionSiteId: 'site-1',
    contractValue: 1_000,
    progressPercent: 25,
    status: 'active',
  },
  material_project_transaction: {
    id: 'opening-material:aaaaaaaa',
    project_id: 'project-1',
    project_finance_id: 'opening-finance:project-1-site-1',
    construction_site_id: 'site-1',
    type: 'expense',
    category: 'materials',
    amount: 40,
    description: 'Chi phí vật tư đầu kỳ',
    date: '2026-07-14',
    source: 'import',
    source_ref: 'opening_balance:aaaaaaaa:materials',
  },
  stock_transactions: [{
    id: 'opening-balance:aaaaaaaa:warehouse-1',
    type: 'ADJUSTMENT',
    date: '2026-07-14T00:00:00+00:00',
    items: [{ itemId: existingItem.id, quantity: 1.25, price: 10, unit: 'Kg' }],
    target_warehouse_id: 'warehouse-1',
    requester_id: 'user-1',
    approver_id: 'user-1',
    status: 'COMPLETED',
    source_type: 'project_opening_balance',
    source_id: 'aaaaaaaa:warehouse-1',
  }],
  created_items: [],
  updated_items: [{
    ...existingItem,
    accounting_code: existingItem.accountingCode,
    price_in: 10,
    price_out: 10,
    min_stock: 0,
    stock_by_warehouse: { 'warehouse-1': 1.25 },
  }],
  ...overrides,
});

describe('project opening balance atomic posting command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.weeklySnapshot.mockResolvedValue(undefined);
    mocks.from.mockImplementation(() => {
      throw new Error('configured lock must not orchestrate table mutations in the browser');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('locks through one RPC, trusts the server actor, and maps the complete response', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: rpcResult(), error: null });

    const result = await projectOpeningBalanceService.lockOpeningBalance(makeInput(1.25));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('lock_project_opening_balance', {
      p_command: {
        commandId,
        openingBalance: expect.objectContaining({
          scopeKey: 'Project-1_Site-1',
          projectId: 'project-1',
          constructionSiteId: 'site-1',
          contractValue: '1000',
          constructionProgressPercent: '25',
          purchasedValue: '100',
          issuedValue: '40',
          usedValue: '40',
          recognizedValue: '40',
          status: 'draft',
        }),
        lines: [expect.objectContaining({
          inventoryItemId: existingItem.id,
          sku: existingItem.sku,
          warehouseId: 'warehouse-1',
          remainingQty: '1.25',
          unitPrice: '10',
          remainingValue: '12.5',
        })],
        projectFinanceId: existingFinance.id,
        financeSnapshot: expect.objectContaining({
          id: existingFinance.id,
          projectId: 'project-1',
          constructionSiteId: 'site-1',
          actualMaterials: '30',
          updatedAt: '2026-07-14T00:00:00.000Z',
        }),
      },
    });
    const command = mocks.rpc.mock.calls[0][1].p_command;
    expect(command).not.toHaveProperty('actorUserId');
    expect(command).not.toHaveProperty('existingItems');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      openingBalance: { status: 'locked', scopeKey: 'project-1_site-1' },
      projectFinance: { id: 'opening-finance:project-1-site-1' },
      materialProjectTransaction: { amount: 40 },
      stockTransactions: [{ status: 'COMPLETED', targetWarehouseId: 'warehouse-1' }],
      createdItems: [],
      updatedItems: [{ id: existingItem.id, stockByWarehouse: { 'warehouse-1': 1.25 } }],
    });
    expect(mocks.weeklySnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns the committed lock with a warning when the derived weekly snapshot fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: rpcResult(), error: null });
    mocks.weeklySnapshot.mockRejectedValueOnce(new Error('weekly snapshot unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await projectOpeningBalanceService.lockOpeningBalance(makeInput(1.25));

    expect(result.openingBalance.status).toBe('locked');
    expect(result.warnings).toEqual([
      'Dữ liệu đầu kỳ đã được khóa nhưng snapshot tiến độ tuần chưa cập nhật.',
    ]);
    expect(warn).toHaveBeenCalledWith(
      'project opening balance weekly snapshot failed after commit',
      'weekly snapshot unavailable',
    );
  });

  it('preserves stock-by-warehouse identifiers as opaque map keys', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: rpcResult({
        updated_items: [{
          ...existingItem,
          accounting_code: existingItem.accountingCode,
          stock_by_warehouse: { zone_a: 1.25, 'warehouse-1': 2.5 },
        }],
      }),
      error: null,
    });

    const result = await projectOpeningBalanceService.lockOpeningBalance(makeInput(1.25));

    expect(result.updatedItems[0].stockByWarehouse).toEqual({
      zone_a: 1.25,
      'warehouse-1': 2.5,
    });
    expect(result.updatedItems[0].stockByWarehouse).not.toHaveProperty('zoneA');
  });

  it('voids through one typed controlled-reversal RPC with canonical finance snapshots', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        opening_balance: {
          ...rpcResult().opening_balance,
          status: 'void',
          reversal_command_id: commandId,
          reversal_reason: 'Điều chỉnh số dư đầu kỳ sai',
          reversed_by: 'user-1',
          reversed_at: '2026-07-15T04:00:00.000Z',
          reversal_stock_transaction_ids: ['opening-reversal:aaaaaaaa:warehouse-1'],
          reversal_material_project_transaction_id: 'opening-material-reversal:aaaaaaaa',
        },
        project_finance: {
          ...rpcResult().project_finance,
          contractValue: 950,
          progressPercent: 20,
          notes: 'Đã hiệu chỉnh đầu kỳ',
          updatedAt: '2026-07-15T04:00:00.000Z',
        },
        finance_before: {
          id: existingFinance.id,
          projectId: 'project-1',
          constructionSiteId: 'site-1',
          contractValue: 1000,
          progressPercent: 25,
          status: 'active',
          notes: 'Sau khóa đầu kỳ',
          updatedAt: '2026-07-15T03:00:00.000Z',
        },
        finance_after: {
          id: existingFinance.id,
          projectId: 'project-1',
          constructionSiteId: 'site-1',
          contractValue: 950,
          progressPercent: 20,
          status: 'active',
          notes: 'Đã hiệu chỉnh đầu kỳ',
          updatedAt: '2026-07-15T04:00:00.000Z',
        },
        compensating_stock_transactions: [{
          ...rpcResult().stock_transactions[0],
          id: 'opening-reversal:aaaaaaaa:warehouse-1',
          items: [{ itemId: existingItem.id, quantity: -1.25, price: 10, unit: 'Kg' }],
          source_type: 'project_opening_balance_reversal',
          source_id: 'aaaaaaaa:warehouse-1',
        }],
        compensating_material_project_transaction: {
          ...rpcResult().material_project_transaction,
          id: 'opening-material-reversal:aaaaaaaa',
          amount: -40,
          source_ref: 'opening_balance_reversal:aaaaaaaa:materials',
        },
        stock_transaction_map: [{
          originalTransactionId: 'opening-balance:aaaaaaaa:warehouse-1',
          compensatingTransactionId: 'opening-reversal:aaaaaaaa:warehouse-1',
        }],
        reversal: {
          commandId,
          requestHash: 'hash-1',
          actorId: 'user-1',
          reason: 'Điều chỉnh số dư đầu kỳ sai',
          reversedAt: '2026-07-15T04:00:00.000Z',
        },
      },
      error: null,
    });

    const result = await projectOpeningBalanceService.voidOpeningBalance({
      commandId,
      openingBalanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason: '  Điều chỉnh số dư đầu kỳ sai  ',
      expectedFinanceSnapshot: {
        id: existingFinance.id,
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        contractValue: 1_000,
        progressPercent: 25,
        status: 'active',
        updatedAt: '2026-07-15T03:00:00.000Z',
      },
      correctedFinanceSnapshot: {
        id: existingFinance.id,
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        contractValue: 950,
        progressPercent: 20,
        status: 'active',
      },
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('reverse_project_opening_balance', {
      p_command: {
        commandId,
        openingBalanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        reason: 'Điều chỉnh số dư đầu kỳ sai',
        expectedFinanceSnapshot: expect.objectContaining({
          contractValue: '1000',
          progressPercent: '25',
          notes: null,
          updatedAt: '2026-07-15T03:00:00.000Z',
        }),
        correctedFinanceSnapshot: expect.objectContaining({
          contractValue: '950',
          progressPercent: '20',
          notes: null,
        }),
      },
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      openingBalance: { status: 'void' },
      projectFinance: { contractValue: 950 },
      financeBefore: { contractValue: 1_000 },
      financeAfter: { contractValue: 950 },
      compensatingStockTransactions: [{
        sourceType: 'project_opening_balance_reversal',
        items: [{ quantity: -1.25 }],
      }],
      compensatingMaterialProjectTransaction: { amount: -40 },
      stockTransactionMap: [{
        originalTransactionId: 'opening-balance:aaaaaaaa:warehouse-1',
        compensatingTransactionId: 'opening-reversal:aaaaaaaa:warehouse-1',
      }],
      reversal: { commandId, actorId: 'user-1' },
    });
  });

  it('rejects an incomplete reversal command before any network mutation', async () => {
    await expect(projectOpeningBalanceService.voidOpeningBalance({
      commandId,
      openingBalanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason: '   ',
      expectedFinanceSnapshot: {
        id: existingFinance.id,
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        contractValue: 1_000,
        progressPercent: 25,
        status: 'active',
        updatedAt: '2026-07-15T03:00:00.000Z',
      },
      correctedFinanceSnapshot: {
        id: existingFinance.id,
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        contractValue: 950,
        progressPercent: 20,
        status: 'active',
      },
    })).rejects.toThrow('lý do');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('sends the same command id and canonical content on an exact retry', async () => {
    const response = rpcResult();
    mocks.rpc
      .mockResolvedValueOnce({ data: response, error: null })
      .mockResolvedValueOnce({ data: response, error: null });
    const input = makeInput(1.25);

    const first = await projectOpeningBalanceService.lockOpeningBalance(input);
    const retry = await projectOpeningBalanceService.lockOpeningBalance(input);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1]);
    expect(first).toEqual(retry);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('expands scientific notation into canonical dot-decimal command strings', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: rpcResult(), error: null });
    const input = makeInput(1e-7);
    input.openingBalance.contractValue = 1e21;

    await projectOpeningBalanceService.lockOpeningBalance(input);

    const command = mocks.rpc.mock.calls[0][1].p_command;
    expect(command.openingBalance.contractValue).toBe('1000000000000000000000');
    expect(command.lines[0].remainingQty).toBe('0.0000001');
    expect(JSON.stringify(command)).not.toMatch(/[0-9][eE][+-]?[0-9]/);
  });

  it('surfaces a conflicting retry without running derived-cache work', async () => {
    const error = Object.assign(new Error('opening balance commandId was reused with different content'), {
      code: '22023',
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error });

    await expect(projectOpeningBalanceService.lockOpeningBalance(makeInput(2)))
      .rejects.toBe(error);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.weeklySnapshot).not.toHaveBeenCalled();
  });

  it('keeps a zero-quantity line as evidence while the server returns no WMS movement', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: rpcResult({
        stock_transactions: [],
        opening_balance: {
          ...rpcResult().opening_balance,
          stock_transaction_ids: [],
        },
        lines: [{
          ...rpcResult().lines[0],
          purchased_qty: 0,
          remaining_qty: 0,
          remaining_value: 0,
        }],
      }),
      error: null,
    });

    const result = await projectOpeningBalanceService.lockOpeningBalance(makeInput(0));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1].p_command.lines).toHaveLength(1);
    expect(mocks.rpc.mock.calls[0][1].p_command.lines[0].remainingQty).toBe('0');
    expect(result.lines).toHaveLength(1);
    expect(result.stockTransactions).toEqual([]);
  });

  it('delegates multi-warehouse posting as one all-or-nothing RPC', async () => {
    const error = Object.assign(new Error('warehouse-2 posting failed; transaction rolled back'), {
      code: 'P0001',
    });
    mocks.rpc.mockResolvedValueOnce({ data: null, error });
    const input = makeInput(1.25);
    input.lines.push({ ...input.lines[0], warehouseId: 'warehouse-2' });

    await expect(projectOpeningBalanceService.lockOpeningBalance(input)).rejects.toBe(error);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1].p_command.lines.map((line: any) => line.warehouseId))
      .toEqual(['warehouse-1', 'warehouse-2']);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.weeklySnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['ambiguous item lookup', 'opening item lookup is ambiguous', '21000'],
    ['stale or locked scope', 'opening balance scope is already locked', '23505'],
    ['project permission denial', 'project.budget.manage is required', '42501'],
    ['warehouse completion denial', 'wms.transaction.complete is required for warehouse-1', '42501'],
  ])('propagates %s from the atomic command', async (_label, message, code) => {
    const error = Object.assign(new Error(message), { code });
    mocks.rpc.mockResolvedValueOnce({ data: null, error });

    await expect(projectOpeningBalanceService.lockOpeningBalance(makeInput(1.25)))
      .rejects.toBe(error);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.weeklySnapshot).not.toHaveBeenCalled();
  });
});
