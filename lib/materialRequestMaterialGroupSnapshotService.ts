import { supabase } from './supabase';
import { MaterialRequest, MaterialRequestMaterialGroupSnapshot, RequestItem } from '../types';
import { fromDb, toDb } from './dbMapping';
import { getRequestLineId } from './materialRequestFulfillmentService';
import { getSupabaseOrderColumns, getSupabaseProjection } from './supabaseProjections';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';

const TABLE = 'material_request_material_group_snapshots';

const isMissingSnapshotTable = (error: any): boolean =>
  error?.code === '42P01' || String(error?.message || '').includes(TABLE);

const buildSnapshotRows = (request: MaterialRequest): MaterialRequestMaterialGroupSnapshot[] => {
  return (request.items || [])
    .map((line: RequestItem, index: number) => {
      const snapshot = line.materialGroupSnapshot;
      const materialGroupKey = line.materialGroupKey || snapshot?.materialGroupKey;
      if (!materialGroupKey) return null;
      const requestQty = Number(line.requestQty || 0);
      const requestedBeforeQty = Number(snapshot?.requestedBeforeQtySnapshot || 0);
      return {
        requestId: request.id,
        requestLineId: getRequestLineId(request, line, index),
        projectId: request.projectId || null,
        constructionSiteId: request.constructionSiteId || null,
        materialGroupKey,
        inventoryItemId: snapshot?.inventoryItemId || line.itemId || null,
        materialCodeSnapshot: snapshot?.materialCodeSnapshot || line.skuSnapshot || null,
        itemNameSnapshot: snapshot?.itemNameSnapshot || line.itemNameSnapshot || null,
        unitSnapshot: snapshot?.unitSnapshot || line.unitSnapshot || null,
        totalBoqQtySnapshot: Number(snapshot?.totalBoqQtySnapshot || line.budgetQtySnapshot || 0),
        requestedBeforeQtySnapshot: requestedBeforeQty,
        requestQty,
        requestedAfterQtySnapshot: requestedBeforeQty + requestQty,
        remainingBoqQtySnapshot: Number(snapshot?.remainingBoqQtySnapshot || 0),
        sourceMaterialBudgetItemIds: snapshot?.sourceMaterialBudgetItemIds || [],
        requestStatusSnapshot: request.status || null,
      };
    })
    .filter(Boolean) as MaterialRequestMaterialGroupSnapshot[];
};

export const materialRequestMaterialGroupSnapshotService = {
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

      const { data: existingRows, error: readError } = await fetchAllSupabaseRows(supabase
        .from(TABLE)
        .select('request_line_id')
        .eq('request_id', request.id), { label: "lib/materialRequestMaterialGroupSnapshotService.ts:57", maxRows: 20_000, orderBy: getSupabaseOrderColumns(TABLE) });
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

  async listByProject(projectId: string): Promise<MaterialRequestMaterialGroupSnapshot[]> {
    if (!projectId) return [];
    const { data, error } = await fetchAllSupabaseRows(supabase
      .from(TABLE)
      .select(getSupabaseProjection(TABLE))
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }), { label: "lib/materialRequestMaterialGroupSnapshotService.ts:83", maxRows: 20_000, orderBy: getSupabaseOrderColumns(TABLE) });
    if (error) {
      if (isMissingSnapshotTable(error)) return [];
      throw error;
    }
    return (data || []).map(row => fromDb(row) as MaterialRequestMaterialGroupSnapshot);
  },
};
