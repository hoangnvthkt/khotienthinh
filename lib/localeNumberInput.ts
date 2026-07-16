export const parseNonNegativeLocaleNumber = (value: unknown): number => {
  const raw = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const parsed = Number(raw || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

export const formatLocaleDecimalInput = (value: unknown, maximumFractionDigits = 3): string => {
  const parsed = parseNonNegativeLocaleNumber(value);
  return new Intl.NumberFormat('vi-VN', {
    useGrouping: false,
    maximumFractionDigits,
  }).format(parsed);
};
