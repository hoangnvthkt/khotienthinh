import {
  InventoryItem,
  MaterialBudgetItem,
  MaterialDemandDistributionMethod,
  MaterialForecastDetail,
  MaterialForecastRow,
  MaterialForecastWindow,
  MaterialPlanningDraftPo,
  MaterialPlanningForecast,
  MaterialPlanningRule,
  MaterialPlanningRuleSource,
  MaterialPlanningSummary,
  PlanningCurveTemplate,
  ProjectTask,
  ProjectWorkBoqItem,
  PurchaseOrder,
  PurchaseOrderItem,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildPoUnitSnapshot, getPoLineStockUnitPrice, poLinePurchaseToStockQty, stockToPurchaseQty, stockUnitPriceToPurchaseUnitPrice } from './materialUnitConversion';
import { isSupabaseConfigured, supabase } from './supabase';

const TABLE = 'material_planning_rules';
const CONFIRMED_INCOMING_PO_STATUSES = new Set(['confirmed', 'in_transit', 'partial']);
const VALID_PRICE_PO_STATUSES = new Set(['confirmed', 'in_transit', 'partial', 'delivered', 'closed']);

export const MATERIAL_FORECAST_WINDOWS: Array<{ key: MaterialForecastWindow; days: number; label: string }> = [
  { key: '7d', days: 7, label: '7 ngày' },
  { key: '30d', days: 30, label: '30 ngày' },
  { key: '90d', days: 90, label: '90 ngày' },
];

const emptyWindowMap = (): Record<MaterialForecastWindow, number> => ({
  '7d': 0,
  '30d': 0,
  '90d': 0,
});

const roundQty = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
};

const clampNonNegative = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const parseIsoDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (value: string, days: number): string => {
  const date = parseIsoDate(value) || new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
};

const maxIsoDate = (a: string, b: string): string => a > b ? a : b;

const daysInclusive = (start: string, end: string): number => {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
};

const overlapDaysInclusive = (aStart: string, aEnd: string, bStart: string, bEnd: string): number => {
  const start = maxIsoDate(aStart, bStart);
  const end = aEnd < bEnd ? aEnd : bEnd;
  return daysInclusive(start, end);
};

const normalizeCategory = (value?: string | null): string => String(value || '').trim().toLowerCase();

const normalizeDistributionMethod = (value?: string | null): MaterialDemandDistributionMethod =>
  value === 'linear' || value === 'custom_curve' ? value : 'pre_start';

const normalizeRule = (rule: MaterialPlanningRule): MaterialPlanningRule => ({
  ...rule,
  leadTimeDays: Math.max(0, Math.min(365, Math.round(Number(rule.leadTimeDays ?? 7)))),
  distributionMethod: normalizeDistributionMethod(rule.distributionMethod),
  inventoryItemId: rule.inventoryItemId || null,
  category: rule.category?.trim() || null,
  curveTemplateId: rule.curveTemplateId || null,
});

const resolveRule = (
  material: MaterialBudgetItem,
  item: InventoryItem | undefined,
  rules: MaterialPlanningRule[],
): { rule: MaterialPlanningRule; source: MaterialPlanningRuleSource } => {
  const itemRule = material.inventoryItemId
    ? rules.find(rule => rule.inventoryItemId === material.inventoryItemId)
    : undefined;
  if (itemRule) return { rule: normalizeRule(itemRule), source: 'item' };

  const materialCategory = normalizeCategory(material.category);
  const categoryRule = rules.find(rule => !rule.inventoryItemId && normalizeCategory(rule.category) === materialCategory);
  if (categoryRule) return { rule: normalizeRule(categoryRule), source: 'category' };

  return {
    rule: {
      scopeKey: '',
      leadTimeDays: Number.isFinite(Number(item?.defaultLeadTimeDays)) ? Number(item?.defaultLeadTimeDays) : 7,
      distributionMethod: 'pre_start',
      category: material.category || null,
    },
    source: 'default',
  };
};

const getRowKey = (material: MaterialBudgetItem): string => {
  if (material.inventoryItemId) return `item:${material.inventoryItemId}`;
  if (material.materialCode) return `code:${material.materialCode.toLowerCase()}`;
  return `budget:${material.id}`;
};

