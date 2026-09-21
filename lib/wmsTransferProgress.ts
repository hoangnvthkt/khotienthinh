import { formatDecimal6, parseQuantity6 } from './procurement/decimal';

export type TransferProgressInput = {
  dispatched: string;
  received: string;
  returned: string;
  lost: string;
};

export const deriveTransferProgress = (input: TransferProgressInput): {
  inTransit: string;
  complete: boolean;
} => {
  const dispatched = parseQuantity6(input.dispatched);
  const disposed = parseQuantity6(input.received)
    + parseQuantity6(input.returned)
    + parseQuantity6(input.lost);
  if (disposed > dispatched) throw new Error('WMS_TRANSFER_DISPOSITION_EXCEEDED');
  const inTransit = dispatched - disposed;
  return { inTransit: formatDecimal6(inTransit), complete: inTransit === 0n };
};
