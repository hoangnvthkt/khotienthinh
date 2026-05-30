import { supabase } from './supabase';
import { MaterialRequest, MaterialRequestBoqLineSnapshot, RequestItem } from '../types';
import { getRequestLineId } from './materialRequestFulfillmentService';

const TABLE = 'material_request_boq_line_snapshots';

const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

const mapKeys = (obj: any, fn: (k: string) => string): any => {
  if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
  }
  return obj;
};

const toDb = (obj: any) => mapKeys(obj, toSnake);
const fromDb = (obj: any) => mapKeys(obj, toCamel);

const isMissingSnapshotTable = (error: any): boolean =>
  error?.code === '42P01' || String(error?.message || '').includes(TABLE);

const lineName = (line: RequestItem): string | null =>
  line.itemNameSnapshot || line.materialBudgetItemName || line.itemId || null;

const lineUnit = (line: RequestItem): string | null =>
  line.unitSnapshot || null;

const buildSnapshotRows = (request: MaterialRequest): MaterialRequestBoqLineSnapshot[] => {
  return (request.items || [])
    .map((line, index) => {
      if (!line.materialBudgetItemId) return null;
      const overQty = Number(line.overQty ?? line.overBudgetQtySnapshot ?? 0);
      const overPercent = Number(line.overPercent ?? line.overBudgetPercentSnapshot ?? 0);
      return {
        requestId: request.id,
        requestLineId: getRequestLineId(request, line, index),
        projectId: request.projectId || null,
        constructionSiteId: request.constructionSiteId || null,
        workBoqItemId: line.workBoqItemId || null,
        materialBudgetItemId: line.materialBudgetItemId,
        inventoryItemId: line.itemId || null,
        itemNameSnapshot: lineName(line),
        unitSnapshot: lineUnit(line),
        requestQty: Number(line.requestQty || 0),
        budgetQtySnapshot: Number(line.budgetQtySnapshot || 0),
        reservedBeforeQty: Number(line.reservedBeforeQtySnapshot ?? line.previousRequestedQtySnapshot ?? 0),
        isOverBoq: Boolean(line.isOverBoq ?? overQty > 0),
        overQty,
        overPercent,
        overReason: line.overReason || line.overBudgetReason || null,
        requestStatusSnapshot: request.status || null,
      };
    })
    .filter(Boolean) as MaterialRequestBoqLineSnapshot[];
};

export const materialRequestBoqLineSnapshotService = {
  async upsertForRequest(request: MaterialRequest): Promise<void> {
    if (!request?.id) return;

    const rows = buildSnapshotRows(request);
    const requestLineIds = rows.map(row => row.requestLineId);

    try {
      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from(TABLE)
          .upsert(rows.map(toDb), { onConflict: 'request_id,request_line_id' });
        if (upsertError) throw upsertError;
      }

      const { data: existingRows, error: readError } = await supabase
        .from(TABLE)
        .select('request_line_id')
        .eq('request_id', request.id);
      if (readError) throw readError;

      const staleLineIds = (existingRows || [])
        .map(row => row.request_line_id)
        .filter((lineId: string) => !requestLineIds.includes(lineId));

      if (staleLineIds.length > 0) {
        const { error: deleteError } = await supabase
          .from(TABLE)
          .delete()
          .eq('request_id', request.id)
          .in('request_line_id', staleLineIds);
        if (deleteError) throw deleteError;
      }
    } catch (error: any) {
      if (isMissingSnapshotTable(error)) return;
      throw error;
    }
  },

  async listByProject(projectId: string): Promise<MaterialRequestBoqLineSnapshot[]> {
    if (!projectId) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingSnapshotTable(error)) return [];
      throw error;
    }
    return (data || []).map(row => fromDb(row) as MaterialRequestBoqLineSnapshot);
  },
};
