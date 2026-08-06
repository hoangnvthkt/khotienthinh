import { describe, expect, it } from 'vitest';
import type { TransactionItem } from '../../types';
import { aggregateTransactionItemsForInventory } from '../transactionItemAggregation';

describe('aggregateTransactionItemsForInventory', () => {
  it('sums matching quantities and calculates a weighted accounting price for one accounting unit', () => {
    const items: TransactionItem[] = [
      { itemId: 'item-1', quantity: 3, accountingQty: 3, accountingUnit: 'KG', accountingPrice: 10_000 },
      { itemId: 'item-1', quantity: 7, accountingQty: 7, accountingUnit: 'KG', accountingPrice: 12_000 },
      { itemId: 'item-2', quantity: 5, accountingQty: 5, accountingUnit: 'KG', accountingPrice: 15_000 },
    ];

    expect(aggregateTransactionItemsForInventory(items, 'item-1')).toEqual({
      quantity: 10,
      accountingQty: 10,
      accountingUnit: 'KG',
      accountingPrice: 11_400,
    });
  });

  it('withholds the accounting price when matching lines use mixed accounting units', () => {
    const items: TransactionItem[] = [
      { itemId: 'item-1', quantity: 3, accountingQty: 3, accountingUnit: 'KG', accountingPrice: 10_000 },
      { itemId: 'item-1', quantity: 7, accountingQty: 7, accountingUnit: 'M', accountingPrice: 12_000 },
    ];

    expect(aggregateTransactionItemsForInventory(items, 'item-1')).toEqual({
      quantity: 10,
      accountingQty: 10,
      accountingUnit: null,
      accountingPrice: null,
    });
  });

  it('withholds the accounting unit and price when an accounting line has no unit', () => {
    const items: TransactionItem[] = [
      { itemId: 'item-1', quantity: 3, accountingQty: 3, accountingUnit: 'KG', accountingPrice: 10_000 },
      { itemId: 'item-1', quantity: 7, accountingQty: 7, accountingPrice: 12_000 },
    ];

    expect(aggregateTransactionItemsForInventory(items, 'item-1')).toEqual({
      quantity: 10,
      accountingQty: 10,
      accountingUnit: null,
      accountingPrice: null,
    });
  });

  it('withholds the accounting unit and price when an accounting line has a blank unit', () => {
    const items: TransactionItem[] = [
      { itemId: 'item-1', quantity: 3, accountingQty: 3, accountingUnit: 'KG', accountingPrice: 10_000 },
      { itemId: 'item-1', quantity: 7, accountingQty: 7, accountingUnit: ' ', accountingPrice: 12_000 },
    ];

    expect(aggregateTransactionItemsForInventory(items, 'item-1')).toEqual({
      quantity: 10,
      accountingQty: 10,
      accountingUnit: null,
      accountingPrice: null,
    });
  });

  it('returns a null accounting price when the total accounting quantity is zero', () => {
    const items: TransactionItem[] = [
      { itemId: 'item-1', quantity: 3, accountingQty: 0, accountingUnit: 'KG', accountingPrice: 10_000 },
      { itemId: 'item-1', quantity: 7, accountingQty: 0, accountingUnit: 'KG', accountingPrice: 12_000 },
    ];

    expect(aggregateTransactionItemsForInventory(items, 'item-1')).toEqual({
      quantity: 10,
      accountingQty: 0,
      accountingUnit: 'KG',
      accountingPrice: null,
    });
  });
});
