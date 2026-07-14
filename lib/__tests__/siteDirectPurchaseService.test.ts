import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteDirectPurchase, SiteDirectPurchaseLine } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

import {
  calculateSiteDirectPurchaseTotals,
  canRecognizeSiteDirectPurchaseLine,
  siteDirectPurchaseService,
} from '../siteDirectPurchaseService';

const line = (patch: Partial<SiteDirectPurchaseLine> = {}): SiteDirectPurchaseLine => ({
  id: 'line-1',
  directPurchaseId: 'direct-1',
  lineNo: 1,
  lineType: 'stock_item',
  itemId: 'item-1',
  skuSnapshot: 'VT-001',
  itemNameSnapshot: 'Vat tu mua nong',
  unitSnapshot: 'kg',
  quantity: 10.5,
  unitPrice: 100_000,
  vatRate: 10,
  lineAmount: 1_050_000,
  vatAmount: 105_000,
  acceptedQuantity: 0,
  acceptedAmount: 0,
  status: 'pending',
  ...patch,
});

const purchaseRow = (patch: Record<string, any> = {}) => ({
  id: 'direct-1',
  code: 'MN-001',
  project_id: 'project-1',
  construction_site_id: 'site-1',
  supplier_id: 'supplier-a',
  supplier_name_snapshot: 'NCC A',
  purchase_mode: 'immediate',
  payment_source: 'supplier_credit',
  target_warehouse_id: 'wh-1',
  status: 'purchased',
  purchase_date: '2026-07-08',
  invoice_number: 'INV-001',
  invoice_date: '2026-07-08',
  gross_amount: 1000000,
  vat_amount: 100000,
  total_amount: 1100000,
  po_id: null,
  wms_transaction_id: null,
  site_cash_settlement_id: null,
  qr_token: 'qr-1',
  attachments: [],
  created_by: 'user-1',
  created_at: '2026-07-08T00:00:00.000Z',
  updated_at: '2026-07-08T00:00:00.000Z',
  note: 'Mua nóng',
  ...patch,
});

const purchase = (patch: Partial<SiteDirectPurchase> = {}): SiteDirectPurchase => ({
  id: 'direct-1',
  code: 'MN-001',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  supplierId: 'supplier-a',
  supplierNameSnapshot: 'NCC A',
  purchaseMode: 'immediate',
  paymentSource: 'supplier_credit',
  targetWarehouseId: 'wh-1',
  status: 'purchased',
  purchaseDate: '2026-07-08',
  invoiceNumber: 'INV-001',
  invoiceDate: '2026-07-08',
  grossAmount: 1000000,
  vatAmount: 100000,
  totalAmount: 1100000,
  poId: null,
  wmsTransactionId: null,
  siteCashSettlementId: null,
  qrToken: 'qr-1',
  attachments: [],
  createdBy: 'user-1',
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
  note: 'Mua nóng',
  ...patch,
});

const lineRow = (patch: Record<string, any> = {}) => ({
  id: 'line-1',
  direct_purchase_id: 'direct-1',
  line_no: 1,
  line_type: 'stock_item',
  item_id: 'item-1',
  sku_snapshot: 'VT-001',
  item_name_snapshot: 'Vat tu mua nong',
  unit_snapshot: 'kg',
  quantity: 10.5,
  unit_price: 100000,
  vat_rate: 10,
  line_amount: 1050000,
  vat_amount: 105000,
  accepted_quantity: 0,
  accepted_amount: 0,
  status: 'pending',
  rejection_reason: null,
  work_boq_item_id: null,
  material_budget_item_id: null,
  note: null,
  ...patch,
});

