import {
  AdvancePayment,
  BoqReconciliationGroup,
  ContractVariation,
  ContractItem,
  ContractItemType,
  DailyLog,
  MaterialBudgetItem,
  PaymentCertificate,
  PaymentSchedule,
  ProjectDelayEvent,
  Project,
  ProjectFinance,
  ProjectProgressCalculationMode,
  ProjectTask,
  ProjectTaskCompletionRequest,
  ProjectWorkBoqItem,
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
  workBoqService,
} from './projectService';
import { boqReconciliationService } from './boqReconciliationService';
import { buildScheduleForecast } from './projectScheduleForecast';
import { delayEventService } from './projectScheduleForecastService';
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
import { buildTaskContractQuantityFactors, taskContractItemService } from './taskContractItemService';
import { taskCompletionRequestService } from './projectTaskCompletionService';

export interface ProjectProgressMetric {
  mode: ProjectProgressCalculationMode;
  modeLabel: string;
  percent: number;
  ganttPercent: number;
  leafTaskCount: number;
  completedLeafCount: number;
  totalWeight: number;
  /** Tổng giá trị hợp đồng (chỉ khi mode = contract_value) */
  contractTotalValue?: number;
  /** Giá trị vật tư đã cấp: PO totalAmount (chỉ khi mode = contract_value) */
  suppliedValue?: number;
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

export type ExecutiveAlertSeverity = 'critical' | 'warning' | 'info' | 'success';
export type ExecutiveHealthStatus = 'green' | 'amber' | 'red';
export type ExecutivePaymentParty = 'owner' | 'subcontractor' | 'supplier';
export type ExecutivePaymentBlockingStage = 'none' | 'production' | 'acceptance' | 'certificate' | 'cash';

export interface ExecutiveScheduleHealthMetric {
  status: ExecutiveHealthStatus;
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  baselineEndDate: string;
  forecastEndDate: string;
  forecastDeltaDays: number;
  activeDelayEventCount: number;
  impactedTaskCount: number;
  overdueTaskCount: number;
  criticalOverdueTaskCount: number;
  upcomingDueTaskCount: number;
}

export interface ExecutivePaymentPeriodRisk {
  id: string;
  party: ExecutivePaymentParty;
  label: string;
  description: string;
  dueDate: string;
  daysUntilDue: number;
  targetCumulative: number;
  performedValue: number;
  acceptedValue: number;
  certifiedValue: number;
  paidValue: number;
  blockingStage: ExecutivePaymentBlockingStage;
  missingAmount: number;
  severity: ExecutiveAlertSeverity;
  recommendation: string;
}

export interface ExecutiveApprovalQueueMetric {
  dailyLogSubmitted: number;
  taskCompletionSubmitted: number;
  taskGatePending: number;
  quantityAcceptanceSubmitted: number;
  paymentCertificateSubmitted: number;
  variationSubmitted: number;
  reconciliationSubmitted: number;
  total: number;
}

export interface ExecutivePriorityAlert {
  id: string;
  severity: ExecutiveAlertSeverity;
  title: string;
  message: string;
  targetTab?: string;
  dueDate?: string;
  amount?: number;
}

export interface ExecutiveDashboardMetric {
  scheduleHealth: ExecutiveScheduleHealthMetric;
  paymentPeriodRisks: ExecutivePaymentPeriodRisk[];
  approvalQueue: ExecutiveApprovalQueueMetric;
  priorityAlerts: ExecutivePriorityAlert[];
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
  executive: ExecutiveDashboardMetric;
  sourceNotes: string[];
  warnings: string[];
  calculatedAt: string;
}

const PROGRESS_MODE_LABELS: Record<ProjectProgressCalculationMode, string> = {
  gantt_weighted: 'Gantt có trọng số',
  budget: 'Ngân sách công việc',
  duration: 'Thời gian thực hiện',
  task_count: 'Số lượng công việc',
  contract_value: 'Giá trị hợp đồng (VT cấp phát)',
  manual: 'Thủ công',
};

const BOOKED_CERT_STATUSES = new Set(['submitted', 'approved', 'paid']);
const ACTIVE_PO_STATUSES = new Set(['draft', 'sent', 'confirmed', 'in_transit', 'partial', 'delivered']);

const sum = <T>(items: T[], picker: (item: T) => number | null | undefined): number =>
  items.reduce((total, item) => total + Number(picker(item) || 0), 0);

const clampMoney = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const addDaysIso = (date: string, days: number): string => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const maxEndDate = (tasks: ProjectTask[]): string => {
  const dates = tasks.map(task => task.endDate).filter(Boolean).sort();
  return dates[dates.length - 1] || '';
};
const severityRank: Record<ExecutiveAlertSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };

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

