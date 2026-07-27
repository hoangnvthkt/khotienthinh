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

/**
 * Formats live input string or number with Vietnamese number formatting:
 * - Dot (.) as thousand separator (e.g. 35680 -> 35.680)
 * - Comma (,) as decimal separator (e.g. 35680,5 -> 35.680,5)
 * - Preserves trailing comma so user can continue typing decimals (e.g. "35.680,")
 */
export const formatViLiveInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value).trim();
  if (str === '') return '';

  const isNegative = str.startsWith('-');
  const cleaned = str.replace(/[^0-9,.]/g, '');
  if (!cleaned) return isNegative ? '-' : '';

  let integerPartStr = cleaned;
  let decimalPartStr = '';
  let hasDecimal = false;

  if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    integerPartStr = parts[0].replace(/\./g, '');
    decimalPartStr = parts.slice(1).join('');
    hasDecimal = true;
  } else if (cleaned.includes('.')) {
    const lastDotIdx = cleaned.lastIndexOf('.');
    const digitsAfterLastDot = cleaned.slice(lastDotIdx + 1);
    const isThousandDot = /\.\d{3}(?:\.|$)/.test(cleaned);
    if (isThousandDot) {
      integerPartStr = cleaned.replace(/\./g, '');
    } else {
      integerPartStr = cleaned.slice(0, lastDotIdx).replace(/\./g, '');
      decimalPartStr = digitsAfterLastDot;
      hasDecimal = true;
    }
  }

  const digitsOnly = integerPartStr.replace(/\D/g, '');
  const formattedInteger = digitsOnly ? Number(digitsOnly).toLocaleString('vi-VN') : '0';
  const prefix = isNegative ? '-' : '';

  if (hasDecimal) {
    return `${prefix}${formattedInteger},${decimalPartStr}`;
  }
  return `${prefix}${formattedInteger}`;
};

