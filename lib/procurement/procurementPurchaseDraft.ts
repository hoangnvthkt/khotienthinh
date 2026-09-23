import { formatDecimal6, parseDecimal6, parseQuantity6 } from './decimal';
import type { ProcurementV2Source } from '../../types/procurementV2';

const SCALE = 1_000_000n;

export interface ProcurementPurchaseSelection {
  adapter: ProcurementV2Source;
  demandId: string;
  demandLineId: string;
  sourceRevisionId: string;
  expectedVersion: string;
  sourceDocumentId: string;
  sourceCode: string;
  sourceLineId: string;
  itemId: string;
  itemName: string;
  unit: string;
  requestedQty: string;
  fulfilledQty: string;
  availableQty: string | null;
  needQty: string;
  purchaseUnit: string;
  conversionNumerator: string;
  conversionDenominator: string;
  unitPrice: string | null;
  canViewPrice: boolean;
  canAllocate: boolean;
  vendorId: string;
  vendorName: string;
  projectId: string;
  constructionSiteId: string | null;
  warehouseId: string;
  neededDate: string | null;
  note: string;
  poLineId: string;
}

export interface ProcurementPurchaseOrderInput {
  id: string;
  poNumber: string;
  actorUserId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  idempotencyKey: string;
  note?: string;
}

export function buildProcurementPurchaseDraft(
  selections: ProcurementPurchaseSelection[], order: ProcurementPurchaseOrderInput,
) {
  if (!selections.length || !order.id?.trim() || !order.actorUserId?.trim()
    || !order.idempotencyKey?.trim() || !order.poNumber?.trim())
    throw new Error('PURCHASE_DRAFT_INCOMPLETE');
  const first = selections[0];
  const demandIds = new Set<string>();
  const poLineIds = new Set<string>();
  let totalAmount = 0n;
  const requestLineLinks: Array<Record<string, string | null>> = [];
  const allocations: Array<Record<string, string>> = [];
  const items = selections.map(line => {
    if (line.vendorId !== first.vendorId || line.projectId !== first.projectId
      || line.constructionSiteId !== first.constructionSiteId
      || line.warehouseId !== first.warehouseId) throw new Error('PURCHASE_SCOPE_MIXED');
    if (!line.demandLineId?.trim() || demandIds.has(line.demandLineId))
      throw new Error('PURCHASE_DEMAND_LINE_DUPLICATE');
    demandIds.add(line.demandLineId);
    if (!line.poLineId?.trim() || poLineIds.has(line.poLineId))
      throw new Error('PURCHASE_LINE_ID_DUPLICATE');
    poLineIds.add(line.poLineId);
    if (!line.canAllocate) throw new Error('PURCHASE_ALLOCATION_DENIED');
    if (line.availableQty === null) throw new Error('PURCHASE_QUANTITY_UNKNOWN');
    if (!line.canViewPrice) throw new Error('PURCHASE_PRICE_HIDDEN');
    if (line.unitPrice === null) throw new Error('PURCHASE_PRICE_REQUIRED');
    if (!line.itemId?.trim() || !line.unit?.trim() || !line.purchaseUnit?.trim()
      || !line.vendorId?.trim() || !line.warehouseId?.trim()
      || !line.sourceRevisionId?.trim() || !line.sourceDocumentId?.trim()
      || !line.sourceLineId?.trim() || !/^\d+$/.test(line.expectedVersion))
      throw new Error('PURCHASE_DRAFT_INCOMPLETE');
    if (!line.conversionNumerator || !line.conversionDenominator)
      throw new Error('PURCHASE_CONVERSION_REQUIRED');
    const numerator = parseQuantity6(line.conversionNumerator);
    const denominator = parseQuantity6(line.conversionDenominator);
    if (numerator <= 0n || denominator <= 0n) throw new Error('PURCHASE_CONVERSION_REQUIRED');
    const need = parseQuantity6(line.needQty);
    const available = parseQuantity6(line.availableQty);
    if (need <= 0n || need > available) throw new Error('PURCHASE_QUANTITY_UNAVAILABLE');
    const purchaseRaw = need * denominator;
    if (purchaseRaw % numerator !== 0n) throw new Error('PURCHASE_CONVERSION_INEXACT');
    if ((numerator * SCALE) % denominator !== 0n)
      throw new Error('PURCHASE_CONVERSION_INEXACT');
    const purchaseQty = purchaseRaw / numerator;
    if (purchaseQty <= 0n) throw new Error('PURCHASE_CONVERSION_INEXACT');
    const price = parseDecimal6(line.unitPrice);
    if (price < 0n) throw new Error('PURCHASE_PRICE_REQUIRED');
    const lineAmount = (purchaseQty * price + SCALE / 2n) / SCALE;
    totalAmount += lineAmount;
    const purchaseQtyText = formatDecimal6(purchaseQty);
    const needText = formatDecimal6(need);
    if (line.adapter === 'project_material_request') {
      requestLineLinks.push({
        project_id: line.projectId, construction_site_id: line.constructionSiteId,
        source_construction_site_id: line.constructionSiteId,
        target_warehouse_id: line.warehouseId, allocation_status: 'open',
        purchase_order_id: order.id, purchase_order_line_id: line.poLineId,
        material_request_id: line.sourceDocumentId, material_request_code: line.sourceCode,
        request_line_id: line.sourceLineId, item_id: line.itemId,
        requested_qty: line.requestedQty, ordered_qty: needText,
        requested_qty_snapshot: line.requestedQty, ordered_stock_qty_snapshot: needText,
        actual_received_qty_snapshot: line.fulfilledQty, unit: line.unit,
        note: line.note || null,
      });
    }
    allocations.push({
      demandLineId: line.demandLineId, sourceRevisionId: line.sourceRevisionId,
      purchaseOrderLineId: line.poLineId, expectedVersion: line.expectedVersion,
      needQty: needText, needUnit: line.unit, executionQty: purchaseQtyText,
      executionUnit: line.purchaseUnit,
      conversionNumerator: formatDecimal6(numerator),
      conversionDenominator: formatDecimal6(denominator),
      reason: line.note || `Lập PO từ ${line.sourceCode}`,
    });
    return {
      lineId: line.poLineId, itemId: line.itemId, name: line.itemName,
      unit: line.purchaseUnit, stockUnitSnapshot: line.unit,
      purchaseUnitSnapshot: line.purchaseUnit,
      purchaseConversionFactor: formatDecimal6(numerator * SCALE / denominator),
      qty: purchaseQtyText, unitPrice: formatDecimal6(price),
      neededDate: line.neededDate, note: line.note,
    };
  });
  return {
    purchaseOrder: {
      id: order.id, po_number: order.poNumber, project_id: first.projectId,
      construction_site_id: first.constructionSiteId,
      target_warehouse_id: first.warehouseId,
      vendor_id: first.vendorId, vendor_name: first.vendorName,
      order_date: order.orderDate, expected_delivery_date: order.expectedDeliveryDate,
      status: 'draft', source_mode: 'company_consolidated', purchase_mode: 'single',
      items, total_amount: formatDecimal6(totalAmount),
      note: order.note || null, created_by_id: order.actorUserId,
    },
    requestLineLinks, allocations,
  };
}
