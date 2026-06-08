import {
  ContractItem,
  ContractItemType,
  CustomerContract,
  DailyLog,
  DailyLogVolume,
  PaymentCertificate,
  PaymentEligibilityBlockReason,
  PaymentEligibilityNextAction,
  PaymentEligibilityRow,
  PaymentEligibilitySourceDocument,
  PaymentEligibilitySourceLog,
  PaymentEligibilityStatus,
  PaymentEligibilityWorkbench,
  ProjectTask,
  ProjectWorkBoqItem,
  QuantityAcceptance,
  SubcontractorContract,
} from '../types';
import { contractItemService } from './contractItemService';
import { dailyLogDetailService } from './dailyLogDetailService';
import { fromDb } from './dbMapping';
import { customerContractService, subcontractorContractService } from './hdService';
import { paymentCertificateService as certificateService } from './paymentCertificateService';
import { quantityAcceptanceService } from './quantityAcceptanceService';
import { supabase } from './supabase';
import { buildTaskContractQuantityFactors, taskContractItemService } from './taskContractItemService';
import { taskService, workBoqService } from './projectService';
import { getProjectTaskStatus } from './projectScheduleRules';

export type PaymentEligibilityContractTypeFilter = ContractItemType | 'all';
export type PaymentEligibilityStatusFilter = PaymentEligibilityStatus | PaymentEligibilityBlockReason | 'all';

export interface PaymentEligibilityWorkbenchParams {
  projectId?: string | null;
  constructionSiteId: string;
  contractType?: PaymentEligibilityContractTypeFilter;
  contractId?: string;
  periodStart?: string;
  periodEnd?: string;
  status?: PaymentEligibilityStatusFilter;
  search?: string;
}

type ContractMeta = {
  id: string;
  type: ContractItemType;
  code?: string;
  name?: string;
  counterpartyName?: string;
};

type LineAccumulator = {
  quantity: number;
  amount: number;
  logs: PaymentEligibilitySourceLog[];
  docs: PaymentEligibilitySourceDocument[];
};

const EPSILON = 1;
const CONTRACT_ACCEPTANCE_STATUSES = new Set(['approved']);
const CERTIFIED_STATUSES = new Set(['approved', 'paid']);
const PENDING_CERTIFICATE_STATUSES = new Set(['draft', 'submitted', 'returned']);

const emptyLine = (): LineAccumulator => ({ quantity: 0, amount: 0, logs: [], docs: [] });
const money = (value?: number | null) => Math.round(Number(value || 0));
const positive = (value?: number | null) => Math.max(0, Number(value || 0));
const lower = (value?: string | null) => (value || '').toLowerCase();
const todayIso = () => new Date().toISOString().slice(0, 10);

const addToMap = (
  map: Map<string, LineAccumulator>,
  key: string,
  quantity: number,
  amount: number,
  logs: PaymentEligibilitySourceLog[] = [],
  docs: PaymentEligibilitySourceDocument[] = [],
) => {
  const row = map.get(key) || emptyLine();
  row.quantity += positive(quantity);
  row.amount += money(amount);
  row.logs.push(...logs);
  row.docs.push(...docs);
  map.set(key, row);
};

const buildContractMeta = (
  customers: CustomerContract[],
  subcontractors: SubcontractorContract[],
): Map<string, ContractMeta> => {
  const map = new Map<string, ContractMeta>();
  customers.forEach(contract => {
    map.set(`customer:${contract.id}`, {
      id: contract.id,
      type: 'customer',
      code: contract.code,
      name: contract.name,
      counterpartyName: contract.customerName,
    });
  });
  subcontractors.forEach(contract => {
    map.set(`subcontractor:${contract.id}`, {
      id: contract.id,
      type: 'subcontractor',
      code: contract.code,
      name: contract.name,
      counterpartyName: contract.subcontractorName,
    });
  });
  return map;
};

const getContractAmount = (item: ContractItem) =>
  money(item.revisedTotalPrice ?? item.totalPrice ?? positive(item.revisedQuantity ?? item.quantity) * positive(item.revisedUnitPrice ?? item.unitPrice));

const getContractQty = (item: ContractItem) => positive(item.revisedQuantity ?? item.quantity);
const getUnitPrice = (item: ContractItem) => positive(item.revisedUnitPrice ?? item.unitPrice);
const getContractKey = (type: ContractItemType, id?: string | null) => `${type}:${id || ''}`;

