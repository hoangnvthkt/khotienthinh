const SCALE = 1_000_000n;
const MAX_QUANTITY = 99_999_999_999_999_999_999n;

export function parseDecimal6(input: string): bigint {
  const match = typeof input === 'string' ? /^-?\d+(?:\.\d{1,6})?$/.exec(input) : null;
  if (!match || match[0] !== input) {
    throw new Error('INVALID_QUANTITY: Expected a decimal string with at most six fractional digits.');
  }
  const negative = input.startsWith('-');
  const [integer, fraction = ''] = (negative ? input.slice(1) : input).split('.');
  const magnitude = BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return negative ? -magnitude : magnitude;
}

export function formatDecimal6(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${magnitude / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function parseQuantity6(input: string, precision = 6): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new Error('INVALID_QUANTITY: Unsupported quantity precision.');
  }
  const value = parseDecimal6(input);
  if (value < 0n || value > MAX_QUANTITY || value % (10n ** BigInt(6 - precision)) !== 0n) {
    throw new Error('INVALID_QUANTITY: Quantity is negative, out of range, or incompatible with unit precision.');
  }
  return value;
}

export function sumQuantitiesInUnit(
  lines: ReadonlyArray<{ quantity: string; unit: string }>,
  unit: string,
): string {
  if (!unit || unit.trim() !== unit) throw new Error('INVALID_UNIT: A canonical unit is required.');
  let total = 0n;
  for (const line of lines) {
    if (line.unit !== unit) throw new Error('INVALID_UNIT: Resolve units before aggregation.');
    total += parseQuantity6(line.quantity);
  }
  return formatDecimal6(total);
}
