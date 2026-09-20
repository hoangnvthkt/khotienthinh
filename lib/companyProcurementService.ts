import { supabase } from './supabase';
import { fromDb } from './dbMapping';
import { MATERIAL_REQUEST_LIST_SELECT, mapMaterialRequestFromDb } from './materialRequestService';
import { getRequestLineId, materialRequestFulfillmentService } from './materialRequestFulfillmentService';
import { PURCHASE_ORDER_REQUEST_LINE_SELECT, PURCHASE_ORDER_SELECT, poService } from './projectService';
import { chunkValues } from './supabasePagination';
import {
  BusinessPartner,
  CompanyProcurementCreateInput,
  CompanyProcurementCreateLine,
  CompanyProcurementCreateResult,
  CompanyProcurementDeliveryGroupDetail,
  CompanyProcurementDemandLine,
  InventoryItem,
  MaterialRequest,
  MaterialRequestFulfillmentBatch,
  POStatus,
  PurchaseOrder,
  PurchaseOrderDeliveryGroup,
  PurchaseOrderItem,
  PurchaseOrderRequestLineLink,
  RequestItem,
  RequestStatus,
} from '../types';
import {
  buildPoUnitSnapshot,
  poLineStockToPurchaseQty,
  stockUnitPriceToPurchaseUnitPrice,
} from './materialUnitConversion';
import { openCommitment } from './companyProcurementCommitment';

const ACTIVE_PO_STATUSES = new Set<POStatus>(['draft', 'sent', 'confirmed', 'in_transit', 'partial']);
const OPEN_REQUEST_STATUSES = new Set<string>([
  RequestStatus.APPROVED,
  RequestStatus.IN_TRANSIT,
]);

const newId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const mapPurchaseOrder = (row: any): PurchaseOrder => fromDb(row) as PurchaseOrder;
const mapPoLink = (row: any): PurchaseOrderRequestLineLink => fromDb(row) as PurchaseOrderRequestLineLink;
const mapDeliveryGroup = (row: any): PurchaseOrderDeliveryGroup => fromDb(row) as PurchaseOrderDeliveryGroup;

const COMPANY_READ_PAGE_SIZE = 1000;
const COMPANY_READ_MAX_ROWS = 20_000;
const DELIVERY_GROUP_SELECT = 'id,project_id,purchase_order_id,delivery_no,planned_date,status,note,created_by,created_at,updated_at';
const COMMITMENT_DELIVERY_BATCH_SELECT = 'id,purchase_order_id,status';
const COMMITMENT_DELIVERY_LINE_SELECT = 'id,delivery_batch_id,purchase_order_id,purchase_order_line_id,item_id,accepted_stock_qty,stock_unit';
const COMMITMENT_FULFILLMENT_LINE_SELECT = 'id,batch_id,material_request_id,request_line_id,item_id,po_id,po_line_id,received_qty,unit,purchase_order_request_line_id';
const COMMITMENT_FULFILLMENT_BATCH_SELECT = 'id,status,source_type';
const TERMINAL_RECEIPT_STATUSES = new Set(['received', 'received_short', 'received_over']);

type DemandCommitmentRead = {
  orderedQty: number;
  openCommitmentQty: number | null;
  remainingKnown: boolean;
  reconciliationIssues: string[];
};

const loadChunkedRows = async (input: {
  table: string;
  projection: string;
  filterColumn: string;
  values: string[];
}): Promise<any[]> => {
  const rows: any[] = [];
  for (const valueChunk of chunkValues(Array.from(new Set(input.values.filter(Boolean))), 100)) {
    let lastId: string | null = null;
    while (true) {
      let query: any = supabase
        .from(input.table as any)
        .select(input.projection)
        .in(input.filterColumn, valueChunk)
        .order('id', { ascending: true })
        .limit(COMPANY_READ_PAGE_SIZE);
      if (lastId) query = query.gt('id', lastId);
      const { data, error } = await query;
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (rows.length > COMPANY_READ_MAX_ROWS) throw new Error(`Company procurement read exceeded safety cap of ${COMPANY_READ_MAX_ROWS} rows`);
      if (page.length < COMPANY_READ_PAGE_SIZE) break;
      const nextId = String(page[page.length - 1]?.id || '');
      if (!nextId || nextId === lastId) throw new Error('Company procurement read received a repeated cursor');
      lastId = nextId;
    }
  }
  return rows;
};

