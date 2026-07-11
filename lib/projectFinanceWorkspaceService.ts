import { supabase } from './supabase';
import { fromDb } from './dbMapping';
import {
  AdvancePayment,
  ContractItemType,
  CustomerContract,
  PaymentCertificate,
  PaymentSchedule,
  ProjectCostCategory,
  ProjectCostItem,
  ProjectTransaction,
  PurchaseOrder,
  DocumentTraceNodeType,
  SupplierDeliveryStatement,
  SupplierDirectDeliveryLine,
  SupplierDirectDeliveryNote,
  SubcontractorContract,
  SupplierPayableBalance,
  SupplierPayableDocument,
  SupplierPaymentBatch,
} from '../types';

export type ProjectFinanceWorkspaceTab =
  | 'overview'
  | 'budget'
  | 'payables'
  | 'receivables'
  | 'payments'
  | 'cashflow'
  | 'ledger';

export type ProjectFinanceCounterpartyType = 'customer' | 'supplier' | 'subcontractor' | 'team' | 'other';
export type ProjectFinanceDocumentType =
  | 'purchase_order'
  | 'supplier_payable'
  | 'payment_certificate'
  | 'payment_schedule'
  | 'project_transaction';
export type ProjectFinanceSourceTab = 'material' | 'contract' | 'payment' | 'cashflow' | 'finance';
export interface ProjectFinanceSourceRoute {
  tab: ProjectFinanceSourceTab;
  params?: Record<string, string>;
}

export interface ProjectFinancePayableRow {
  id: string;
  sourceType: ProjectFinanceDocumentType;
  sourceId: string;
  counterpartyType: ProjectFinanceCounterpartyType;
  counterpartyName: string;
  documentNo: string;
  description: string;
  documentDate?: string | null;
  dueDate?: string | null;
  status: string;
  committedAmount: number;
  recognizedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  sourceTab: ProjectFinanceSourceTab;
  sourceLabel?: string;
  sourceRoute?: ProjectFinanceSourceRoute;
}

export interface ProjectFinanceReceivableRow {
  id: string;
  sourceType: ProjectFinanceDocumentType;
  sourceId: string;
  counterpartyType: ProjectFinanceCounterpartyType;
  counterpartyName: string;
  documentNo: string;
  description: string;
  documentDate?: string | null;
  dueDate?: string | null;
  status: string;
  contractAmount: number;
  recognizedAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  sourceTab: 'contract' | 'payment' | 'cashflow' | 'finance';
  sourceLabel?: string;
  sourceRoute?: ProjectFinanceSourceRoute;
}

export interface ProjectFinanceLedgerRow {
  id: string;
  date: string;
  type: ProjectTransaction['type'];
  category: ProjectCostCategory;
  amount: number;
  description: string;
  source: ProjectTransaction['source'];
  sourceRef?: string | null;
  contractCostItemId?: string | null;
  contractCostItemSymbolSnapshot?: string | null;
  contractCostItemNameSnapshot?: string | null;
  costClassificationStatus?: ProjectTransaction['costClassificationStatus'];
  counterpartyPartnerId?: string | null;
  counterpartyName?: string | null;
  invoiceNo?: string | null;
  invoiceDate?: string | null;
  createdAt?: string | null;
}

export interface ProjectFinanceSupplierControlIssue {
  id: string;
  tone: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  sourceRoute?: ProjectFinanceSourceRoute;
  trace?: {
    type: DocumentTraceNodeType;
    id: string;
    qrToken?: string | null;
  };
}

export interface ProjectFinanceSupplierControlSummary {
  recognizedMaterialCost: number;
  openingMaterialCost: number;
  supplierPaidAmount: number;
  supplierOutstanding: number;
  apDocumentCount: number;
  paymentBatchCount: number;
  waitingStatementCount: number;
  wmsPendingExportCount: number;
  blockedCount: number;
  issues: ProjectFinanceSupplierControlIssue[];
}

export interface ProjectFinanceWorkspaceSummary {
  contractValue: number;
  budgetAmount: number;
  actualCost: number;
  budgetVariance: number;
  certifiedRevenue: number;
  paidRevenue: number;
  cashIn: number;
  cashOut: number;
  cashPosition: number;
  payableCommitted: number;
  payableRecognized: number;
  payableOutstanding: number;
  receivableRecognized: number;
  receivableOutstanding: number;
  advanceOutstanding: number;
  estimatedMargin: number;
  overdueReceivableCount: number;
  overduePayableCount: number;
  pendingPaymentCount: number;
  supplierControl: ProjectFinanceSupplierControlSummary;
  alerts: Array<{
    id: string;
    tone: 'info' | 'warning' | 'danger';
    title: string;
    message: string;
  }>;
}

export interface ProjectFinanceWorkspaceData {
  summary: ProjectFinanceWorkspaceSummary;
  paymentSchedules: PaymentSchedule[];
  payables: ProjectFinancePayableRow[];
  receivables: ProjectFinanceReceivableRow[];
  ledger: ProjectFinanceLedgerRow[];
}

