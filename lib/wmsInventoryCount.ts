import { formatDecimal6, parseDecimal6, parseQuantity6 } from './procurement/decimal';

export const deriveInventoryCountVariance = (input: {
  snapshotQty: string;
  movementQty: string;
  countedQty: string;
}) => {
  const expected = parseQuantity6(input.snapshotQty) + parseDecimal6(input.movementQty);
  if (expected < 0n) throw new Error('WMS_INVENTORY_COUNT_EXPECTED_NEGATIVE');
  const counted = parseQuantity6(input.countedQty);
  return {
    expectedQtyAtPost: formatDecimal6(expected),
    varianceQty: formatDecimal6(counted - expected),
  };
};
