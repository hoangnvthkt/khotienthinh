import {
  AdvancePayment,
  ContractItem,
  ContractItemType,
  DailyLog,
  MaterialBudgetItem,
  PaymentCertificate,
  PaymentSchedule,
  Project,
  ProjectProgressCalculationMode,
  ProjectTask,
  ProjectTransaction,
  PurchaseOrder,
  QuantityAcceptance,
  TaskContractItem,
} from '../types';
import { advancePaymentService } from './advancePaymentService';
import { contractItemService } from './contractItemService';
import { fromDb } from './dbMapping';
import { isSupabaseConfigured, supabase } from './supabase';
import {
  boqService,
  dailyLogService,
  paymentService,
  poService,
  taskService,
} from './projectService';
import { paymentCertificateService } from './paymentCertificateService';
import { projectFinancialService, ProjectFinancialKPIs } from './projectFinancialService';
import { projectMasterService } from './projectMasterService';
import {
  calculateProjectProgress,
  clampProgress,
  daysBetweenDates,
  getLeafProjectTasks,
  getTaskProgressWeight,
} from './projectScheduleRules';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { quantityAcceptanceService } from './quantityAcceptanceService';
import { taskContractItemService } from './taskContractItemService';

export interface ProjectProgressMetric {
  mode: ProjectProgressCalculationMode;
  modeLabel: string;
  percent: number;
  ganttPercent: number;
  leafTaskCount: number;
  completedLeafCount: number;
  totalWeight: number;
}

export interface PartyDashboardMetric {
  contractValue: number;
  performedValue: number;
  acceptedValue: number;
  paymentRequested: number;
  paymentVolumeValue: number;
  advanceRecovered: number;
  retentionValue: number;
  penaltyDeductionValue: number;
  paidFromPaymentRequests: number;
  outstandingAdvance: number;
  actualPaid: number;
  debt: number;
}

export interface SupplierDashboardMetric {
  contractValue: number;
  paymentRequested: number;
  actualPaid: number;
  paidFromPaymentRequests: number;
  outstandingAdvance: number;
  debt: number;
  sourceNote: string;
}

export interface CashFlowDashboardMetric {
  cashIn: number;
  cashOut: number;
  balance: number;
  receivable: number;
  payable: number;
  overdueCount: number;
}

export interface ConstructionCostDashboardMetric {
  performedBudgetCost: number;
  subcontractPaid: number;
  supplierPaid: number;
  otherCost: number;
  totalActualCost: number;
  forecastProfitLoss: number;
}

export interface MaterialDashboardMetric {
  materialPurchasedBudgetCost: number;
  materialPurchasedActualCost: number;
  materialPurchaseProfitLoss: number;
  overLimitCount: number;
  warningLevel1Count: number;
  warningLevel2Count: number;
  taskMaterialOverCount: number;
  taskMaterialProgressOverCount: number;
}

export interface SevenDayForecastDashboardMetric {
  materialCost: number;
  laborCost: number;
  machineCost: number;
  totalCost: number;
  taskCount: number;
}

export interface ProjectDashboardMetrics {
  project?: Project;
  financialKPIs?: ProjectFinancialKPIs;
  progress: ProjectProgressMetric;
  owner: PartyDashboardMetric;
  subcontractor: PartyDashboardMetric;
  supplier: SupplierDashboardMetric;
  cashFlow: CashFlowDashboardMetric;
  constructionCost: ConstructionCostDashboardMetric;
  material: MaterialDashboardMetric;
  sevenDayForecast: SevenDayForecastDashboardMetric;
  sourceNotes: string[];
  warnings: string[];
  calculatedAt: string;
}

const PROGRESS_MODE_LABELS: Record<ProjectProgressCalculationMode, string> = {
  gantt_weighted: 'Gantt có trọng số',
  budget: 'Ngân sách công việc',
  duration: 'Thời gian thực hiện',
  task_count: 'Số lượng công việc',
  manual: 'Thủ công',
};

const BOOKED_CERT_STATUSES = new Set(['submitted', 'approved', 'paid']);
const ACTIVE_PO_STATUSES = new Set(['draft', 'sent', 'partial', 'delivered']);

const sum = <T>(items: T[], picker: (item: T) => number | null | undefined): number =>
  items.reduce((total, item) => total + Number(picker(item) || 0), 0);

const clampMoney = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const revisedItemValue = (item: ContractItem): number =>
  Number(item.revisedTotalPrice ?? item.totalPrice ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0)) ?? 0);