const numeric = (value: unknown) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const money = (value: unknown) => {
  const amount = numeric(value);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const scopeFilter = (projectId?: string | null, constructionSiteId?: string | null) => {
  const filters: string[] = [];
  if (projectId) filters.push(`project_id.eq.${projectId}`);
  if (constructionSiteId) filters.push(`construction_site_id.eq.${constructionSiteId}`);
  return filters.join(',');
};

const dedupeById = <T extends { id?: string | null }>(rows: T[]): T[] =>
  Array.from(rows.reduce((map, row) => {
    if (row.id) map.set(row.id, row);
    return map;
  }, new Map<string, T>()).values());

const loadScopedRows = async <T>(
  table: string,
  projectId?: string | null,
  constructionSiteId?: string | null,
  orderColumn = 'created_at',
): Promise<T[]> => {
  const filter = scopeFilter(projectId, constructionSiteId);
  if (!filter) return [];
  let query = supabase.from(table).select('*').or(filter);
  if (orderColumn) query = query.order(orderColumn, { ascending: false });
  const { data, error } = await query;
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return dedupeById((data || []).map(fromDb)) as T[];
};

export const calculatePoRecognizedPayable = (po: Pick<PurchaseOrder, 'items' | 'totalAmount'>) =>
  (po.items || []).reduce((sum, item) => {
    const netReceivedQty = Math.max(0, numeric(item.receivedQty) - numeric(item.returnedQty));
    return sum + netReceivedQty * numeric(item.unitPrice);
  }, 0);

const calculatePoCommittedAmount = (po: Pick<PurchaseOrder, 'items' | 'totalAmount'>) => {
  const itemTotal = (po.items || []).reduce((sum, item) => sum + numeric(item.qty) * numeric(item.unitPrice), 0);
  return money(itemTotal || po.totalAmount);
};

const sumTransactions = (
  transactions: ProjectTransaction[],
  predicate: (tx: ProjectTransaction) => boolean,
) => transactions.filter(predicate).reduce((sum, tx) => sum + money(tx.amount), 0);

const estimatePaidForRef = (transactions: ProjectTransaction[], refs: string[], fallbackText?: string | null) =>
  sumTransactions(transactions, tx => {
    if (tx.type !== 'expense' && tx.type !== 'revenue_received') return false;
    const sourceRef = String(tx.sourceRef || '');
    const description = String(tx.description || '');
    return refs.some(ref => sourceRef === ref || sourceRef.includes(ref)) ||
      Boolean(fallbackText && description.includes(fallbackText));
  });

const payableStatus = (recognized: number, paid: number, committed = recognized) => {
  if (recognized <= 0 && committed > 0) return 'waiting_receipt';
  if (recognized <= 0) return 'planned';
  if (paid >= recognized) return 'paid';
  if (paid > 0) return 'partial';
  return 'payable';
};

const formatPeriodMonth = (value?: string | null) => {
  if (!value) return null;
  const [year, month] = value.slice(0, 10).split('-');
  if (!year || !month) return null;
  return `T${month}/${year}`;
};

const formatShortDate = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return null;
  return `${day}/${month}/${year}`;
};

export const buildPurchaseOrderPayableRow = (
  po: PurchaseOrder,
  transactions: ProjectTransaction[],
): ProjectFinancePayableRow => {
  const committedAmount = calculatePoCommittedAmount(po);
  const recognizedAmount = money(calculatePoRecognizedPayable(po));
  const paidAmount = estimatePaidForRef(transactions, [`purchase_order:${po.id}`, `po:${po.id}`, po.id], po.poNumber);
  return {
    id: `po:${po.id}`,
    sourceType: 'purchase_order',
    sourceId: po.id,
    counterpartyType: 'supplier',
    counterpartyName: po.vendorName || po.vendorId || 'Nhà cung cấp',
    documentNo: po.poNumber,
    description: 'Phải trả NCC theo thực nhận PO',
    documentDate: po.orderDate || po.createdAt,
    dueDate: po.expectedDeliveryDate || null,
    status: payableStatus(recognizedAmount, paidAmount, committedAmount),
    committedAmount,
    recognizedAmount,
    paidAmount,
    outstandingAmount: Math.max(0, recognizedAmount - paidAmount),
    sourceTab: 'material',
    sourceLabel: 'Mở PO',
    sourceRoute: {
      tab: 'material',
      params: {
        materialTab: 'po',
        poId: po.id,
      },
    },
  };
};

