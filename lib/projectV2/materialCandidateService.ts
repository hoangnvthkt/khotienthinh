import { supabase } from '../supabase';
import { parseQuantity6 } from '../procurement/decimal';

export type MaterialCandidateDiagnostic = 'missing_inventory_identity' | 'missing_norm_revision'
  | 'missing_conversion' | 'missing_norm_factor' | 'ambiguous_mapping'
  | 'source_quantity_unknown' | 'source_revision_changed' | 'already_allocated'
  | 'unit_mismatch';

export interface MaterialCandidate {
  candidateId: string;
  itemId: string | null; itemCode: string | null; itemName: string;
  unit: string | null; calculatedQty: string | null;
  alreadyPlannedQty: string | null; availableQty: string | null;
  diagnostics: MaterialCandidateDiagnostic[]; selectable: boolean;
  sourcePlanId: string; sourceRevision: number; sourcePlanHash: string;
  sourceLineId: string; sourceWorkName: string; sourceWorkQuantity: string | null;
  sourceUnit: string | null; normResourceId: string | null; normRevision: string | null;
  normFactor: string | null; coefficient: string | null;
  conversionNumerator: string | null; conversionDenominator: string | null;
  workspaceId: string;
}

export interface MaterialCandidateGroup {
  key: string; itemId: string | null; itemCode: string | null; itemName: string;
  unit: string | null; calculatedQty: string | null; alreadyPlannedQty: string | null;
  availableQty: string | null; diagnostics: MaterialCandidateDiagnostic[];
  selectable: boolean; derivations: MaterialCandidate[];
}

function sum(values: (string | null)[]): string | null {
  if (values.some(value => value === null)) return null;
  const total = values.reduce((result, value) => result + parseQuantity6(value!), 0n);
  return `${total / 1_000_000n}.${(total % 1_000_000n).toString().padStart(6, '0')}`;
}

export function groupMaterialCandidates(rows: MaterialCandidate[]): MaterialCandidateGroup[] {
  const groups = new Map<string, MaterialCandidateGroup>();
  for (const row of rows) {
    const complete = Boolean(row.itemId && row.unit && row.selectable && !row.diagnostics.length);
    const key = complete ? `${row.itemId}:${row.unit}` : row.candidateId;
    const existing = groups.get(key);
    if (existing && complete) {
      existing.derivations.push(row);
      existing.calculatedQty = sum(existing.derivations.map(item => item.calculatedQty));
      existing.alreadyPlannedQty = sum(existing.derivations.map(item => item.alreadyPlannedQty));
      existing.availableQty = sum(existing.derivations.map(item => item.availableQty));
    } else groups.set(key, { key, itemId: row.itemId, itemCode: row.itemCode,
      itemName: row.itemName, unit: row.unit, calculatedQty: row.calculatedQty,
      alreadyPlannedQty: row.alreadyPlannedQty, availableQty: row.availableQty,
      diagnostics: row.diagnostics, selectable: row.selectable, derivations: [row] });
  }
  return [...groups.values()];
}

export function validateMaterialSelection(rows: MaterialCandidate[], selections: {
  candidateId: string; quantity: string; sourceRevision?: number; sourcePlanHash?: string;
}[]): { candidateId: string; reason: string }[] {
  const issues: { candidateId: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    const row = rows.find(item => item.candidateId === selection.candidateId);
    if (seen.has(selection.candidateId)) issues.push({ candidateId: selection.candidateId,
      reason: 'Nguồn đã được chọn hai lần' });
    seen.add(selection.candidateId);
    if (!row) { issues.push({ candidateId: selection.candidateId, reason: 'Nguồn không còn khả dụng' }); continue; }
    if (!row.selectable) issues.push({ candidateId: selection.candidateId, reason: 'Nguồn chưa đủ dữ liệu' });
    if (selection.sourceRevision !== undefined && (selection.sourceRevision !== row.sourceRevision ||
      selection.sourcePlanHash !== row.sourcePlanHash)) issues.push({ candidateId: selection.candidateId,
      reason: 'Kế hoạch thi công đã đổi phiên bản' });
    try {
      const quantity = parseQuantity6(selection.quantity);
      if (quantity <= 0n) issues.push({ candidateId: selection.candidateId, reason: 'Khối lượng phải lớn hơn 0' });
      if (row.availableQty === null) issues.push({ candidateId: selection.candidateId,
        reason: 'Chưa xác định khối lượng khả dụng' });
      else if (quantity > parseQuantity6(row.availableQty)) issues.push({ candidateId: selection.candidateId,
        reason: `Khối lượng vượt khả dụng (${row.availableQty})` });
    } catch { issues.push({ candidateId: selection.candidateId, reason: 'Khối lượng không hợp lệ' }); }
  }
  return issues;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_INVALID');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_INVALID');
  return value;
};
const optional = (value: unknown): string | null => value === null ? null : text(value);
const decimal = (value: unknown): string | null => {
  if (value === null) return null;
  const result = typeof value === 'number' && Number.isFinite(value) &&
    Number.isSafeInteger(Math.round(value * 1_000_000)) ? value.toFixed(6) : text(value);
  parseQuantity6(result);
  return result;
};

