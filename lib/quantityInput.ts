// Vật tư uses Vietnamese number entry: comma for decimals and no thousands
// grouping. Keeping the text as-entered lets a user type `12,5` naturally.
const DECIMAL_INPUT_PATTERN = /^\d*(?:,\d*)?$/;

export const formatQuantityInput = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : '';
  return value;
};

export const parseQuantityInput = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') return value;
  const normalized = formatQuantityInput(value).trim().replace(',', '.');
  if (!normalized || normalized === '.') return Number.NaN;
  return Number(normalized);
};

export const sanitizeQuantityInput = (
  rawValue: string,
  options: { max?: number; previousValue?: string } = {},
): string => {
  const normalized = rawValue.trim();
  const previousValue = options.previousValue ?? '';

  if (normalized === '') return '';
  if (!DECIMAL_INPUT_PATTERN.test(normalized)) return previousValue;

  const parsed = parseQuantityInput(normalized);
  if (!Number.isFinite(parsed)) return normalized;
  if (parsed < 0) return previousValue;

  const max = options.max;
  if (max !== undefined && Number.isFinite(max) && parsed > max) {
    return formatQuantityInput(Math.max(0, max));
  }

  return normalized;
};

export const clampQuantity = (value: number, max?: number): number => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (max === undefined || !Number.isFinite(max)) return safeValue;
  return Math.min(safeValue, Math.max(0, max));
};
