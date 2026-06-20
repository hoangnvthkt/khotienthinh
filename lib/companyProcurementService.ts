import { supabase } from './supabase';
import { fromDb } from './dbMapping';
import { mapMaterialRequestFromDb } from './materialRequestService';
import { getRequestLineId, materialRequestFulfillmentService } from './materialRequestFulfillmentService';
import { poService } from './projectService';
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

const ACTIVE_PO_STATUSES = new Set<POStatus>(['draft', 'sent', 'confirmed', 'in_transit', 'partial']);
const OPEN_REQUEST_STATUSES = new Set<string>([
  RequestStatus.APPROVED,
  RequestStatus.IN_TRANSIT,
  RequestStatus.LEGACY_APPROVED,
  'approved',
  'in_transit',
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

const normalizeBatch = (batch: any, lines: any[]): MaterialRequestFulfillmentBatch => ({
  ...fromDb(batch),
  lines: lines.map(fromDb),
}) as MaterialRequestFulfillmentBatch;

const loadInventoryByIds = async (ids: string[]): Promise<Map<string, InventoryItem>> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('items')
    .select('id, sku, name, category, unit, purchase_unit, purchase_conversion_factor, price_in, price_out, min_stock, supplier_id, image_url, location, stock_by_warehouse')
    .in('id', uniqueIds);
  if (error) throw error;
  return new Map((data || []).map(row => {
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
  openOrderedByLine: Map<string, number>,
): CompanyProcurementDemandLine | null => {
  const requestLineId = getRequestLineId(request, line, index);
  const item = inventoryById.get(line.itemId);
  const requestedQty = getLineRequestedQty(line);
  const lineSummary = summaryByLine.get(requestLineId);
  const actualReceivedQty = toFiniteNumber(lineSummary?.receivedQty);
  const closedNeedQty = toFiniteNumber(lineSummary?.closedNeedQty);
  const openNeedQty = Math.max(0, toFiniteNumber(lineSummary?.openNeedQty, requestedQty - actualReceivedQty - closedNeedQty));
  const orderedQty = toFiniteNumber(openOrderedByLine.get(buildDemandKey(request.id, requestLineId)));
  const remainingQty = Math.max(0, openNeedQty - orderedQty);

  if (remainingQty <= 0 && openNeedQty <= 0) return null;

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
    orderedQty,
    actualReceivedQty,
    closedNeedQty,
    openNeedQty,
    remainingQty,
    boqQty: line.budgetQtySnapshot ?? null,
    neededDate: line.neededDate || request.expectedDate || null,
  };
};

const loadActivePoLinksByRequestIds = async (requestIds: string[]) => {
  const uniqueRequestIds = Array.from(new Set(requestIds.filter(Boolean)));
  if (uniqueRequestIds.length === 0) return new Map<string, number>();

  const { data: linkRows, error: linkError } = await supabase
    .from('purchase_order_request_lines')
    .select('*')
    .in('material_request_id', uniqueRequestIds);
  if (linkError) throw linkError;

  const links = (linkRows || []).map(mapPoLink);
  const poIds = Array.from(new Set(links.map(link => link.purchaseOrderId).filter(Boolean)));
  if (poIds.length === 0) return new Map<string, number>();

  const { data: poRows, error: poError } = await supabase
    .from('purchase_orders')
    .select('id,status,archived_at')
    .in('id', poIds);
  if (poError) throw poError;

  const activePoIds = new Set((poRows || [])
    .filter(row => !row.archived_at && ACTIVE_PO_STATUSES.has(row.status as POStatus))
    .map(row => row.id));

  return links.reduce<Map<string, number>>((map, link) => {
    if (!activePoIds.has(link.purchaseOrderId)) return map;
    const key = buildDemandKey(link.materialRequestId, link.requestLineId);
    map.set(key, (map.get(key) || 0) + toFiniteNumber(link.orderedQty || link.orderedStockQtySnapshot));
    return map;
  }, new Map());
};

const loadRequestsForOpenDemand = async (): Promise<MaterialRequest[]> => {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('request_origin', 'project')
    .order('created_date', { ascending: false });
  if (error) throw error;

  return (data || [])
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
    const [summaryBundle, openOrderedByLine] = await Promise.all([
      materialRequestFulfillmentService.listSummariesByRequests(requests),
      loadActivePoLinksByRequestIds(requestIds),
    ]);

    const rows = requests.flatMap(request => {
      const lineSummaries = summaryBundle.summariesByRequestId[request.id]?.lineSummaries || [];
      const summaryByLine = new Map(lineSummaries.map(line => [line.requestLineId, line]));
      return (request.items || [])
        .map((line, index) => resolveDemandLine(request, line, index, inventoryById, summaryByLine, openOrderedByLine))
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

    const demandRows = await this.listOpenDemand();
    const demandByKey = new Map<string, CompanyProcurementDemandLine>(
      demandRows.map(row => [row.key, row] as const),
    );
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
    for (const [vendorId, vendorLines] of linesByVendor.entries()) {
      const poNumber = await poService.nextNumber();
      const firstLine = vendorLines[0];
      const poItems = vendorLines.map(lineInput => {
        const demand = demandByKey.get(lineInput.demandKey);
        if (!demand) throw new Error('Một dòng nhu cầu đã được xử lý hoặc không còn mở.');
        return buildPoItemFromDemand(demand, lineInput, inventoryById.get(demand.itemId));
      });

      const targetWarehouseIds = Array.from(new Set(vendorLines
        .map(line => demandByKey.get(line.demandKey)?.targetWarehouseId || '')
        .filter(Boolean)));
      const vendorName = firstLine.vendorName || vendorId;
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
        createdAt: now,
      };

      const links = vendorLines.map((lineInput, index) => {
        const demand = demandByKey.get(lineInput.demandKey);
        if (!demand) throw new Error('Một dòng nhu cầu đã được xử lý hoặc không còn mở.');
        return buildPoLinkFromDemand(po, poItems[index], demand, lineInput);
      });

      await poService.upsert(po);
      await poService.replaceRequestLineLinks(po.id, links);
      purchaseOrders.push(po);
    }

    return { procurementGroupId, procurementGroupNo, purchaseOrders };
  },

  async listCompanyPurchaseOrders(): Promise<PurchaseOrder[]> {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('source_mode', 'company_consolidated')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPurchaseOrder);
  },

  async listPoLinks(purchaseOrderId: string): Promise<PurchaseOrderRequestLineLink[]> {
    if (!purchaseOrderId) return [];
    const { data, error } = await supabase
      .from('purchase_order_request_lines')
      .select('*')
      .eq('purchase_order_id', purchaseOrderId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapPoLink);
  },

  async listCompanyDeliveryGroups(): Promise<CompanyProcurementDeliveryGroupDetail[]> {
    const purchaseOrders = await this.listCompanyPurchaseOrders();
    const poById = new Map(purchaseOrders.map(po => [po.id, po]));
    const poIds = purchaseOrders.map(po => po.id);
    if (poIds.length === 0) return [];

    const { data: groupRows, error } = await supabase
      .from('purchase_order_delivery_groups')
      .select('*')
      .in('purchase_order_id', poIds)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
    return Promise.all((groupRows || []).map(async row => {
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
      .select('*')
      .eq('id', deliveryGroupId)
      .single();
    if (groupError) throw groupError;
    const group = mapDeliveryGroup(groupRow);

    const [{ data: poRow, error: poError }, { data: batchRows, error: batchError }] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('id', group.purchaseOrderId).maybeSingle(),
      supabase.from('material_request_fulfillment_batches').select('*').eq('po_delivery_group_id', deliveryGroupId),
    ]);
    if (poError) throw poError;
    if (batchError) {
      if (batchError.code === '42P01') return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
      throw batchError;
    }

    const batches = batchRows || [];
    if (batches.length === 0) {
      return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
    }

    const { data: lineRows, error: lineError } = await supabase
      .from('material_request_fulfillment_lines')
      .select('*')
      .in('batch_id', batches.map(batch => batch.id))
      .order('created_at', { ascending: true });
    if (lineError) {
      if (lineError.code === '42P01') return { group, purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null, batches: [] };
      throw lineError;
    }

    const linesByBatch = new Map<string, any[]>();
    (lineRows || []).forEach(line => {
      linesByBatch.set(line.batch_id, [...(linesByBatch.get(line.batch_id) || []), line]);
    });

    return {
      group,
      purchaseOrder: poRow ? mapPurchaseOrder(poRow) : null,
      batches: batches.map(batch => normalizeBatch(batch, linesByBatch.get(batch.id) || [])),
    };
  },
};

export const resolveBusinessPartnerName = (partner?: BusinessPartner | null) =>
  partner?.name || partner?.code || '';