export const buildSupplierPayableRowFromBalance = (balance: SupplierPayableBalance): ProjectFinancePayableRow => {
  const recognizedAmount = money(balance.recognizedAmount);
  const paidAmount = money(balance.paidAmount);
  const outstandingAmount = money(balance.outstandingAmount);
  const period = formatPeriodMonth(balance.latestDocumentDate || balance.oldestDueDate);
  const latestDate = formatShortDate(balance.latestDocumentDate);
  const description = [
    `${balance.documentCount || 0} chứng từ AP`,
    period ? `kỳ ${period}` : '',
    latestDate ? `mới nhất ${latestDate}` : '',
  ].filter(Boolean).join(' • ');
  return {
    id: `supplier_payable:${balance.id || balance.supplierId || balance.supplierNameSnapshot}`,
    sourceType: 'supplier_payable',
    sourceId: balance.supplierId || balance.id || balance.supplierNameSnapshot,
    counterpartyType: 'supplier',
    counterpartyName: balance.supplierNameSnapshot || balance.supplierId || 'Nhà cung cấp',
    documentNo: 'Công nợ NCC',
    description: description || 'Chứng từ AP phải trả NCC',
    documentDate: balance.latestDocumentDate || null,
    dueDate: balance.oldestDueDate || null,
    status: payableStatus(recognizedAmount, paidAmount + money(balance.creditAmount), recognizedAmount),
    committedAmount: recognizedAmount,
    recognizedAmount,
    paidAmount,
    outstandingAmount,
    sourceTab: 'material',
    sourceLabel: 'Chứng từ AP',
    sourceRoute: {
      tab: 'finance',
      params: {
        financeTab: 'payables',
        ...(balance.supplierId ? { supplierId: balance.supplierId } : {}),
      },
    },
  };
};

const receivableStatus = (recognized: number, received: number, planned = recognized) => {
  if (recognized <= 0 && planned > 0) return 'planned';
  if (recognized <= 0) return 'draft';
  if (received >= recognized) return 'received';
  if (received > 0) return 'partial';
  return 'receivable';
};

const loadScopedPurchaseOrders = async (
  projectId?: string | null,
  constructionSiteId?: string | null,
): Promise<PurchaseOrder[]> => {
  const directRows = await loadScopedRows<PurchaseOrder>('purchase_orders', projectId, constructionSiteId);
  const filter = scopeFilter(projectId, constructionSiteId);
  if (!filter) return directRows;

  const { data: linkRows, error: linkError } = await supabase
    .from('purchase_order_request_lines')
    .select('purchase_order_id')
    .or(filter);
  if (linkError && linkError.code !== '42P01') throw linkError;

  const linkedPoIds = Array.from(new Set((linkRows || []).map(row => row.purchase_order_id).filter(Boolean)));
  if (linkedPoIds.length === 0) return directRows.filter(po => !po.archivedAt);

  const { data: linkedRows, error: poError } = await supabase
    .from('purchase_orders')
    .select('*')
    .in('id', linkedPoIds);
  if (poError) throw poError;

  return dedupeById([
    ...directRows,
    ...(linkedRows || []).map(fromDb) as PurchaseOrder[],
  ]).filter(po => !po.archivedAt);
};

