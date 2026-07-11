import {
  ProjectCostClassificationStatus,
  ProjectTransaction,
} from '../types';

const normalizeStatus = (
  value: unknown,
  hasCostItem: boolean,
): ProjectCostClassificationStatus => {
  if (value === 'manual' || value === 'auto' || value === 'unclassified') return value;
  return hasCostItem ? 'manual' : 'unclassified';
};

export const normalizeProjectTransactionRow = (row: any): ProjectTransaction => {
  const contractCostItemId = row.contractCostItemId ?? row.contract_cost_item_id ?? null;
  return {
    ...row,
    projectId: row.projectId ?? row.project_id ?? null,
    projectFinanceId: row.projectFinanceId ?? row.project_finance_id ?? '',
    constructionSiteId: row.constructionSiteId ?? row.construction_site_id ?? '',
    sourceRef: row.sourceRef ?? row.source_ref ?? undefined,
    contractCostItemId,
    contractCostItemSymbolSnapshot: row.contractCostItemSymbolSnapshot ?? row.contract_cost_item_symbol_snapshot ?? null,
    contractCostItemNameSnapshot: row.contractCostItemNameSnapshot ?? row.contract_cost_item_name_snapshot ?? null,
    costClassificationStatus: normalizeStatus(row.costClassificationStatus ?? row.cost_classification_status, Boolean(contractCostItemId)),
    counterpartyPartnerId: row.counterpartyPartnerId ?? row.counterparty_partner_id ?? null,
    counterpartyName: row.counterpartyName ?? row.counterparty_name ?? null,
    invoiceNo: row.invoiceNo ?? row.invoice_no ?? null,
    invoiceDate: row.invoiceDate ?? row.invoice_date ?? null,
    createdAt: row.createdAt ?? row.created_at,
  };
};

export const resolveProjectTransactionClassificationStatus = (
  tx: Pick<ProjectTransaction, 'contractCostItemId' | 'costClassificationStatus'>,
): ProjectCostClassificationStatus => normalizeStatus(tx.costClassificationStatus, Boolean(tx.contractCostItemId));

export const projectTransactionToDb = (tx: ProjectTransaction): Record<string, unknown> => {
  const {
    projectId,
    contractCostItemId,
    contractCostItemSymbolSnapshot,
    contractCostItemNameSnapshot,
    costClassificationStatus,
    counterpartyPartnerId,
    counterpartyName,
    invoiceNo,
    invoiceDate,
    ...legacyPayload
  } = tx;

  return {
    ...legacyPayload,
    project_id: projectId || null,
    project_finance_id: tx.projectFinanceId || null,
    construction_site_id: tx.constructionSiteId || null,
    source_ref: tx.sourceRef || null,
    contract_cost_item_id: contractCostItemId || null,
    contract_cost_item_symbol_snapshot: contractCostItemSymbolSnapshot || null,
    contract_cost_item_name_snapshot: contractCostItemNameSnapshot || null,
    cost_classification_status: resolveProjectTransactionClassificationStatus({
      contractCostItemId,
      costClassificationStatus,
    }),
    counterparty_partner_id: counterpartyPartnerId || null,
    counterparty_name: counterpartyName || null,
    invoice_no: invoiceNo || null,
    invoice_date: invoiceDate || null,
  };
};
