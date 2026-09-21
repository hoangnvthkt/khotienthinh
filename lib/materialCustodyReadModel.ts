import { formatDecimal6, parseQuantity6 } from './procurement/decimal';

export type MaterialCustodyInput = {
  issued: string;
  consumed: string;
  returned: string;
  lost: string;
  workBoqItemId?: string | null;
  materialBudgetItemId?: string | null;
};

export const deriveMaterialCustodyLine = (input: MaterialCustodyInput) => {
  const issued = parseQuantity6(input.issued);
  const settled = parseQuantity6(input.consumed)
    + parseQuantity6(input.returned)
    + parseQuantity6(input.lost);
  if (settled > issued) throw new Error('MATERIAL_CUSTODY_SETTLEMENT_EXCEEDED');
  return {
    custody: formatDecimal6(issued - settled),
    allocationComplete: !!input.workBoqItemId && !!input.materialBudgetItemId,
    workBoqItemId: input.workBoqItemId ?? null,
    materialBudgetItemId: input.materialBudgetItemId ?? null,
  };
};