const getMaterialLabel = (material: MaterialBudgetItem, item?: InventoryItem): Pick<MaterialForecastRow, 'inventoryItemId' | 'sku' | 'itemName' | 'category' | 'unit' | 'unitPrice'> => ({
  inventoryItemId: material.inventoryItemId || item?.id || null,
  sku: item?.sku || material.materialCode || null,
  itemName: item?.name || material.itemName,
  category: item?.category || material.category || 'Chưa phân nhóm',
  unit: item?.unit || material.unit || '',
  unitPrice: Number(material.budgetUnitPrice || item?.priceIn || 0),
});

const normalizeCurveTemplate = (row: any): PlanningCurveTemplate => {
  const template = fromDb(row) as PlanningCurveTemplate & { planningCurvePoints?: any[] };
  const points = (template.points || template.planningCurvePoints || [])
    .map(point => fromDb(point))
    .map(point => ({
      ...point,
      curveId: point.curveId || template.id,
      sequence: Number(point.sequence || 0),
      percentage: Number(point.percentage || 0),
    }))
    .sort((a, b) => a.sequence - b.sequence);
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description || null,
    points,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
};

const curveTotalPercent = (curve?: PlanningCurveTemplate): number =>
  (curve?.points || []).reduce((sum, point) => sum + Number(point.percentage || 0), 0);

const getPlanningUnitPrice = (input: {
  item?: InventoryItem;
  purchaseOrders: PurchaseOrder[];
  transactions: Transaction[];
}): Pick<MaterialForecastRow, 'planningUnitPrice' | 'planningUnitPriceSource'> => {
  const itemId = input.item?.id;
  if (!itemId) return { planningUnitPrice: 0, planningUnitPriceSource: 'fallback' };

  const latestConfirmedPoLine = input.purchaseOrders
    .filter(po => VALID_PRICE_PO_STATUSES.has(po.status))
    .flatMap(po => (po.items || [])
      .filter(line => line.itemId === itemId && Number(line.unitPrice || 0) > 0)
      .map(line => ({
        unitPrice: getPoLineStockUnitPrice(line, input.item),
        date: po.orderDate || po.expectedDeliveryDate || po.createdAt || '',
      })))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latestConfirmedPoLine) {
    return { planningUnitPrice: latestConfirmedPoLine.unitPrice, planningUnitPriceSource: 'latest_confirmed_po' };
  }

  const latestReceivedLine = input.transactions
    .filter(tx => [TransactionStatus.COMPLETED, TransactionStatus.APPROVED, TransactionStatus.LEGACY_COMPLETED].includes(tx.status))
    .filter(tx => [TransactionType.IMPORT, TransactionType.TRANSFER, TransactionType.LEGACY_IN, TransactionType.LEGACY_NHAP].includes(tx.type))
    .flatMap(tx => (tx.items || [])
      .filter(line => line.itemId === itemId && Number(line.price ?? line.accountingPrice ?? 0) > 0)
      .map(line => ({
        unitPrice: Number(line.price ?? line.accountingPrice ?? 0),
        date: tx.date || '',
      })))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latestReceivedLine) {
    return { planningUnitPrice: latestReceivedLine.unitPrice, planningUnitPriceSource: 'latest_received' };
  }

  if (Number(input.item?.priceIn || 0) > 0) {
    return { planningUnitPrice: Number(input.item?.priceIn || 0), planningUnitPriceSource: 'material_master' };
  }

  return { planningUnitPrice: 0, planningUnitPriceSource: 'fallback' };
};

