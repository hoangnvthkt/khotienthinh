import { describe, expect, it, vi } from 'vitest';
import { ProjectTransaction, PurchaseOrder, SupplierPayableBalance } from '../../types';
import {
  buildPurchaseOrderPayableRow,
  buildProjectFinanceSummary,
  buildSupplierPayableRowFromBalance,
  calculatePoRecognizedPayable,
} from '../projectFinanceWorkspaceService';

vi.mock('../supabase', () => ({
  supabase: {},
}));

describe('projectFinanceWorkspaceService', () => {
  const basePo = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
    id: 'po-1',
    poNumber: 'PO-001',
    vendorName: 'NCC A',
    status: 'approved',
    totalAmount: 20_000_000,
    createdAt: '2026-07-01T00:00:00.000Z',
    orderDate: '2026-07-01',
    expectedDeliveryDate: '2026-07-10',
    items: [
      {
        itemId: 'steel',
        sku: 'D10',
        name: 'Thép D10',
        unit: 'Kg',
        qty: 1000,
        unitPrice: 20_000,
        receivedQty: 600,
      },
    ],
    ...overrides,
  } as PurchaseOrder);

  const paymentTx = (id: string, amount: number, sourceRef: string, description = 'Thanh toán PO-001'): ProjectTransaction => ({
    id,
    projectFinanceId: 'finance-1',
    constructionSiteId: 'site-1',
    type: 'expense',
    category: 'materials',
    amount,
    description,
    date: '2026-07-04',
    source: 'manual',
    sourceRef,
    attachments: [],
    createdAt: '2026-07-04T00:00:00.000Z',
  });

  it('recognizes supplier payable from net received PO quantity, not ordered quantity', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
        },
      ],
    });

    expect(payable).toBe(12_000_000);
  });

  it('deducts supplier returns from recognized payable', () => {
    const payable = calculatePoRecognizedPayable({
      totalAmount: 20_000_000,
      items: [
        {
          itemId: 'steel',
          sku: 'D10',
          name: 'Thép D10',
          unit: 'Kg',
          qty: 1000,
          unitPrice: 20_000,
          receivedQty: 600,
          returnedQty: 100,
        },
      ],
    });

    expect(payable).toBe(10_000_000);
  });

  it('marks received PO payable as unpaid when there is no payment transaction', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), []);

    expect(row.paidAmount).toBe(0);
    expect(row.recognizedAmount).toBe(12_000_000);
    expect(row.outstandingAmount).toBe(12_000_000);
    expect(row.status).toBe('payable');
  });

  it('sums multiple PO payment transactions by purchase order source ref prefix', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), [
      paymentTx('tx-1', 4_000_000, 'purchase_order:po-1:payment:one'),
      paymentTx('tx-2', 3_500_000, 'purchase_order:po-1:payment:two'),
      paymentTx('tx-other', 1_000_000, 'purchase_order:po-other:payment:one', 'Thanh toán PO khác'),
    ]);

    expect(row.paidAmount).toBe(7_500_000);
    expect(row.outstandingAmount).toBe(4_500_000);
    expect(row.status).toBe('partial');
  });

  it('marks PO payable as paid once payment transactions cover the recognized amount', () => {
    const row = buildPurchaseOrderPayableRow(basePo(), [
      paymentTx('tx-1', 7_000_000, 'purchase_order:po-1:payment:one'),
      paymentTx('tx-2', 5_000_000, 'purchase_order:po-1:payment:two'),
    ]);

    expect(row.paidAmount).toBe(12_000_000);
    expect(row.outstandingAmount).toBe(0);
    expect(row.status).toBe('paid');
  });

  it('builds supplier payable rows from AP balances instead of PO payment transactions', () => {
    const balance: SupplierPayableBalance = {
      id: 'balance-supplier-a',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      supplierId: 'supplier-a',
      supplierNameSnapshot: 'NCC A',
      currency: 'VND',
      recognizedAmount: 1_000_000_000,
      paidAmount: 300_000_000,
      creditAmount: 0,
      outstandingAmount: 700_000_000,
      documentCount: 10,
      oldestDueDate: '2026-07-01',
      latestDocumentDate: '2026-07-31',
    };

    const row = buildSupplierPayableRowFromBalance(balance);

    expect(row.sourceType).toBe('supplier_payable');
    expect(row.counterpartyName).toBe('NCC A');
    expect(row.recognizedAmount).toBe(1_000_000_000);
    expect(row.paidAmount).toBe(300_000_000);
    expect(row.outstandingAmount).toBe(700_000_000);
    expect(row.description).toContain('10 chứng từ');
  });

  it('uses business labels instead of supplier UUIDs for aggregated AP rows', () => {
    const balance: SupplierPayableBalance = {
      id: '50b50577-1c2d-4d82-9154-9f18800b6f6b',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      supplierId: '50b50577-1c2d-4d82-9154-9f18800b6f6b',
      supplierNameSnapshot: 'Công ty TNHH Tuấn Anh',
      currency: 'VND',
      recognizedAmount: 360_000,
      paidAmount: 0,
      creditAmount: 0,
      outstandingAmount: 360_000,
      documentCount: 1,
      latestDocumentDate: '2026-07-15',
    };

    const row = buildSupplierPayableRowFromBalance(balance);

    expect(row.documentNo).toBe('Công nợ NCC');
    expect(row.documentNo).not.toContain(balance.supplierId!);
    expect(row.description).toContain('1 chứng từ AP');
    expect(row.description).toContain('T07/2026');
    expect(row.sourceLabel).toBe('Chứng từ AP');
  });

  it('deep-links purchase order payable rows to the PO document position', () => {
    const row = buildPurchaseOrderPayableRow(basePo({ id: 'po-deep-link', poNumber: 'PO-2026-001' }), []);

    expect(row.sourceRoute).toEqual({
      tab: 'material',
      params: {
        materialTab: 'po',
        poId: 'po-deep-link',
      },
    });
    expect(row.sourceLabel).toBe('Mở PO');
  });

  it('does not double count site cash settlement cashflow when AP already recognized the cost', () => {
    const balance: SupplierPayableBalance = {
      id: 'balance-direct-purchase',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      supplierId: 'supplier-small',
      supplierNameSnapshot: 'Tạp hóa cô Lan',
      currency: 'VND',
      recognizedAmount: 16_500_000,
      paidAmount: 16_500_000,
      creditAmount: 0,
      outstandingAmount: 0,
      documentCount: 1,
      latestDocumentDate: '2026-07-15',
    };
    const payable = buildSupplierPayableRowFromBalance(balance);

    const summary = buildProjectFinanceSummary({
      customerContracts: [],
      costItems: [],
      paymentCertificates: [],
      schedules: [],
      advances: [],
      transactions: [
        paymentTx('tx-settlement', 16_500_000, 'site_cash_settlement_batch:settlement-1', 'Hoàn ứng công trường'),
      ],
      payables: [payable],
      receivables: [],
    });

    expect(summary.actualCost).toBe(16_500_000);
    expect(summary.cashOut).toBe(16_500_000);
  });
});