const normalizeBatch = (batch: any, lines: any[]): MaterialRequestFulfillmentBatch => ({
  ...fromDb(batch),
  lines: lines.map(fromDb),
}) as MaterialRequestFulfillmentBatch;

export interface UpdateCompanyDeliveryGroupInput {
  deliveryGroupId: string;
  plannedDate: string;
  note?: string | null;
  lines: Array<{
    id: string;
    issuedQty: number;
    deliveryUnitPrice: number;
  }>;
}

const loadInventoryByIds = async (ids: string[]): Promise<Map<string, InventoryItem>> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const rows = await loadChunkedRows({
    table: 'items',
    projection: 'id,sku,accounting_code,name,category,unit,purchase_unit,purchase_conversion_factor,price_in,price_out,min_stock,supplier_id,image_url,location,stock_by_warehouse',
    filterColumn: 'id',
    values: uniqueIds,
  });
  return new Map(rows.map(row => {
    const item = fromDb(row) as InventoryItem;
    return [
      item.id,
      {
        ...item,
        purchaseConversionFactor: toFiniteNumber(item.purchaseConversionFactor, 1),
        stockByWarehouse: item.stockByWarehouse || {},
      },
    ] as const;
  }));
};

const getLineRequestedQty = (line: RequestItem) => toFiniteNumber(line.requestQty || line.approvedQty || 0);

const buildDemandKey = (requestId: string, requestLineId: string) => `${requestId}:${requestLineId}`;