const query = (response: { data?: any; error?: any } = { data: [], error: null }) => {
  const api: any = {
    select: vi.fn(() => api),
    order: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    limit: vi.fn(() => api),
    single: vi.fn(() => Promise.resolve(response)),
    maybeSingle: vi.fn(() => Promise.resolve(response)),
    upsert: vi.fn(() => api),
    insert: vi.fn(() => Promise.resolve(response)),
    update: vi.fn(() => api),
    delete: vi.fn(() => api),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return api;
};

describe('siteDirectPurchaseService helpers', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('calculates decimal quantities and VAT for direct purchase lines', () => {
    const totals = calculateSiteDirectPurchaseTotals([
      line({ quantity: 10.5, unitPrice: 100_000, vatRate: 10 }),
      line({
        id: 'line-2',
        lineNo: 2,
        lineType: 'expense_only',
        quantity: 1,
        unitPrice: 500_000,
        vatRate: 0,
      }),
    ]);

    expect(totals.grossAmount).toBe(1_550_000);
    expect(totals.vatAmount).toBe(105_000);
    expect(totals.totalAmount).toBe(1_655_000);
  });

  it('does not recognize stock-item direct purchase before completed WMS import', () => {
    expect(canRecognizeSiteDirectPurchaseLine(line(), { wmsStatus: 'draft', financeAccepted: true })).toBe(false);
    expect(canRecognizeSiteDirectPurchaseLine(line(), { wmsStatus: 'completed', financeAccepted: true })).toBe(true);
  });

  it('recognizes expense-only lines from finance review without changing inventory', () => {
    expect(canRecognizeSiteDirectPurchaseLine(
      line({ lineType: 'expense_only', itemId: null }),
      { wmsStatus: null, financeAccepted: true },
    )).toBe(true);
  });

  it('recognizes small-tool lines from finance review without WMS import', () => {
    expect(canRecognizeSiteDirectPurchaseLine(
      line({ lineType: 'small_tool', itemId: null, itemNameSnapshot: 'Tô vít', unitSnapshot: 'cái' }),
      { wmsStatus: null, financeAccepted: true },
    )).toBe(true);
  });
});