const getLeafItems = (items: ContractItem[]): ContractItem[] => {
  const parentIds = new Set(items.map(item => item.parentId).filter(Boolean) as string[]);
  const leafItems = items.filter(item => !parentIds.has(item.id));
  return leafItems.length > 0 ? leafItems : items;
};

const getVerifiedLogs = (logs: DailyLog[]): DailyLog[] =>
  logs.filter(log => log.status === 'verified' || log.verified);

const certPeriodGross = (cert: PaymentCertificate): number =>
  Number(cert.grossThisPeriod ?? cert.currentCompletedValue ?? 0);

const certPeriodPayable = (cert: PaymentCertificate): number =>
  Number(cert.payableThisPeriod ?? cert.currentPayableAmount ?? 0);

const certAdvanceRecovery = (cert: PaymentCertificate): number =>
  Number(cert.advanceRecoveryThisPeriod ?? cert.advanceRecovery ?? 0);

const certRetention = (cert: PaymentCertificate): number =>
  Number(cert.retentionThisPeriod ?? cert.retentionAmount ?? 0);

const taskDuration = (task: ProjectTask): number => {
  if (task.isMilestone) return 1;
  if (Number(task.duration) > 0) return Number(task.duration);
  if (task.startDate && task.endDate) return Math.max(1, daysBetweenDates(task.startDate, task.endDate));
  return 1;
};

const overlapDays = (startDate: string, endDate: string, windowStart: string, windowEnd: string): number => {
  if (!startDate || !endDate || endDate < windowStart || startDate > windowEnd) return 0;
  const start = startDate > windowStart ? startDate : windowStart;
  const end = endDate < windowEnd ? endDate : windowEnd;
  return Math.max(0, daysBetweenDates(start, end) + 1);
};

const safeLoad = async <T>(
  label: string,
  warnings: string[],
  factory: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await factory();
  } catch (error: any) {
    warnings.push(`${label}: ${error?.message || 'Không đọc được dữ liệu'}`);
    return fallback;
  }
};

