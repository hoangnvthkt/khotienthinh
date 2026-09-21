import type {
  BoqMaterialBalance,
  BoqMaterialBudgetLine,
  BoqMaterialTreeNode,
  BoqMaterialTreePage,
  BoqMaterialTreeTotals,
  BoqPlanningCompleteness,
} from '../../types/materialPlanning';
import { parseQuantity6 } from '../procurement/decimal';
import { supabase } from '../supabase';
import { groupBoqTreePage } from './boqMaterialSelectors';

export interface ListBoqMaterialPageInput {
  projectId: string;
  constructionSiteId?: string | null;
  parentId?: string | null;
  search?: string | null;
  limit?: number;
  cursor?: string | null;
  asOf?: string | null;
  expectedMetricVersion?: string | null;
}

type JsonObject = Record<string, unknown>;

const fail = (code: string): never => { throw new Error(code); };
const object = (value: unknown, code: string): JsonObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fail(code)
);
const string = (value: unknown, code: string): string => (
  typeof value === 'string' && value.length > 0 ? value : fail(code)
);
const nullableString = (value: unknown, code: string): string | null => (
  value === null ? null : string(value, code)
);
const boolean = (value: unknown, code: string): boolean => (
  typeof value === 'boolean' ? value : fail(code)
);
const integer = (value: unknown, code: string): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(code)
);
const array = (value: unknown, code: string): unknown[] => Array.isArray(value) ? value : fail(code);
const stringArray = (value: unknown, code: string): string[] => array(value, code).map(item => string(item, code));
const decimal = (value: unknown, code: string): string => {
  const result = string(value, code);
  parseQuantity6(result);
  return result;
};
const nullableDecimal = (value: unknown, code: string): string | null => (
  value === null ? null : decimal(value, code)
);
const unit = (value: unknown): string => {
  const result = string(value, 'BOQ_PLANNING_UNIT_INVALID');
  if (result.trim() !== result) fail('BOQ_PLANNING_UNIT_INVALID');
  return result;
};

const mapBalance = (value: unknown, expectedUnit: string): BoqMaterialBalance => {
  const source = object(value, 'BOQ_PLANNING_BALANCE_INVALID');
  const balanceUnit = unit(source.unit);
  if (balanceUnit !== expectedUnit) fail('BOQ_PLANNING_UNIT_MISMATCH');
  const open = object(source.open, 'BOQ_PLANNING_OPEN_BALANCE_INVALID');
  const completeness = string(source.completeness, 'BOQ_PLANNING_COMPLETENESS_INVALID');
  if (!(['complete', 'partial', 'unknown'] as string[]).includes(completeness)) {
    fail('BOQ_PLANNING_COMPLETENESS_INVALID');
  }
  return {
    unit: balanceUnit,
    budget: decimal(source.budget, 'BOQ_PLANNING_DECIMAL_INVALID'),
    issuedNet: nullableDecimal(source.issuedNet, 'BOQ_PLANNING_DECIMAL_INVALID'),
    open: {
      awaitingApproval: nullableDecimal(open.awaitingApproval, 'BOQ_PLANNING_DECIMAL_INVALID'),
      awaitingArrangement: nullableDecimal(open.awaitingArrangement, 'BOQ_PLANNING_DECIMAL_INVALID'),
      executing: nullableDecimal(open.executing, 'BOQ_PLANNING_DECIMAL_INVALID'),
    },
    closed: nullableDecimal(source.closed, 'BOQ_PLANNING_DECIMAL_INVALID'),
    uncovered: nullableDecimal(source.uncovered, 'BOQ_PLANNING_DECIMAL_INVALID'),
    excess: nullableDecimal(source.excess, 'BOQ_PLANNING_DECIMAL_INVALID'),
    issues: stringArray(source.issues, 'BOQ_PLANNING_ISSUES_INVALID'),
    blockingIssues: stringArray(source.blockingIssues, 'BOQ_PLANNING_ISSUES_INVALID'),
    completeness: completeness as BoqPlanningCompleteness,
    selectable: boolean(source.selectable, 'BOQ_PLANNING_SELECTABLE_INVALID'),
  };
};

const mapMaterial = (value: unknown, canViewPrice: boolean): BoqMaterialBudgetLine => {
  const source = object(value, 'BOQ_PLANNING_LINE_INVALID');
  const lineUnit = unit(source.unit);
  const unitPrice = nullableDecimal(source.unitPrice, 'BOQ_PLANNING_PRICE_INVALID');
  if (!canViewPrice && unitPrice !== null) fail('BOQ_PLANNING_PRICE_NOT_AUTHORIZED');
  return {
    id: string(source.id, 'BOQ_PLANNING_LINE_ID_INVALID'),
    workBoqItemId: nullableString(source.workBoqItemId, 'BOQ_PLANNING_WORK_ID_INVALID'),
    taskId: nullableString(source.taskId, 'BOQ_PLANNING_TASK_ID_INVALID'),
    itemId: nullableString(source.itemId, 'BOQ_PLANNING_ITEM_ID_INVALID'),
    sku: nullableString(source.sku, 'BOQ_PLANNING_SKU_INVALID'),
    itemName: string(source.itemName, 'BOQ_PLANNING_ITEM_NAME_INVALID'),
    category: string(source.category, 'BOQ_PLANNING_CATEGORY_INVALID'),
    unit: lineUnit,
    suggestedQty30d: nullableDecimal(source.suggestedQty30d, 'BOQ_PLANNING_DECIMAL_INVALID'),
    unitPrice,
    balance: mapBalance(source.balance, lineUnit),
    issues: stringArray(source.issues, 'BOQ_PLANNING_ISSUES_INVALID'),
  };
};

