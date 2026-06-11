import {
  ContractItemType,
  CustomerContract,
  PaymentDossierStatus,
  PaymentQualityStatus,
  PaymentSchedule,
  PaymentScheduleStatus,
  PaymentScheduleWorkbenchRow,
  PaymentScheduleWorkbenchSummary,
  ProjectTask,
  SubcontractorContract,
} from '../types';
import { customerContractService, subcontractorContractService } from './hdService';
import { paymentService, taskService } from './projectService';

export type PaymentScheduleContractTypeFilter = ContractItemType | 'all';
export type PaymentScheduleWorkbenchStatusFilter =
  | PaymentScheduleStatus
  | PaymentDossierStatus
  | PaymentQualityStatus
  | 'upcoming'
  | 'planned'
  | 'all';

export interface PaymentScheduleWorkbenchParams {
  projectId?: string | null;
  constructionSiteId?: string | null;
  contractType?: PaymentScheduleContractTypeFilter;
  contractId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: PaymentScheduleWorkbenchStatusFilter;
  search?: string;
}

export interface PaymentScheduleWorkbench {
  rows: PaymentScheduleWorkbenchRow[];
  summary: PaymentScheduleWorkbenchSummary;
}

type ContractMeta = {
  id: string;
  type: ContractItemType;
  code: string;
  name: string;
  value: number;
  currency: 'VND' | 'USD';
  counterpartyName: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (date: string, days: number) => {
  const dt = new Date(`${date}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
};

const daysBetweenDates = (from: string, to?: string) => {
  if (!to) return 0;
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
};

const lower = (value?: string | null) => (value || '').toLowerCase();
const money = (value?: number | null) => Math.round(Number(value || 0));

const scheduleContractKey = (schedule: PaymentSchedule) =>
  schedule.contractId && schedule.contractType ? `${schedule.contractType}:${schedule.contractId}` : '';

const buildContractMap = (
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
      value: Number(contract.value || 0),
      currency: contract.currency || 'VND',
      counterpartyName: contract.customerName,
    });
  });
  subcontractors.forEach(contract => {
    map.set(`subcontractor:${contract.id}`, {
      id: contract.id,
      type: 'subcontractor',
      code: contract.code,
      name: contract.name,
      value: Number(contract.value || 0),
      currency: contract.currency || 'VND',
      counterpartyName: contract.subcontractorName,
    });
  });
  return map;
};

const buildRow = (
  schedule: PaymentSchedule,
  contractMap: Map<string, ContractMeta>,
  taskMap: Map<string, ProjectTask>,
  today: string,
): PaymentScheduleWorkbenchRow => {
  const meta = contractMap.get(scheduleContractKey(schedule));
  const daysUntilDue = daysBetweenDates(today, schedule.dueDate);
  const isOverdue = schedule.status !== 'paid' && (schedule.status === 'overdue' || daysUntilDue < 0);
  const isUpcoming = schedule.status !== 'paid' && !isOverdue && schedule.dueDate <= addDaysIso(today, 10);
  const plannedTasks = (schedule.plannedTaskIds || [])
    .map(id => taskMap.get(id))
    .filter(Boolean)
    .map(task => ({
      id: task!.id,
      name: task!.name,
      wbsCode: task!.wbsCode || null,
      startDate: task!.startDate || null,
      endDate: task!.endDate || null,
      progress: task!.progress ?? null,
    }));

  return {
    ...schedule,
    contractCode: meta?.code,
    contractName: meta?.name,
    contractValue: meta?.value,
    contractCurrency: meta?.currency,
    counterpartyName: meta?.counterpartyName || schedule.contactName,
    plannedTasks,
    daysUntilDue,
    isUpcoming,
    isOverdue,
    remainingAmount: Math.max(0, money(schedule.amount) - money(schedule.paidAmount)),
  };
};

const matchStatus = (row: PaymentScheduleWorkbenchRow, status: PaymentScheduleWorkbenchStatusFilter) => {
  if (status === 'all') return true;
  if (status === 'upcoming') return row.isUpcoming;
  if (status === 'planned') return row.status !== 'paid';
  if (status === 'overdue') return row.isOverdue;
  if (status === 'paid' || status === 'pending') return row.status === status;
  if (['not_started', 'preparing', 'submitted', 'approved'].includes(status)) return row.dossierStatus === status;
  if (['not_applicable', 'not_confirmed', 'passed', 'failed'].includes(status)) return row.qualityStatus === status;
  return true;
};

const buildSummary = (rows: PaymentScheduleWorkbenchRow[], customers: CustomerContract[]): PaymentScheduleWorkbenchSummary => ({
  customerContractValue: money(customers.reduce((sum, contract) => sum + Number(contract.value || 0), 0)),
  totalReceivable: money(rows.filter(row => row.type === 'receivable').reduce((sum, row) => sum + Number(row.amount || 0), 0)),
  totalPayable: money(rows.filter(row => row.type === 'payable').reduce((sum, row) => sum + Number(row.amount || 0), 0)),
  upcomingCount: rows.filter(row => row.isUpcoming).length,
  overdueCount: rows.filter(row => row.isOverdue).length,
  paidAmount: money(rows.reduce((sum, row) => sum + Number(row.paidAmount || (row.status === 'paid' ? row.amount : 0)), 0)),
  pendingAmount: money(rows.filter(row => row.status !== 'paid').reduce((sum, row) => sum + row.remainingAmount, 0)),
  paidCount: rows.filter(row => row.status === 'paid').length,
  totalCount: rows.length,
});

export const paymentScheduleWorkbenchService = {
  async getWorkbench(params: PaymentScheduleWorkbenchParams): Promise<PaymentScheduleWorkbench> {
    const projectScopeId = params.projectId || params.constructionSiteId || '';
    const typeFilter = params.contractType || 'all';
    const includeCustomers = typeFilter === 'all' || typeFilter === 'customer';
    const includeSubcontractors = typeFilter === 'all' || typeFilter === 'subcontractor';

    const [schedules, customers, subcontractors, tasks] = await Promise.all([
      paymentService.listScoped(params.projectId, params.constructionSiteId),
      includeCustomers && projectScopeId ? customerContractService.listBySite(projectScopeId, params.constructionSiteId || null) : Promise.resolve([]),
      includeSubcontractors && projectScopeId ? subcontractorContractService.listBySite(projectScopeId, params.constructionSiteId || null) : Promise.resolve([]),
      projectScopeId ? taskService.list(projectScopeId, params.constructionSiteId || null) : Promise.resolve([]),
    ]);

    const contractMap = buildContractMap(customers, subcontractors);
    const taskMap = new Map(tasks.map(task => [task.id, task]));
    const today = todayIso();

    let rows = schedules
      .filter(schedule => typeFilter === 'all' || schedule.contractType === typeFilter)
      .filter(schedule => !params.contractId || schedule.contractId === params.contractId)
      .filter(schedule => !params.dateFrom || !schedule.dueDate || schedule.dueDate >= params.dateFrom)
      .filter(schedule => !params.dateTo || !schedule.dueDate || schedule.dueDate <= params.dateTo)
      .map(schedule => buildRow(schedule, contractMap, taskMap, today));

    const status = params.status || 'all';
    rows = rows.filter(row => matchStatus(row, status));

    const search = lower(params.search);
    if (search) {
      rows = rows.filter(row => [
        row.description,
        row.contractCode,
        row.contractName,
        row.counterpartyName,
        row.plannedScopeNote,
        row.note,
        ...row.plannedTasks.flatMap(task => [task.wbsCode, task.name]),
      ].some(value => lower(value).includes(search)));
    }

    rows.sort((a, b) =>
      (a.dueDate || '').localeCompare(b.dueDate || '') ||
      Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0) ||
      (a.description || '').localeCompare(b.description || ''),
    );

    return {
      rows,
      summary: buildSummary(rows, customers),
    };
  },
};
