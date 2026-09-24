import { supabase } from '../supabase';
import { parseDecimal6, parseQuantity6 } from '../procurement/decimal';

export interface ProjectV2MaterialBoqPositionRow {
  itemId: string;
  unit: string | null;
  state: 'known' | 'unknown' | 'outside_boq';
  boqQuantity: string | null;
  receivedQuantity: string | null;
  remainingQuantity: string | null;
  pendingQuantity: string | null;
  issues: ('boq_source_unknown' | 'receipt_source_unknown')[];
}

const invalid = (): never => { throw new Error('PROJECT_V2_BOQ_RESPONSE_INVALID'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const decimal = (value: unknown, signed = false): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid();
  if (!/^-?\d+\.\d{6}$/.test(value)) return invalid();
  if (signed) parseDecimal6(value);
  else parseQuantity6(value);
  return value;
};

export function parseProjectV2MaterialBoqPositions(payload: unknown,
  requestedItemIds: readonly string[]): Map<string, ProjectV2MaterialBoqPositionRow> {
  const rows = object(payload).items;
  if (!Array.isArray(rows)) return invalid();
  if (rows.length !== requestedItemIds.length) return invalid();
  const expected = new Set(requestedItemIds);
  if (expected.size !== requestedItemIds.length) invalid();
  const result = new Map<string, ProjectV2MaterialBoqPositionRow>();
  for (const value of rows) {
    const row = object(value);
    const itemId = row.itemId;
    if (typeof itemId !== 'string') return invalid();
    if (!expected.has(itemId) || result.has(itemId)) return invalid();
    if (row.unit !== null && (typeof row.unit !== 'string' || !row.unit.trim())) invalid();
    const state = row.state;
    if (state !== 'known' && state !== 'unknown' && state !== 'outside_boq') return invalid();
    const issues = row.issues;
    if (!Array.isArray(issues) || issues.some(issue =>
      issue !== 'boq_source_unknown' && issue !== 'receipt_source_unknown')) return invalid();
    const boqQuantity = decimal(row.boqQuantity);
    const receivedQuantity = decimal(row.receivedQuantity);
    const remainingQuantity = decimal(row.remainingQuantity, true);
    const pendingQuantity = decimal(row.pendingQuantity);
    if (state === 'known' && (boqQuantity === null || receivedQuantity === null
      || remainingQuantity === null || parseDecimal6(remainingQuantity)
        !== parseQuantity6(boqQuantity) - parseQuantity6(receivedQuantity))) invalid();
    if (state === 'outside_boq' && (boqQuantity !== null || remainingQuantity !== null)) invalid();
    if (state === 'unknown' && remainingQuantity !== null) invalid();
    result.set(itemId, { itemId, unit: row.unit as string | null,
      state, boqQuantity, receivedQuantity, remainingQuantity, pendingQuantity,
      issues });
  }
  return result;
}

export const materialBoqPositionService = {
  async list(workspaceId: string, itemIds: readonly string[]): Promise<Map<string, ProjectV2MaterialBoqPositionRow>> {
    if (!workspaceId || itemIds.some(id => !id)) invalid();
    const unique = [...new Set(itemIds)];
    const positions = new Map<string, ProjectV2MaterialBoqPositionRow>();
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      const { data, error } = await supabase.rpc('list_project_v2_material_boq_positions_v1', {
        p_workspace_id: workspaceId, p_item_ids: batch,
      });
      if (error) throw error;
      for (const [id, row] of parseProjectV2MaterialBoqPositions(data, batch)) positions.set(id, row);
    }
    return positions;
  },
};
