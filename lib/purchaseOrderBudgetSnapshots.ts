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
