import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';

export type PurchaseBoqWarning = {
  state: 'within_boq' | 'over_boq' | 'unknown' | 'invalid_input';
  excess: string | null;
};

type MaterialBoqRow = {
  inventoryItemId?: string;
  unit: string;
  budgetQty: number;
  sourceType?: string | null;
};

const normalizeInput = (value: string): string => {
  const raw = value.trim().replace(/[\s\u00a0]/g, '');
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,6})?$/.test(raw)) return raw.replace(/\./g, '').replace(',', '.');
  if (/^\d+(?:,\d{1,6})$/.test(raw)) return raw.replace(',', '.');
  return raw;
};

export function sumProjectMaterialBoq(rows: readonly MaterialBoqRow[], itemId: string, unit: string): string | null {
  const matching = rows.filter(row => row.inventoryItemId === itemId);
  if (!matching.length || !unit || matching.some(row => row.unit !== unit || !Number.isFinite(row.budgetQty) || row.budgetQty <= 0)) return null;
  if (new Set(matching.map(row => row.sourceType || 'unknown')).size !== 1) return null;
  try {
    return formatDecimal6(matching.reduce((sum, row) => sum + parseQuantity6(String(row.budgetQty)), 0n));
  } catch {
    return null;
  }
}

export function sumMaterialProposalQuantity(
  lines: readonly { itemId: string; qty: number | string }[], itemId: string,
): string | null {
  try {
    return formatDecimal6(lines.filter(line => line.itemId === itemId)
      .reduce((sum, line) => sum + parseQuantity6(normalizeInput(String(line.qty))), 0n));
  } catch {
    return null;
  }
}

/** Current site stock plus the proposed purchase is compared with the whole-project material BOQ. */
export function evaluatePurchaseBoqWarning(
  proposedQuantity: string,
  projectBoqQuantity: string | null,
  siteOnHandQuantity: string | null,
): PurchaseBoqWarning {
  let proposed: bigint;
  try {
    proposed = parseQuantity6(normalizeInput(proposedQuantity));
  } catch {
    return { state: 'invalid_input', excess: null };
  }
  if (projectBoqQuantity === null || siteOnHandQuantity === null) return { state: 'unknown', excess: null };
  try {
    const excess = parseQuantity6(siteOnHandQuantity) + proposed - parseQuantity6(projectBoqQuantity);
    return excess > 0n
      ? { state: 'over_boq', excess: formatDecimal6(excess) }
      : { state: 'within_boq', excess: null };
  } catch {
    return { state: 'unknown', excess: null };
  }
}

export type PurchaseBoqLineSnapshot = {
  state: 'known' | 'unknown';
  boqQuantity: number | null;
  stockBefore: number | null;
  overQuantity: number | null;
  overPercent: number | null;
};

export function buildPurchaseBoqLineSnapshots(
  lines: readonly { lineId: string; itemId: string; unit: string; qty: number | string }[],
  boqRows: readonly MaterialBoqRow[],
  onHandByItemId: Readonly<Record<string, string | null>>,
): Map<string, PurchaseBoqLineSnapshot> {
  const running = new Map<string, bigint>();
  const snapshots = new Map<string, PurchaseBoqLineSnapshot>();
  for (const line of lines) {
    const boqText = sumProjectMaterialBoq(boqRows, line.itemId, line.unit);
    const onHandText = onHandByItemId[line.itemId];
    let snapshot: PurchaseBoqLineSnapshot = {
      state: 'unknown', boqQuantity: null, stockBefore: null, overQuantity: null, overPercent: null,
    };
    try {
      const qty = parseQuantity6(normalizeInput(String(line.qty)));
      const previous = running.get(line.itemId) || 0n;
      running.set(line.itemId, previous + qty);
      if (boqText !== null && onHandText != null) {
        const boq = parseQuantity6(boqText);
        const before = parseQuantity6(onHandText) + previous;
        const overBefore = before > boq ? before - boq : 0n;
        const overAfter = before + qty > boq ? before + qty - boq : 0n;
        const over = overAfter - overBefore;
        snapshot = {
          state: 'known',
          boqQuantity: Number(boqText),
          stockBefore: Number(formatDecimal6(before)),
          overQuantity: Number(formatDecimal6(over)),
          overPercent: boq > 0n ? Number((Number(formatDecimal6(over)) / Number(boqText) * 100).toFixed(3)) : 0,
        };
      }
    } catch {
      // Invalid inputs stay unknown; draft validation reports malformed quantities separately.
    }
    snapshots.set(line.lineId, snapshot);
  }
  return snapshots;
}