const buildProcurementGroupNo = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `MUA-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

const resolveDemandLine = (
  request: MaterialRequest,
  line: RequestItem,
  index: number,
  inventoryById: Map<string, InventoryItem>,
  summaryByLine: Map<string, any>,
  commitmentByLine: Map<string, DemandCommitmentRead>,
): CompanyProcurementDemandLine | null => {
  const requestLineId = getRequestLineId(request, line, index);
  const item = inventoryById.get(line.itemId);
  const requestedQty = getLineRequestedQty(line);
  const lineSummary = summaryByLine.get(requestLineId);
  const actualReceivedQty = toFiniteNumber(lineSummary?.netReceivedQty ?? lineSummary?.receivedQty);
  const closedNeedQty = toFiniteNumber(lineSummary?.closedNeedQty);
  const openNeedQty = Math.max(0, toFiniteNumber(lineSummary?.openNeedQty, requestedQty - actualReceivedQty - closedNeedQty));
  const commitment = commitmentByLine.get(buildDemandKey(request.id, requestLineId)) || {
    orderedQty: 0,
    openCommitmentQty: 0,
    remainingKnown: true,
    reconciliationIssues: [],
  };
  const remainingQty = commitment.remainingKnown && commitment.openCommitmentQty != null
    ? Math.max(0, openNeedQty - commitment.openCommitmentQty)
    : null;

  if (openNeedQty <= 0) return null;

  return {
    key: buildDemandKey(request.id, requestLineId),
    request,
    requestLine: line,
    requestLineId,
    projectId: request.projectId || null,
    constructionSiteId: request.constructionSiteId || null,
    targetWarehouseId: request.siteWarehouseId || null,
    itemId: line.itemId,
    itemName: line.itemNameSnapshot || item?.name || line.materialBudgetItemName || line.itemId,
    sku: line.skuSnapshot || item?.sku || null,
    unit: line.unitSnapshot || item?.unit || null,
    supplierId: item?.supplierId || null,
    requestedQty,
    orderedQty: commitment.orderedQty,
    openCommitmentQty: commitment.openCommitmentQty,
    actualReceivedQty,
    closedNeedQty,
    openNeedQty,
    remainingQty,
    remainingKnown: commitment.remainingKnown,
    reconciliationIssues: commitment.reconciliationIssues,
    boqQty: line.budgetQtySnapshot ?? null,
    neededDate: line.neededDate || request.expectedDate || null,
  };
};

const loadActivePoLinksByRequestIds = async (requestIds: string[]) => {
  const uniqueRequestIds = Array.from(new Set(requestIds.filter(Boolean)));
  if (uniqueRequestIds.length === 0) return new Map<string, DemandCommitmentRead>();

  const linkRows = await loadChunkedRows({
    table: 'purchase_order_request_lines',
    projection: PURCHASE_ORDER_REQUEST_LINE_SELECT,
    filterColumn: 'material_request_id',
    values: uniqueRequestIds,
  });

  const links = linkRows.map(mapPoLink);
  const poIds = Array.from(new Set(links.map(link => link.purchaseOrderId).filter(Boolean)));
  if (poIds.length === 0) return new Map<string, DemandCommitmentRead>();

  const poRows = await loadChunkedRows({
    table: 'purchase_orders',
    projection: 'id,status,archived_at',
    filterColumn: 'id',
    values: poIds,
  });

  const activePoIds = new Set((poRows || [])
    .filter(row => !row.archived_at && ACTIVE_PO_STATUSES.has(row.status as POStatus))
    .map(row => row.id));
  const activeLinks = links.filter(link => activePoIds.has(link.purchaseOrderId));
  if (activeLinks.length === 0) return new Map<string, DemandCommitmentRead>();

  const activeIds = [...activePoIds];
  const [deliveryBatchRows, deliveryLineRows, fulfillmentLineRows] = await Promise.all([
    loadChunkedRows({
      table: 'purchase_order_delivery_batches',
      projection: COMMITMENT_DELIVERY_BATCH_SELECT,
      filterColumn: 'purchase_order_id',
      values: activeIds,
    }),
    loadChunkedRows({
      table: 'purchase_order_delivery_lines',
      projection: COMMITMENT_DELIVERY_LINE_SELECT,
      filterColumn: 'purchase_order_id',
      values: activeIds,
    }),
    loadChunkedRows({
      table: 'material_request_fulfillment_lines',
      projection: COMMITMENT_FULFILLMENT_LINE_SELECT,
      filterColumn: 'po_id',
      values: activeIds,
    }),
  ]);
  const fulfillmentBatchRows = fulfillmentLineRows.length === 0
    ? []
    : await loadChunkedRows({
      table: 'material_request_fulfillment_batches',
      projection: COMMITMENT_FULFILLMENT_BATCH_SELECT,
      filterColumn: 'id',
      values: fulfillmentLineRows.map(row => row.batch_id),
    });

  const normalizedUnit = (value?: string | null) => String(value || '').trim().toLowerCase();
  const strictQuantity = (value: unknown): number | null => {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
  };
  const poLineKey = (poId: string, poLineId: string) => `${poId}:${poLineId}`;
  const batchById = new Map(deliveryBatchRows.map(row => [row.id, row]));
  const fulfillmentBatchById = new Map(fulfillmentBatchRows.map(row => [row.id, row]));
  const linksByPoLine = activeLinks.reduce<Map<string, PurchaseOrderRequestLineLink[]>>((map, link) => {
    const key = poLineKey(link.purchaseOrderId, link.purchaseOrderLineId);
    map.set(key, [...(map.get(key) || []), link]);
    return map;
  }, new Map());
  const deliveryLinesByPoLine = deliveryLineRows.reduce<Map<string, any[]>>((map, row) => {
    const batch = batchById.get(row.delivery_batch_id);
    if (!batch || !TERMINAL_RECEIPT_STATUSES.has(batch.status)) return map;
    const key = poLineKey(row.purchase_order_id, row.purchase_order_line_id);
    map.set(key, [...(map.get(key) || []), row]);
    return map;
  }, new Map());
  const fulfillmentLinesByPoLine = fulfillmentLineRows.reduce<Map<string, any[]>>((map, row) => {
    const key = poLineKey(row.po_id, row.po_line_id);
    map.set(key, [...(map.get(key) || []), row]);
    return map;
  }, new Map());

  const byDemand = new Map<string, {
    orderedQty: number;
    openCommitmentQty: number;
    unknown: boolean;
    issues: Set<string>;
  }>();
  const addIssue = (target: { unknown: boolean; issues: Set<string> }, issue: string) => {
    target.unknown = true;
    target.issues.add(issue);
  };

  for (const [lineKey, lineLinks] of linksByPoLine.entries()) {
    const deliveryLines = deliveryLinesByPoLine.get(lineKey) || [];
    const fulfillmentLines = fulfillmentLinesByPoLine.get(lineKey) || [];
    const receivedByLinkId = new Map<string, number>();
    const returnedLinkIds = new Set<string>();
    let attributedTotal = 0;
    let attributionMalformed = false;

    const matchLink = (row: any) => {
      if (row.purchase_order_request_line_id) {
        return lineLinks.find(link => link.id === row.purchase_order_request_line_id) || null;
      }
      const matchingLinks = lineLinks.filter(link => (
        link.materialRequestId === row.material_request_id
        && link.requestLineId === row.request_line_id
        && link.itemId === row.item_id
      ));
      return matchingLinks.length === 1 ? matchingLinks[0] : null;
    };

    fulfillmentLines.forEach(row => {
      const batch = fulfillmentBatchById.get(row.batch_id);
      if (!batch || batch.source_type !== 'po_receipt') return;
      const link = matchLink(row);
      if (!link?.id) return;
      if (batch.status === 'returned') {
        returnedLinkIds.add(link.id);
        return;
      }
      if (batch.status !== 'received') return;
      const quantity = strictQuantity(row.received_qty);
      if (quantity == null || !normalizedUnit(row.unit) || normalizedUnit(row.unit) !== normalizedUnit(link.unit)) {
        attributionMalformed = true;
        return;
      }
      receivedByLinkId.set(link.id, (receivedByLinkId.get(link.id) || 0) + quantity);
      attributedTotal += quantity;
    });

    const deliveryQuantities = deliveryLines.map(row => strictQuantity(row.accepted_stock_qty));
    const deliveryMalformed = deliveryQuantities.some(quantity => quantity == null)
      || deliveryLines.some(row => !normalizedUnit(row.stock_unit)
        || lineLinks.some(link => normalizedUnit(link.unit) !== normalizedUnit(row.stock_unit)));
    const acceptedTotal = deliveryQuantities.reduce((sum, quantity) => sum + Number(quantity || 0), 0);
    const allocationExceedsReceipt = deliveryLines.length > 0 && attributedTotal > acceptedTotal + 0.000001;

    lineLinks.forEach(link => {
      const demandKey = buildDemandKey(link.materialRequestId, link.requestLineId);
      const target = byDemand.get(demandKey) || {
        orderedQty: 0,
        openCommitmentQty: 0,
        unknown: false,
        issues: new Set<string>(),
      };
      byDemand.set(demandKey, target);

      const ordered = strictQuantity(link.orderedStockQtySnapshot ?? link.orderedQty);
      if (ordered == null) {
        addIssue(target, 'invalid_ordered_quantity');
        return;
      }
      target.orderedQty += ordered;
      if (attributionMalformed || deliveryMalformed) {
        addIssue(target, 'quantity_or_unit_mismatch');
        return;
      }
      if (allocationExceedsReceipt) {
        addIssue(target, 'receipt_attribution_exceeds_delivery');
        return;
      }
      if (link.id && returnedLinkIds.has(link.id)) {
        addIssue(target, 'return_disposition_unknown');
        return;
      }

      let receivedAttributed: number | null;
      if (link.id && receivedByLinkId.has(link.id)) {
        receivedAttributed = receivedByLinkId.get(link.id)!;
      } else if (lineLinks.length === 1 && deliveryLines.length > 0) {
        receivedAttributed = acceptedTotal;
      } else if (lineLinks.length > 1 && acceptedTotal > 0) {
        const allocationIsComplete = deliveryLines.length > 0
          && Math.abs(attributedTotal - acceptedTotal) <= 0.000001;
        receivedAttributed = allocationIsComplete ? 0 : null;
        if (!allocationIsComplete) addIssue(target, 'missing_receipt_attribution');
      } else {
        receivedAttributed = 0;
      }

      const quantity = openCommitment({
        ordered,
        receivedAttributed,
        terminal: link.allocationStatus === 'cancelled' || link.allocationStatus === 'need_closed',
      });
      if (quantity == null) {
        addIssue(target, 'missing_receipt_attribution');
      } else {
        target.openCommitmentQty += quantity;
      }
    });
  }

  return new Map(Array.from(byDemand.entries()).map(([key, value]) => [key, {
    orderedQty: value.orderedQty,
    openCommitmentQty: value.unknown ? null : value.openCommitmentQty,
    remainingKnown: !value.unknown,
    reconciliationIssues: [...value.issues],
  }]));
};

const loadRequestsForOpenDemand = async (): Promise<MaterialRequest[]> => {
  const rows: any[] = [];
  let cursor: { createdDate: string; id: string } | null = null;
  while (true) {
    let query = supabase
      .from('requests')
      .select(MATERIAL_REQUEST_LIST_SELECT)
      .eq('request_origin', 'project')
      .in('status', [...OPEN_REQUEST_STATUSES])
      .order('created_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(COMPANY_READ_PAGE_SIZE);
    if (cursor) query = query.or(`created_date.lt.${cursor.createdDate},and(created_date.eq.${cursor.createdDate},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (rows.length > COMPANY_READ_MAX_ROWS) throw new Error(`Company procurement request read exceeded safety cap of ${COMPANY_READ_MAX_ROWS} rows`);
    if (page.length < COMPANY_READ_PAGE_SIZE) break;
    const last = page[page.length - 1];
    const next = last ? { createdDate: last.created_date, id: last.id } : null;
    if (!next || (cursor && next.createdDate === cursor.createdDate && next.id === cursor.id)) throw new Error('Company procurement request read received a repeated cursor');
    cursor = next;
  }

  return rows
    .map(mapMaterialRequestFromDb)
    .filter(request => OPEN_REQUEST_STATUSES.has(String(request.status || '')))
    .filter(request => request.workflowStep !== 'rejected' && request.workflowStep !== 'returned_to_creator');
};