const listContractVariations = async (projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ContractVariation[]> => {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('contract_variations')
    .select('*')
    .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return dedupeRowsById(data || []).map(row => fromDb(row) as ContractVariation);
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
  purchaseOrders: PurchaseOrder[],
  projectFinance: ProjectFinance | undefined,
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
  let contractTotalValue: number | undefined;
  let suppliedValue: number | undefined;

  if (mode === 'contract_value') {
    // Giá trị hợp đồng: ưu tiên sum(ContractItem.customer.leaf), fallback ProjectFinance.contractValue
    const leafCustomerItems = getLeafItems(customerItems.filter(item => item.contractType === 'customer'));
    const boqTotal = sum(leafCustomerItems, revisedItemValue);
    contractTotalValue = boqTotal > 0 ? boqTotal : Number(projectFinance?.contractValue || 0);

    // Giá trị vật tư đã cấp: PO totalAmount (active statuses)
    const activePOs = purchaseOrders.filter(po => ACTIVE_PO_STATUSES.has(po.status));
    suppliedValue = sum(activePOs, po => po.totalAmount);

    percent = contractTotalValue > 0
      ? Math.round((suppliedValue / contractTotalValue) * 100)
      : 0;
    percent = Math.max(0, Math.min(100, percent));
  } else if (mode === 'budget') {
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
    contractTotalValue,
    suppliedValue,
  };
};

const buildPartyMetric = (
  contractType: ContractItemType,
  contractItems: ContractItem[],
  logs: DailyLog[],
  workBoqItems: ProjectWorkBoqItem[],
  taskLinks: TaskContractItem[],
  acceptances: QuantityAcceptance[],
  certs: PaymentCertificate[],
  advances: AdvancePayment[],
): PartyDashboardMetric => {
  const items = getLeafItems(contractItems.filter(item => item.contractType === contractType));
  const itemMap = new Map(items.map(item => [item.id, item]));
  const workBoqByTaskId = new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.sourceTaskId as string, item.id]));
  const taskByWorkBoqId = new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.id, item.sourceTaskId as string]));
  const factorsByTaskId = buildTaskContractQuantityFactors(taskLinks, new Set(itemMap.keys()))
    .reduce<Map<string, ReturnType<typeof buildTaskContractQuantityFactors>>>((acc, factor) => {
      if (!acc.has(factor.taskId)) acc.set(factor.taskId, []);
      acc.get(factor.taskId)!.push(factor);
      return acc;
    }, new Map());
  const contractValue = sum(items, revisedItemValue);
  const verifiedLogs = getVerifiedLogs(logs);
  const performedFromLogs = verifiedLogs.reduce((total, log) => {
    return total + sum(log.volumes || [], volume => {
      const directItem = volume.contractItemId ? itemMap.get(volume.contractItemId) : undefined;
      if (directItem) return Number(volume.quantity || 0) * Number(directItem.unitPrice || 0);
      const workBoqItemId = volume.workBoqItemId || (volume.taskId ? workBoqByTaskId.get(volume.taskId) : undefined);
      const sourceTaskId = volume.taskId || (workBoqItemId ? taskByWorkBoqId.get(workBoqItemId) : undefined);
      if (!sourceTaskId) return 0;
      return sum(factorsByTaskId.get(sourceTaskId) || [], factor => {
        const item = itemMap.get(factor.contractItemId);
        if (!item) return 0;
        return Number(volume.quantity || 0) * Number(factor.quantityFactor || 0) * Number(item.unitPrice || 0);
      });
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
    purchaseOrders.filter(po => !['cancelled', 'returned'].includes(po.status)),
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

const buildPlannedProgress = (tasks: ProjectTask[], today: string): number => {
  const leafTasks = getLeafProjectTasks(tasks);
  const totalWeight = sum(leafTasks, getTaskProgressWeight);
  if (totalWeight <= 0) return 0;
  const weighted = leafTasks.reduce((total, task) => {
    let planned = 0;
    if (task.startDate && task.endDate) {
      if (today >= task.endDate) planned = 100;
      else if (today <= task.startDate) planned = 0;
      else {
        const duration = Math.max(1, daysBetweenDates(task.startDate, task.endDate) + 1);
        const elapsed = Math.max(0, daysBetweenDates(task.startDate, today) + 1);
        planned = clampProgress((elapsed / duration) * 100);
      }
    }
    return total + planned * getTaskProgressWeight(task);
  }, 0);
  return Math.round(weighted / totalWeight);
};

const buildScheduleHealthMetric = (
  tasks: ProjectTask[],
  progress: ProjectProgressMetric,
  delayEvents: ProjectDelayEvent[],
): ExecutiveScheduleHealthMetric => {
  const today = todayIso();
  const leafTasks = getLeafProjectTasks(tasks);
  const forecast = buildScheduleForecast(tasks, delayEvents);
  const plannedProgress = buildPlannedProgress(tasks, today);
  const progressVariance = Math.round((progress.percent - plannedProgress) * 10) / 10;
  const overdueTasks = leafTasks.filter(task => task.progress < 100 && !!task.endDate && task.endDate < today);
  const upcomingEnd = addDaysIso(today, 10);
  const upcomingDueTasks = leafTasks.filter(task => task.progress < 100 && !!task.endDate && task.endDate >= today && task.endDate <= upcomingEnd);
  const criticalIds = forecast.baseCriticalPath?.criticalPath || [];
  const criticalOverdueTaskCount = overdueTasks.filter(task => criticalIds.includes(task.id) || task.isCritical).length;
  const forecastDeltaDays = forecast.projectEndDeltaDays || 0;
  const status: ExecutiveHealthStatus = forecastDeltaDays > 0 || criticalOverdueTaskCount > 0 || progressVariance <= -10
    ? 'red'
    : forecast.activeDelayEvents.length > 0 || overdueTasks.length > 0 || progressVariance <= -3
      ? 'amber'
      : 'green';

  return {
    status,
    plannedProgress,
    actualProgress: progress.percent,
    progressVariance,
    baselineEndDate: forecast.baseProjectEndDate || maxEndDate(tasks),
    forecastEndDate: forecast.forecastProjectEndDate || maxEndDate(tasks),
    forecastDeltaDays,
    activeDelayEventCount: forecast.activeDelayEvents.length,
    impactedTaskCount: forecast.changedTasks.length,
    overdueTaskCount: overdueTasks.length,
    criticalOverdueTaskCount,
    upcomingDueTaskCount: upcomingDueTasks.length,
  };
};

const paymentGroupKey = (schedule: PaymentSchedule): string =>
  [schedule.type, schedule.contractType || '', schedule.contractId || ''].join('|');

const getPartyMetric = (
  schedule: PaymentSchedule,
  owner: PartyDashboardMetric,
  subcontractor: PartyDashboardMetric,
  supplier: SupplierDashboardMetric,
): {
  party: ExecutivePaymentParty;
  label: string;
  performedValue: number;
  acceptedValue: number;
  certifiedValue: number;
  paidValue: number;
} => {
  if (schedule.type === 'receivable' || schedule.contractType === 'customer') {
    return {
      party: 'owner',
      label: 'Chủ đầu tư',
      performedValue: owner.performedValue,
      acceptedValue: owner.acceptedValue,
      certifiedValue: owner.paymentRequested,
      paidValue: owner.actualPaid,
    };
  }
  if (schedule.contractType === 'subcontractor') {
    return {
      party: 'subcontractor',
      label: 'Thầu phụ',
      performedValue: subcontractor.performedValue,
      acceptedValue: subcontractor.acceptedValue,
      certifiedValue: subcontractor.paymentRequested,
      paidValue: subcontractor.actualPaid,
    };
  }
  return {
    party: 'supplier',
    label: 'Nhà cung cấp',
    performedValue: supplier.paymentRequested,
    acceptedValue: supplier.paymentRequested,
    certifiedValue: supplier.paymentRequested,
    paidValue: supplier.actualPaid,
  };
};

const buildPaymentPeriodRisks = (
  paymentSchedules: PaymentSchedule[],
  owner: PartyDashboardMetric,
  subcontractor: PartyDashboardMetric,
  supplier: SupplierDashboardMetric,
): ExecutivePaymentPeriodRisk[] => {
  const today = todayIso();
  const horizon = addDaysIso(today, 10);
  const openSchedules = paymentSchedules
    .filter(schedule => schedule.status !== 'paid')
    .filter(schedule => schedule.dueDate && schedule.dueDate <= horizon)
    .filter(schedule => schedule.type === 'receivable' || schedule.contractType === 'subcontractor' || schedule.type === 'payable');

  return openSchedules.map(schedule => {
    const partyMetric = getPartyMetric(schedule, owner, subcontractor, supplier);
    const key = paymentGroupKey(schedule);
    const targetCumulative = sum(
      paymentSchedules.filter(item => paymentGroupKey(item) === key && item.dueDate <= schedule.dueDate),
      item => item.amount,
    );

    let blockingStage: ExecutivePaymentBlockingStage = 'none';
    let missingAmount = 0;
    if (partyMetric.performedValue < targetCumulative) {
      blockingStage = 'production';
      missingAmount = targetCumulative - partyMetric.performedValue;
    } else if (partyMetric.acceptedValue < targetCumulative) {
      blockingStage = 'acceptance';
      missingAmount = targetCumulative - partyMetric.acceptedValue;
    } else if (partyMetric.certifiedValue < targetCumulative) {
      blockingStage = 'certificate';
      missingAmount = targetCumulative - partyMetric.certifiedValue;
    } else if (partyMetric.paidValue < targetCumulative) {
      blockingStage = 'cash';
      missingAmount = targetCumulative - partyMetric.paidValue;
    }

    const daysUntilDue = daysBetweenDates(today, schedule.dueDate);
    const isOverdue = daysUntilDue < 0 || schedule.status === 'overdue';
    const severity: ExecutiveAlertSeverity = blockingStage === 'none'
      ? 'info'
      : isOverdue || daysUntilDue <= 3
        ? 'critical'
        : 'warning';
    const recommendationByStage: Record<ExecutivePaymentBlockingStage, string> = {
      none: 'Đủ điều kiện theo dữ liệu hiện có; theo dõi thu/chi đúng hạn.',
      production: partyMetric.party === 'subcontractor'
        ? 'Không thanh toán đủ kỳ; chỉ xem xét phần đã có khối lượng/tiến độ thực tế.'
        : 'Cần đẩy sản lượng/khối lượng thi công trước kỳ thanh toán.',
      acceptance: 'Cần hoàn tất nghiệm thu khối lượng trước khi lập/thực hiện thanh toán.',
      certificate: 'Cần lập hoặc gửi chứng từ thanh toán cho phần đã nghiệm thu.',
      cash: partyMetric.party === 'owner'
        ? 'Cần theo dõi thu tiền từ CĐT theo chứng từ đã đủ điều kiện.'
        : 'Cần chuẩn bị dòng tiền trả theo phần đã đủ hồ sơ.',
    };

    return {
      id: schedule.id,
      party: partyMetric.party,
      label: partyMetric.label,
      description: schedule.description,
      dueDate: schedule.dueDate,
      daysUntilDue,
      targetCumulative,
      performedValue: partyMetric.performedValue,
      acceptedValue: partyMetric.acceptedValue,
      certifiedValue: partyMetric.certifiedValue,
      paidValue: partyMetric.paidValue,
      blockingStage,
      missingAmount: clampMoney(missingAmount),
      severity,
      recommendation: recommendationByStage[blockingStage],
    };
  }).sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.dueDate.localeCompare(b.dueDate));
};

const buildApprovalQueueMetric = (
  tasks: ProjectTask[],
  logs: DailyLog[],
  completionRequests: ProjectTaskCompletionRequest[],
  acceptances: QuantityAcceptance[],
  certs: PaymentCertificate[],
  variations: ContractVariation[],
  reconciliationGroups: BoqReconciliationGroup[],
): ExecutiveApprovalQueueMetric => {
  const queue = {
    dailyLogSubmitted: logs.filter(log => log.status === 'submitted').length,
    taskCompletionSubmitted: completionRequests.filter(req => ['submitted', 'verified'].includes(req.status)).length,
    taskGatePending: tasks.filter(task => task.gateStatus === 'pending' || (task.progress >= 100 && (!task.gateStatus || task.gateStatus === 'none'))).length,
    quantityAcceptanceSubmitted: acceptances.filter(item => item.status === 'submitted').length,
    paymentCertificateSubmitted: certs.filter(cert => cert.status === 'submitted').length,
    variationSubmitted: variations.filter(item => item.status === 'submitted').length,
    reconciliationSubmitted: reconciliationGroups.filter(item => item.status === 'submitted').length,
    total: 0,
  };
  queue.total =
    queue.dailyLogSubmitted +
    queue.taskCompletionSubmitted +
    queue.taskGatePending +
    queue.quantityAcceptanceSubmitted +
    queue.paymentCertificateSubmitted +
    queue.variationSubmitted +
    queue.reconciliationSubmitted;
  return queue;
};

const buildPriorityAlerts = (
  scheduleHealth: ExecutiveScheduleHealthMetric,
  paymentPeriodRisks: ExecutivePaymentPeriodRisk[],
  approvalQueue: ExecutiveApprovalQueueMetric,
  sourceWarnings: string[],
): ExecutivePriorityAlert[] => {
  const alerts: ExecutivePriorityAlert[] = [];
  if (scheduleHealth.status === 'red') {
    alerts.push({
      id: 'schedule-red',
      severity: 'critical',
      title: 'Tiến độ cần can thiệp',
      message: `Actual ${scheduleHealth.actualProgress}% so với kế hoạch ${scheduleHealth.plannedProgress}%. ${scheduleHealth.criticalOverdueTaskCount} hạng mục critical quá hạn, forecast ${scheduleHealth.forecastDeltaDays > 0 ? `trễ ${scheduleHealth.forecastDeltaDays} ngày` : 'chưa kéo dài'}.`,
      targetTab: 'gantt',
    });
  } else if (scheduleHealth.status === 'amber') {
    alerts.push({
      id: 'schedule-amber',
      severity: 'warning',
      title: 'Tiến độ có dấu hiệu lệch',
      message: `${scheduleHealth.overdueTaskCount} hạng mục quá hạn, ${scheduleHealth.activeDelayEventCount} sự kiện chậm đang ảnh hưởng forecast.`,
      targetTab: 'gantt',
    });
  }

  paymentPeriodRisks
    .filter(risk => risk.severity === 'critical' || risk.severity === 'warning')
    .slice(0, 5)
    .forEach(risk => {
      alerts.push({
        id: `payment-${risk.id}`,
        severity: risk.severity,
        title: `${risk.label}: ${risk.description}`,
        message: `${risk.daysUntilDue < 0 ? `Quá hạn ${Math.abs(risk.daysUntilDue)} ngày` : `Còn ${risk.daysUntilDue} ngày`} · thiếu ${Math.round(risk.missingAmount).toLocaleString('vi-VN')} đ tại bước ${risk.blockingStage}. ${risk.recommendation}`,
        targetTab: risk.party === 'owner' ? 'contract' : 'subcontract',
        dueDate: risk.dueDate,
        amount: risk.missingAmount,
      });
    });

  if (approvalQueue.total > 0) {
    alerts.push({
      id: 'approval-queue',
      severity: approvalQueue.total >= 5 ? 'warning' : 'info',
      title: 'Có chứng từ đang chờ xử lý',
      message: `${approvalQueue.total} nhật ký/chứng từ/hạng mục đang ở bước submitted/pending.`,
      targetTab: 'executive',
    });
  }

  if (sourceWarnings.length > 0) {
    alerts.push({
      id: 'data-source-warning',
      severity: 'info',
      title: 'Một số nguồn dữ liệu chưa đọc được',
      message: `${sourceWarnings.length} nguồn dữ liệu fallback. Xem ghi chú dữ liệu để kiểm tra Supabase/RLS.`,
    });
  }

  return alerts
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 8);
};

const buildExecutiveMetric = (
  tasks: ProjectTask[],
  logs: DailyLog[],
  completionRequests: ProjectTaskCompletionRequest[],
  acceptances: QuantityAcceptance[],
  certs: PaymentCertificate[],
  variations: ContractVariation[],
  reconciliationGroups: BoqReconciliationGroup[],
  paymentSchedules: PaymentSchedule[],
  delayEvents: ProjectDelayEvent[],
  progress: ProjectProgressMetric,
  owner: PartyDashboardMetric,
  subcontractor: PartyDashboardMetric,
  supplier: SupplierDashboardMetric,
  sourceWarnings: string[],
): ExecutiveDashboardMetric => {
  const scheduleHealth = buildScheduleHealthMetric(tasks, progress, delayEvents);
  const paymentPeriodRisks = buildPaymentPeriodRisks(paymentSchedules, owner, subcontractor, supplier);
  const approvalQueue = buildApprovalQueueMetric(tasks, logs, completionRequests, acceptances, certs, variations, reconciliationGroups);
  const priorityAlerts = buildPriorityAlerts(scheduleHealth, paymentPeriodRisks, approvalQueue, sourceWarnings);
  return {
    scheduleHealth,
    paymentPeriodRisks,
    approvalQueue,
    priorityAlerts,
  };
};

const getScopeKey = (projectId: string | undefined, constructionSiteId: string): string => {
  if (projectId && constructionSiteId) return `${projectId}_${constructionSiteId}`;
  return projectId || constructionSiteId;
};

export const projectDashboardMetricsService = {
  async getSnapshot(projectId: string | undefined, constructionSiteId: string): Promise<ProjectDashboardMetrics | null> {
    const scopeKey = getScopeKey(projectId, constructionSiteId);

    // Try Supabase first
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('project_dashboard_snapshots')
          .select('metrics')
          .eq('scope_key', scopeKey)
          .maybeSingle();

        if (error) throw error;
        if (data?.metrics) {
          return data.metrics as ProjectDashboardMetrics;
        }
      } catch (err) {
        console.warn('Failed to load dashboard snapshot from Supabase:', err);
      }
    }

    // Fallback to localStorage
    try {
      const cached = localStorage.getItem(`vioo_dashboard_snapshot_${scopeKey}`);
      if (cached) {
        return JSON.parse(cached) as ProjectDashboardMetrics;
      }
    } catch (err) {
      console.warn('Failed to load dashboard snapshot from localStorage:', err);
    }

    return null;
  },

  async saveSnapshot(projectId: string | undefined, constructionSiteId: string, metrics: ProjectDashboardMetrics): Promise<boolean> {
    const scopeKey = getScopeKey(projectId, constructionSiteId);

    // Try saving to Supabase
    let supabaseOk = false;
    if (isSupabaseConfigured) {
      try {
        const payload = {
          scope_key: scopeKey,
          project_id: projectId || null,
          construction_site_id: constructionSiteId || null,
          metrics,
          calculated_at: metrics.calculatedAt,
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('project_dashboard_snapshots')
          .upsert(payload, { onConflict: 'scope_key' });

        if (error) throw error;
        supabaseOk = true;
      } catch (err) {
        console.warn('Failed to save dashboard snapshot to Supabase:', err);
      }
    }

    // Save to localStorage regardless (for local copy/cache)
    try {
      localStorage.setItem(`vioo_dashboard_snapshot_${scopeKey}`, JSON.stringify(metrics));
    } catch (err) {
      console.warn('Failed to save dashboard snapshot to localStorage:', err);
    }

    return supabaseOk || !isSupabaseConfigured;
  },

  async getMetrics(params: { projectId?: string; constructionSiteId: string }): Promise<ProjectDashboardMetrics> {
    const warnings: string[] = [];
    const sourceNotes = [
      'Dữ liệu chủ đầu tư và nhà thầu ưu tiên BOQ, nghiệm thu, chứng chỉ thanh toán, tạm ứng.',
      'Khối lượng thi công từ Daily Log chỉ quy đổi sang BOQ hợp đồng qua nhóm đối chiếu đã rà soát/khóa.',
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
    const constructionSite = project?.constructionSiteId || params.constructionSiteId;

    const [
      tasks,
      logs,
      workBoqItems,
      customerItems,
      subcontractorItems,
      taskLinks,
      completionRequests,
      acceptances,
      certs,
      advances,
      transactions,
      purchaseOrders,
      materialBudgets,
      paymentSchedules,
      delayEvents,
      variations,
      reconciliationGroups,
      financialKPIs,
    ] = await Promise.all([
      safeLoad('project_tasks', warnings, () => taskService.list(projectScopeId, constructionSite), [] as ProjectTask[]),
      safeLoad('daily_logs', warnings, () => dailyLogService.list(projectScopeId, constructionSite), [] as DailyLog[]),
      safeLoad('project_work_boq_items', warnings, () => workBoqService.list(projectScopeId, constructionSite), [] as ProjectWorkBoqItem[]),
      safeLoad('contract_items customer', warnings, () => contractItemService.listBySite(projectScopeId, 'customer', constructionSite), [] as ContractItem[]),
      safeLoad('contract_items subcontractor', warnings, () => contractItemService.listBySite(projectScopeId, 'subcontractor', constructionSite), [] as ContractItem[]),
      safeLoad('task_contract_items', warnings, () => taskContractItemService.listBySite(projectScopeId, constructionSite), [] as TaskContractItem[]),
      safeLoad('project_task_completion_requests', warnings, () => taskCompletionRequestService.list(projectScopeId, constructionSite), [] as ProjectTaskCompletionRequest[]),
      safeLoad('quantity_acceptances', warnings, () => quantityAcceptanceService.listBySite(constructionSite, undefined, project?.id || params.projectId), [] as QuantityAcceptance[]),
      safeLoad('payment_certificates', warnings, () => paymentCertificateService.listBySite(constructionSite, project?.id || params.projectId), [] as PaymentCertificate[]),
      safeLoad('advance_payments', warnings, () => advancePaymentService.listBySite(constructionSite, project?.id || params.projectId), [] as AdvancePayment[]),
      safeLoad('project_transactions', warnings, () => listTransactions(projectScopeId, constructionSite), [] as ProjectTransaction[]),
      safeLoad('purchase_orders', warnings, () => poService.list(projectScopeId, constructionSite), [] as PurchaseOrder[]),
      safeLoad('material_budget_items', warnings, () => boqService.list(projectScopeId, constructionSite), [] as MaterialBudgetItem[]),
      safeLoad('payment_schedules', warnings, () => paymentService.list(projectScopeId, constructionSite), [] as PaymentSchedule[]),
      safeLoad('project_delay_events', warnings, () => delayEventService.list(projectScopeId, constructionSite), [] as ProjectDelayEvent[]),
      safeLoad('contract_variations', warnings, () => listContractVariations(projectScopeId, constructionSite), [] as ContractVariation[]),
      safeLoad('boq_reconciliation submitted', warnings, () => boqReconciliationService.listByProject(projectScopeId, constructionSite), [] as BoqReconciliationGroup[]),
      safeLoad('financial_kpis', warnings, () => projectFinancialService.getKPIs(constructionSite, [], project?.id || params.projectId), undefined as ProjectFinancialKPIs | undefined),
    ]);

    const allContractItems = [...customerItems, ...subcontractorItems];
    const owner = buildPartyMetric('customer', allContractItems, logs, workBoqItems, taskLinks, acceptances, certs, advances);
    const subcontractor = buildPartyMetric('subcontractor', allContractItems, logs, workBoqItems, taskLinks, acceptances, certs, advances);
    const supplier = buildSupplierMetric(purchaseOrders, transactions);
    const cashFlow = buildCashFlowMetric(transactions, paymentSchedules, owner, subcontractor, supplier);
    const constructionCost = buildConstructionCostMetric(owner, subcontractor, supplier, transactions);
    const material = buildMaterialMetric(materialBudgets, purchaseOrders);
    const sevenDayForecast = buildSevenDayForecastMetric(tasks);
    const finance = await safeLoad('project_finance', warnings, async () => {
      if (!isSupabaseConfigured) return undefined;
      let query = supabase.from('project_finances').select('*').limit(1);
      if (project?.id) query = query.eq('project_id', project.id);
      else query = query.eq('constructionSiteId', constructionSite);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data ? fromDb(data) as ProjectFinance : undefined;
    }, undefined as ProjectFinance | undefined);
    const progress = buildProgressMetric(project, tasks, taskLinks, customerItems, purchaseOrders, finance);
    const executive = buildExecutiveMetric(
      tasks,
      logs,
      completionRequests,
      acceptances,
      certs,
      variations,
      reconciliationGroups,
      paymentSchedules,
      delayEvents,
      progress,
      owner,
      subcontractor,
      supplier,
      warnings,
    );

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
      executive,
      sourceNotes,
      warnings,
      calculatedAt: new Date().toISOString(),
    };
  },
};
