import { describe, expect, it } from 'vitest';
import type { ProjectTransaction } from '../../types';
import {
  normalizeProjectTransactionRow,
  projectTransactionToDb,
} from '../projectTransactionMapping';

describe('project transaction cost item mapping', () => {
  it('normalizes contract cost item fields from snake_case rows', () => {
    const row = {
      id: 'tx-1',
      project_id: 'project-1',
      project_finance_id: 'finance-1',
      construction_site_id: 'site-1',
      type: 'expense',
      category: 'labor',
      amount: 12_000_000,
      description: 'Thanh toán nhân công',
      date: '2026-07-10',
      source: 'manual',
      source_ref: 'PC-001',
      contract_cost_item_id: 'cost-1',
      contract_cost_item_symbol_snapshot: 'CPNC',
      contract_cost_item_name_snapshot: 'Chi phí nhân công',
      cost_classification_status: 'manual',
      counterparty_partner_id: 'partner-1',
      counterparty_name: 'Đội nhân công A',
      invoice_no: 'HD-001',
      invoice_date: '2026-07-09',
      created_at: '2026-07-10T00:00:00.000Z',
    };

    expect(normalizeProjectTransactionRow(row)).toMatchObject({
      projectId: 'project-1',
      projectFinanceId: 'finance-1',
      constructionSiteId: 'site-1',
      sourceRef: 'PC-001',
      contractCostItemId: 'cost-1',
      contractCostItemSymbolSnapshot: 'CPNC',
      contractCostItemNameSnapshot: 'Chi phí nhân công',
      costClassificationStatus: 'manual',
      counterpartyPartnerId: 'partner-1',
      counterpartyName: 'Đội nhân công A',
      invoiceNo: 'HD-001',
      invoiceDate: '2026-07-09',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
  });

  it('writes contract cost item fields as snake_case payload and keeps snapshots', () => {
    const tx: ProjectTransaction = {
      id: 'tx-2',
      projectId: 'project-2',
      projectFinanceId: 'finance-2',
      constructionSiteId: 'site-2',
      type: 'expense',
      category: 'labor',
      amount: 8_500_000,
      description: 'Chi lương nhân viên',
      date: '2026-07-10',
      source: 'manual',
      sourceRef: 'PC-002',
      contractCostItemId: 'cost-2',
      contractCostItemSymbolSnapshot: 'CPL',
      contractCostItemNameSnapshot: 'Chi phí lương nhân viên',
      costClassificationStatus: 'manual',
      counterpartyPartnerId: 'partner-2',
      counterpartyName: 'Nguyễn Văn A',
      invoiceNo: 'UNC-002',
      invoiceDate: '2026-07-10',
      attachments: [],
      createdBy: 'user-1',
      createdAt: '2026-07-10T01:00:00.000Z',
    };

    expect(projectTransactionToDb(tx)).toMatchObject({
      project_id: 'project-2',
      project_finance_id: 'finance-2',
      construction_site_id: 'site-2',
      source_ref: 'PC-002',
      contract_cost_item_id: 'cost-2',
      contract_cost_item_symbol_snapshot: 'CPL',
      contract_cost_item_name_snapshot: 'Chi phí lương nhân viên',
      cost_classification_status: 'manual',
      counterparty_partner_id: 'partner-2',
      counterparty_name: 'Nguyễn Văn A',
      invoice_no: 'UNC-002',
      invoice_date: '2026-07-10',
    });
  });

  it('defaults rows without a cost item to unclassified', () => {
    const row = normalizeProjectTransactionRow({
      id: 'tx-3',
      project_finance_id: 'finance-3',
      construction_site_id: 'site-3',
      type: 'revenue_received',
      category: 'other',
      amount: 1,
      description: 'Thu tiền',
      date: '2026-07-10',
      source: 'manual',
      created_at: '2026-07-10T00:00:00.000Z',
    });

    expect(row.costClassificationStatus).toBe('unclassified');
  });
});