const buildPoItemFromDemand = (
  demand: CompanyProcurementDemandLine,
  lineInput: CompanyProcurementCreateLine,
  inventory?: InventoryItem,
): PurchaseOrderItem => {
  const stockQty = Math.max(0, toFiniteNumber(lineInput.orderStockQty));
  const stockUnitPrice = Math.max(0, toFiniteNumber(lineInput.stockUnitPrice));
  const unitSnapshot = buildPoUnitSnapshot(inventory);
  const conversionLine: PurchaseOrderItem = {
    lineId: newId('po-line'),
    itemId: demand.itemId,
    sku: demand.sku || inventory?.sku || '',
    name: demand.itemName,
    unit: demand.unit || inventory?.unit || '',
    qty: stockQty,
    unitPrice: stockUnitPrice,
    ...unitSnapshot,
  };

  const purchaseQty = poLineStockToPurchaseQty(conversionLine, stockQty, inventory);
  return {
    ...conversionLine,
    vendorId: lineInput.vendorId,
    vendorName: lineInput.vendorName || null,
    qty: purchaseQty,
    unitPrice: stockUnitPriceToPurchaseUnitPrice(stockUnitPrice, inventory),
    neededDate: lineInput.neededDate || demand.neededDate || undefined,
    workBoqItemId: demand.requestLine.workBoqItemId || null,
    workBoqItemName: demand.requestLine.workBoqItemName || null,
    materialBudgetItemId: demand.requestLine.materialBudgetItemId || null,
    materialBudgetItemName: demand.requestLine.materialBudgetItemName || null,
    requestId: demand.request.id,
    requestCode: demand.request.code,
    requestLineId: demand.requestLineId,
    budgetQtySnapshot: demand.requestLine.budgetQtySnapshot,
    previousRequestedQtySnapshot: demand.requestLine.previousRequestedQtySnapshot,
    previousOrderedQtySnapshot: demand.orderedQty,
    previousReceivedQtySnapshot: demand.actualReceivedQty,
    isOverBoq: demand.requestLine.isOverBoq,
    overQty: demand.requestLine.overQty,
    overPercent: demand.requestLine.overPercent,
    overReason: demand.requestLine.overReason,
    overBudgetQtySnapshot: demand.requestLine.overBudgetQtySnapshot,
    overBudgetPercentSnapshot: demand.requestLine.overBudgetPercentSnapshot,
    overBudgetReason: demand.requestLine.overBudgetReason,
    isManualItem: demand.requestLine.isManualItem,
    itemNameSnapshot: demand.itemName,
    specification: demand.requestLine.specification,
    manualReason: demand.requestLine.manualReason,
    note: lineInput.note || `Từ đề xuất ${demand.request.code}`,
  };
};