const loadSupplierDirectDeliveryLinesForNotes = async (
  noteIds: string[],
): Promise<SupplierDirectDeliveryLine[]> => {
  const ids = Array.from(new Set(noteIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('supplier_direct_delivery_lines')
    .select('*')
    .in('delivery_note_id', ids)
    .order('line_no', { ascending: true });
  if (error) {
    if (error.code === '42P01') return [];
    throw error;
  }
  return (data || []).map(fromDb) as SupplierDirectDeliveryLine[];
};

const buildPayables = (
  purchaseOrders: PurchaseOrder[],
  paymentCertificates: PaymentCertificate[],
  schedules: PaymentSchedule[],
  transactions: ProjectTransaction[],
  subcontractors: SubcontractorContract[],
  supplierPayableBalances: SupplierPayableBalance[] = [],
): ProjectFinancePayableRow[] => {
  const subcontractById = new Map(subcontractors.map(contract => [contract.id, contract]));
  const materialPayableRows: ProjectFinancePayableRow[] = supplierPayableBalances.length > 0
    ? supplierPayableBalances
      .filter(balance => money(balance.recognizedAmount) > 0 || money(balance.outstandingAmount) > 0)
      .map(buildSupplierPayableRowFromBalance)
    : purchaseOrders
      .filter(po => !['cancelled', 'returned'].includes(String(po.status || '')))
      .map(po => buildPurchaseOrderPayableRow(po, transactions));

  const certRows: ProjectFinancePayableRow[] = paymentCertificates
    .filter(cert => cert.contractType === 'subcontractor')
    .filter(cert => cert.status !== 'cancelled')
    .map(cert => {
      const contract = subcontractById.get(cert.contractId);
      const recognizedAmount = ['approved', 'paid'].includes(cert.status)
        ? money(cert.payableThisPeriod ?? cert.currentPayableAmount)
        : 0;
      const committedAmount = money(cert.grossThisPeriod ?? cert.currentCompletedValue ?? recognizedAmount);
      const paidAmount = cert.status === 'paid'
        ? money(cert.payableThisPeriod ?? cert.currentPayableAmount)
        : estimatePaidForRef(transactions, [`payment_certificate:${cert.id}`, cert.id]);
      return {
        id: `cert:${cert.id}`,
        sourceType: 'payment_certificate',
        sourceId: cert.id,
        counterpartyType: 'subcontractor',
        counterpartyName: contract?.subcontractorName || contract?.name || 'Thầu phụ',
        documentNo: `TT-${cert.periodNumber || '-'}`,
        description: cert.description || contract?.name || 'Chứng chỉ thanh toán thầu phụ',
        documentDate: cert.approvedAt || cert.createdAt,
        dueDate: cert.paidAt || null,
        status: payableStatus(recognizedAmount, paidAmount, committedAmount),
        committedAmount,
        recognizedAmount,
        paidAmount,
        outstandingAmount: Math.max(0, recognizedAmount - paidAmount),
        sourceTab: 'payment',
      };
    });

  const scheduleRows: ProjectFinancePayableRow[] = schedules
    .filter(schedule => schedule.type === 'payable')
    .map(schedule => {
      const paidAmount = money(schedule.paidAmount || (schedule.status === 'paid' ? schedule.amount : 0));
      const recognizedAmount = schedule.status === 'paid' || schedule.dossierStatus === 'approved' ? money(schedule.amount) : 0;
      return {
        id: `schedule:${schedule.id}`,
        sourceType: 'payment_schedule',
        sourceId: schedule.id,
        counterpartyType: schedule.contractType === 'subcontractor' ? 'subcontractor' : 'other',
        counterpartyName: schedule.contactName || 'Đối tượng phải trả',
        documentNo: `KH-${schedule.sequenceNo || '-'}`,
        description: schedule.description,
        documentDate: schedule.paidDate || null,
        dueDate: schedule.dueDate,
        status: schedule.status,
        committedAmount: money(schedule.amount),
        recognizedAmount,
        paidAmount,
        outstandingAmount: Math.max(0, money(schedule.amount) - paidAmount),
        sourceTab: 'payment',
      };
    });

  return [...materialPayableRows, ...certRows, ...scheduleRows]
    .sort((a, b) => String(a.dueDate || a.documentDate || '').localeCompare(String(b.dueDate || b.documentDate || '')));
};

const buildReceivables = (
  customerContracts: CustomerContract[],
  paymentCertificates: PaymentCertificate[],
  schedules: PaymentSchedule[],
  transactions: ProjectTransaction[],
): ProjectFinanceReceivableRow[] => {
  const customerById = new Map(customerContracts.map(contract => [contract.id, contract]));
  const certRows: ProjectFinanceReceivableRow[] = paymentCertificates
    .filter(cert => cert.contractType === 'customer')
    .filter(cert => cert.status !== 'cancelled')
    .map(cert => {
      const contract = customerById.get(cert.contractId);
      const recognizedAmount = ['approved', 'paid'].includes(cert.status)
        ? money(cert.payableThisPeriod ?? cert.currentPayableAmount)
        : 0;
      const contractAmount = money(cert.grossThisPeriod ?? cert.currentCompletedValue ?? recognizedAmount);
      const receivedAmount = cert.status === 'paid'
        ? money(cert.payableThisPeriod ?? cert.currentPayableAmount)
        : estimatePaidForRef(transactions, [`payment_certificate:${cert.id}`, cert.id]);
      return {
        id: `cert:${cert.id}`,
        sourceType: 'payment_certificate',
        sourceId: cert.id,
        counterpartyType: 'customer',
        counterpartyName: contract?.customerName || 'Chủ đầu tư',
        documentNo: `TT-${cert.periodNumber || '-'}`,
        description: cert.description || contract?.name || 'Chứng chỉ thanh toán chủ đầu tư',
        documentDate: cert.approvedAt || cert.createdAt,
        dueDate: cert.paidAt || null,
        status: receivableStatus(recognizedAmount, receivedAmount, contractAmount),
        contractAmount,
        recognizedAmount,
        receivedAmount,
        outstandingAmount: Math.max(0, recognizedAmount - receivedAmount),
        sourceTab: 'payment',
      };
    });

  const scheduleRows: ProjectFinanceReceivableRow[] = schedules
    .filter(schedule => schedule.type === 'receivable')
    .map(schedule => {
      const receivedAmount = money(schedule.paidAmount || (schedule.status === 'paid' ? schedule.amount : 0));
      const recognizedAmount = schedule.status === 'paid' || schedule.dossierStatus === 'approved' ? money(schedule.amount) : 0;
      return {
        id: `schedule:${schedule.id}`,
        sourceType: 'payment_schedule',
        sourceId: schedule.id,
        counterpartyType: 'customer',
        counterpartyName: schedule.contactName || 'Chủ đầu tư',
        documentNo: `KH-${schedule.sequenceNo || '-'}`,
        description: schedule.description,
        documentDate: schedule.paidDate || null,
        dueDate: schedule.dueDate,
        status: schedule.status,
        contractAmount: money(schedule.amount),
        recognizedAmount,
        receivedAmount,
        outstandingAmount: Math.max(0, money(schedule.amount) - receivedAmount),
        sourceTab: 'payment',
      };
    });

  return [...certRows, ...scheduleRows]
    .sort((a, b) => String(a.dueDate || a.documentDate || '').localeCompare(String(b.dueDate || b.documentDate || '')));
};

const buildLedgerRows = (transactions: ProjectTransaction[]): ProjectFinanceLedgerRow[] =>
  transactions
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      type: tx.type,
      category: tx.category,
      amount: money(tx.amount),
      description: tx.description,
      source: tx.source,
      sourceRef: tx.sourceRef || null,
      contractCostItemId: tx.contractCostItemId || null,
      contractCostItemSymbolSnapshot: tx.contractCostItemSymbolSnapshot || null,
      contractCostItemNameSnapshot: tx.contractCostItemNameSnapshot || null,
      costClassificationStatus: tx.costClassificationStatus || 'unclassified',
      counterpartyPartnerId: tx.counterpartyPartnerId || null,
      counterpartyName: tx.counterpartyName || null,
      invoiceNo: tx.invoiceNo || null,
      invoiceDate: tx.invoiceDate || null,
      createdAt: tx.createdAt,
    }));