const getDetailDemand = (input: {
  remainingDemandQty: number;
  task: ProjectTask;
  leadTimeDays: number;
  distributionMethod: MaterialDemandDistributionMethod;
  curve?: PlanningCurveTemplate;
  today: string;
}): { needDate: string | null; demandQty: Record<MaterialForecastWindow, number>; warnings: string[] } => {
  const demandQty = emptyWindowMap();
  const warnings: string[] = [];
  const startDate = input.task.startDate?.slice(0, 10);
  const endDate = input.task.endDate?.slice(0, 10);
  if (!parseIsoDate(startDate) || !parseIsoDate(endDate) || startDate > endDate) {
    return { needDate: null, demandQty, warnings: ['Task thiếu ngày bắt đầu/kết thúc hợp lệ'] };
  }

  if (input.remainingDemandQty <= 0) {
    return { needDate: null, demandQty, warnings };
  }

  if (input.distributionMethod === 'pre_start') {
    const rawNeedDate = addDays(startDate, -input.leadTimeDays);
    const needDate = rawNeedDate < input.today ? input.today : rawNeedDate;
    for (const window of MATERIAL_FORECAST_WINDOWS) {
      const windowEnd = addDays(input.today, window.days);
      if (needDate <= windowEnd) demandQty[window.key] = roundQty(input.remainingDemandQty);
    }
    return { needDate, demandQty, warnings };
  }

  if (input.distributionMethod === 'custom_curve') {
    const curve = input.curve;
    const totalPercent = curveTotalPercent(curve);
    if (!curve || curve.points.length === 0) {
      warnings.push('Custom curve chưa chọn template');
      const rawNeedDate = addDays(startDate, -input.leadTimeDays);
      const needDate = rawNeedDate < input.today ? input.today : rawNeedDate;
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        const windowEnd = addDays(input.today, window.days);
        if (needDate <= windowEnd) demandQty[window.key] = roundQty(input.remainingDemandQty);
      }
      return { needDate, demandQty, warnings };
    }
    if (Math.abs(totalPercent - 100) > 0.01) {
      warnings.push(`Curve ${curve.name} chưa đủ 100%`);
    }
    const denominator = totalPercent > 0 ? totalPercent : 100;
    let earliestNeedDate: string | null = null;
    for (const point of curve.points) {
      const weekStart = addDays(startDate, (Number(point.sequence || 1) - 1) * 7);
      const rawNeedDate = addDays(weekStart, -input.leadTimeDays);
      const needDate = rawNeedDate < input.today ? input.today : rawNeedDate;
      if (!earliestNeedDate || needDate < earliestNeedDate) earliestNeedDate = needDate;
      const pointQty = input.remainingDemandQty * (Number(point.percentage || 0) / denominator);
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        const windowEnd = addDays(input.today, window.days);
        if (needDate <= windowEnd) {
          demandQty[window.key] = roundQty(demandQty[window.key] + pointQty);
        }
      }
    }
    return { needDate: earliestNeedDate, demandQty, warnings };
  }

  const distributionStart = maxIsoDate(input.today, startDate);
  const distributionEnd = endDate < distributionStart ? distributionStart : endDate;
  const totalDays = Math.max(1, daysInclusive(distributionStart, distributionEnd));
  for (const window of MATERIAL_FORECAST_WINDOWS) {
    const windowEnd = addDays(input.today, window.days);
    const overlap = overlapDaysInclusive(distributionStart, distributionEnd, input.today, windowEnd);
    demandQty[window.key] = roundQty(input.remainingDemandQty * Math.min(1, overlap / totalDays));
  }
  return { needDate: distributionStart, demandQty, warnings };
};

export const getMaterialPlanningScopeKey = (projectId?: string | null, constructionSiteId?: string | null): string =>
  projectId && constructionSiteId ? `${projectId}_${constructionSiteId}` : (projectId || constructionSiteId || '');

export const materialPlanningRuleService = {
  async listByScope(scopeKey: string): Promise<MaterialPlanningRule[]> {
    if (!isSupabaseConfigured || !scopeKey) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('scope_key', scopeKey)
      .order('inventory_item_id', { ascending: false })
      .order('category', { ascending: true });
    if (error) {
      console.warn('material planning rules unavailable', error.message);
      return [];
    }
    return (data || []).map(row => normalizeRule(fromDb(row) as MaterialPlanningRule));
  },

  async upsertRule(rule: MaterialPlanningRule): Promise<MaterialPlanningRule> {
    const normalized = normalizeRule(rule);
    if (!isSupabaseConfigured || !normalized.scopeKey) return normalized;

    let existingId = normalized.id;
    if (!existingId) {
      let query = supabase.from(TABLE).select('id').eq('scope_key', normalized.scopeKey).limit(1);
      if (normalized.inventoryItemId) {
        query = query.eq('inventory_item_id', normalized.inventoryItemId);
      } else {
        query = query.is('inventory_item_id', null).ilike('category', normalized.category || '');
      }
      const { data, error } = await query.maybeSingle();
      if (!error && data?.id) existingId = data.id;
    }

    const payload = toDb({ ...normalized, id: existingId });
    if (!payload.id) delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return normalizeRule(fromDb(data) as MaterialPlanningRule);
  },
};

