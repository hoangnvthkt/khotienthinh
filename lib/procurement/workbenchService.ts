import type { ProcurementDemandDetail, ProcurementQuery, ProcurementWorkbenchPage } from '../../types/procurementWorkbench';
import { supabase } from '../supabase';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const isProcurementWorkbenchUnavailable = (error: unknown): boolean => {
  const code = record(error) && typeof error.code === 'string' ? error.code : '';
  return code === '42883' || code === 'PGRST202';
};

const assertPage = (value: unknown): ProcurementWorkbenchPage => {
  if (!record(value) || !Array.isArray(value.items) || !Array.isArray(value.counters)
    || typeof value.snapshotToken !== 'string' || typeof value.asOf !== 'string') {
    throw new Error('PROCUREMENT_WORKBENCH_RESPONSE_INVALID');
  }
  return value as unknown as ProcurementWorkbenchPage;
};

const assertDetail = (value: unknown): ProcurementDemandDetail => {
  if (!record(value) || typeof value.id !== 'string' || typeof value.version !== 'string'
    || !Array.isArray(value.lines) || !Array.isArray(value.issues) || !Array.isArray(value.allowedActions)) {
    throw new Error('PROCUREMENT_DEMAND_RESPONSE_INVALID');
  }
  return value as unknown as ProcurementDemandDetail;
};

export const procurementWorkbenchService = {
  async list(query: ProcurementQuery, cursor: string | null = null, limit = 50): Promise<ProcurementWorkbenchPage> {
    const { data, error } = await supabase.rpc('list_procurement_work_v1', {
      p_filter: query,
      p_cursor: cursor,
      p_limit: Math.max(1, Math.min(200, Math.trunc(limit) || 50)),
    });
    if (error) throw error;
    return assertPage(data);
  },
  async getDemand(demandId: string): Promise<ProcurementDemandDetail> {
    if (!demandId.trim()) throw new Error('PROCUREMENT_DEMAND_ID_REQUIRED');
    const { data, error } = await supabase.rpc('get_procurement_demand_v1', { p_demand_id: demandId });
    if (error) throw error;
    return assertDetail(data);
  },
};