const buildAlerts = (input: {
  budgetAmount: number;
  actualCost: number;
  cashPosition: number;
  payableOutstanding: number;
  receivableOutstanding: number;
  overdueReceivableCount: number;
  overduePayableCount: number;
}) => {
  const alerts: ProjectFinanceWorkspaceSummary['alerts'] = [];
  if (input.budgetAmount > 0 && input.actualCost > input.budgetAmount) {
    alerts.push({
      id: 'budget-overrun',
      tone: 'danger',
      title: 'Vượt ngân sách',
      message: 'Chi phí thực tế đã vượt ngân sách khai báo của công trình.',
    });
  }
  if (input.cashPosition < 0) {
    alerts.push({
      id: 'negative-cash',
      tone: 'warning',
      title: 'Dòng tiền âm',
      message: 'Tổng chi thực tế đang lớn hơn tổng thu đã ghi nhận.',
    });
  }
  if (input.overdueReceivableCount > 0 || input.overduePayableCount > 0) {
    alerts.push({
      id: 'overdue-payment',
      tone: 'warning',
      title: 'Có lịch thanh toán quá hạn',
      message: `${input.overdueReceivableCount} khoản phải thu và ${input.overduePayableCount} khoản phải trả đang quá hạn.`,
    });
  }
  if (input.receivableOutstanding > input.payableOutstanding && input.receivableOutstanding > 0) {
    alerts.push({
      id: 'collect-receivable',
      tone: 'info',
      title: 'Cần bám thu',
      message: 'Phải thu đang lớn hơn phải trả, nên ưu tiên hồ sơ thu tiền chủ đầu tư.',
    });
  }
  return alerts;
};

const inactiveDocumentStatuses = new Set(['cancelled', 'canceled', 'reversed', 'void']);
const wmsWaitingStatuses = new Set(['import_pending', 'imported', 'export_pending']);

const emptySupplierControlSummary = (): ProjectFinanceSupplierControlSummary => ({
  recognizedMaterialCost: 0,
  openingMaterialCost: 0,
  supplierPaidAmount: 0,
  supplierOutstanding: 0,
  apDocumentCount: 0,
  paymentBatchCount: 0,
  waitingStatementCount: 0,
  wmsPendingExportCount: 0,
  blockedCount: 0,
  issues: [],
});

const isActiveStatus = (status?: string | null) =>
  !inactiveDocumentStatuses.has(String(status || '').toLowerCase());

const supplierPaymentBatchIdFromRef = (sourceRef?: string | null) => {
  const value = String(sourceRef || '');
  if (!value.startsWith('supplier_payment_batch:')) return null;
  return value.slice('supplier_payment_batch:'.length).split(/[:/]/)[0] || null;
};

const supplierDirectRoute = (params?: Record<string, string>): ProjectFinanceSourceRoute => ({
  tab: 'material',
  params: {
    materialTab: 'direct',
    ...params,
  },
});

const supplierFinanceRoute = (financeTab: ProjectFinanceWorkspaceTab, params?: Record<string, string>): ProjectFinanceSourceRoute => ({
  tab: 'finance',
  params: {
    financeTab,
    ...params,
  },
});

