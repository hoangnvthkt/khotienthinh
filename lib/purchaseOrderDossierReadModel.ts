import type { PurchaseOrderDeliveryBatch } from '../types';

export type PurchaseOrderDossierQuantityIssueCode =
  | 'missing_demand_conversion'
  | 'missing_planned_conversion'
  | 'missing_accepted_stock_quantity';

export interface PurchaseOrderDossierDemandLine {
  purchaseOrderLineId: string;
  itemId: string;
  purchaseQty: number;
  purchaseUnit?: string | null;
  stockUnit?: string | null;
  conversionFactor?: number | null;
}

export interface PurchaseOrderDossierQuantityIssue {
  code: PurchaseOrderDossierQuantityIssueCode;
  purchaseOrderLineId: string;
  deliveryBatchId?: string;
}

export interface PurchaseOrderDossierQuantityGroup {
  key: string;
  itemId: string;
  stockUnit: string;
  demandStockQty: number | null;
  approvedPlannedStockQty: number | null;
  receivedAcceptedStockQty: number | null;
  remainingStockQty: number | null;
}

export interface PurchaseOrderDossierQuantitySummary {
  groups: PurchaseOrderDossierQuantityGroup[];
  counts: {
    demandLines: number;
    approvedLines: number;
    receivedLines: number;
    terminalBatches: number;
  };
  aggregate: {
    stockUnit: string;
    demandQty: number;
    approvedQty: number;
    receivedQty: number;
    remainingQty: number;
    receivedPercent: number | null;
  } | null;
  qualityIssues: PurchaseOrderDossierQuantityIssue[];
}

type MutableQuantityGroup = Omit<PurchaseOrderDossierQuantityGroup, 'remainingStockQty'>;

const RECEIVED_TERMINAL_STATUSES = new Set<PurchaseOrderDeliveryBatch['status']>([
  'received',
  'received_short',
  'received_over',
]);

const normalizedUnit = (value?: string | null) => String(value || '').trim().toLowerCase();
const displayUnit = (value?: string | null) => String(value || '').trim() || 'Chưa xác định';
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const finiteQuantity = (value: unknown): number | null => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
};
const addQuantity = (current: number | null, value: number | null): number | null => (
  current == null || value == null ? null : rounded(current + value)
);

const groupKey = (itemId: string, stockUnit?: string | null) =>
  `${itemId}|${normalizedUnit(stockUnit) || 'unknown'}`;

export const buildPurchaseOrderDossierQuantitySummary = (input: {
  demandLines: PurchaseOrderDossierDemandLine[];
  deliveryBatches: PurchaseOrderDeliveryBatch[];
}): PurchaseOrderDossierQuantitySummary => {
  const groups = new Map<string, MutableQuantityGroup>();
  const qualityIssues: PurchaseOrderDossierQuantityIssue[] = [];
  let approvedLines = 0;
  let receivedLines = 0;
  let terminalBatches = 0;

  const ensureGroup = (itemId: string, stockUnit?: string | null): MutableQuantityGroup => {
    const key = groupKey(itemId, stockUnit);
    const current = groups.get(key);
    if (current) return current;
    const created: MutableQuantityGroup = {
      key,
      itemId,
      stockUnit: displayUnit(stockUnit),
      demandStockQty: 0,
      approvedPlannedStockQty: 0,
      receivedAcceptedStockQty: 0,
    };
    groups.set(key, created);
    return created;
  };

  input.demandLines.forEach(line => {
    const group = ensureGroup(line.itemId, line.stockUnit);
    const purchaseQty = finiteQuantity(line.purchaseQty);
    const purchaseUnit = normalizedUnit(line.purchaseUnit);
    const stockUnit = normalizedUnit(line.stockUnit);
    const conversionFactor = finiteQuantity(line.conversionFactor);
    let stockQty: number | null = purchaseQty;
    if (!purchaseUnit || !stockUnit || purchaseUnit !== stockUnit) {
      stockQty = purchaseQty != null && conversionFactor != null && conversionFactor > 0
        ? rounded(purchaseQty * conversionFactor)
        : null;
    }
    if (stockQty == null) {
      qualityIssues.push({
        code: 'missing_demand_conversion',
        purchaseOrderLineId: line.purchaseOrderLineId,
      });
    }
    group.demandStockQty = addQuantity(group.demandStockQty, stockQty);
  });

  input.deliveryBatches.forEach(batch => {
    if (batch.status === 'cancelled') return;
    const isApproved = batch.approvalStatus === 'approved';
    const isReceived = RECEIVED_TERMINAL_STATUSES.has(batch.status);
    if (isReceived) terminalBatches += 1;

    batch.lines.forEach(line => {
      const group = ensureGroup(line.itemId, line.stockUnit);
      if (isApproved) {
        approvedLines += 1;
        const purchaseUnit = normalizedUnit(line.unit);
        const stockUnit = normalizedUnit(line.stockUnit);
        let plannedStockQty = line.stockPlannedQty == null
          ? null
          : finiteQuantity(line.stockPlannedQty);
        if (plannedStockQty == null && purchaseUnit && purchaseUnit === stockUnit) {
          plannedStockQty = finiteQuantity(line.plannedQty);
        }
        if (plannedStockQty == null) {
          qualityIssues.push({
            code: 'missing_planned_conversion',
            purchaseOrderLineId: line.purchaseOrderLineId,
            deliveryBatchId: batch.id,
          });
        }
        group.approvedPlannedStockQty = addQuantity(group.approvedPlannedStockQty, plannedStockQty);
      }

      if (isReceived) {
        receivedLines += 1;
        const receivedStockQty = line.acceptedStockQty == null
          ? null
          : finiteQuantity(line.acceptedStockQty);
        if (receivedStockQty == null) {
          qualityIssues.push({
            code: 'missing_accepted_stock_quantity',
            purchaseOrderLineId: line.purchaseOrderLineId,
            deliveryBatchId: batch.id,
          });
        }
        group.receivedAcceptedStockQty = addQuantity(group.receivedAcceptedStockQty, receivedStockQty);
      }
    });
  });

  const resultGroups = Array.from(groups.values())
    .map(group => ({
      ...group,
      remainingStockQty: group.demandStockQty == null || group.receivedAcceptedStockQty == null
        ? null
        : rounded(group.demandStockQty - group.receivedAcceptedStockQty),
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId) || left.stockUnit.localeCompare(right.stockUnit));

  const onlyGroup = resultGroups.length === 1 ? resultGroups[0] : null;
  const aggregate = onlyGroup
    && onlyGroup.demandStockQty != null
    && onlyGroup.approvedPlannedStockQty != null
    && onlyGroup.receivedAcceptedStockQty != null
    && onlyGroup.remainingStockQty != null
    ? {
      stockUnit: onlyGroup.stockUnit,
      demandQty: onlyGroup.demandStockQty,
      approvedQty: onlyGroup.approvedPlannedStockQty,
      receivedQty: onlyGroup.receivedAcceptedStockQty,
      remainingQty: onlyGroup.remainingStockQty,
      receivedPercent: onlyGroup.demandStockQty > 0
        ? Math.round((onlyGroup.receivedAcceptedStockQty / onlyGroup.demandStockQty) * 100)
        : null,
    }
    : null;

  return {
    groups: resultGroups,
    counts: {
      demandLines: input.demandLines.length,
      approvedLines,
      receivedLines,
      terminalBatches,
    },
    aggregate,
    qualityIssues,
  };
};
