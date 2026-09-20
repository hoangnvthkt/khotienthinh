import type { ProcurementDemandBalance, ProcurementDemandBalanceInput } from '../../types/procurementIdentity';
import { formatDecimal6, parseQuantity6 } from './decimal';

/** Projection only. Server commands must recalculate under resource locks. */
export function calculateDemandBalance(input: ProcurementDemandBalanceInput): ProcurementDemandBalance {
  const fulfilled = parseQuantity6(input.fulfilled);
  const closed = parseQuantity6(input.closed);
  const reserved = parseQuantity6(input.reserved);
  const committed = parseQuantity6(input.committed);
  if (input.approved === null) {
    return { openNeed: null, availableToPlan: null, coverageExcess: null, receivedExcess: null };
  }
  const approved = parseQuantity6(input.approved);
  const open = approved - fulfilled - closed;
  const held = reserved + committed;
  const nonnegative = (value: bigint) => formatDecimal6(value > 0n ? value : 0n);
  return {
    openNeed: nonnegative(open),
    availableToPlan: nonnegative(open - held),
    coverageExcess: nonnegative(fulfilled + closed + held - approved),
    receivedExcess: nonnegative(fulfilled - approved),
  };
}