const buildPoLinkFromDemand = (
  po: PurchaseOrder,
  poLine: PurchaseOrderItem,
  demand: CompanyProcurementDemandLine,
  lineInput: CompanyProcurementCreateLine,
): PurchaseOrderRequestLineLink => ({
  projectId: demand.projectId || null,
  constructionSiteId: demand.constructionSiteId || null,
  sourceConstructionSiteId: demand.constructionSiteId || null,
  targetWarehouseId: demand.targetWarehouseId || null,
  allocationStatus: 'open',
  purchaseOrderId: po.id,
  purchaseOrderLineId: poLine.lineId || poLine.itemId,
  materialRequestId: demand.request.id,
  materialRequestCode: demand.request.code,
  requestLineId: demand.requestLineId,
  itemId: demand.itemId,
  workBoqItemId: demand.requestLine.workBoqItemId || null,
  materialBudgetItemId: demand.requestLine.materialBudgetItemId || null,
  requestedQty: demand.requestedQty,
  orderedQty: Math.max(0, toFiniteNumber(lineInput.orderStockQty)),
  requestedQtySnapshot: demand.requestedQty,
  orderedStockQtySnapshot: Math.max(0, toFiniteNumber(lineInput.orderStockQty)),
  actualReceivedQtySnapshot: demand.actualReceivedQty,
  unit: demand.unit || null,
  note: lineInput.note || null,
});