describe('siteDirectPurchaseService persistence', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset();
    supabaseMocks.rpc.mockReset();
  });

  it('loads a direct purchase detail and maps snake case rows', async () => {
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow(), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow()], error: null }));

    const detail = await siteDirectPurchaseService.getDetail('direct-1');

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(1, 'site_direct_purchases');
    expect(supabaseMocks.from).toHaveBeenNthCalledWith(2, 'site_direct_purchase_lines');
    expect(detail.purchase.supplierNameSnapshot).toBe('NCC A');
    expect(detail.purchase.totalAmount).toBe(1100000);
    expect(detail.purchase.note).toBe('Mua nóng');
    expect(detail.lines[0].directPurchaseId).toBe('direct-1');
    expect(detail.lines[0].lineType).toBe('stock_item');
  });

  it('saves direct purchase header and lines through one atomic RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: purchaseRow(), error: null });

    const saved = await siteDirectPurchaseService.upsert(purchase(), [line()]);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('upsert_site_direct_purchase_with_lines', {
      p_purchase: expect.objectContaining({
        id: 'direct-1',
        gross_amount: 1050000,
        vat_amount: 105000,
        total_amount: 1155000,
      }),
      p_lines: [
        expect.objectContaining({
          id: 'line-1',
          direct_purchase_id: 'direct-1',
          line_amount: 1050000,
          vat_amount: 105000,
        }),
      ],
    });
    expect(supabaseMocks.from).not.toHaveBeenCalledWith('site_direct_purchases');
    expect(supabaseMocks.from).not.toHaveBeenCalledWith('site_direct_purchase_lines');
    expect(saved.id).toBe('direct-1');
  });

  it('auto-syncs AP after saving an expense-only direct purchase', async () => {
    const expenseLine = line({
      id: 'line-expense',
      lineType: 'expense_only',
      itemId: null,
      quantity: 1,
      unitPrice: 500000,
      vatRate: 0,
      lineAmount: 500000,
      vatAmount: 0,
    });
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: purchaseRow({ target_warehouse_id: null, gross_amount: 500000, vat_amount: 0, total_amount: 500000 }), error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'ap-1',
          source_type: 'site_direct_purchase',
          source_id: 'direct-1',
          recognized_amount: 500000,
          paid_amount: 0,
          credit_amount: 0,
          outstanding_amount: 500000,
          currency: 'VND',
          status: 'open',
        },
        error: null,
      });
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow({ target_warehouse_id: null }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ id: 'line-expense', line_type: 'expense_only', item_id: null, status: 'accepted', accepted_quantity: 1, accepted_amount: 500000, line_amount: 500000, vat_amount: 0 })], error: null }));

    await siteDirectPurchaseService.upsert(purchase({ targetWarehouseId: null }), [expenseLine]);

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'upsert_site_direct_purchase_with_lines', expect.any(Object));
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'sync_supplier_payable_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
  });

  it('reviews direct purchase lines with accepted quantity and accepted amount snapshots', async () => {
    const updateQuery = query({ data: [{ id: 'line-1' }], error: null });
    supabaseMocks.from
      .mockReturnValueOnce(updateQuery)
      .mockReturnValueOnce(query({ data: purchaseRow({ status: 'finance_review' }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ status: 'accepted', accepted_quantity: 10.5, accepted_amount: 1155000 })], error: null }));

    const detail = await siteDirectPurchaseService.reviewLines('direct-1', [{
      lineId: 'line-1',
      status: 'accepted',
      acceptedQuantity: 10.5,
      acceptedAmount: 1155000,
      reviewNote: 'Đủ chứng từ',
    }]);

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'accepted',
      accepted_quantity: 10.5,
      accepted_amount: 1155000,
      rejection_reason: null,
      note: 'Đủ chứng từ',
    }));
    expect(detail.lines[0].status).toBe('accepted');
    expect(detail.lines[0].acceptedAmount).toBe(1155000);
  });

  it('submits a direct purchase with an explicit approval recipient', async () => {
    const updateQuery = query({
      data: purchaseRow({
        status: 'submitted',
        submitted_to_user_id: 'approver-1',
        submitted_to_name: 'Anh duyệt',
        submitted_to_permission: 'approve',
        submission_note: 'Duyệt gấp',
        ever_submitted: true,
        last_action_by: 'actor-1',
      }),
      error: null,
    });
    supabaseMocks.from.mockReturnValueOnce(updateQuery);

    const saved = await siteDirectPurchaseService.submit('direct-1', {
      userId: 'approver-1',
      userIds: ['approver-1'],
      name: 'Anh duyệt',
      names: ['Anh duyệt'],
      permissionCode: 'approve',
      note: 'Duyệt gấp',
    }, 'actor-1');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      submitted_to_user_id: 'approver-1',
      submitted_to_name: 'Anh duyệt',
      submitted_to_permission: 'approve',
      submission_note: 'Duyệt gấp',
      ever_submitted: true,
      last_action_by: 'actor-1',
    }));
    expect(saved.status).toBe('submitted');
    expect(saved.submittedToUserId).toBe('approver-1');
    expect(saved.everSubmitted).toBe(true);
  });

  it('falls back to status-only submit when approval recipient columns are missing', async () => {
    const missingColumnQuery = query({
      data: null,
      error: { code: '42703', message: 'column "submitted_to_user_id" does not exist' },
    });
    const fallbackQuery = query({ data: purchaseRow({ status: 'submitted' }), error: null });
    supabaseMocks.from
      .mockReturnValueOnce(missingColumnQuery)
      .mockReturnValueOnce(fallbackQuery);

    const saved = await siteDirectPurchaseService.submit('direct-1', {
      userId: 'approver-1',
      userIds: ['approver-1'],
      name: 'Anh duyệt',
      names: ['Anh duyệt'],
      permissionCode: 'approve',
    }, 'actor-1');

    expect(missingColumnQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      submitted_to_user_id: 'approver-1',
    }));
    expect(fallbackQuery.update).toHaveBeenCalledWith({ status: 'submitted' });
    expect(saved.status).toBe('submitted');
  });

  it('cancels purchase approval back to submitted before purchase execution', async () => {
    const updateQuery = query({ data: purchaseRow({ status: 'submitted', note: 'Hủy duyệt: cần bổ sung báo giá' }), error: null });
    supabaseMocks.from.mockReturnValueOnce(updateQuery);

    const saved = await siteDirectPurchaseService.cancelApproval('direct-1', 'cần bổ sung báo giá');

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      last_action_by: null,
      submitted_to_permission: 'approve',
    }));
    expect(saved.status).toBe('submitted');
  });

  it('deletes an unsubmitted direct purchase that has no downstream documents', async () => {
    const readQuery = query({
      data: purchaseRow({ status: 'purchased', ever_submitted: false, wms_transaction_id: null, site_cash_settlement_id: null, po_id: null }),
      error: null,
    });
    const deleteQuery = query({ data: [{ id: 'direct-1' }], error: null });
    supabaseMocks.from
      .mockReturnValueOnce(readQuery)
      .mockReturnValueOnce(deleteQuery);

    await siteDirectPurchaseService.deleteUnsubmitted('direct-1');

    expect(readQuery.single).toHaveBeenCalled();
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith('id', 'direct-1');
  });

  it('blocks deleting direct purchases that were already submitted', async () => {
    supabaseMocks.from.mockReturnValueOnce(query({
      data: purchaseRow({ status: 'submitted', ever_submitted: true }),
      error: null,
    }));

    await expect(siteDirectPurchaseService.deleteUnsubmitted('direct-1')).rejects.toThrow('đã gửi duyệt');
  });

  it('creates a pending WMS import draft for stock lines and links it to the direct purchase', async () => {
    const insertQuery = query({ data: null, error: null });
    const updateQuery = query({ data: purchaseRow({ wms_transaction_id: 'tx-direct-1' }), error: null });
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow(), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow()], error: null }))
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(updateQuery);

    const transaction = await siteDirectPurchaseService.createWmsImportDraft('direct-1', 'user-1');

    expect(supabaseMocks.from).toHaveBeenNthCalledWith(3, 'transactions');
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: transaction.id,
      type: 'IMPORT',
      status: 'PENDING',
      target_warehouse_id: 'wh-1',
      created_by: 'user-1',
      updated_by: 'user-1',
      business_partner_id: 'supplier-a',
      business_partner_name_snapshot: 'NCC A',
      source_type: 'site_direct_purchase',
      source_id: 'direct-1',
      related_request_id: 'direct-purchase:direct-1',
    }));
    const insertPayload = insertQuery.insert.mock.calls[0][0];
    expect(insertPayload).not.toHaveProperty('supplier_id');
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      wms_transaction_id: transaction.id,
      status: 'purchased',
    }));
    expect(transaction.items[0]).toEqual(expect.objectContaining({
      itemId: 'item-1',
      quantity: 10.5,
      price: 100000,
    }));
  });

  it('does not create WMS import for small-tool-only direct purchases', async () => {
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow({ target_warehouse_id: null }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ line_type: 'small_tool', item_id: null, sku_snapshot: null, item_name_snapshot: 'Tô vít', unit_snapshot: 'cái' })], error: null }));

    await expect(siteDirectPurchaseService.createWmsImportDraft('direct-1', 'user-1')).rejects.toThrow('không có dòng vật tư tồn kho');
  });

  it('rejects AP sync for stock lines before the linked WMS import is completed', async () => {
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow({ wms_transaction_id: 'tx-direct-1' }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ status: 'accepted' })], error: null }))
      .mockReturnValueOnce(query({ data: { id: 'tx-direct-1', status: 'PENDING' }, error: null }));

    await expect(siteDirectPurchaseService.syncPayable('direct-1')).rejects.toThrow('WMS import');
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('syncs AP for accepted expense-only direct purchases without WMS import', async () => {
    const apDocument = {
      id: 'ap-1',
      source_type: 'site_direct_purchase',
      source_id: 'direct-1',
      supplier_name_snapshot: 'NCC A',
      recognized_amount: 500000,
      paid_amount: 0,
      credit_amount: 0,
      outstanding_amount: 500000,
      currency: 'VND',
      status: 'open',
      created_at: '2026-07-08T00:00:00.000Z',
    };
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow({ target_warehouse_id: null }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ line_type: 'expense_only', item_id: null, status: 'accepted', accepted_amount: 500000 })], error: null }));
    supabaseMocks.rpc.mockResolvedValueOnce({ data: apDocument, error: null });

    const document = await siteDirectPurchaseService.syncPayable('direct-1');

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('sync_supplier_payable_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
    expect(document.sourceType).toBe('site_direct_purchase');
    expect(document.recognizedAmount).toBe(500000);
  });

  it('syncs small tools before AP for accepted small-tool direct purchases', async () => {
    const apDocument = {
      id: 'ap-1',
      source_type: 'site_direct_purchase',
      source_id: 'direct-1',
      supplier_name_snapshot: 'NCC A',
      recognized_amount: 900000,
      paid_amount: 0,
      credit_amount: 0,
      outstanding_amount: 900000,
      currency: 'VND',
      status: 'open',
      created_at: '2026-07-08T00:00:00.000Z',
    };
    supabaseMocks.from
      .mockReturnValueOnce(query({ data: purchaseRow({ target_warehouse_id: null }), error: null }))
      .mockReturnValueOnce(query({ data: [lineRow({ line_type: 'small_tool', item_id: null, sku_snapshot: null, item_name_snapshot: 'Tô vít', unit_snapshot: 'cái', quantity: 3, unit_price: 300000, line_amount: 900000, status: 'accepted', accepted_quantity: 3, accepted_amount: 900000 })], error: null }));
    supabaseMocks.rpc
      .mockResolvedValueOnce({ data: [{ id: 'tool-1', source_line_id: 'line-1' }], error: null })
      .mockResolvedValueOnce({ data: apDocument, error: null });

    const document = await siteDirectPurchaseService.syncPayable('direct-1');

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, 'sync_site_small_tools_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(2, 'sync_supplier_payable_from_site_direct_purchase', {
      p_direct_purchase_id: 'direct-1',
    });
    expect(document.recognizedAmount).toBe(900000);
  });
});
