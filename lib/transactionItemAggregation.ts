import type { TransactionItem } from '../types';

type AggregatedTransactionItem = {
  quantity: number;
  accountingQty: number;
  accountingUnit: string | null;
  accountingPrice: number | null;
};

const numberOrZero = (value: number | undefined) => Number.isFinite(value) ? value! : 0;

export const aggregateTransactionItemsForInventory = (
  items: TransactionItem[],
  itemId: string,
): AggregatedTransactionItem | null => {
  const matchingItems = items.filter(item => item.itemId === itemId);
  if (matchingItems.length === 0) return null;

  const quantity = matchingItems.reduce((total, item) => total + numberOrZero(item.quantity), 0);
  const accountingQty = matchingItems.reduce((total, item) => total + numberOrZero(item.accountingQty), 0);
  const accountingUnits = new Set(
    matchingItems
      .map(item => item.accountingUnit?.trim())
      .filter((unit): unit is string => Boolean(unit)),
  );
  const accountingUnit = accountingUnits.size === 1 ? [...accountingUnits][0] : null;
  const accountingAmount = matchingItems.reduce(
    (total, item) => total + numberOrZero(item.accountingQty) * numberOrZero(item.accountingPrice),
    0,
  );

  return {
    quantity,
    accountingQty,
    accountingUnit,
    accountingPrice: accountingUnit && accountingQty !== 0
      ? accountingAmount / accountingQty
      : null,
  };
};