export const materialPlanningCurveService = {
  async listTemplates(): Promise<PlanningCurveTemplate[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('planning_curve_templates')
      .select('*, planning_curve_points(*)')
      .order('code', { ascending: true });
    if (error) {
      console.warn('planning curve templates unavailable', error.message);
      return [];
    }
    return (data || []).map(normalizeCurveTemplate);
  },
};

export const projectMaterialPlanningService = {
  buildForecast(input: {
    projectId?: string | null;
    constructionSiteId?: string | null;
    siteWarehouseId?: string;
    tasks: ProjectTask[];
    workBoqItems: ProjectWorkBoqItem[];
    materialBudgetItems: MaterialBudgetItem[];
    inventoryItems: InventoryItem[];
    purchaseOrders: PurchaseOrder[];
    transactions?: Transaction[];
    rules: MaterialPlanningRule[];
    curveTemplates?: PlanningCurveTemplate[];
    today?: string;
  }): MaterialPlanningForecast {
    const today = input.today || toIsoDate(new Date());
    const taskById = new Map(input.tasks.map(task => [task.id, task]));
    const workById = new Map(input.workBoqItems.map(item => [item.id, item]));
    const itemById = new Map(input.inventoryItems.map(item => [item.id, item]));
    const curveById = new Map((input.curveTemplates || []).map(curve => [curve.id, curve]));
    const rows = new Map<string, MaterialForecastRow>();

    const getOrCreateRow = (material: MaterialBudgetItem, item: InventoryItem | undefined, rule: MaterialPlanningRule, ruleSource: MaterialPlanningRuleSource): MaterialForecastRow => {
      const key = getRowKey(material);
      const label = getMaterialLabel(material, item);
      const existing = rows.get(key);
      if (existing) return existing;
      const price = getPlanningUnitPrice({
        item: label.inventoryItemId ? itemById.get(label.inventoryItemId) : item,
        purchaseOrders: input.purchaseOrders,
        transactions: input.transactions || [],
      });
      const curve = rule.curveTemplateId ? curveById.get(rule.curveTemplateId) : undefined;
      const row: MaterialForecastRow = {
        key,
        ...label,
        ...price,
        siteAvailableQty: label.inventoryItemId && input.siteWarehouseId
          ? roundQty(Number(itemById.get(label.inventoryItemId)?.stockByWarehouse?.[input.siteWarehouseId] || 0))
          : 0,
        incomingQty: emptyWindowMap(),
        demandQty: emptyWindowMap(),
        demandValue: emptyWindowMap(),
        shortageQty: emptyWindowMap(),
        shortageValue: emptyWindowMap(),
        forecastQty7d: 0,
        forecastQty30d: 0,
        forecastQty90d: 0,
        forecastValue7d: 0,
        forecastValue30d: 0,
        forecastValue90d: 0,
        shortageQty7d: 0,
        shortageQty30d: 0,
        shortageQty90d: 0,
        shortageValue7d: 0,
        shortageValue30d: 0,
        shortageValue90d: 0,
        leadTimeDays: rule.leadTimeDays,
        distributionMethod: rule.distributionMethod,
        curveTemplateId: rule.curveTemplateId || null,
        curveTemplateName: curve?.name || null,
        ruleSource,
        warnings: [],
        details: [],
      };
      if (!material.inventoryItemId) row.warnings.push('Chưa liên kết mã kho');
      if (material.inventoryItemId && !item) row.warnings.push('Không tìm thấy mã vật tư trong kho');
      if (!input.siteWarehouseId) row.warnings.push('Chưa xác định kho công trường');
      rows.set(key, row);
      return row;
    };

    for (const material of input.materialBudgetItems) {
      const item = material.inventoryItemId ? itemById.get(material.inventoryItemId) : undefined;
      const { rule, source } = resolveRule(material, item, input.rules);
      const curve = rule.curveTemplateId ? curveById.get(rule.curveTemplateId) : undefined;
      const row = getOrCreateRow(material, item, rule, source);
      const work = material.workBoqItemId ? workById.get(material.workBoqItemId) : undefined;
      const task = work?.sourceTaskId ? taskById.get(work.sourceTaskId) : undefined;
      const warnings: string[] = [];
      if (!material.workBoqItemId || !work) warnings.push('Vật tư chưa gắn đầu mục BOQ triển khai');
      if (work?.sourceTaskId && !task) warnings.push('Đầu mục BOQ chưa tìm thấy task tiến độ');

      const progress = clampNonNegative(Number(task?.progress || 0));
      const remainingWorkRatio = task ? Math.max(0, 1 - progress / 100) : 0;
      const remainingDemandQty = roundQty(Number(material.budgetQty || 0) * remainingWorkRatio);
      const detailBase: MaterialForecastDetail = {
        id: `${material.id}:${task?.id || 'no-task'}`,
        materialBudgetItemId: material.id,
        workBoqItemId: material.workBoqItemId || null,
        taskId: task?.id || null,
        wbsCode: work?.wbsCode || task?.wbsCode || null,
        taskName: task?.name || work?.name || 'Chưa gắn tiến độ',
        startDate: task?.startDate || null,
        endDate: task?.endDate || null,
        needDate: null,
        remainingDemandQty,
        leadTimeDays: rule.leadTimeDays,
        distributionMethod: rule.distributionMethod,
        curveTemplateId: rule.curveTemplateId || null,
        curveTemplateName: curve?.name || null,
        demandQty: emptyWindowMap(),
        demandValue: emptyWindowMap(),
        warnings,
      };

      if (!task) {
        row.details.push(detailBase);
        row.warnings.push(...warnings);
        continue;
      }

      const demand = getDetailDemand({
        remainingDemandQty,
        task,
        leadTimeDays: rule.leadTimeDays,
        distributionMethod: rule.distributionMethod,
        curve,
        today,
      });
      const detail: MaterialForecastDetail = {
        ...detailBase,
        needDate: demand.needDate,
        demandQty: demand.demandQty,
        demandValue: emptyWindowMap(),
        warnings: [...warnings, ...demand.warnings],
      };
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        detail.demandValue[window.key] = Math.round(detail.demandQty[window.key] * row.planningUnitPrice);
      }
      row.details.push(detail);
      row.warnings.push(...detail.warnings);
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        row.demandQty[window.key] = roundQty(row.demandQty[window.key] + detail.demandQty[window.key]);
        row.demandValue[window.key] += detail.demandValue[window.key];
      }
    }

    const rowsByItemId = new Map<string, MaterialForecastRow>();
    for (const row of rows.values()) {
      if (row.inventoryItemId) rowsByItemId.set(row.inventoryItemId, row);
    }

    for (const po of input.purchaseOrders) {
      if (!CONFIRMED_INCOMING_PO_STATUSES.has(po.status)) continue;
      for (const line of po.items || []) {
        const row = rowsByItemId.get(line.itemId);
        if (!row) continue;
        const inventoryItem = input.inventoryItems.find(item => item.id === line.itemId);
        const remainingPurchaseQty = Math.max(0, Number(line.qty || 0) - Number(line.receivedQty || 0));
        const remainingQty = roundQty(poLinePurchaseToStockQty(line, remainingPurchaseQty, inventoryItem));
        if (remainingQty <= 0) continue;
        if (!po.expectedDeliveryDate) {
          row.warnings.push('PO đã xác nhận nhưng chưa có ETA');
          continue;
        }
        const eta = po.expectedDeliveryDate.slice(0, 10);
        for (const window of MATERIAL_FORECAST_WINDOWS) {
          if (eta <= addDays(today, window.days)) {
            row.incomingQty[window.key] = roundQty(row.incomingQty[window.key] + remainingQty);
          }
        }
      }
    }

    for (const row of rows.values()) {
      row.warnings = [...new Set(row.warnings)];
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        const shortage = Math.max(0, row.demandQty[window.key] - row.siteAvailableQty - row.incomingQty[window.key]);
        row.shortageQty[window.key] = roundQty(shortage);
        row.shortageValue[window.key] = Math.round(shortage * row.planningUnitPrice);
      }
      row.forecastQty7d = row.demandQty['7d'];
      row.forecastQty30d = row.demandQty['30d'];
      row.forecastQty90d = row.demandQty['90d'];
      row.forecastValue7d = row.demandValue['7d'];
      row.forecastValue30d = row.demandValue['30d'];
      row.forecastValue90d = row.demandValue['90d'];
      row.shortageQty7d = row.shortageQty['7d'];
      row.shortageQty30d = row.shortageQty['30d'];
      row.shortageQty90d = row.shortageQty['90d'];
      row.shortageValue7d = row.shortageValue['7d'];
      row.shortageValue30d = row.shortageValue['30d'];
      row.shortageValue90d = row.shortageValue['90d'];
    }

    const forecastRows = [...rows.values()]
      .filter(row => row.demandQty['90d'] > 0 || row.warnings.length > 0)
      .sort((a, b) => b.shortageValue['30d'] - a.shortageValue['30d'] || b.demandQty['30d'] - a.demandQty['30d']);

    const summary: MaterialPlanningSummary = {
      rowCount: forecastRows.length,
      demandQty: emptyWindowMap(),
      demandValue: emptyWindowMap(),
      shortageQty: emptyWindowMap(),
      shortageValue: emptyWindowMap(),
      shortageRowCount: forecastRows.filter(row => row.shortageQty['30d'] > 0).length,
      criticalShortageCount: forecastRows.filter(row => row.shortageQty['7d'] > 0).length,
      missingInventoryCount: forecastRows.filter(row => !row.inventoryItemId).length,
      etaMissingPoCount: forecastRows.filter(row => row.warnings.includes('PO đã xác nhận nhưng chưa có ETA')).length,
      invalidTaskCount: forecastRows.filter(row => row.warnings.some(warning => {
        const text = warning.toLowerCase();
        return text.includes('task') || text.includes('tiến độ') || text.includes('ngày');
      })).length,
    };

    for (const row of forecastRows) {
      for (const window of MATERIAL_FORECAST_WINDOWS) {
        summary.demandQty[window.key] = roundQty(summary.demandQty[window.key] + row.demandQty[window.key]);
        summary.demandValue[window.key] += row.demandValue[window.key];
        summary.shortageQty[window.key] = roundQty(summary.shortageQty[window.key] + row.shortageQty[window.key]);
        summary.shortageValue[window.key] += row.shortageValue[window.key];
      }
    }

    return { rows: forecastRows, summary };
  },

  createDraftPoFromShortage(input: {
    row: MaterialForecastRow;
    window: MaterialForecastWindow;
    siteWarehouseId?: string;
    inventoryItems: InventoryItem[];
    today?: string;
  }): MaterialPlanningDraftPo {
    if (!input.siteWarehouseId) throw new Error('Chưa xác định kho công trường để tạo PO.');
    if (!input.row.inventoryItemId) throw new Error('Vật tư chưa liên kết mã kho, chưa thể tạo PO.');
    const item = input.inventoryItems.find(candidate => candidate.id === input.row.inventoryItemId);
    if (!item) throw new Error('Không tìm thấy mã vật tư trong kho.');
    const qty = roundQty(input.row.shortageQty[input.window]);
    if (qty <= 0) throw new Error('Dòng vật tư này chưa có thiếu hụt trong kỳ đã chọn.');
    const today = input.today || toIsoDate(new Date());
    const windowDays = MATERIAL_FORECAST_WINDOWS.find(item => item.key === input.window)?.days || 30;
    const windowEnd = addDays(today, windowDays);
    const sourceDetail = input.row.details
      .filter(detail => detail.demandQty[input.window] > 0)
      .sort((a, b) => (a.needDate || windowEnd).localeCompare(b.needDate || windowEnd))[0];
    const neededDate = sourceDetail?.needDate || windowEnd;
    const poLine: PurchaseOrderItem = {
      lineId: crypto.randomUUID(),
      itemId: item.id,
      vendorId: item.supplierId || null,
      vendorName: null,
      sku: item.sku,
      name: item.name,
      ...buildPoUnitSnapshot(item),
      unit: item.purchaseUnit || item.unit,
      qty: stockToPurchaseQty(qty, item),
      unitPrice: stockUnitPriceToPurchaseUnitPrice(Number(input.row.planningUnitPrice || input.row.unitPrice || item.priceIn || 0), item),
      receivedQty: 0,
      neededDate,
      workBoqItemId: sourceDetail?.workBoqItemId || null,
      workBoqItemName: sourceDetail?.taskName || null,
      materialBudgetItemId: sourceDetail?.materialBudgetItemId || null,
      materialBudgetItemName: input.row.itemName,
      note: `Tạo từ Kế hoạch vật tư ${input.window}`,
    };

    return {
      poNumber: `KHVT-${today.replace(/-/g, '')}`,
      targetWarehouseId: input.siteWarehouseId,
      expectedDeliveryDate: neededDate,
      sourceMode: 'proactive_project',
      items: [poLine],
      note: `PO nháp tạo từ thiếu hụt kế hoạch vật tư ${input.window}.`,
    };
  },
};