export const companyProcurementService = {
  async listOpenDemand(): Promise<CompanyProcurementDemandLine[]> {
    const requests = await loadRequestsForOpenDemand();
    const requestIds = requests.map(request => request.id);
    const inventoryById = await loadInventoryByIds(requests.flatMap(request => (request.items || []).map(line => line.itemId)));
    const [summaryBundle, commitmentByLine] = await Promise.all([
      materialRequestFulfillmentService.listSummariesByRequests(requests),
      loadActivePoLinksByRequestIds(requestIds),
    ]);

    const rows = requests.flatMap(request => {
      const lineSummaries = summaryBundle.summariesByRequestId[request.id]?.lineSummaries || [];
      const summaryByLine = new Map(lineSummaries.map(line => [line.requestLineId, line]));
      return (request.items || [])
        .map((line, index) => resolveDemandLine(request, line, index, inventoryById, summaryByLine, commitmentByLine))
        .filter((line): line is CompanyProcurementDemandLine => !!line);
    });

    return rows.sort((a, b) => {
      const byNeedDate = String(a.neededDate || '').localeCompare(String(b.neededDate || ''));
      if (byNeedDate !== 0) return byNeedDate;
      return String(b.request.createdDate || '').localeCompare(String(a.request.createdDate || ''));
    });
  },

  async createConsolidatedPurchaseOrders(input: CompanyProcurementCreateInput): Promise<CompanyProcurementCreateResult> {
    const validLines = (input.lines || [])
      .filter(line => line.demandKey && line.vendorId && toFiniteNumber(line.orderStockQty) > 0);
    if (validLines.length === 0) {
      throw new Error('Chưa có dòng nhu cầu hợp lệ để tạo PO gộp.');
    }
    if (!input.actorUserId) {
      throw new Error('Không xác định được người thao tác tạo PO gộp.');
    }

    const demandRows = await this.listOpenDemand();
    const demandByKey = new Map<string, CompanyProcurementDemandLine>(
      demandRows.map(row => [row.key, row] as const),
    );
    const unknownDemand = validLines
      .map(line => demandByKey.get(line.demandKey))
      .find(demand => demand && (!demand.remainingKnown || demand.remainingQty == null));
    if (unknownDemand) {
      throw new Error('Dòng nhu cầu chưa đủ dữ liệu đối chiếu nhận hàng để tạo PO.');
    }
    const inventoryById = await loadInventoryByIds(demandRows.map(row => row.itemId));
    const procurementGroupId = newId('proc-group');
    const procurementGroupNo = buildProcurementGroupNo();
    const now = new Date().toISOString();
    const orderDate = input.orderDate || now.split('T')[0];

    const linesByVendor = validLines.reduce<Map<string, CompanyProcurementCreateLine[]>>((map, line) => {
      map.set(line.vendorId, [...(map.get(line.vendorId) || []), line]);
      return map;
    }, new Map());

    const purchaseOrders: PurchaseOrder[] = [];
    const outcomes: CompanyProcurementCreateResult['outcomes'] = [];
    for (const [vendorId, vendorLines] of linesByVendor.entries()) {
      const firstLine = vendorLines[0];
      const vendorName = firstLine.vendorName || vendorId;
      try {
        const poNumber = await poService.nextNumber();
        const poItems = vendorLines.map(lineInput => {
          const demand = demandByKey.get(lineInput.demandKey);
          if (!demand) throw new Error('Một dòng nhu cầu đã được xử lý hoặc không còn mở.');
          return buildPoItemFromDemand(demand, lineInput, inventoryById.get(demand.itemId));
        });

        const targetWarehouseIds = Array.from(new Set(vendorLines
          .map(line => demandByKey.get(line.demandKey)?.targetWarehouseId || '')
          .filter(Boolean)));
        const totalAmount = poItems.reduce((sum, item) => sum + toFiniteNumber(item.qty) * toFiniteNumber(item.unitPrice), 0);
        const po: PurchaseOrder = {
          id: newId('po'),
          projectId: null,
          constructionSiteId: null,
          vendorId,
          vendorName,
          poNumber,
          items: poItems,
          totalAmount,
          orderDate,
          expectedDeliveryDate: input.expectedDeliveryDate || undefined,
          status: 'draft',
          sourceMode: 'company_consolidated',
          procurementGroupId,
          procurementGroupNo,
          targetWarehouseId: targetWarehouseIds.length === 1 ? targetWarehouseIds[0] : undefined,
          note: [
            `PO công ty ${procurementGroupNo}`,
            input.note || null,
          ].filter(Boolean).join('\n'),
          createdById: input.actorUserId || null,
          createdAt: now,
        };

        const links = vendorLines.map((lineInput, index) => {
          const demand = demandByKey.get(lineInput.demandKey);
          if (!demand) throw new Error('Một dòng nhu cầu đã được xử lý hoặc không còn mở.');
          return buildPoLinkFromDemand(po, poItems[index], demand, lineInput);
        });

        await poService.saveAggregate({
          purchaseOrder: po,
          requestLineLinks: links,
          deliveryBatches: [],
          expected: {
            rowVersion: null,
            requestLineLinks: [],
            deliveryBatches: [],
          },
          actorUserId: input.actorUserId,
          idempotencyKey: globalThis.crypto.randomUUID(),
        });
        purchaseOrders.push(po);
        outcomes.push({
          vendorId,
          vendorName,
          status: 'created',
          purchaseOrder: po,
        });
      } catch (error: any) {
        outcomes.push({
          vendorId,
          vendorName,
          status: 'failed',
          error: String(error?.message || error || 'Không thể tạo PO.'),
        });
      }
    }

    return { procurementGroupId, procurementGroupNo, purchaseOrders, outcomes };
  },

  async listCompanyPurchaseOrders(): Promise<PurchaseOrder[]> {
    const rows: any[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    while (true) {
      let query = supabase
        .from('purchase_orders')
        .select(PURCHASE_ORDER_SELECT)
        .eq('source_mode', 'company_consolidated')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(COMPANY_READ_PAGE_SIZE);
      if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
      const { data, error } = await query;
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (rows.length > COMPANY_READ_MAX_ROWS) throw new Error(`Company purchase order read exceeded safety cap of ${COMPANY_READ_MAX_ROWS} rows`);
      if (page.length < COMPANY_READ_PAGE_SIZE) break;
      const last = page[page.length - 1];
      const next = last ? { createdAt: last.created_at, id: last.id } : null;
      if (!next || (cursor && next.createdAt === cursor.createdAt && next.id === cursor.id)) throw new Error('Company purchase order read received a repeated cursor');
      cursor = next;
    }
    return rows.map(mapPurchaseOrder);
  },

  async listPoLinks(purchaseOrderId: string): Promise<PurchaseOrderRequestLineLink[]> {
    if (!purchaseOrderId) return [];
    const rows = await loadChunkedRows({
      table: 'purchase_order_request_lines',
      projection: PURCHASE_ORDER_REQUEST_LINE_SELECT,
      filterColumn: 'purchase_order_id',
      values: [purchaseOrderId],
    });
    rows.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
    return rows.map(mapPoLink);
  },

  async listCompanyDeliveryGroups(): Promise<CompanyProcurementDeliveryGroupDetail[]> {
    const purchaseOrders = await this.listCompanyPurchaseOrders();
    const poById = new Map(purchaseOrders.map(po => [po.id, po]));
    const poIds = purchaseOrders.map(po => po.id);
    if (poIds.length === 0) return [];

    let groupRows: any[];
    try {
      groupRows = await loadChunkedRows({
        table: 'purchase_order_delivery_groups',
        projection: DELIVERY_GROUP_SELECT,
        filterColumn: 'purchase_order_id',
        values: poIds,
      });
      groupRows.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || String(right.id).localeCompare(String(left.id)));
    } catch (error: any) {
      if (error?.code === '42P01') return [];
      throw error;
    }
    return Promise.all(groupRows.map(async row => {
      const group = mapDeliveryGroup(row);
      const detail = await this.getDeliveryGroupDetail(group.id);
      return {
        ...detail,
        purchaseOrder: poById.get(group.purchaseOrderId) || detail.purchaseOrder || null,
      };
    }));
  },

  async getDeliveryGroupDetail(deliveryGroupId: string): Promise<CompanyProcurementDeliveryGroupDetail> {
    const { data: groupRow, error: groupError } = await supabase
      .from('purchase_order_delivery_groups')
      .select(DELIVERY_GROUP_SELECT)
      .eq('id', deliveryGroupId)
      .single();
    if (groupError) throw groupError;
    const group = mapDeliveryGroup(groupRow);

    const { data: poRow, error: poError } = await supabase
      .from('purchase_orders')
      .select(PURCHASE_ORDER_SELECT)
      .eq('id', group.purchaseOrderId)
      .maybeSingle();
    if (poError) throw poError;
    let batches: any[];
    try {
      batches = await loadChunkedRows({
        table: 'material_request_fulfillment_batches',
        projection: 'id,project_id,construction_site_id,material_request_id,batch_no,batch_date,source_warehouse_id,target_warehouse_id,fulfillment_mode,source_type,status,transaction_id,reason,note,created_by,created_at,issued_by,issued_at,received_by,received_at,cancel_reason,updated_at,qr_token,po_delivery_batch_id,po_delivery_group_id',
        filterColumn: 'po_delivery_group_id',
        values: [deliveryGroupId],
      });
    } catch (error: any) {
      if (error?.code === '42P01') return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
      throw error;
    }

    if (batches.length === 0) {
      return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
    }

    let lineRows: any[];
    try {
      lineRows = await loadChunkedRows({
        table: 'material_request_fulfillment_lines',
        projection: 'id,batch_id,material_request_id,request_line_id,item_id,material_budget_item_id,work_boq_item_id,po_id,po_line_id,requested_qty_snapshot,committed_qty_snapshot,issued_qty,received_qty,unit,variance_reason,note,created_at,updated_at,po_delivery_line_id,purchase_order_request_line_id,delivery_unit,delivery_unit_price',
        filterColumn: 'batch_id',
        values: batches.map(batch => batch.id),
      });
      lineRows.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
    } catch (error: any) {
      if (error?.code === '42P01') return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
      throw error;
    }

    const linesByBatch = new Map<string, any[]>();
    lineRows.forEach(line => {
      linesByBatch.set(line.batch_id, [...(linesByBatch.get(line.batch_id) || []), line]);
    });

    return {
      group,
      purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null,
      batches: batches.map(batch => normalizeBatch(batch, linesByBatch.get(batch.id) || [])),
    };
  },

  async updateDeliveryGroup(input: UpdateCompanyDeliveryGroupInput): Promise<void> {
    const { error } = await supabase.rpc('update_purchase_order_delivery_group_v1', {
      p_delivery_group_id: input.deliveryGroupId,
      p_planned_date: input.plannedDate,
      p_note: input.note || null,
      p_lines: input.lines,
    });
    if (error) throw error;
  },
};

export const resolveBusinessPartnerName = (partner?: BusinessPartner | null) =>
  partner?.name || partner?.code || '';