const listTransactions = async (projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectTransaction[]> => {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('project_transactions')
    .select('*')
    .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
    .order('date', { ascending: true });
  if (error) throw error;
  return dedupeRowsById(data || []).map(row => fromDb(row) as ProjectTransaction);
};

const resolveProject = async (projectId?: string, constructionSiteId?: string): Promise<Project | undefined> => {
  if (!isSupabaseConfigured) return undefined;
  const projects = await projectMasterService.list();
  return projects.find(project =>
    (projectId && project.id === projectId) ||
    (constructionSiteId && project.constructionSiteId === constructionSiteId),
  );
};

const buildProgressMetric = (
  project: Project | undefined,
  tasks: ProjectTask[],
  taskLinks: TaskContractItem[],
  customerItems: ContractItem[],
): ProjectProgressMetric => {
  const gantt = calculateProjectProgress(tasks);
  const leafTasks = getLeafProjectTasks(tasks);
  const mode = project?.progressCalculationMode || 'gantt_weighted';

  const weightedAverage = (weightPicker: (task: ProjectTask) => number): number => {
    const totalWeight = sum(leafTasks, weightPicker);
    if (totalWeight <= 0) return 0;
    const progressWeight = leafTasks.reduce((total, task) => total + clampProgress(task.progress) * weightPicker(task), 0);
    return Math.round(progressWeight / totalWeight);
  };

  const customerItemMap = new Map(customerItems.map(item => [item.id, item]));
  const budgetWeightByTask = new Map<string, number>();
  for (const link of taskLinks) {
    const item = customerItemMap.get(link.contractItemId);
    if (!item) continue;
    const splitPercent = Number(link.weightPercent ?? 100);
    const value = revisedItemValue(item) * Math.max(0, splitPercent) / 100;
    budgetWeightByTask.set(link.taskId, (budgetWeightByTask.get(link.taskId) || 0) + value);
  }

  let percent = gantt.progressPercent;
  if (mode === 'budget') {
    percent = weightedAverage(task => budgetWeightByTask.get(task.id) || getTaskProgressWeight(task));
  } else if (mode === 'duration') {
    percent = weightedAverage(taskDuration);
  } else if (mode === 'task_count') {
    percent = leafTasks.length > 0
      ? Math.round((leafTasks.filter(task => task.progress >= 100 && task.gateStatus === 'approved').length / leafTasks.length) * 100)
      : 0;
  } else if (mode === 'manual') {
    percent = clampProgress(project?.manualProgressPercent || 0);
  }

  return {
    mode,
    modeLabel: PROGRESS_MODE_LABELS[mode],
    percent,
    ganttPercent: gantt.progressPercent,
    leafTaskCount: gantt.leafTaskCount,
    completedLeafCount: gantt.completedLeafCount,
    totalWeight: gantt.totalWeight,
  };
};

const buildPartyMetric = (
  contractType: ContractItemType,
  contractItems: ContractItem[],
  logs: DailyLog[],
  acceptances: QuantityAcceptance[],
  certs: PaymentCertificate[],
  advances: AdvancePayment[],
): PartyDashboardMetric => {
  const items = getLeafItems(contractItems.filter(item => item.contractType === contractType));
  const itemMap = new Map(items.map(item => [item.id, item]));
  const contractValue = sum(items, revisedItemValue);
  const verifiedLogs = getVerifiedLogs(logs);
  const performedFromLogs = verifiedLogs.reduce((total, log) => {
    return total + sum(log.volumes || [], volume => {
      const item = itemMap.get(volume.contractItemId);
      if (!item) return 0;
      return Number(volume.quantity || 0) * Number(item.unitPrice || 0);
    });
  }, 0);
  const performedFromItems = sum(items, item => Number(item.completedQuantity || 0) * Number(item.unitPrice || 0));
  const performedValue = performedFromLogs > 0 ? performedFromLogs : performedFromItems;

  const scopedAcceptances = acceptances.filter(item => item.contractType === contractType);
  const scopedCerts = certs.filter(cert => cert.contractType === contractType);
  const scopedAdvances = advances.filter(advance => advance.contractType === contractType);
  const bookedCerts = scopedCerts.filter(cert => BOOKED_CERT_STATUSES.has(cert.status));

  const acceptedValue = sum(scopedAcceptances.filter(item => item.status === 'approved'), item => item.totalAcceptedAmount);
  const paymentRequested = sum(bookedCerts, certPeriodGross);
  const paymentVolumeValue = sum(bookedCerts, cert => cert.currentCompletedValue || cert.grossThisPeriod || 0);
  const advanceRecovered = sum(bookedCerts, certAdvanceRecovery);
  const retentionValue = sum(bookedCerts, certRetention);
  const penaltyDeductionValue = sum(bookedCerts, cert => Number(cert.penaltyAmount || 0) + Number(cert.deductionAmount || 0));
  const paidFromPaymentRequests = sum(scopedCerts.filter(cert => cert.status === 'paid'), certPeriodPayable);
  const outstandingAdvance = sum(scopedAdvances.filter(advance => advance.status === 'active'), advance => advance.remainingAmount);
  const actualPaid = paidFromPaymentRequests + outstandingAdvance;

  return {
    contractValue,
    performedValue,
    acceptedValue,
    paymentRequested,
    paymentVolumeValue,
    advanceRecovered,
    retentionValue,
    penaltyDeductionValue,
    paidFromPaymentRequests,
    outstandingAdvance,
    actualPaid,
    debt: clampMoney(paymentRequested - actualPaid),
  };
};

const buildSupplierMetric = (
  purchaseOrders: PurchaseOrder[],
  transactions: ProjectTransaction[],
): SupplierDashboardMetric => {
  const activePOs = purchaseOrders.filter(po => ACTIVE_PO_STATUSES.has(po.status));
  const requestedPOs = purchaseOrders.filter(po => ['sent', 'partial', 'delivered'].includes(po.status));
  const contractValue = sum(activePOs, po => po.totalAmount);
  const paymentRequested = requestedPOs.length > 0 ? sum(requestedPOs, po => po.totalAmount) : contractValue;
  const paidFromPaymentRequests = sum(
    transactions.filter(tx => tx.type === 'expense' && tx.category === 'materials'),
    tx => tx.amount,
  );

  return {
    contractValue,
    paymentRequested,
    actualPaid: paidFromPaymentRequests,
    paidFromPaymentRequests,
    outstandingAdvance: 0,
    debt: clampMoney(paymentRequested - paidFromPaymentRequests),
    sourceNote: 'NCC v1 dùng PO và giao dịch chi vật tư; chưa có model tạm ứng riêng cho NCC.',
  };
};

const buildCashFlowMetric = (
  transactions: ProjectTransaction[],
  paymentSchedules: PaymentSchedule[],
  owner: PartyDashboardMetric,
  subcontractor: PartyDashboardMetric,
  supplier: SupplierDashboardMetric,
): CashFlowDashboardMetric => {
  const today = new Date().toISOString().slice(0, 10);
  const cashIn = sum(transactions.filter(tx => tx.type === 'revenue_received'), tx => tx.amount);
  const cashOut = sum(transactions.filter(tx => tx.type === 'expense'), tx => tx.amount);
  const overdueCount = paymentSchedules.filter(schedule =>
    schedule.status === 'overdue' ||
    (schedule.status === 'pending' && schedule.dueDate < today),
  ).length;

  return {
    cashIn,
    cashOut,
    balance: cashIn - cashOut,
    receivable: owner.debt,
    payable: subcontractor.debt + supplier.debt,
    overdueCount,
  };
};

const buildConstructionCostMetric = (
  owner: PartyDashboardMetric,
  subcontractor: PartyDashboardMetric,
  supplier: SupplierDashboardMetric,
  transactions: ProjectTransaction[],
): ConstructionCostDashboardMetric => {
  const subcontractTxPaid = sum(
    transactions.filter(tx => tx.type === 'expense' && tx.category === 'subcontract'),
    tx => tx.amount,
  );
  const subcontractPaid = subcontractor.actualPaid > 0 ? subcontractor.actualPaid : subcontractTxPaid;
  const supplierPaid = supplier.actualPaid;
  const otherCost = sum(
    transactions.filter(tx => tx.type === 'expense' && !['materials', 'subcontract'].includes(tx.category)),
    tx => tx.amount,
  );
  const totalActualCost = subcontractPaid + supplierPaid + otherCost;

  return {
    performedBudgetCost: owner.performedValue,
    subcontractPaid,
    supplierPaid,
    otherCost,
    totalActualCost,
    forecastProfitLoss: owner.performedValue - totalActualCost,
  };
};

const buildMaterialMetric = (
  materialBudgets: MaterialBudgetItem[],
  purchaseOrders: PurchaseOrder[],
): MaterialDashboardMetric => {
  const materialPurchasedBudgetCost = sum(materialBudgets, item => {
    const purchasedQty = Number(item.cumulativeImported ?? item.actualQty ?? 0);
    return purchasedQty * Number(item.budgetUnitPrice || 0);
  });
  const materialPurchasedActualCost = sum(
    purchaseOrders.filter(po => po.status !== 'cancelled'),
    po => po.totalAmount,
  );
  const overLimitCount = materialBudgets.filter(item =>
    Number(item.actualQty || 0) > Number(item.budgetQty || 0) ||
    Number(item.wastePercent || 0) > 0 ||
    Number(item.budgetOverPercent || 0) > 0,
  ).length;
  const warningLevel1Count = materialBudgets.filter(item =>
    Number(item.wastePercent || item.budgetOverPercent || 0) > Number(item.wasteThreshold || 0),
  ).length;
  const warningLevel2Count = materialBudgets.filter(item => {
    const threshold = Number(item.wasteThreshold || 0);
    const overPercent = Number(item.wastePercent || item.budgetOverPercent || 0);
    return threshold > 0 && overPercent > threshold * 2;
  }).length;

  return {
    materialPurchasedBudgetCost,
    materialPurchasedActualCost,
    materialPurchaseProfitLoss: materialPurchasedBudgetCost - materialPurchasedActualCost,
    overLimitCount,
    warningLevel1Count,
    warningLevel2Count,
    taskMaterialOverCount: overLimitCount,
    taskMaterialProgressOverCount: materialBudgets.filter(item => Number(item.budgetOverPercent || 0) > 0).length,
  };
};

const buildSevenDayForecastMetric = (tasks: ProjectTask[]): SevenDayForecastDashboardMetric => {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);
  const windowEnd = endDate.toISOString().slice(0, 10);
  const activeTasks = getLeafProjectTasks(tasks).filter(task =>
    task.progress < 100 && overlapDays(task.startDate, task.endDate, today, windowEnd) > 0,
  );

  const laborCost = sum(activeTasks, task => {
    if (!['worker', 'specialist'].includes(task.resourceType || '')) return 0;
    return overlapDays(task.startDate, task.endDate, today, windowEnd)
      * Number(task.resourceCount || 1)
      * Number(task.estimatedCostPerDay || 0);
  });
  const machineCost = sum(activeTasks, task => {
    if (task.resourceType !== 'machine') return 0;
    return overlapDays(task.startDate, task.endDate, today, windowEnd)
      * Number(task.resourceCount || 1)
      * Number(task.estimatedCostPerDay || 0);
  });

  return {
    materialCost: 0,
    laborCost,
    machineCost,
    totalCost: laborCost + machineCost,
    taskCount: activeTasks.length,
  };
};