export const buildProjectFinanceSupplierControlSummary = (input: {
  supplierPayableBalances?: SupplierPayableBalance[];
  supplierPayableDocuments?: SupplierPayableDocument[];
  supplierPaymentBatches?: SupplierPaymentBatch[];
  supplierDeliveryStatements?: SupplierDeliveryStatement[];
  supplierDirectDeliveryNotes?: SupplierDirectDeliveryNote[];
  supplierDirectDeliveryLines?: SupplierDirectDeliveryLine[];
  transactions?: ProjectTransaction[];
  issueLimit?: number;
}): ProjectFinanceSupplierControlSummary => {
  const balances = input.supplierPayableBalances || [];
  const documents = (input.supplierPayableDocuments || []).filter(document => isActiveStatus(document.status));
  const paymentBatches = (input.supplierPaymentBatches || []).filter(batch => isActiveStatus(batch.status));
  const paidBatches = paymentBatches.filter(batch => batch.status === 'paid');
  const noteById = new Map((input.supplierDirectDeliveryNotes || []).map(note => [note.id, note]));
  const statements = (input.supplierDeliveryStatements || []).filter(statement => isActiveStatus(statement.status));
  const waitingStatements = statements.filter(statement => statement.status !== 'posted');
  const activeDirectNotes = (input.supplierDirectDeliveryNotes || [])
    .filter(note => isActiveStatus(note.status))
    .filter(note => ['accepted', 'finance_review', 'site_confirmed'].includes(note.status));
  const directLines = input.supplierDirectDeliveryLines || [];
  const wmsPendingLines = directLines.filter(line =>
    line.wmsFlowMode === 'direct_in_out' && wmsWaitingStatuses.has(String(line.wmsStatus || '')),
  );
  const wmsBlockedLines = directLines.filter(line =>
    line.wmsFlowMode === 'direct_in_out' && line.wmsStatus === 'blocked',
  );
  const batchIds = new Set(paidBatches.map(batch => batch.id));
  const batchTransactionIds = new Set(paidBatches.map(batch => batch.projectTransactionId).filter(Boolean));
  const unmatchedSupplierPaymentTxAmount = sumTransactions(input.transactions || [], tx => {
    if (tx.type !== 'expense') return false;
    const batchId = supplierPaymentBatchIdFromRef(tx.sourceRef);
    if (!batchId) return false;
    return !batchIds.has(batchId) && !batchTransactionIds.has(tx.id);
  });
  const openingMaterialCost = sumTransactions(input.transactions || [], tx =>
    tx.type === 'expense'
    && tx.category === 'materials'
    && String(tx.sourceRef || '').startsWith('opening_balance:'),
  );
  const supplierRecognizedMaterialCost = balances.length > 0
    ? money(balances.reduce((sum, balance) => sum + numeric(balance.recognizedAmount), 0))
    : money(documents.reduce((sum, document) => sum + numeric(document.recognizedAmount), 0));
  const recognizedMaterialCost = money(supplierRecognizedMaterialCost + openingMaterialCost);
  const supplierOutstanding = balances.length > 0
    ? money(balances.reduce((sum, balance) => sum + numeric(balance.outstandingAmount), 0))
    : money(documents.reduce((sum, document) => sum + numeric(document.outstandingAmount), 0));
  const supplierPaidAmount = money(
    paidBatches.reduce((sum, batch) => sum + numeric(batch.paymentAmount ?? batch.amount), 0) + unmatchedSupplierPaymentTxAmount,
  );
  const apDocumentCount = documents.length || balances.reduce((sum, balance) => sum + numeric(balance.documentCount), 0);
  const waitingStatementCount = waitingStatements.length + activeDirectNotes.length;
  const issueLimit = Math.max(0, input.issueLimit ?? 5);
  const issues: ProjectFinanceSupplierControlIssue[] = [];
  const issueIds = new Set<string>();
  const deliveryNoteIssueIds = new Set<string>();
  const pushIssue = (issue: ProjectFinanceSupplierControlIssue) => {
    if (issueIds.has(issue.id) || issues.length >= issueLimit) return;
    issueIds.add(issue.id);
    issues.push(issue);
  };

  Array.from(new Set(wmsBlockedLines.map(line => line.deliveryNoteId))).forEach(noteId => {
    const note = noteById.get(noteId);
    deliveryNoteIssueIds.add(noteId);
    pushIssue({
      id: `wms-blocked:${noteId}`,
      tone: 'danger',
      title: 'WMS bị chặn',
      message: `${note?.code || 'Phiếu giao HĐ NCC'} có dòng nhập-xuất thẳng bị chặn, cần tạo lại phiếu xuất hợp lệ trước khi đối soát/AP.`,
      sourceRoute: supplierDirectRoute({ supplierDirectDeliveryNoteId: noteId }),
      trace: {
        type: 'supplier_direct_delivery_note',
        id: noteId,
        qrToken: note?.qrToken,
      },
    });
  });

  Array.from(new Set(wmsPendingLines.map(line => line.deliveryNoteId)))
    .filter(noteId => !deliveryNoteIssueIds.has(noteId))
    .forEach(noteId => {
      const note = noteById.get(noteId);
      deliveryNoteIssueIds.add(noteId);
      pushIssue({
        id: `wms-pending-export:${noteId}`,
        tone: 'warning',
        title: 'Tồn chờ xuất dùng',
        message: `${note?.code || 'Phiếu giao HĐ NCC'} đã đi qua WMS nhưng chưa hoàn tất xuất dùng, chưa đủ điều kiện vào đối soát/AP.`,
        sourceRoute: supplierDirectRoute({ supplierDirectDeliveryNoteId: noteId }),
        trace: {
          type: 'supplier_direct_delivery_note',
          id: noteId,
          qrToken: note?.qrToken,
        },
      });
    });

  waitingStatements.forEach(statement => {
    pushIssue({
      id: `waiting-statement:${statement.id}`,
      tone: 'warning',
      title: 'Bảng đối soát chưa post',
      message: `${statement.code || 'Bảng đối soát HĐ NCC'} chưa post nên chưa ghi nhận AP.`,
      sourceRoute: supplierDirectRoute({
        supplierDeliveryStatementId: statement.id,
        ...(statement.supplierContractId ? { supplierContractId: statement.supplierContractId } : {}),
      }),
      trace: {
        type: 'supplier_delivery_statement',
        id: statement.id,
        qrToken: statement.qrToken,
      },
    });
  });

  balances
    .filter(balance => balance.isOverdue && numeric(balance.outstandingAmount) > 0)
    .forEach(balance => {
      const id = balance.id || balance.supplierId || balance.supplierNameSnapshot;
      pushIssue({
        id: `supplier-overdue:${id}`,
        tone: 'danger',
        title: 'Công nợ NCC quá hạn',
        message: `${balance.supplierNameSnapshot || 'Nhà cung cấp'} còn ${money(balance.outstandingAmount).toLocaleString('vi-VN')} đ phải trả quá hạn.`,
        sourceRoute: supplierFinanceRoute('payables', {
          ...(balance.supplierId ? { supplierId: balance.supplierId } : {}),
        }),
      });
    });

  return {
    recognizedMaterialCost,
    openingMaterialCost,
    supplierPaidAmount,
    supplierOutstanding,
    apDocumentCount: money(apDocumentCount),
    paymentBatchCount: paymentBatches.length,
    waitingStatementCount,
    wmsPendingExportCount: wmsPendingLines.length,
    blockedCount: wmsBlockedLines.length,
    issues,
  };
};