export const materialCandidateService = {
  async listSourcePlans(workspaceId: string): Promise<{ id: string; code: string; title: string }[]> {
    const { data, error } = await supabase.rpc('list_project_v2_source_candidates_v1', {
      p_workspace_id: workspaceId, p_target_type: 'material', p_exclude_plan_id: null,
    });
    if (error) throw error;
    const payload = record(data);
    if (!Array.isArray(payload.items)) throw new Error('PROJECT_V2_MATERIAL_SOURCE_INVALID');
    const plans = new Map<string, { id: string; code: string; title: string }>();
    for (const value of payload.items) {
      const row = record(value);
      if (text(row.workspaceId) !== workspaceId) throw new Error('PROJECT_V2_MATERIAL_SCOPE_MISMATCH');
      const id = text(row.sourcePlanId);
      plans.set(id, { id, code: text(row.code), title: text(row.title) });
    }
    return [...plans.values()];
  },
  async list(input: { projectId: string; constructionSiteId: string | null;
    sourcePlanIds: string[]; excludePlanId?: string | null }): Promise<MaterialCandidate[]> {
    if (!input.projectId || !input.sourcePlanIds.length || input.sourcePlanIds.length > 100)
      throw new Error('PROJECT_V2_MATERIAL_SCOPE_INVALID');
    const { data, error } = await supabase.rpc('list_project_v2_material_candidates_v1', {
      p_project_id: input.projectId, p_construction_site_id: input.constructionSiteId,
      p_source_plan_ids: input.sourcePlanIds, p_exclude_plan_id: input.excludePlanId ?? null,
    });
    if (error) throw error;
    const payload = record(data);
    if (!Array.isArray(payload.items)) throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_INVALID');
    const ids = new Set<string>();
    return payload.items.map(value => {
      const row = record(value);
      const candidateId = text(row.candidateId);
      if (ids.has(candidateId)) throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_DUPLICATE');
      ids.add(candidateId);
      if (!input.sourcePlanIds.includes(text(row.sourcePlanId))) throw new Error('PROJECT_V2_MATERIAL_SCOPE_MISMATCH');
      if (!Array.isArray(row.diagnostics) || row.diagnostics.some(item => typeof item !== 'string'))
        throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_INVALID');
      if (!Number.isSafeInteger(row.sourceRevision) || Number(row.sourceRevision) < 1)
        throw new Error('PROJECT_V2_MATERIAL_CANDIDATE_INVALID');
      return { candidateId, itemId: optional(row.itemId), itemCode: optional(row.itemCode),
        itemName: text(row.itemName), unit: optional(row.unit), calculatedQty: decimal(row.calculatedQty),
        alreadyPlannedQty: decimal(row.alreadyPlannedQty), availableQty: decimal(row.availableQty),
        diagnostics: row.diagnostics as MaterialCandidateDiagnostic[], selectable: row.selectable === true,
        sourcePlanId: text(row.sourcePlanId), sourceRevision: Number(row.sourceRevision),
        sourcePlanHash: text(row.sourcePlanHash), sourceLineId: text(row.sourceLineId),
        sourceWorkName: text(row.sourceWorkName), sourceWorkQuantity: decimal(row.sourceWorkQuantity),
        sourceUnit: optional(row.sourceUnit), normResourceId: optional(row.normResourceId),
        normRevision: optional(row.normRevision), normFactor: decimal(row.normFactor),
        coefficient: decimal(row.coefficient), conversionNumerator: decimal(row.conversionNumerator),
        conversionDenominator: decimal(row.conversionDenominator), workspaceId: text(row.workspaceId) };
    });
  },
};