export const projectDashboardMetricsService = {
  async getMetrics(params: { projectId?: string; constructionSiteId: string }): Promise<ProjectDashboardMetrics> {
    const warnings: string[] = [];
    const sourceNotes = [
      'Dữ liệu chủ đầu tư và nhà thầu ưu tiên BOQ, nghiệm thu, chứng chỉ thanh toán, tạm ứng.',
      'Dữ liệu NCC ưu tiên PO và giao dịch chi vật tư để tránh tạo model trùng khi chưa có tạm ứng NCC riêng.',
      'Chi phí thầu phụ ưu tiên chứng chỉ thanh toán/tạm ứng; giao dịch chi thầu phụ chỉ dùng làm fallback.',
    ];

    const project = await safeLoad(
      'projects',
      warnings,
      () => resolveProject(params.projectId, params.constructionSiteId),
      undefined,
    );
    const projectScopeId = project?.id || params.projectId || params.constructionSiteId;
    const constructionSiteId = project?.constructionSiteId || params.constructionSiteId;

    const [
      tasks,
      logs,
      customerItems,
      subcontractorItems,
      taskLinks,
      acceptances,
      certs,
      advances,
      transactions,
      purchaseOrders,
      materialBudgets,
      paymentSchedules,
      financialKPIs,
    ] = await Promise.all([
      safeLoad('project_tasks', warnings, () => taskService.list(projectScopeId, constructionSiteId), [] as ProjectTask[]),
      safeLoad('daily_logs', warnings, () => dailyLogService.list(projectScopeId, constructionSiteId), [] as DailyLog[]),
      safeLoad('contract_items customer', warnings, () => contractItemService.listBySite(projectScopeId, 'customer', constructionSiteId), [] as ContractItem[]),
      safeLoad('contract_items subcontractor', warnings, () => contractItemService.listBySite(projectScopeId, 'subcontractor', constructionSiteId), [] as ContractItem[]),
      safeLoad('task_contract_items', warnings, () => taskContractItemService.listBySite(projectScopeId, constructionSiteId), [] as TaskContractItem[]),
      safeLoad('quantity_acceptances', warnings, () => quantityAcceptanceService.listBySite(constructionSiteId), [] as QuantityAcceptance[]),
      safeLoad('payment_certificates', warnings, () => paymentCertificateService.listBySite(constructionSiteId), [] as PaymentCertificate[]),
      safeLoad('advance_payments', warnings, () => advancePaymentService.listBySite(constructionSiteId), [] as AdvancePayment[]),
      safeLoad('project_transactions', warnings, () => listTransactions(projectScopeId, constructionSiteId), [] as ProjectTransaction[]),
      safeLoad('purchase_orders', warnings, () => poService.list(projectScopeId, constructionSiteId), [] as PurchaseOrder[]),
      safeLoad('material_budget_items', warnings, () => boqService.list(projectScopeId, constructionSiteId), [] as MaterialBudgetItem[]),
      safeLoad('payment_schedules', warnings, () => paymentService.list(projectScopeId, constructionSiteId), [] as PaymentSchedule[]),
      safeLoad('financial_kpis', warnings, () => projectFinancialService.getKPIs(constructionSiteId), undefined as ProjectFinancialKPIs | undefined),
    ]);

    const allContractItems = [...customerItems, ...subcontractorItems];
    const owner = buildPartyMetric('customer', allContractItems, logs, acceptances, certs, advances);
    const subcontractor = buildPartyMetric('subcontractor', allContractItems, logs, acceptances, certs, advances);
    const supplier = buildSupplierMetric(purchaseOrders, transactions);
    const cashFlow = buildCashFlowMetric(transactions, paymentSchedules, owner, subcontractor, supplier);
    const constructionCost = buildConstructionCostMetric(owner, subcontractor, supplier, transactions);
    const material = buildMaterialMetric(materialBudgets, purchaseOrders);
    const sevenDayForecast = buildSevenDayForecastMetric(tasks);
    const progress = buildProgressMetric(project, tasks, taskLinks, customerItems);

    return {
      project,
      financialKPIs,
      progress,
      owner,
      subcontractor,
      supplier,
      cashFlow,
      constructionCost,
      material,
      sevenDayForecast,
      sourceNotes,
      warnings,
      calculatedAt: new Date().toISOString(),
    };
  },
};
