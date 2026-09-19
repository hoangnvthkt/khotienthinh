export type CommitmentQuantity = {
  ordered: number;
  receivedAttributed: number | null;
  terminal: boolean;
};

const assertQuantity = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid commitment quantity');
  }
};

export const openCommitment = (input: CommitmentQuantity): number | null => {
  assertQuantity(input.ordered);
  if (input.terminal) return 0;
  if (input.receivedAttributed == null) return null;
  assertQuantity(input.receivedAttributed);
  return Math.max(0, input.ordered - input.receivedAttributed);
};