const getRowTaskStatus = (task?: ProjectTask) => task ? getProjectTaskStatus(task, todayIso()) : null;

const getTaskLabel = (task?: ProjectTask, workBoq?: ProjectWorkBoqItem | null) => {
  if (workBoq?.wbsCode || workBoq?.name) return `${workBoq.wbsCode ? `${workBoq.wbsCode} - ` : ''}${workBoq.name}`;
  if (task?.wbsCode || task?.name) return `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`;
  return 'Chưa gắn tiến độ';
};

const getBlockLabel = (
  reason: PaymentEligibilityBlockReason,
  amount: number,
  eligibleAmount: number,
  cashflowSynced: boolean,
) => {
  const prefix = eligibleAmount > EPSILON && amount > EPSILON
    ? `${money(eligibleAmount).toLocaleString('vi-VN')} đ đủ lập chứng chỉ; `
    : '';
  switch (reason) {
    case 'eligible':
      return amount > EPSILON ? `${prefix}${money(amount).toLocaleString('vi-VN')} đ còn bị chặn bởi nghiệm thu CĐT` : 'Đủ điều kiện lập chứng chỉ';
    case 'missing_verified_log':
      return 'Chưa có nhật ký verified';
    case 'missing_internal_acceptance':
      return 'Chưa nghiệm thu nội bộ';
    case 'missing_contract_acceptance':
      return 'Chưa nghiệm thu CĐT';
    case 'missing_task_contract_link':
      return 'Task/khối lượng chưa gắn BOQ hợp đồng trong tiến độ';
    case 'over_boq':
      return 'Vượt BOQ hiệu lực, cần phát sinh/phụ lục';
    case 'certificate_pending':
      return 'Đã lập chứng chỉ, đang chờ duyệt/xử lý';
    case 'payment_pending':
      return cashflowSynced ? 'Đã duyệt chứng chỉ, chờ thanh toán' : 'Đã paid nhưng chưa thấy giao dịch dòng tiền';
    case 'fully_paid':
      return 'Đã thanh toán hết';
    case 'cashflow_unsynced':
      return 'Đã thanh toán nhưng chưa đối soát dòng tiền';
    default:
      return 'Cần kiểm tra';
  }
};

const getNextAction = (reason: PaymentEligibilityBlockReason, eligibleAmount: number, taskId?: string | null): PaymentEligibilityNextAction => {
  if (eligibleAmount > EPSILON) return 'create_certificate';
  if (reason === 'missing_task_contract_link') return taskId ? 'open_gantt' : 'open_contract';
  if (reason === 'missing_internal_acceptance' || reason === 'missing_contract_acceptance' || reason === 'eligible') return 'create_acceptance';
  if (reason === 'certificate_pending' || reason === 'payment_pending') return 'open_certificate';
  if (reason === 'cashflow_unsynced') return 'open_cashflow';
  return 'none';
};

const getNextActionLabel = (action: PaymentEligibilityNextAction) => {
  switch (action) {
    case 'create_acceptance': return 'Tạo nghiệm thu CĐT';
    case 'create_certificate': return 'Tạo chứng chỉ';
    case 'open_gantt': return 'Mở tiến độ';
    case 'open_contract': return 'Mở hợp đồng';
    case 'open_certificate': return 'Mở chứng chỉ';
    case 'open_cashflow': return 'Mở dòng tiền';
    default: return 'Không cần thao tác';
  }
};

