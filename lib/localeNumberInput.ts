export const parseNonNegativeLocaleNumber = (value: unknown): number => {
  const raw = typeof value === 'string'
    ? value.trim().replace(/[\s\u00a0]/g, '').replace(/[^\d,.-]/g, '')
    : value;
  if (typeof raw === 'string') {
    const sign = raw.startsWith('-') ? '-' : '';
    const unsigned = raw.replace(/-/g, '');
    const lastComma = unsigned.lastIndexOf(',');
    const lastDot = unsigned.lastIndexOf('.');
    let normalized = unsigned;

    if (lastComma >= 0 && lastDot >= 0) {
      normalized = lastComma > lastDot
        ? unsigned.replace(/\./g, '').replace(',', '.')
        : unsigned.replace(/,/g, '');
    } else if (lastComma >= 0) {
      normalized = unsigned.replace(/\./g, '').replace(',', '.');
    } else if (/\.\d{3}(?:\.|$)/.test(unsigned)) {
      normalized = unsigned.replace(/\./g, '');
    }

    const parsed = Number(`${sign}${normalized}` || 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }

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
