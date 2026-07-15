export type CanonicalDecimalText = string & {
  readonly __brand: 'CanonicalDecimalText';
};

export type DecimalParseFailureCode =
  | 'empty'
  | 'invalid'
  | 'invalid_grouping'
  | 'ambiguous'
  | 'out_of_range'
  | 'too_many_fraction_digits';

export type DecimalParseResult =
  | { ok: true; value: number; canonical: CanonicalDecimalText }
  | { ok: false; code: DecimalParseFailureCode };

export interface DecimalPolicy {
  kind: 'quantity' | 'vnd' | 'currency' | 'percent' | 'rate' | 'count';
  maxFractionDigits: number;
  min?: number;
  max?: number;
  allowNegative?: boolean;
}

type DecimalParseFailure = Extract<DecimalParseResult, { ok: false }>;

const failure = (code: DecimalParseFailureCode): DecimalParseFailure => ({ ok: false, code });

const canonicalizeParts = (negative: boolean, integer: string, fraction: string): CanonicalDecimalText => {
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fraction.replace(/0+$/, '');
  const isZero = normalizedInteger === '0' && normalizedFraction.length === 0;
  return `${negative && !isZero ? '-' : ''}${normalizedInteger}${
    normalizedFraction ? `.${normalizedFraction}` : ''
  }` as CanonicalDecimalText;
};

const enforcePolicy = (
  negative: boolean,
  integer: string,
  fraction: string,
  policy: DecimalPolicy,
): DecimalParseResult => {
  if (!Number.isInteger(policy.maxFractionDigits) || policy.maxFractionDigits < 0) {
    return failure('invalid');
  }
  if (fraction.length > policy.maxFractionDigits) {
    return failure('too_many_fraction_digits');
  }

  const canonical = canonicalizeParts(negative, integer, fraction);
  const value = Number(canonical);
  if (!Number.isFinite(value)) return failure('out_of_range');
  if (value < 0 && policy.allowNegative !== true) return failure('out_of_range');
  if (policy.min !== undefined && value < policy.min) return failure('out_of_range');
  if (policy.max !== undefined && value > policy.max) return failure('out_of_range');

  return { ok: true, value, canonical };
};

const splitSign = (text: string): { negative: boolean; unsigned: string } => {
  if (text.startsWith('-')) return { negative: true, unsigned: text.slice(1) };
  if (text.startsWith('+')) return { negative: false, unsigned: text.slice(1) };
  return { negative: false, unsigned: text };
};

export const parseViDecimal = (input: string, policy: DecimalPolicy): DecimalParseResult => {
  const text = String(input ?? '').trim();
  if (!text) return failure('empty');
  if (/\s/.test(text)) return failure('invalid');

  const { negative, unsigned } = splitSign(text);
  if (!unsigned) return failure('invalid');

  const commaIndex = unsigned.indexOf(',');
  const dotIndex = unsigned.indexOf('.');
  if (commaIndex >= 0 && dotIndex > commaIndex) return failure('ambiguous');
  if ((unsigned.match(/,/g) || []).length > 1) return failure('invalid');

  const [integerText, fraction = ''] = unsigned.split(',');
  if (!integerText || (commaIndex >= 0 && !fraction)) return failure('invalid');
  if (fraction && !/^\d+$/.test(fraction)) return failure('invalid');

  let integer: string;
  if (integerText.includes('.')) {
    const groups = integerText.split('.');
    const validGrouping = /^\d{1,3}$/.test(groups[0])
      && groups.length > 1
      && groups.slice(1).every(group => /^\d{3}$/.test(group));
    if (!validGrouping) return failure('invalid_grouping');
    integer = groups.join('');
  } else {
    if (!/^\d+$/.test(integerText)) return failure('invalid');
    integer = integerText;
  }

  return enforcePolicy(negative, integer, fraction, policy);
};

export const parseCanonicalDecimal = (input: string, policy: DecimalPolicy): DecimalParseResult => {
  const text = String(input ?? '').trim();
  if (!text) return failure('empty');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return failure('invalid');

  const { negative, unsigned } = splitSign(text);
  const [integer, fraction = ''] = unsigned.split('.');
  return enforcePolicy(negative, integer, fraction, policy);
};

const numberToPlainText = (value: number): string => {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;

  const [coefficient, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [integer, fraction = ''] = unsigned.split('.');
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const plain = decimalPosition <= 0
    ? `0.${'0'.repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${'0'.repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return negative ? `-${plain}` : plain;
};

export const toCanonicalDecimal = (
  input: number | string,
  policy: DecimalPolicy,
): CanonicalDecimalText => {
  const result = typeof input === 'number'
    ? Number.isFinite(input)
      ? parseCanonicalDecimal(numberToPlainText(input), policy)
      : failure('invalid')
    : parseCanonicalDecimal(input, policy);

  if (result.ok === false) {
    throw new RangeError(`Cannot convert decimal value: ${result.code}`);
  }
  return result.canonical;
};

export interface ViDecimalFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

type DecimalFormatValue = number | CanonicalDecimalText | string | null | undefined;

const decimalFormatNumber = (input: DecimalFormatValue): number | null => {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string' && !/^[+-]?\d+(?:\.\d+)?$/.test(input.trim())) return null;
  const value = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(value) ? value : null;
};

export const formatViDecimal = (
  input: DecimalFormatValue,
  options: ViDecimalFormatOptions = {},
): string => {
  const value = decimalFormatNumber(input);
  if (value === null) return '';
  return new Intl.NumberFormat('vi-VN', {
    useGrouping: options.useGrouping ?? true,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 6,
  }).format(value);
};

export const formatViQuantity = (input: DecimalFormatValue, maximumFractionDigits = 6): string =>
  formatViDecimal(input, { maximumFractionDigits });

export const formatCurrencyVi = (
  input: DecimalFormatValue,
  currency: string = 'VND',
): string => {
  const value = decimalFormatNumber(input);
  if (value === null) return '';
  const fractionDigits = currency.toUpperCase() === 'VND' ? 0 : 2;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
};

/** Percent values use the ERP's percentage-point convention: 12.5 renders as 12,5%. */
export const formatViPercent = (input: DecimalFormatValue, maximumFractionDigits = 2): string => {
  const formatted = formatViDecimal(input, { maximumFractionDigits });
  return formatted ? `${formatted}%` : '';
};
