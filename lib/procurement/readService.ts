import { MaterialRequestFulfillmentMode, RequestStatus } from '../../types';
import type { CompanyProcurementDemandLine, MaterialRequest, RequestItem } from '../../types';
import { supabase } from '../supabase';

type NullableDecimal = string | null;

export interface ProcurementDemandBalanceRow {
  key: string;
  demandId: string | null;
  demandLineId: string | null;
  demandLineVersion: string | null;
  sourceRevisionId: string | null;
  requestId: string;
  requestCode: string;
  requestTitle: string | null;
  requestStatus: string;
  createdDate: string;
  expectedDate: string | null;
  targetWarehouseId: string | null;
  fulfillmentMode: string | null;
  projectId: string;
  constructionSiteId: string | null;
  requestLineId: string;
  itemId: string;
  itemName: string | null;
  sku: string | null;
  unit: string | null;
  supplierId: string | null;
  workBoqItemId: string | null;
  materialBudgetItemId: string | null;
  neededDate: string | null;
  boqQty: NullableDecimal;
  requestedQty: string;
  approvedQty: NullableDecimal;
  fulfilledQty: NullableDecimal;
  closedQty: NullableDecimal;
  reservedQty: NullableDecimal;
  committedQty: NullableDecimal;
  openNeedQty: NullableDecimal;
  availableToPlanQty: NullableDecimal;
  orderedQty: NullableDecimal;
  remainingKnown: boolean;
  reconciliationIssues: string[];
  canViewPrice: boolean;
  canAllocate: boolean;
}

const decimalNumber = (value: NullableDecimal, fallback = 0): number => {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('PROCUREMENT_READ_DECIMAL_INVALID');
  return parsed;
};

const mapDemand = (row: ProcurementDemandBalanceRow): CompanyProcurementDemandLine => {
  const requestedQty = decimalNumber(row.requestedQty);
  const approvedQty = decimalNumber(row.approvedQty, 0);
  const requestLine: RequestItem = {
    lineId: row.requestLineId,
    itemId: row.itemId,
    requestQty: requestedQty,
    approvedQty,
    itemNameSnapshot: row.itemName || row.itemId,
    skuSnapshot: row.sku || undefined,
    unitSnapshot: row.unit || undefined,
    workBoqItemId: row.workBoqItemId,
    materialBudgetItemId: row.materialBudgetItemId,
    neededDate: row.neededDate || undefined,
    budgetQtySnapshot: row.boqQty == null ? undefined : decimalNumber(row.boqQty),
  };
  const request: MaterialRequest = {
    id: row.requestId,
    code: row.requestCode,
    title: row.requestTitle || undefined,
    projectId: row.projectId,
    constructionSiteId: row.constructionSiteId,
    requestOrigin: 'project',
    siteWarehouseId: row.targetWarehouseId || '',
    requesterId: '',
    status: row.requestStatus as RequestStatus,
    items: [requestLine],
    createdDate: row.createdDate,
    expectedDate: row.expectedDate || '',
    fulfillmentMode: (row.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK) as MaterialRequestFulfillmentMode,
    logs: [],
  };
  const remainingKnown = row.remainingKnown && row.availableToPlanQty != null;
  return {
    key: row.key,
    request,
    requestLine,
    requestLineId: row.requestLineId,
    projectId: row.projectId,
    constructionSiteId: row.constructionSiteId,
    targetWarehouseId: row.targetWarehouseId,
    itemId: row.itemId,
    itemName: row.itemName || row.itemId,
    sku: row.sku,
    unit: row.unit,
    supplierId: row.supplierId,
    requestedQty,
    orderedQty: decimalNumber(row.orderedQty),
    openCommitmentQty: remainingKnown
      ? decimalNumber(row.reservedQty) + decimalNumber(row.committedQty)
      : null,
    actualReceivedQty: decimalNumber(row.fulfilledQty),
    closedNeedQty: decimalNumber(row.closedQty),
    openNeedQty: decimalNumber(row.openNeedQty),
    remainingQty: remainingKnown ? decimalNumber(row.availableToPlanQty) : null,
    remainingKnown,
    reconciliationIssues: Array.isArray(row.reconciliationIssues) ? row.reconciliationIssues : [],
    boqQty: row.boqQty == null ? null : decimalNumber(row.boqQty),
    neededDate: row.neededDate,
    g2DemandId: row.demandId,
    g2DemandLineId: row.demandLineId,
    g2SourceRevisionId: row.sourceRevisionId,
    g2DemandLineVersion: row.demandLineVersion == null ? null : Number(row.demandLineVersion),
    canViewPrice: row.canViewPrice,
    canAllocate: row.canAllocate && remainingKnown,
  };
};

export const procurementReadService = {
  async listOpenDemand(input: { projectId?: string | null; constructionSiteId?: string | null } = {}) {
    const { data, error } = await supabase.rpc('list_procurement_demand_balances_v1', {
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('PROCUREMENT_READ_RESPONSE_INVALID');
    return (data as ProcurementDemandBalanceRow[])
      .map(mapDemand)
      .sort((left, right) => String(left.neededDate || '').localeCompare(String(right.neededDate || ''))
        || String(right.request.createdDate || '').localeCompare(String(left.request.createdDate || '')));
  },
};
