import { supabase } from './supabase';
import {
  DailyLogLabor,
  DailyLogMachine,
  DailyLogMaterial,
  DailyLogVolume,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { getSupabaseOrderColumns, getSupabaseProjection } from './supabaseProjections';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';

export interface DailyLogDetails {
  normalizedWbs?: boolean;
  volumes: DailyLogVolume[];
  materials: DailyLogMaterial[];
  laborDetails: DailyLogLabor[];
  machines: DailyLogMachine[];
}

type DetailTable = 'daily_log_volumes' | 'daily_log_materials' | 'daily_log_labor' | 'daily_log_machines';

const emptyDetails = (): DailyLogDetails => ({
  volumes: [],
  materials: [],
  laborDetails: [],
  machines: [],
});

const emptyToNullKeys = new Set([
  'contract_item_id',
  'work_boq_item_id',
  'task_id',
  'material_id',
  'catalog_item_id',
  'partner_id',
]);

const sanitizeDetailRow = (table: DetailTable, row: Record<string, any>) => {
  const next = { ...row };
  for (const key of emptyToNullKeys) {
    if (next[key] === '') next[key] = null;
  }
  if ((table === 'daily_log_volumes' || 'attachments' in next) && next.attachments == null) {
    next.attachments = [];
  }
  return next;
};

const attachMeta = (table: DetailTable, items: any[], dailyLogId: string, projectId: string | null, constructionSiteId: string | null) =>
  items.map((item, sourceIndex) => {
    const row = toDb({ ...item, dailyLogId, projectId, constructionSiteId, sourceIndex });
    delete row.id;
    return sanitizeDetailRow(table, row);
  });

async function replaceTable(table: DetailTable, dailyLogId: string, rows: any[]): Promise<void> {
  const { error: deleteError } = await supabase.from(table).delete().eq('daily_log_id', dailyLogId);
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw error;
}

export const dailyLogDetailService = {
  async listByLogIds(logIds: string[]): Promise<Record<string, DailyLogDetails>> {
    if (logIds.length === 0) return {};
    const result: Record<string, DailyLogDetails> = Object.fromEntries(logIds.map(id => [id, emptyDetails()]));

    const work = await fetchAllSupabaseRows(supabase.from('daily_log_work_items')
      .select(getSupabaseProjection('daily_log_work_items')).in('daily_log_id', logIds),
    { label: 'Daily Log normalized work', maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_work_items') });
    if (work.error) throw work.error;
    const normalizedIds = new Set<string>((work.data || []).map(row => row.daily_log_id));
    const decisions = normalizedIds.size ? await fetchAllSupabaseRows(supabase.from('daily_log_wbs_decisions')
      .select(getSupabaseProjection('daily_log_wbs_decisions')).in('daily_log_id', [...normalizedIds]),
    { label: 'Daily Log official decisions', maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_wbs_decisions') })
      : { data: [], error: null };
    if (decisions.error) throw decisions.error;
    for (const id of normalizedIds) result[id].normalizedWbs = true;
    for (const decision of decisions.data || []) {
      const item = work.data?.find(row => row.daily_log_id === decision.daily_log_id && row.task_id === decision.task_id);
      // Unknown quantities stay absent from numeric totals; never substitute JSONB or zero.
      if (!item || decision.official_daily_quantity == null) continue;
      result[decision.daily_log_id].volumes.push({
        taskId: item.task_id, taskName: item.task_name_snapshot,
        workBoqItemId: item.work_boq_item_id || undefined,
        quantity: Number(decision.official_daily_quantity), unit: item.unit_snapshot || '',
        note: decision.resolution_reason || undefined,
      });
    }

    if (normalizedIds.size) {
      const ids = [...normalizedIds];
      for (let offset = 0; offset < ids.length; offset += 500) {
        const { data, error } = await supabase.rpc('get_daily_log_physical_resources_v1', {
          p_log_ids: ids.slice(offset, offset + 500),
        });
        if (error) throw error;
        for (const row of (data || []) as Array<Record<string, any>>) {
          if (!normalizedIds.has(row.daily_log_id)) continue;
          const { resource_type: resourceType, ...physical } = row;
          if (resourceType === 'labor') result[row.daily_log_id].laborDetails.push(fromDb(physical));
          if (resourceType === 'machine') result[row.daily_log_id].machines.push(fromDb(physical));
        }
      }
    }

    const legacyIds = logIds.filter(id => !normalizedIds.has(id));

    try {
      const [volumes, materials, labor, machines] = await Promise.all([
        fetchAllSupabaseRows(supabase.from('daily_log_volumes').select(getSupabaseProjection('daily_log_volumes')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:69", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_volumes') }),
        fetchAllSupabaseRows(supabase.from('daily_log_materials').select(getSupabaseProjection('daily_log_materials')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:70", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_materials') }),
        legacyIds.length ? fetchAllSupabaseRows(supabase.from('daily_log_labor').select(getSupabaseProjection('daily_log_labor')).in('daily_log_id', legacyIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:71", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_labor') }) : Promise.resolve({ data: [], error: null }),
        legacyIds.length ? fetchAllSupabaseRows(supabase.from('daily_log_machines').select(getSupabaseProjection('daily_log_machines')).in('daily_log_id', legacyIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:72", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_machines') }) : Promise.resolve({ data: [], error: null }),
      ]);

      for (const response of [volumes, materials, labor, machines]) {
        if (response.error) throw response.error;
      }

      for (const row of volumes.data || []) {
        if (!normalizedIds.has(row.daily_log_id)) result[row.daily_log_id].volumes.push(fromDb(row));
      }
      for (const row of materials.data || []) result[row.daily_log_id].materials.push(fromDb(row));
      for (const row of labor.data || []) result[row.daily_log_id].laborDetails.push(fromDb(row));
      for (const row of machines.data || []) result[row.daily_log_id].machines.push(fromDb(row));
    } catch (error: any) {
      if (normalizedIds.size || !['42P01', 'PGRST205'].includes(error?.code)) throw error;
      console.warn('Daily log detail tables unavailable; using JSONB fallback', error?.message || error);
    }

    return result;
  },

  async replaceForLog(
    dailyLogId: string,
    projectId: string | null,
    constructionSiteId: string | null,
    details: DailyLogDetails,
  ): Promise<void> {
    try {
      await Promise.all([
        replaceTable('daily_log_volumes', dailyLogId, attachMeta('daily_log_volumes', details.volumes, dailyLogId, projectId, constructionSiteId)),
        replaceTable('daily_log_materials', dailyLogId, attachMeta('daily_log_materials', details.materials, dailyLogId, projectId, constructionSiteId)),
        replaceTable('daily_log_labor', dailyLogId, attachMeta('daily_log_labor', details.laborDetails, dailyLogId, projectId, constructionSiteId)),
        replaceTable('daily_log_machines', dailyLogId, attachMeta('daily_log_machines', details.machines, dailyLogId, projectId, constructionSiteId)),
      ]);
    } catch (error: any) {
      console.warn('Cannot write normalized daily log details yet; JSONB copy remains available', error?.message || error);
      throw error;
    }
  },
};
