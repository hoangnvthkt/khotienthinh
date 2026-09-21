import { formatDecimal6, parseDecimal6 } from './procurement/decimal';

export type InventoryReconciliationClassification =
  | 'matched'
  | 'cache_missing'
  | 'negative_quantity'
  | 'quantity_mismatch';

export const classifyInventoryReconciliation = (input: {
  cacheQty: string | null;
  ledgerQty: string;
}): {
  classification: InventoryReconciliationClassification;
  difference: string | null;
  authoritative: boolean;
} => {
  const ledger = parseDecimal6(input.ledgerQty);
  if (input.cacheQty == null) {
    return { classification: 'cache_missing', difference: null, authoritative: false };
  }
  const cache = parseDecimal6(input.cacheQty);
  const difference = cache - ledger;
  if (cache < 0n || ledger < 0n) {
    return { classification: 'negative_quantity', difference: formatDecimal6(difference), authoritative: false };
  }
  if (difference !== 0n) {
    return { classification: 'quantity_mismatch', difference: formatDecimal6(difference), authoritative: false };
  }
  return { classification: 'matched', difference: '0', authoritative: true };
};
