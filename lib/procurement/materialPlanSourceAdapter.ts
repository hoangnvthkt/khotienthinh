import type { ProcurementSourceSnapshot } from '../../types/procurementIdentity';
import { parseQuantity6 } from './decimal';

export interface RawApprovedMaterialPlanSnapshot {
  id: string; code: string; revision: number; sourceHash: string; status: 'approved';
  projectId: string; constructionSiteId: string | null;
  lines: Array<{ id: string; itemId: string; title: string; quantity: string | null;
    unit: string; neededDate: string; destinationId: string;
    calculatedQuantity?: string | null; workBoqItemId?: string | null;
    materialBudgetItemId?: string | null }>;
}

const quantity6 = (value: string): string => {
  const parsed = parseQuantity6(value);
  return `${parsed / 1_000_000n}.${(parsed % 1_000_000n).toString().padStart(6, '0')}`;
};

export function normalizeMaterialPlanSnapshot(raw: RawApprovedMaterialPlanSnapshot): ProcurementSourceSnapshot {
  if (raw.status !== 'approved') throw new Error('SOURCE_APPROVAL_REQUIRED');
  if (!raw.id?.trim() || !raw.code?.trim() || !raw.projectId?.trim()
    || !Number.isSafeInteger(raw.revision) || raw.revision < 1
    || !/^[a-f0-9]{64}$/i.test(raw.sourceHash)) throw new Error('SOURCE_REVISION_REQUIRED');
  if (!raw.lines.length) throw new Error('SOURCE_LINES_REQUIRED');
  const seen = new Set<string>();
  const lines = raw.lines.map(line => {
    if (!line.id?.trim()) throw new Error('SOURCE_LINE_ID_REQUIRED');
    if (seen.has(line.id)) throw new Error('SOURCE_LINE_ID_DUPLICATE');
    seen.add(line.id);
    if (!line.itemId?.trim()) throw new Error('SOURCE_LINE_ITEM_REQUIRED');
    if (!line.unit?.trim() || line.unit !== line.unit.trim()) throw new Error('SOURCE_LINE_UNIT_REQUIRED');
    if (!line.neededDate || !/^\d{4}-\d{2}-\d{2}$/.test(line.neededDate)
      || !line.destinationId?.trim()) throw new Error('SOURCE_LINE_DELIVERY_REQUIRED');
    if (line.quantity === null) throw new Error('SOURCE_LINE_APPROVED_QTY_REQUIRED');
    let approvedQty: string;
    try { approvedQty = quantity6(line.quantity); }
    catch { throw new Error('SOURCE_LINE_APPROVED_QTY_REQUIRED'); }
    if (parseQuantity6(approvedQty) <= 0n) throw new Error('SOURCE_LINE_APPROVED_QTY_REQUIRED');
    const calculatedQty = line.calculatedQuantity === undefined || line.calculatedQuantity === null
      ? null : quantity6(line.calculatedQuantity);
    return { sourceLineId: line.id, itemId: line.itemId, title: line.title?.trim() || line.itemId,
      requestedQty: approvedQty, approvedQty, unit: line.unit,
      workBoqItemId: line.workBoqItemId ?? null, materialBudgetItemId: line.materialBudgetItemId ?? null,
      neededDate: line.neededDate, destinationId: line.destinationId,
      calculatedQty };
  });
  return { adapter: 'material_plan', sourceDocumentId: raw.id, sourceCode: raw.code,
    sourceRevision: String(raw.revision), sourceHash: raw.sourceHash,
    ownerContext: { logicalKey: 'company_default', resolution: 'server_registry_required' },
    scope: { projectId: raw.projectId, constructionSiteId: raw.constructionSiteId },
    intakeState: 'ready', healthState: 'healthy', lines, diagnostics: [] };
}
