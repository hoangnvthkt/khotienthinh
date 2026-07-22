export const dateInputToTransactionTimestamp = (date: string): string | undefined => {
  if (!date) return undefined;
  return new Date(`${date}T12:00:00.000Z`).toISOString();
};