const mapNode = (value: unknown, canViewPrice: boolean): BoqMaterialTreeNode => {
  const source = object(value, 'BOQ_PLANNING_NODE_INVALID');
  const syntheticValue = source.synthetic === null
    ? null
    : string(source.synthetic, 'BOQ_PLANNING_SYNTHETIC_INVALID');
  if (syntheticValue !== null && syntheticValue !== 'unallocated') fail('BOQ_PLANNING_SYNTHETIC_INVALID');
  const synthetic: 'unallocated' | null = syntheticValue === 'unallocated' ? 'unallocated' : null;
  return {
    id: string(source.id, 'BOQ_PLANNING_NODE_ID_INVALID'),
    parentId: nullableString(source.parentId, 'BOQ_PLANNING_PARENT_ID_INVALID'),
    taskId: nullableString(source.taskId, 'BOQ_PLANNING_TASK_ID_INVALID'),
    wbsCode: nullableString(source.wbsCode, 'BOQ_PLANNING_WBS_INVALID'),
    name: string(source.name, 'BOQ_PLANNING_NODE_NAME_INVALID'),
    sortOrder: integer(source.sortOrder, 'BOQ_PLANNING_SORT_ORDER_INVALID'),
    childCount: integer(source.childCount, 'BOQ_PLANNING_CHILD_COUNT_INVALID'),
    materials: array(source.materials, 'BOQ_PLANNING_MATERIALS_INVALID')
      .map(item => mapMaterial(item, canViewPrice)),
    synthetic,
  };
};

const mapTotals = (value: unknown): BoqMaterialTreeTotals => {
  const source = object(value, 'BOQ_PLANNING_TOTALS_INVALID');
  const totals = {
    workNodeCount: integer(source.workNodeCount, 'BOQ_PLANNING_TOTALS_INVALID'),
    materialLineCount: integer(source.materialLineCount, 'BOQ_PLANNING_TOTALS_INVALID'),
    selectableLineCount: integer(source.selectableLineCount, 'BOQ_PLANNING_TOTALS_INVALID'),
    unallocatedEffectCount: integer(source.unallocatedEffectCount, 'BOQ_PLANNING_TOTALS_INVALID'),
  };
  if (totals.selectableLineCount > totals.materialLineCount) fail('BOQ_PLANNING_TOTALS_MISMATCH');
  return totals;
};

const mapPage = (value: unknown, input: ListBoqMaterialPageInput): BoqMaterialTreePage => {
  const source = object(value, 'BOQ_PLANNING_PAGE_INVALID');
  const scope = object(source.scope, 'BOQ_PLANNING_SCOPE_INVALID');
  const projectId = string(scope.projectId, 'BOQ_PLANNING_SCOPE_INVALID');
  const constructionSiteId = nullableString(scope.constructionSiteId, 'BOQ_PLANNING_SCOPE_INVALID');
  if (projectId !== input.projectId || constructionSiteId !== (input.constructionSiteId ?? null)) {
    fail('BOQ_PLANNING_SCOPE_MISMATCH');
  }
  const asOf = string(source.asOf, 'BOQ_PLANNING_AS_OF_INVALID');
  if (!Number.isFinite(Date.parse(asOf))) fail('BOQ_PLANNING_AS_OF_INVALID');
  const metricVersion = string(source.metricVersion, 'BOQ_PLANNING_METRIC_VERSION_INVALID');
  if ((input.asOf && Date.parse(input.asOf) !== Date.parse(asOf))
      || (input.expectedMetricVersion && input.expectedMetricVersion !== metricVersion)) {
    fail('BOQ_PLANNING_PAGE_VERSION_MISMATCH');
  }
  const capabilities = object(source.capabilities, 'BOQ_PLANNING_CAPABILITIES_INVALID');
  const canViewPrice = boolean(capabilities.canViewPrice, 'BOQ_PLANNING_CAPABILITIES_INVALID');
  const nodes = array(source.nodes, 'BOQ_PLANNING_NODES_INVALID').map(item => mapNode(item, canViewPrice));
  const totals = mapTotals(source.totals);
  const materialCount = nodes.reduce((count, node) => count + node.materials.length, 0);
  if (nodes.length > totals.workNodeCount || materialCount > totals.materialLineCount) {
    fail('BOQ_PLANNING_TOTALS_MISMATCH');
  }
  return groupBoqTreePage({
    scope: { projectId, constructionSiteId },
    asOf,
    metricVersion,
    nodes,
    nextCursor: nullableString(source.nextCursor, 'BOQ_PLANNING_CURSOR_INVALID'),
    totals,
    capabilities: { canViewPrice },
  });
};

export const boqMaterialReadService = {
  async listPage(input: ListBoqMaterialPageInput): Promise<BoqMaterialTreePage> {
    if (!input.projectId.trim()) fail('BOQ_PLANNING_SCOPE_REQUIRED');
    const { data, error } = await supabase.rpc('list_boq_material_planning_v1' as never, {
      p_project_id: input.projectId,
      p_construction_site_id: input.constructionSiteId ?? null,
      p_parent_id: input.parentId ?? null,
      p_search: input.search ?? null,
      p_limit: input.limit ?? 50,
      p_cursor: input.cursor ?? null,
      p_as_of: input.asOf ?? null,
    } as never);
    if (error) throw error;
    if (data == null) fail('BOQ_PLANNING_PAGE_MISSING');
    return mapPage(data, input);
  },
};

export function createBoqPlanningRequestGate() {
  let generation = 0;
  return {
    next: () => { generation += 1; return generation; },
    isCurrent: (token: number) => token === generation,
    invalidate: () => { generation += 1; },
  };
}
