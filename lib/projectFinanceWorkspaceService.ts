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
  SubcontractorContract,
  SupplierPayableBalance,
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
  createdAt?: string | null;
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

export const buildProjectFinanceSummary = (input: {
  customerContracts: CustomerContract[];
  costItems: ProjectCostItem[];
  paymentCertificates: PaymentCertificate[];
  schedules: PaymentSchedule[];
  advances: AdvancePayment[];
  transactions: ProjectTransaction[];
  payables: ProjectFinancePayableRow[];
  receivables: ProjectFinanceReceivableRow[];
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
      input.transactions
        ? Promise.resolve(input.transactions)
        : loadScopedRows<ProjectTransaction>('project_transactions', projectId, constructionSiteId, 'date'),
    ]);

    const transactions = dedupeById(loadedTransactions);
    const payables = buildPayables(purchaseOrders, paymentCertificates, schedules, transactions, subcontractors, supplierPayableBalances);
    const receivables = buildReceivables(customerContracts, paymentCertificates, schedules, transactions);
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
      }),
      paymentSchedules: schedules,
      payables,
      receivables,
      ledger: buildLedgerRows(transactions),
    };
  },
};
