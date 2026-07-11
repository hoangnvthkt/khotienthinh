import { describe, expect, it } from 'vitest';
import type { BusinessPartner, ContractCostItem } from '../../types';
import {
  buildProjectTransactionsFromImportRows,
  resolveProjectTransactionPartner,
} from '../projectTransactionImport';

const costItem = (id: string, symbol: string, name: string): ContractCostItem => ({
  id,
  parentId: null,
  symbol,
  name,
  status: 'active',
  sortOrder: 0,
});

const partner = (id: string, code: string, name: string): BusinessPartner => ({
  id,
  code,
  name,
  classifications: ['supplier'],
  isActive: true,
});

describe('project transaction import helpers', () => {
  const costItems = [
    costItem('cost-labor', 'CPNC', 'Chi phí nhân công'),
    costItem('cost-material', 'CPVL', 'Chi phí vật liệu'),
  ];
  const partners = [
    partner('partner-1', 'NCC001', 'Công ty Vật tư A'),
    partner('partner-2', 'DOI-NC', 'Đội nhân công B'),
  ];

  it('resolves partners by id, code, or name', () => {
    expect(resolveProjectTransactionPartner(partners, 'partner-1')?.id).toBe('partner-1');
    expect(resolveProjectTransactionPartner(partners, ' ncc001 ')?.id).toBe('partner-1');
    expect(resolveProjectTransactionPartner(partners, 'Đội nhân công B')?.id).toBe('partner-2');
  });

  it('imports expense rows with cost item and partner code', () => {
    const result = buildProjectTransactionsFromImportRows([{
      'Loại giao dịch': 'Chi phí',
      'Mã khoản mục': 'CPNC',
      'Mã đối tượng': 'DOI-NC',
      'Số tiền': '12.500.000',
      'Nội dung': 'Thanh toán nhân công',
      'Ngày': '10/07/2026',
      'Số hóa đơn/chứng từ': 'PC-001',
    }], {
      projectId: 'project-1',
      projectFinanceId: 'finance-1',
      constructionSiteId: 'site-1',
      costItems,
      partners,
      createdBy: 'user-1',
      now: '2026-07-10T00:00:00.000Z',
      idFactory: () => 'tx-1',
    });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      id: 'tx-1',
      type: 'expense',
      category: 'labor',
      amount: 12_500_000,
      contractCostItemId: 'cost-labor',
      contractCostItemSymbolSnapshot: 'CPNC',
      counterpartyPartnerId: 'partner-2',
      counterpartyName: 'Đội nhân công B',
      invoiceNo: 'PC-001',
      date: '2026-07-10',
    });
    expect(result.skippedMissingCostItem).toBe(0);
  });

  it('skips expense rows without a resolvable cost item', () => {
    const result = buildProjectTransactionsFromImportRows([{
      'Loại giao dịch': 'Chi phí',
      'Mã khoản mục': 'UNKNOWN',
      'Số tiền': 1000000,
      'Nội dung': 'Chi ngoài danh mục',
    }], {
      projectFinanceId: 'finance-1',
      constructionSiteId: 'site-1',
      costItems,
      partners,
      now: '2026-07-10T00:00:00.000Z',
      idFactory: () => 'tx-skip',
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.skippedMissingCostItem).toBe(1);
  });

  it('imports revenue rows without cost items', () => {
    const result = buildProjectTransactionsFromImportRows([{
      'Loại giao dịch': 'Thu',
      'Số tiền': 2000000,
      'Nội dung': 'Thu tiền chủ đầu tư',
    }], {
      projectFinanceId: 'finance-1',
      constructionSiteId: 'site-1',
      costItems,
      partners,
      now: '2026-07-10T00:00:00.000Z',
      idFactory: () => 'tx-revenue',
    });

    expect(result.transactions[0]).toMatchObject({
      type: 'revenue_received',
      category: 'other',
      contractCostItemId: null,
    });
    expect(result.skippedMissingCostItem).toBe(0);
  });

  it('keeps counterparty snapshot when partner cannot be mapped', () => {
    const result = buildProjectTransactionsFromImportRows([{
      'Loại giao dịch': 'Chi phí',
      'Mã khoản mục': 'CPVL',
      'Đối tượng': 'Nhà cung cấp vãng lai',
      'Số tiền': 3000000,
      'Nội dung': 'Mua vật tư nóng',
    }], {
      projectFinanceId: 'finance-1',
      constructionSiteId: 'site-1',
      costItems,
      partners,
      now: '2026-07-10T00:00:00.000Z',
      idFactory: () => 'tx-fallback',
    });

    expect(result.transactions[0]).toMatchObject({
      category: 'materials',
      counterpartyPartnerId: null,
      counterpartyName: 'Nhà cung cấp vãng lai',
    });
  });
});