const loadVerifiedLogs = async (params: PaymentEligibilityWorkbenchParams): Promise<DailyLog[]> => {
  let query = supabase
    .from('daily_logs')
    .select('*')
    .eq('status', 'verified')
    .order('date', { ascending: true });
  if (params.periodStart) query = query.gte('date', params.periodStart);
  if (params.periodEnd) query = query.lte('date', params.periodEnd);
  query = params.projectId ? query.eq('project_id', params.projectId) : query.eq('construction_site_id', params.constructionSiteId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(fromDb);
};

const loadPaymentTransactionRefs = async (projectId: string | null | undefined, constructionSiteId: string): Promise<Set<string>> => {
  let query = supabase.from('project_transactions').select('source_ref');
  query = projectId ? query.eq('project_id', projectId) : query.eq('construction_site_id', constructionSiteId);
  const { data, error } = await query;
  if (error) {
    console.warn('Cannot load project payment transactions for eligibility workbench', error.message);
    return new Set();
  }
  return new Set((data || []).map(row => row.source_ref).filter(Boolean));
};

const filterContracts = <T extends { id: string }>(items: T[], contractId?: string) =>
  contractId ? items.filter(item => item.id === contractId) : items;

export const paymentEligibilityService = {
  async getWorkbench(params: PaymentEligibilityWorkbenchParams): Promise<PaymentEligibilityWorkbench> {
    const projectScopeId = params.projectId || params.constructionSiteId;
    const typeFilter = params.contractType || 'customer';
    const includeCustomer = typeFilter === 'all' || typeFilter === 'customer';
    const includeSubcontractor = typeFilter === 'all' || typeFilter === 'subcontractor';

    const [
      customers,
      subcontractors,
      contractItems,
      tasks,
      workBoqItems,
      taskContractLinks,
      verifiedLogs,
      internalAcceptances,
      contractAcceptances,
      paymentCertificates,
      transactionRefs,
    ] = await Promise.all([
      includeCustomer ? customerContractService.listBySite(projectScopeId, params.constructionSiteId).then(rows => filterContracts(rows, params.contractId)) : Promise.resolve([]),
      includeSubcontractor ? subcontractorContractService.listBySite(projectScopeId, params.constructionSiteId).then(rows => filterContracts(rows, params.contractId)) : Promise.resolve([]),
      contractItemService.listBySite(projectScopeId, typeFilter === 'all' ? undefined : typeFilter, params.constructionSiteId),
      taskService.list(projectScopeId, params.constructionSiteId),
      workBoqService.list(projectScopeId, params.constructionSiteId),
      taskContractItemService.listBySite(projectScopeId, params.constructionSiteId),
      loadVerifiedLogs(params),
      quantityAcceptanceService.listBySite(params.constructionSiteId, 'internal', params.projectId || undefined),
      quantityAcceptanceService.listBySite(params.constructionSiteId, 'contract', params.projectId || undefined),
      certificateService.listBySite(params.constructionSiteId, params.projectId || undefined),
      loadPaymentTransactionRefs(params.projectId, params.constructionSiteId),
    ]);

    const contractMeta = buildContractMeta(customers, subcontractors);
    const allowedContractIds = new Set([...customers.map(item => item.id), ...subcontractors.map(item => item.id)]);
    const scopedContractItems = contractItems.filter(item =>
      allowedContractIds.has(item.contractId) &&
      (typeFilter === 'all' || item.contractType === typeFilter) &&
      (!params.contractId || item.contractId === params.contractId)
    );
    const contractItemMap = new Map(scopedContractItems.map(item => [item.id, item]));
    const contractItemIds = new Set(scopedContractItems.map(item => item.id));
    const childContractItemIds = new Set(scopedContractItems.map(item => item.parentId).filter(Boolean) as string[]);
    const taskMap = new Map(tasks.map(item => [item.id, item]));
    const workBoqMap = new Map(workBoqItems.map(item => [item.id, item]));
    const taskToWorkBoq = new Map<string, ProjectWorkBoqItem>();
    workBoqItems.forEach(item => {
      if (item.sourceTaskId) taskToWorkBoq.set(item.sourceTaskId, item);
    });

    const factorsByTaskId = buildTaskContractQuantityFactors(taskContractLinks, contractItemIds).reduce((acc, factor) => {
      if (!acc.has(factor.taskId)) acc.set(factor.taskId, []);
      acc.get(factor.taskId)!.push(factor);
      return acc;
    }, new Map<string, ReturnType<typeof buildTaskContractQuantityFactors>>());

    const primaryTaskByContractItemId = new Map<string, ProjectTask>();
    taskContractLinks.forEach(link => {
      if (!contractItemIds.has(link.contractItemId) || primaryTaskByContractItemId.has(link.contractItemId)) return;
      const task = taskMap.get(link.taskId);
      if (task) primaryTaskByContractItemId.set(link.contractItemId, task);
    });

    const executedByItem = new Map<string, LineAccumulator>();
    const unmappedRows: PaymentEligibilityRow[] = [];
    const detailMap = await dailyLogDetailService.listByLogIds(verifiedLogs.map(log => log.id));

    verifiedLogs.forEach(log => {
      const volumes = detailMap[log.id]?.volumes?.length ? detailMap[log.id].volumes : (log.volumes || []);
      volumes.forEach((volume: DailyLogVolume, sourceIndex) => {
        const quantity = positive(volume.quantity);
        if (quantity <= 0) return;
        const volumeId = (volume as any).id || `${log.id}:${sourceIndex}`;
        const directItemId = volume.contractItemId;
        const workBoqItem = volume.workBoqItemId ? workBoqMap.get(volume.workBoqItemId) : undefined;
        const sourceTaskId = volume.taskId || workBoqItem?.sourceTaskId || undefined;
        const sourceTask = sourceTaskId ? taskMap.get(sourceTaskId) : undefined;
        const sourceLog: PaymentEligibilitySourceLog = {
          id: log.id,
          date: log.date,
          quantity,
          unit: volume.unit,
          taskId: sourceTaskId || null,
          taskName: sourceTask?.name || volume.taskName || null,
          workBoqItemId: volume.workBoqItemId || null,
          workBoqItemName: workBoqItem?.name || volume.workBoqItemName || null,
        };

        if (directItemId && contractItemMap.has(directItemId)) {
          const item = contractItemMap.get(directItemId)!;
          addToMap(executedByItem, directItemId, quantity, quantity * getUnitPrice(item), [{ ...sourceLog, id: volumeId }]);
          return;
        }

        const factors = sourceTaskId ? factorsByTaskId.get(sourceTaskId) || [] : [];
        if (factors.length > 0) {
          factors.forEach(factor => {
            const item = contractItemMap.get(factor.contractItemId);
            if (!item) return;
            const mappedQty = quantity * factor.quantityFactor;
            addToMap(executedByItem, factor.contractItemId, mappedQty, mappedQty * getUnitPrice(item), [{ ...sourceLog, id: volumeId }]);
          });
          return;
        }

        const regionLabel = getTaskLabel(sourceTask, workBoqItem);
        const reason = directItemId && !contractItemMap.has(directItemId)
          ? 'Dòng nhật ký gắn BOQ không thuộc hợp đồng đang lọc'
          : sourceTaskId
            ? 'Task chưa liên kết BOQ hợp đồng trong tiến độ'
            : 'Chưa gắn task/BOQ thi công';
        const blockReason: PaymentEligibilityBlockReason = 'missing_task_contract_link';
        const nextAction = getNextAction(blockReason, 0, sourceTaskId);
        unmappedRows.push({
          id: `unmapped:${log.id}:${sourceIndex}`,
          status: 'blocked',
          contractType: typeFilter === 'subcontractor' ? 'subcontractor' : 'customer',
          boqCode: 'Chưa map BOQ',
          boqName: reason,
          regionLabel,
          taskId: sourceTaskId || null,
          taskName: sourceTask?.name || volume.taskName || null,
          taskWbsCode: sourceTask?.wbsCode || null,
          taskProgress: sourceTask?.progress ?? null,
          taskStatus: getRowTaskStatus(sourceTask),
          taskStartDate: sourceTask?.startDate || null,
          taskEndDate: sourceTask?.endDate || null,
          taskActualStartDate: sourceTask?.actualStartDate || null,
          taskActualEndDate: sourceTask?.actualEndDate || null,
          taskIsCritical: !!sourceTask?.isCritical,
          taskIsOverdue: getRowTaskStatus(sourceTask) === 'overdue',
          unit: volume.unit,
          unitPrice: 0,
          contractQuantity: 0,
          revisedContractQuantity: 0,
          contractAmount: 0,
          executedQuantity: quantity,
          executedAmount: 0,
          internalAcceptedQuantity: 0,
          internalAcceptedAmount: 0,
          contractAcceptedQuantity: 0,
          contractAcceptedAmount: 0,
          certifiedQuantity: 0,
          certifiedAmount: 0,
          pendingCertifiedAmount: 0,
          paidQuantity: 0,
          paidAmount: 0,
          payableRemainingAmount: 0,
          certifiableRemainingAmount: 0,
          blockedAmount: 0,
          blockReason,
          blockLabel: getBlockLabel(blockReason, 0, 0, true),
          nextAction,
          nextActionLabel: getNextActionLabel(nextAction),
          cashflowSynced: true,
          sourceLogs: [{ ...sourceLog, id: volumeId, reason }],
          sourceDocuments: [],
        });
      });
    });

    const internalAcceptedByItem = new Map<string, LineAccumulator>();
    internalAcceptances.filter(item => CONTRACT_ACCEPTANCE_STATUSES.has(item.status)).forEach(acceptance => {
      acceptance.items.forEach(item => {
        const sourceTaskId = item.taskId || (item.workBoqItemId ? workBoqMap.get(item.workBoqItemId)?.sourceTaskId : undefined);
        const factors = sourceTaskId ? factorsByTaskId.get(sourceTaskId) || [] : [];
        const doc: PaymentEligibilitySourceDocument = {
          id: acceptance.id,
          type: 'internal_acceptance',
          label: `Nội bộ đợt ${acceptance.periodNumber}`,
          status: acceptance.status,
          periodNumber: acceptance.periodNumber,
          amount: money(item.acceptedAmount),
          quantity: positive(item.acceptedQuantity),
        };
        if (item.contractItemId && contractItemMap.has(item.contractItemId)) {
          addToMap(internalAcceptedByItem, item.contractItemId, item.acceptedQuantity, item.acceptedAmount, [], [doc]);
          return;
        }
        factors.forEach(factor => {
          addToMap(internalAcceptedByItem, factor.contractItemId, positive(item.acceptedQuantity) * factor.quantityFactor, money(item.acceptedAmount) * factor.quantityFactor, [], [doc]);
        });
      });
    });

    const contractAcceptedByItem = new Map<string, LineAccumulator>();
    contractAcceptances.filter(item => CONTRACT_ACCEPTANCE_STATUSES.has(item.status)).forEach(acceptance => {
      if (typeFilter !== 'all' && acceptance.contractType !== typeFilter) return;
      if (params.contractId && acceptance.contractId !== params.contractId) return;
      acceptance.items.forEach(item => {
        if (!item.contractItemId || !contractItemMap.has(item.contractItemId)) return;
        addToMap(contractAcceptedByItem, item.contractItemId, item.acceptedQuantity, item.acceptedAmount, [], [{
          id: acceptance.id,
          type: 'contract_acceptance',
          label: `CĐT đợt ${acceptance.periodNumber}`,
          status: acceptance.status,
          periodNumber: acceptance.periodNumber,
          amount: money(item.acceptedAmount),
          quantity: positive(item.acceptedQuantity),
        }]);
      });
    });

    const certifiedByItem = new Map<string, LineAccumulator>();
    const pendingCertifiedByItem = new Map<string, LineAccumulator>();
    const paidByItem = new Map<string, LineAccumulator>();
    const paidCertIdsByItem = new Map<string, Set<string>>();

    paymentCertificates.forEach((cert: PaymentCertificate) => {
      if (typeFilter !== 'all' && cert.contractType !== typeFilter) return;
      if (params.contractId && cert.contractId !== params.contractId) return;
      if (cert.status === 'cancelled') return;
      cert.items.forEach(item => {
        if (!contractItemMap.has(item.contractItemId)) return;
        const doc: PaymentEligibilitySourceDocument = {
          id: cert.id,
          type: 'payment_certificate',
          label: `Chứng chỉ đợt ${cert.periodNumber}`,
          status: cert.status,
          periodNumber: cert.periodNumber,
          amount: money(item.currentAmount),
          quantity: positive(item.currentQuantity),
        };
        if (CERTIFIED_STATUSES.has(cert.status)) {
          addToMap(certifiedByItem, item.contractItemId, item.currentQuantity, item.currentAmount, [], [doc]);
        }
        if (PENDING_CERTIFICATE_STATUSES.has(cert.status)) {
          addToMap(pendingCertifiedByItem, item.contractItemId, item.currentQuantity, item.currentAmount, [], [doc]);
        }
        if (cert.status === 'paid') {
          addToMap(paidByItem, item.contractItemId, item.currentQuantity, item.currentAmount, [], [doc]);
          const set = paidCertIdsByItem.get(item.contractItemId) || new Set<string>();
          set.add(cert.id);
          paidCertIdsByItem.set(item.contractItemId, set);
        }
      });
    });

    const rowItemIds = new Set<string>();
    scopedContractItems.forEach(item => {
      const hasActivity = executedByItem.has(item.id) || internalAcceptedByItem.has(item.id) || contractAcceptedByItem.has(item.id) || certifiedByItem.has(item.id) || pendingCertifiedByItem.has(item.id) || paidByItem.has(item.id);
      if (!childContractItemIds.has(item.id) || hasActivity) rowItemIds.add(item.id);
    });

    const rows: PaymentEligibilityRow[] = Array.from(rowItemIds).map(contractItemId => {
      const item = contractItemMap.get(contractItemId)!;
      const contract = contractMeta.get(getContractKey(item.contractType, item.contractId));
      const task = primaryTaskByContractItemId.get(contractItemId);
      const workBoq = task?.id ? taskToWorkBoq.get(task.id) : undefined;
      const executed = executedByItem.get(contractItemId) || emptyLine();
      const internalAccepted = internalAcceptedByItem.get(contractItemId) || emptyLine();
      const contractAccepted = contractAcceptedByItem.get(contractItemId) || emptyLine();
      const certified = certifiedByItem.get(contractItemId) || emptyLine();
      const pendingCertified = pendingCertifiedByItem.get(contractItemId) || emptyLine();
      const paid = paidByItem.get(contractItemId) || emptyLine();
      const contractAmount = getContractAmount(item);
      const acceptedCeiling = contractAmount > 0 ? Math.min(contractAccepted.amount, contractAmount) : contractAccepted.amount;
      const executedCeiling = contractAmount > 0 ? Math.min(executed.amount, contractAmount) : executed.amount;
      const payableRemainingAmount = Math.max(0, acceptedCeiling - paid.amount);
      const certifiableRemainingAmount = Math.max(0, acceptedCeiling - certified.amount - pendingCertified.amount);
      const blockedByContractAcceptance = Math.max(0, executedCeiling - contractAccepted.amount);
      const overBoqAmount = contractAmount > 0 ? Math.max(0, contractAccepted.amount - contractAmount) : 0;
      const paidCertIds = paidCertIdsByItem.get(contractItemId) || new Set<string>();
      const cashflowSynced = Array.from(paidCertIds).every(certId => transactionRefs.has(`payment_certificate:${certId}`));

      let blockReason: PaymentEligibilityBlockReason = 'eligible';
      let blockedAmount = blockedByContractAcceptance;
      if (executed.amount <= EPSILON && contractAccepted.amount <= EPSILON && paid.amount <= EPSILON) {
        blockReason = 'missing_verified_log';
        blockedAmount = contractAmount;
      } else if (overBoqAmount > EPSILON) {
        blockReason = 'over_boq';
        blockedAmount = overBoqAmount;
      } else if (internalAccepted.amount <= EPSILON && contractAccepted.amount <= EPSILON && executed.amount > EPSILON) {
        blockReason = 'missing_internal_acceptance';
        blockedAmount = executed.amount;
      } else if (contractAccepted.amount <= EPSILON && executed.amount > EPSILON) {
        blockReason = 'missing_contract_acceptance';
        blockedAmount = executed.amount;
      } else if (pendingCertified.amount > EPSILON && certifiableRemainingAmount <= EPSILON) {
        blockReason = 'certificate_pending';
        blockedAmount = pendingCertified.amount;
      } else if (!cashflowSynced) {
        blockReason = 'cashflow_unsynced';
        blockedAmount = paid.amount;
      } else if (certified.amount > paid.amount + EPSILON && payableRemainingAmount > EPSILON && certifiableRemainingAmount <= EPSILON) {
        blockReason = 'payment_pending';
        blockedAmount = payableRemainingAmount;
      } else if (payableRemainingAmount <= EPSILON && contractAccepted.amount > EPSILON) {
        blockReason = 'fully_paid';
        blockedAmount = 0;
      } else if (blockedByContractAcceptance > EPSILON) {
        blockReason = 'eligible';
        blockedAmount = blockedByContractAcceptance;
      }

      const status: PaymentEligibilityStatus = blockReason === 'fully_paid'
        ? 'paid'
        : (blockReason === 'certificate_pending' || blockReason === 'payment_pending' || blockReason === 'cashflow_unsynced')
          ? 'pending'
          : certifiableRemainingAmount > EPSILON
            ? 'eligible'
            : blockReason === 'eligible'
              ? 'blocked'
              : 'blocked';
      const nextAction = getNextAction(blockReason, certifiableRemainingAmount, task?.id);

      return {
        id: `boq:${contractItemId}`,
        status,
        contractId: item.contractId,
        contractType: item.contractType,
        contractCode: contract?.code,
        contractName: contract?.name,
        counterpartyName: contract?.counterpartyName,
        contractItemId,
        boqCode: item.code,
        boqName: item.name,
        regionLabel: getTaskLabel(task, workBoq),
        taskId: task?.id || null,
        taskName: task?.name || null,
        taskWbsCode: task?.wbsCode || null,
        taskProgress: task?.progress ?? null,
        taskStatus: getRowTaskStatus(task),
        taskStartDate: task?.startDate || null,
        taskEndDate: task?.endDate || null,
        taskActualStartDate: task?.actualStartDate || null,
        taskActualEndDate: task?.actualEndDate || null,
        taskIsCritical: !!task?.isCritical,
        taskIsOverdue: getRowTaskStatus(task) === 'overdue',
        unit: item.unit,
        unitPrice: getUnitPrice(item),
        contractQuantity: positive(item.quantity),
        revisedContractQuantity: getContractQty(item),
        contractAmount,
        executedQuantity: executed.quantity,
        executedAmount: executed.amount,
        internalAcceptedQuantity: internalAccepted.quantity,
        internalAcceptedAmount: internalAccepted.amount,
        contractAcceptedQuantity: contractAccepted.quantity,
        contractAcceptedAmount: contractAccepted.amount,
        certifiedQuantity: certified.quantity,
        certifiedAmount: certified.amount,
        pendingCertifiedAmount: pendingCertified.amount,
        paidQuantity: paid.quantity,
        paidAmount: paid.amount,
        payableRemainingAmount,
        certifiableRemainingAmount,
        blockedAmount,
        blockReason,
        blockLabel: getBlockLabel(blockReason, blockedAmount, certifiableRemainingAmount, cashflowSynced),
        nextAction,
        nextActionLabel: getNextActionLabel(nextAction),
        cashflowSynced,
        sourceLogs: executed.logs,
        sourceDocuments: [...internalAccepted.docs, ...contractAccepted.docs, ...certified.docs, ...pendingCertified.docs, ...paid.docs],
      };
    });

    const allRows = [...rows, ...unmappedRows];
    const query = lower(params.search?.trim());
    const filtered = allRows.filter(row => {
      if (query) {
        const text = lower([
          row.contractCode,
          row.contractName,
          row.counterpartyName,
          row.boqCode,
          row.boqName,
          row.regionLabel,
          row.taskWbsCode,
          row.taskName,
          row.blockLabel,
        ].filter(Boolean).join(' '));
        if (!text.includes(query)) return false;
      }
      if (params.status && params.status !== 'all') {
        if (['eligible', 'blocked', 'pending', 'paid'].includes(params.status)) {
          if (row.status !== params.status) return false;
        } else if (row.blockReason !== params.status) {
          return false;
        }
      }
      return true;
    });

    const sorted = filtered.sort((a, b) =>
      (a.contractCode || '').localeCompare(b.contractCode || '') ||
      a.boqCode.localeCompare(b.boqCode) ||
      a.regionLabel.localeCompare(b.regionLabel)
    );

    const summary = sorted.reduce((acc, row) => {
      acc.totalEligibleAmount += row.status === 'eligible' ? row.certifiableRemainingAmount : 0;
      acc.totalBlockedAmount += row.blockedAmount;
      acc.totalPayableRemainingAmount += row.payableRemainingAmount;
      if (row.status === 'eligible') acc.eligibleCount += 1;
      if (row.status === 'blocked') acc.blockedCount += 1;
      if (row.status === 'pending') acc.pendingCount += 1;
      if (row.status === 'paid') acc.paidCount += 1;
      if (row.blockReason === 'missing_contract_acceptance' || row.blockedAmount > EPSILON && row.blockReason === 'eligible') acc.waitingContractAcceptanceCount += 1;
      if (row.blockReason === 'missing_task_contract_link') acc.waitingProgressMappingCount += 1;
      if (!row.cashflowSynced) acc.cashflowUnsyncedCount += 1;
      return acc;
    }, {
      totalEligibleAmount: 0,
      totalBlockedAmount: 0,
      totalPayableRemainingAmount: 0,
      eligibleCount: 0,
      blockedCount: 0,
      pendingCount: 0,
      paidCount: 0,
      waitingContractAcceptanceCount: 0,
      waitingProgressMappingCount: 0,
      cashflowUnsyncedCount: 0,
    });

    return { rows: sorted, summary };
  },
};
