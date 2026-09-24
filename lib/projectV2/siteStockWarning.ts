import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';

export type SiteStockWarning = {
  state: 'within_stock' | 'over_stock' | 'unknown' | 'invalid_input';
  shortage: string | null;
};

const normalizeInput = (value: string): string => {
  const raw = value.trim().replace(/[\s\u00a0]/g, '');
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,6})?$/.test(raw)) return raw.replace(/\./g, '').replace(',', '.');
  if (/^\d+(?:,\d{1,6})$/.test(raw)) return raw.replace(',', '.');
  return raw;
};

/** Compare a proposed quantity with verified site-warehouse availability only. */
export function evaluateSiteStockWarning(
  proposedQuantity: string,
  availableQuantity: string | null,
): SiteStockWarning {
  let proposed: bigint;
  try {
    proposed = parseQuantity6(normalizeInput(proposedQuantity));
  } catch {
    return { state: 'invalid_input', shortage: null };
  }
  if (availableQuantity === null) return { state: 'unknown', shortage: null };
  let available: bigint;
  try {
    available = parseQuantity6(availableQuantity);
  } catch {
    return { state: 'unknown', shortage: null };
  }
  return proposed > available
    ? { state: 'over_stock', shortage: formatDecimal6(proposed - available) }
    : { state: 'within_stock', shortage: null };
}