export const buildProjectFinanceSummary = (input: {
  customerContracts: CustomerContract[];
  costItems: ProjectCostItem[];
  paymentCertificates: PaymentCertificate[];
  schedules: PaymentSchedule[];
  advances: AdvancePayment[];
  transactions: ProjectTransaction[];
  payables: ProjectFinancePayableRow[];
  receivables: ProjectFinanceReceivableRow[];
  supplierControl?: ProjectFinanceSupplierControlSummary;
}): ProjectFinanceWorkspaceSummary => {
  const rootCosts = input.costItems.filter(item => !item.parentId);
  const contractValue = money(input.customerContracts
    .filter(contract => contract.status !== 'cancelled')
    .reduce((sum, contract) => sum + Number(contract.value || 0), 0));
  const budgetAmount = money(rootCosts.reduce((sum, item) => sum + Number(item.budgetAmount || 0), 0));
  const cashIn = sumTransactions(input.transactions, tx => tx.type === 'revenue_received');
  const supplierMaterialCost = money(input.payables
    .filter(row => row.sourceType === 'supplier_payable' || row.sourceType === 'purchase_order')
    .reduce((sum, row) => sum + row.recognizedAmount, 0));
  const nonSupplierCashCost = sumTransactions(input.transactions, tx => {
    if (tx.type !== 'expense') return false;
    const sourceRef = String(tx.sourceRef || '');
    return !(tx.category === 'materials' && (
      sourceRef.startsWith('supplier_payment_batch:')
      || sourceRef.startsWith('site_cash_settlement_batch:')
    ));
  });
  const actualCost = money(supplierMaterialCost + nonSupplierCashCost);
  const cashOut = sumTransactions(input.transactions, tx => tx.type === 'expense');
  const certifiedRevenue = money(input.paymentCertificates
    .filter(cert => cert.contractType === 'customer' && ['approved', 'paid'].includes(cert.status))
    .reduce((sum, cert) => sum + Number(cert.grossThisPeriod ?? cert.currentCompletedValue ?? 0), 0));
  const paidRevenue = money(input.paymentCertificates
    .filter(cert => cert.contractType === 'customer' && cert.status === 'paid')
    .reduce((sum, cert) => sum + Number(cert.payableThisPeriod ?? cert.currentPayableAmount ?? 0), 0));
  const payableCommitted = money(input.payables.reduce((sum, row) => sum + row.committedAmount, 0));
  const payableRecognized = money(input.payables.reduce((sum, row) => sum + row.recognizedAmount, 0));
  const payableOutstanding = money(input.payables.reduce((sum, row) => sum + row.outstandingAmount, 0));
  const receivableRecognized = money(input.receivables.reduce((sum, row) => sum + row.recognizedAmount, 0));
  const receivableOutstanding = money(input.receivables.reduce((sum, row) => sum + row.outstandingAmount, 0));
  const advanceOutstanding = money(input.advances
    .filter(advance => advance.status === 'active')
    .reduce((sum, advance) => sum + Number(advance.remainingAmount || 0), 0));
  const today = todayIso();
  const overdueReceivableCount = input.schedules.filter(row => row.type === 'receivable' && row.status !== 'paid' && row.dueDate < today).length;
  const overduePayableCount = input.schedules.filter(row => row.type === 'payable' && row.status !== 'paid' && row.dueDate < today).length;
  const pendingPaymentCount = input.schedules.filter(row => row.status !== 'paid').length;
  const cashPosition = cashIn - cashOut;

  return {
    contractValue,
    budgetAmount,
    actualCost,
    budgetVariance: budgetAmount - actualCost,
    certifiedRevenue,
    paidRevenue,
    cashIn,
    cashOut,
    cashPosition,
    payableCommitted,
    payableRecognized,
    payableOutstanding,
    receivableRecognized,
    receivableOutstanding,
    advanceOutstanding,
    estimatedMargin: contractValue - actualCost,
    overdueReceivableCount,
    overduePayableCount,
    pendingPaymentCount,
    supplierControl: input.supplierControl || emptySupplierControlSummary(),
    alerts: buildAlerts({
      budgetAmount,
      actualCost,
      cashPosition,
      payableOutstanding,
      receivableOutstanding,
      overdueReceivableCount,
      overduePayableCount,
    }),
  };
};

