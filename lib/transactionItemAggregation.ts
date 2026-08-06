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
  const accountingItems = matchingItems.filter(item =>
    item.accountingQty !== undefined || item.accountingUnit !== undefined || item.accountingPrice !== undefined,
  );
  const hasMissingAccountingUnit = accountingItems.some(item => !item.accountingUnit?.trim());
  const accountingUnits = new Set(
    accountingItems
      .map(item => item.accountingUnit?.trim())
      .filter((unit): unit is string => Boolean(unit)),
  );
  const accountingUnit = !hasMissingAccountingUnit && accountingUnits.size === 1
    ? [...accountingUnits][0]
    : null;
  const accountingAmount = matchingItems.reduce(
    (total, item) => total + numberOrZero(item.accountingQty) * numberOrZero(item.accountingPrice),
    0,
  );
  const hasMissingAccountingPrice = matchingItems.some(item =>
    numberOrZero(item.accountingQty) !== 0 && !Number.isFinite(item.accountingPrice),
  );

  return {
    quantity,
    accountingQty,
    accountingUnit,
    accountingPrice: accountingUnit && accountingQty !== 0 && !hasMissingAccountingPrice
      ? accountingAmount / accountingQty
      : null,
  };
};
