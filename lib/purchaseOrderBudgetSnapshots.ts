import type { MaterialBudgetItem, ProjectWorkBoqItem, PurchaseOrderItem } from '../types';

export type PurchaseOrderBudgetLineInput = {
  lineId: string;
  materialBudgetItemId: string | null;
  stockQty: number;
};

export type PurchaseOrderBudgetBaseline = {
  budgetQty: number;
  previousRequestedQty: number;
  previousOrderedQty: number;
};

export type PurchaseOrderBudgetSnapshot = {
  reservedBeforeQtySnapshot: number;
  overBudgetQtySnapshot: number;
  overBudgetPercentSnapshot: number;
};

export const ensurePurchaseOrderLineIds = <T extends { lineId?: string | null }>(
  lines: T[],
  createLineId: () => string,
): Array<Omit<T, 'lineId'> & { lineId: string }> => lines.map(line => ({
  ...line,
  lineId: line.lineId || createLineId(),
}));

export const getSequentialPoBudgetSnapshot = (
  snapshots: Map<string, PurchaseOrderBudgetSnapshot>,
  lineId: string,
) => snapshots.get(lineId);

export type PurchaseOrderBudgetSnapshotBuilderInput = {
  materialBudgetMap: Map<string, MaterialBudgetItem>;
  workBoqMap: Map<string, ProjectWorkBoqItem>;
  previousRequestedQtyByBudget: Map<string, number>;
  previousOrderedQtyByBudget: Map<string, number>;
  snapshotsByLineId: Map<string, PurchaseOrderBudgetSnapshot>;
};

export const createPurchaseOrderBudgetSnapshotBuilder = ({
  materialBudgetMap,
  workBoqMap,
  previousRequestedQtyByBudget,
  previousOrderedQtyByBudget,
  snapshotsByLineId,
}: PurchaseOrderBudgetSnapshotBuilderInput) => (line: PurchaseOrderItem): PurchaseOrderItem => {
  if (!line.materialBudgetItemId) return line;
  const budget = materialBudgetMap.get(line.materialBudgetItemId);
  if (!budget) return line;
  const work = budget.workBoqItemId ? workBoqMap.get(budget.workBoqItemId) : undefined;
  const previousRequested = previousRequestedQtyByBudget.get(budget.id) || 0;
  const previousOrdered = previousOrderedQtyByBudget.get(budget.id) || 0;
  const allocationSnapshot = getSequentialPoBudgetSnapshot(snapshotsByLineId, line.lineId);
  const reservedBeforeQty = allocationSnapshot?.reservedBeforeQtySnapshot || 0;
  const overBudgetQty = allocationSnapshot?.overBudgetQtySnapshot || 0;
  const overBudgetPercent = allocationSnapshot?.overBudgetPercentSnapshot || 0;

  return {
    ...line,
    workBoqItemId: line.workBoqItemId || budget.workBoqItemId || null,
    workBoqItemName: line.workBoqItemName || work?.name || null,
    materialBudgetItemId: budget.id,
    materialBudgetItemName: line.materialBudgetItemName || budget.itemName,
    budgetQtySnapshot: Number(budget.budgetQty || 0),
    reservedBeforeQtySnapshot: reservedBeforeQty,
    previousRequestedQtySnapshot: previousRequested,
    previousOrderedQtySnapshot: previousOrdered,
    previousReceivedQtySnapshot: Number(budget.cumulativeImported || 0),
    isOverBoq: overBudgetQty > 0,
    overQty: overBudgetQty,
    overPercent: overBudgetPercent,
    overReason: line.overReason || line.overBudgetReason || '',
    overBudgetQtySnapshot: overBudgetQty,
    overBudgetPercentSnapshot: overBudgetPercent,
  };
};

export const calculateSequentialPoBudgetSnapshots = (
  lines: PurchaseOrderBudgetLineInput[],
  baselines: Map<string, PurchaseOrderBudgetBaseline>,
): Map<string, PurchaseOrderBudgetSnapshot> => {
  const runningQtyByBudget = new Map<string, number>();
  const snapshots = new Map<string, PurchaseOrderBudgetSnapshot>();

  lines.forEach(line => {
    if (!line.materialBudgetItemId) return;
    const baseline = baselines.get(line.materialBudgetItemId);
    if (!baseline) return;

    const runningQty = runningQtyByBudget.get(line.materialBudgetItemId) || 0;
    const reservedBeforeQtySnapshot = baseline.previousRequestedQty + baseline.previousOrderedQty + runningQty;
    const overBefore = Math.max(0, reservedBeforeQtySnapshot - baseline.budgetQty);
    const overAfter = Math.max(0, reservedBeforeQtySnapshot + line.stockQty - baseline.budgetQty);
    const overBudgetQtySnapshot = Math.max(0, overAfter - overBefore);
    const overBudgetPercentSnapshot = baseline.budgetQty > 0
      ? Math.round((overBudgetQtySnapshot / baseline.budgetQty) * 1000) / 10
      : 0;

    snapshots.set(line.lineId, {
      reservedBeforeQtySnapshot,
      overBudgetQtySnapshot,
      overBudgetPercentSnapshot,
    });
    runningQtyByBudget.set(line.materialBudgetItemId, runningQty + line.stockQty);
  });

  return snapshots;
};