export const projectFinanceWorkspaceService = {
  async getWorkspace(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    transactions?: ProjectTransaction[];
  }): Promise<ProjectFinanceWorkspaceData> {
    const { projectId, constructionSiteId } = input;
    const [
      customerContracts,
      subcontractors,
      paymentCertificates,
      schedules,
      advances,
      costItems,
      purchaseOrders,
      supplierPayableBalances,
      supplierPayableDocuments,
      supplierPaymentBatches,
      supplierDeliveryStatements,
      supplierDirectDeliveryNotes,
      loadedTransactions,
    ] = await Promise.all([
      loadScopedRows<CustomerContract>('customer_contracts', projectId, constructionSiteId),
      loadScopedRows<SubcontractorContract>('subcontractor_contracts', projectId, constructionSiteId),
      loadScopedRows<PaymentCertificate>('payment_certificates', projectId, constructionSiteId),
      loadScopedRows<PaymentSchedule>('payment_schedules', projectId, constructionSiteId, 'due_date'),
      loadScopedRows<AdvancePayment>('advance_payments', projectId, constructionSiteId),
      loadScopedRows<ProjectCostItem>('project_cost_items', projectId, constructionSiteId, 'order'),
      loadScopedPurchaseOrders(projectId, constructionSiteId),
      loadScopedRows<SupplierPayableBalance>('supplier_payable_balances', projectId, constructionSiteId, 'latest_document_date'),
      loadScopedRows<SupplierPayableDocument>('supplier_payable_documents', projectId, constructionSiteId, 'document_date'),
      loadScopedRows<SupplierPaymentBatch>('supplier_payment_batches', projectId, constructionSiteId, 'payment_date'),
      loadScopedRows<SupplierDeliveryStatement>('supplier_delivery_statements', projectId, constructionSiteId, 'statement_date'),
      loadScopedRows<SupplierDirectDeliveryNote>('supplier_direct_delivery_notes', projectId, constructionSiteId, 'delivery_date'),
      input.transactions
        ? Promise.resolve(input.transactions)
        : loadScopedRows<ProjectTransaction>('project_transactions', projectId, constructionSiteId, 'date'),
    ]);

    const transactions = dedupeById(loadedTransactions);
    const supplierDirectDeliveryLines = await loadSupplierDirectDeliveryLinesForNotes(
      supplierDirectDeliveryNotes.map(note => note.id),
    );
    const payables = buildPayables(purchaseOrders, paymentCertificates, schedules, transactions, subcontractors, supplierPayableBalances);
    const receivables = buildReceivables(customerContracts, paymentCertificates, schedules, transactions);
    const supplierControl = buildProjectFinanceSupplierControlSummary({
      supplierPayableBalances,
      supplierPayableDocuments,
      supplierPaymentBatches,
      supplierDeliveryStatements,
      supplierDirectDeliveryNotes,
      supplierDirectDeliveryLines,
      transactions,
    });
    return {
      summary: buildProjectFinanceSummary({
        customerContracts,
        costItems,
        paymentCertificates,
        schedules,
        advances,
        transactions,
        payables,
        receivables,
        supplierControl,
      }),
      paymentSchedules: schedules,
      payables,
      receivables,
      ledger: buildLedgerRows(transactions),
    };
  },
};
