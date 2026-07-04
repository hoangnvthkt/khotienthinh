import { describe, expect, it } from 'vitest';
import type { ContractItem, ProjectFinance, PurchaseOrder } from '../../types';
import { calculateProjectValueProgress } from '../projectWeeklyProgressService';

const finance = (patch: Partial<ProjectFinance> = {}): ProjectFinance => ({
  id: 'finance-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  contractValue: 1000,
  budgetMaterials: 0,
  budgetLabor: 0,
  budgetSubcontract: 0,
  budgetMachinery: 0,
  budgetOverhead: 0,
  actualMaterials: 0,
  actualLabor: 0,
  actualSubcontract: 0,
  actualMachinery: 0,
  actualOverhead: 0,
  revenueReceived: 0,
  revenuePending: 0,
  progressPercent: 0,
  status: 'active',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const customerItem = (patch: Partial<ContractItem> = {}): ContractItem => ({
  id: 'contract-item-1',
  contractId: 'contract-1',
  contractType: 'customer',
  itemType: 'work',
  code: 'A',
  name: 'Hạng mục A',
  unit: 'gói',
  quantity: 1,
  unitPrice: 1000,
  totalPrice: 1000,
  revisedQuantity: 1,
  revisedUnitPrice: 1000,
  revisedTotalPrice: 1000,
  order: 1,
  ...patch,
} as ContractItem);

const po = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  poNumber: 'PO-001',
  supplierId: 'supplier-1',
  supplierName: 'NCC',
  orderDate: '2026-01-01',
  status: 'delivered',
  items: [],
  totalAmount: 900,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
} as PurchaseOrder);

describe('calculateProjectValueProgress', () => {
  it('uses project actual production value as recognized value', () => {
    const result = calculateProjectValueProgress({
      projectFinance: finance({ actualProductionValue: 400 }),
      customerItems: [customerItem()],
      purchaseOrders: [],
    });

    expect(result.actualProductionValue).toBe(400);
    expect(result.recognizedValue).toBe(400);
    expect(result.valueProgressPercent).toBe(40);
  });

  it('does not let purchase orders change value progress percent', () => {
    const result = calculateProjectValueProgress({
      projectFinance: finance({ actualProductionValue: 100 }),
      customerItems: [customerItem()],
      purchaseOrders: [po({ totalAmount: 900 })],
    });

    expect(result.purchasedValue).toBe(900);
    expect(result.recognizedValue).toBe(100);
    expect(result.valueProgressPercent).toBe(10);
  });

  it('returns zero percent when there is no contract total value', () => {
    const result = calculateProjectValueProgress({
      projectFinance: finance({ contractValue: 0, actualProductionValue: 100 }),
      customerItems: [],
      purchaseOrders: [],
    });

    expect(result.contractTotalValue).toBe(0);
    expect(result.valueProgressPercent).toBe(0);
  });

  it('keeps the actual value while capping percent at 100 for over-production', () => {
    const result = calculateProjectValueProgress({
      projectFinance: finance({ actualProductionValue: 1500 }),
      customerItems: [customerItem()],
      purchaseOrders: [],
    });

    expect(result.recognizedValue).toBe(1500);
    expect(result.valueProgressPercent).toBe(100);
  });
});
