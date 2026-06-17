import {
  ContractItem,
  MaterialBudgetItem,
  MaterialRequestFulfillmentBatch,
  ProjectFinance,
  ProjectOpeningBalance,
  ProjectTask,
  ProjectValueProgressMetric,
  ProjectWeeklyTaskProgress,
  PurchaseOrder,
  TaskContractItem,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import {
  clampProgress,
  getLeafProjectTasks,
  getTaskProgressWeight,
} from './projectScheduleRules';
import { isSupabaseConfigured, supabase } from './supabase';

const WEEKLY_TABLE = 'project_weekly_task_progress';
const BATCH_TABLE = 'material_request_fulfillment_batches';
const LINE_TABLE = 'material_request_fulfillment_lines';

const VALUE_PO_STATUSES = new Set(['confirmed', 'in_transit', 'partial', 'delivered', 'closed']);
const RECOGNIZED_STOCK_BATCH_STATUSES = new Set(['issued', 'received']);

export const getProjectScopeKey = (projectId?: string | null, constructionSiteId?: string | null): string =>
  projectId && constructionSiteId ? `${projectId}_${constructionSiteId}` : (projectId || constructionSiteId || '');

export const getWeekStart = (date: Date | string = new Date()): string => {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
};

export const getISOWeekLabel = (date: Date | string = new Date()): string => {
  const source = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
  const d = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(weekNo).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

const revisedItemValue = (item: ContractItem): number => {
  const direct = Number(item.revisedTotalPrice ?? item.totalPrice ?? 0);
  if (direct > 0) return direct;
  const qty = Number(item.revisedQuantity ?? item.quantity ?? 0);
  const unitPrice = Number(item.revisedUnitPrice ?? item.unitPrice ?? 0);
  return qty * unitPrice;
};

const getLeafContractItems = (items: ContractItem[]): ContractItem[] => {
  const parentIds = new Set(items.map(item => item.parentId).filter(Boolean) as string[]);
  return items.filter(item => !parentIds.has(item.id));
};

export const buildTaskValueWeights = (
  tasks: ProjectTask[],
  taskLinks: TaskContractItem[],
  contractItems: ContractItem[],
): Map<string, number> => {
  const taskIds = new Set(tasks.map(task => task.id));
  const customerItemMap = new Map(
    getLeafContractItems(contractItems.filter(item => item.contractType === 'customer'))
      .map(item => [item.id, item]),
  );
  const weights = new Map<string, number>();

  for (const link of taskLinks) {
    if (!taskIds.has(link.taskId)) continue;
    const item = customerItemMap.get(link.contractItemId);
    if (!item) continue;
    const splitPercent = Number(link.weightPercent ?? 100);
    const value = revisedItemValue(item) * Math.max(0, splitPercent) / 100;
    if (value <= 0) continue;
    weights.set(link.taskId, (weights.get(link.taskId) || 0) + value);
  }

  return weights;
};

export const calculateWeeklyConstructionProgress = (
  tasks: ProjectTask[],
  taskLinks: TaskContractItem[],
  contractItems: ContractItem[],
): number => {
  const leafTasks = getLeafProjectTasks(tasks);
  if (leafTasks.length === 0) return 0;
  const valueWeights = buildTaskValueWeights(tasks, taskLinks, contractItems);
  const weightOf = (task: ProjectTask) => valueWeights.get(task.id) || getTaskProgressWeight(task);
  const totalWeight = leafTasks.reduce((sum, task) => sum + weightOf(task), 0);
  if (totalWeight <= 0) return 0;
  const weightedProgress = leafTasks.reduce((sum, task) => sum + clampProgress(task.progress) * weightOf(task), 0);
  return clampProgress(Math.round(weightedProgress / totalWeight));
};

const resolveContractTotalValue = (
  projectFinance: ProjectFinance | undefined,
  customerItems: ContractItem[],
): number => {
  const declared = Number(projectFinance?.contractValue || 0);
  if (declared > 0) return declared;
  return getLeafContractItems(customerItems.filter(item => item.contractType === 'customer'))
    .reduce((sum, item) => sum + revisedItemValue(item), 0);
};

export const calculateProjectValueProgress = (input: {
  projectFinance?: ProjectFinance;
  customerItems: ContractItem[];
  purchaseOrders: PurchaseOrder[];
  fulfillmentBatches?: MaterialRequestFulfillmentBatch[];
  materialBudgets?: MaterialBudgetItem[];
  openingBalance?: ProjectOpeningBalance | null;
}): ProjectValueProgressMetric => {
  const contractTotalValue = resolveContractTotalValue(input.projectFinance, input.customerItems);
  const opening = input.openingBalance?.status === 'locked' ? input.openingBalance : null;
  const cutoffDate = opening?.asOfDate || '';
  const purchasedValue = input.purchaseOrders
    .filter(po => VALUE_PO_STATUSES.has(po.status))
    .filter(po => !cutoffDate || (po.orderDate || po.createdAt || '').slice(0, 10) > cutoffDate)
    .reduce((sum, po) => sum + Number(po.totalAmount || 0), 0);

  const materialBudgetPrice = new Map(
    (input.materialBudgets || []).map(item => [item.id, Number(item.budgetUnitPrice || 0)]),
  );
  const issuedValue = (input.fulfillmentBatches || [])
    .filter(batch => RECOGNIZED_STOCK_BATCH_STATUSES.has(batch.status))
    .filter(batch => !cutoffDate || (batch.batchDate || batch.createdAt || '').slice(0, 10) > cutoffDate)
    .reduce((batchTotal, batch) => {
      const lineTotal = (batch.lines || [])
        .filter(line => !line.poId)
        .reduce((sum, line) => {
          const qty = Number(line.receivedQty || line.issuedQty || 0);
          const price = line.materialBudgetItemId ? (materialBudgetPrice.get(line.materialBudgetItemId) || 0) : 0;
          return sum + qty * price;
        }, 0);
      return batchTotal + lineTotal;
    }, 0);

  const openingPurchasedValue = Number(opening?.purchasedValue || 0);
  const openingIssuedValue = Number(opening?.issuedValue || 0);
  const openingRecognizedValue = Number(opening?.recognizedValue || Math.max(openingPurchasedValue, openingIssuedValue) || 0);
  const totalPurchasedValue = openingPurchasedValue + purchasedValue;
  const totalIssuedValue = openingIssuedValue + issuedValue;
  const recognizedValue = openingRecognizedValue + purchasedValue + issuedValue;
  const valueProgressPercent = contractTotalValue > 0
    ? clampProgress(Math.round((recognizedValue / contractTotalValue) * 100))
    : 0;

  return {
    contractTotalValue,
    purchasedValue: totalPurchasedValue,
    issuedValue: totalIssuedValue,
    recognizedValue,
    valueProgressPercent,
  };
};

const weeklyToDb = (row: ProjectWeeklyTaskProgress): Record<string, unknown> => {
  const payload = toDb({
    ...row,
    attachments: row.attachments || [],
  });
  if (!payload.id) delete payload.id;
  delete payload.created_at;
  return payload;
};

export const projectWeeklyProgressService = {
  async listAll(scopeKey: string): Promise<ProjectWeeklyTaskProgress[]> {
    if (!isSupabaseConfigured || !scopeKey) return [];
    const { data, error } = await supabase
      .from(WEEKLY_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .order('week_start', { ascending: true });
    if (error) {
      console.warn('project weekly progress listAll failed:', error.message);
      return [];
    }
    return (data || []).map(row => fromDb(row) as ProjectWeeklyTaskProgress);
  },

  async listByWeek(scopeKey: string, weekStart: string): Promise<ProjectWeeklyTaskProgress[]> {
    if (!isSupabaseConfigured || !scopeKey) return [];
    const { data, error } = await supabase
      .from(WEEKLY_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .eq('week_start', weekStart)
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('project weekly progress unavailable', error.message);
      return [];
    }
    return dedupeRowsById(data || []).map(row => fromDb(row) as ProjectWeeklyTaskProgress);
  },

  async listLatestAtOrBefore(scopeKey: string, weekStart: string): Promise<ProjectWeeklyTaskProgress[]> {
    if (!isSupabaseConfigured || !scopeKey) return [];
    const { data, error } = await supabase
      .from(WEEKLY_TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .lte('week_start', weekStart)
      .order('week_start', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) {
      console.warn('project weekly progress unavailable', error.message);
      return [];
    }
    const byTask = new Map<string, ProjectWeeklyTaskProgress>();
    (data || []).forEach(row => {
      const progress = fromDb(row) as ProjectWeeklyTaskProgress;
      if (!byTask.has(progress.taskId)) byTask.set(progress.taskId, progress);
    });
    return [...byTask.values()];
  },

  async upsertMany(rows: ProjectWeeklyTaskProgress[]): Promise<void> {
    if (!isSupabaseConfigured || rows.length === 0) return;
    const { error } = await supabase
      .from(WEEKLY_TABLE)
      .upsert(rows.map(weeklyToDb), { onConflict: 'scope_key,task_id,week_start' });
    if (error) throw error;
  },

  async upsertSnapshot(input: {
    scopeKey: string;
    projectId?: string | null;
    constructionSiteId?: string | null;
    weekStart: string;
    constructionProgressPercent: number;
    valueMetric: ProjectValueProgressMetric;
    progressMode?: string;
    ganttPercent?: number;
    calculatedAt?: string;
  }): Promise<void> {
    if (!isSupabaseConfigured || !input.scopeKey) return;
    const row = {
      scope_key: input.scopeKey,
      project_id: input.projectId || null,
      construction_site_id: input.constructionSiteId || null,
      week_label: getISOWeekLabel(input.weekStart),
      week_start: input.weekStart,
      progress_percent: input.constructionProgressPercent,
      progress_mode: input.progressMode || 'weekly_report',
      construction_progress_percent: input.constructionProgressPercent,
      value_progress_percent: input.valueMetric.valueProgressPercent,
      supplied_value: input.valueMetric.recognizedValue || null,
      contract_total_value: input.valueMetric.contractTotalValue || null,
      purchased_value: input.valueMetric.purchasedValue,
      issued_value: input.valueMetric.issuedValue,
      recognized_value: input.valueMetric.recognizedValue,
      gantt_percent: input.ganttPercent ?? input.constructionProgressPercent,
      calculated_at: input.calculatedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('weekly_progress_snapshots')
      .upsert(row, { onConflict: 'scope_key,week_start' });
    if (error) throw error;
  },

  async listFulfillmentBatchesByScope(
    projectIdOrSiteId: string,
    constructionSiteId?: string | null,
  ): Promise<MaterialRequestFulfillmentBatch[]> {
    if (!isSupabaseConfigured || !projectIdOrSiteId) return [];
    const { data: batchRows, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId));
    if (batchError) {
      console.warn('material fulfillment batches unavailable', batchError.message);
      return [];
    }
    const batches = batchRows || [];
    if (batches.length === 0) return [];

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .in('batch_id', batches.map(row => row.id));
    if (lineError) {
      console.warn('material fulfillment lines unavailable', lineError.message);
      return [];
    }

    const linesByBatch = (lineRows || []).reduce<Record<string, any[]>>((acc, line) => {
      const key = line.batch_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(line);
      return acc;
    }, {});

    return batches.map(batch => ({
      ...fromDb(batch),
      lines: (linesByBatch[batch.id] || []).map(fromDb),
    })) as MaterialRequestFulfillmentBatch[];
  },
};
