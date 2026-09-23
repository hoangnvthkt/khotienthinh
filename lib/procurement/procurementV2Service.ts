import { supabase } from '../supabase';
import type { ProcurementV2Dossier, ProcurementV2Filter, ProcurementV2Page } from '../../types/procurementV2';

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const procurementV2Service = {
  async list(filter: ProcurementV2Filter = {}, cursor: string | null = null,
    limit = 50): Promise<ProcurementV2Page> {
    const pLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));
    const { data, error } = await supabase.rpc('list_procurement_dossiers_v2', {
      p_filter: filter, p_cursor: cursor, p_limit: pLimit,
    });
    if (error) throw error;
    if (!isObject(data) || !Array.isArray(data.items) || !Array.isArray(data.counters)
      || typeof data.snapshotToken !== 'string'
      || (data.nextCursor !== null && typeof data.nextCursor !== 'string'))
      throw new Error('PROCUREMENT_V2_RESPONSE_INVALID');
    return data as unknown as ProcurementV2Page;
  },

  async get(demandId: string): Promise<ProcurementV2Dossier> {
    if (!demandId.trim()) throw new Error('PROCUREMENT_DEMAND_ID_REQUIRED');
    const { data, error } = await supabase.rpc('get_procurement_dossier_v2', {
      p_demand_id: demandId,
    });
    if (error) throw error;
    if (!isObject(data) || !Array.isArray(data.lines)
      || !['material_plan', 'project_material_request'].includes(String(data.sourceAdapter)))
      throw new Error('PROCUREMENT_V2_RESPONSE_INVALID');
    return data as unknown as ProcurementV2Dossier;
  },
};
