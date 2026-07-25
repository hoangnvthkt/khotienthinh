export const formatInventoryQuantity = (value: unknown): string =>
  Number(value || 0).toLocaleString('vi-VN');
