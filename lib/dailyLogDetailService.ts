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

    try {
      const [volumes, materials, labor, machines] = await Promise.all([
        fetchAllSupabaseRows(supabase.from('daily_log_volumes').select(getSupabaseProjection('daily_log_volumes')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:69", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_volumes') }),
        fetchAllSupabaseRows(supabase.from('daily_log_materials').select(getSupabaseProjection('daily_log_materials')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:70", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_materials') }),
        fetchAllSupabaseRows(supabase.from('daily_log_labor').select(getSupabaseProjection('daily_log_labor')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:71", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_labor') }),
        fetchAllSupabaseRows(supabase.from('daily_log_machines').select(getSupabaseProjection('daily_log_machines')).in('daily_log_id', logIds).order('source_index', { ascending: true }), { label: "lib/dailyLogDetailService.ts:72", maxRows: 20_000, orderBy: getSupabaseOrderColumns('daily_log_machines') }),
      ]);

      for (const response of [volumes, materials, labor, machines]) {
        if (response.error) throw response.error;
      }

      for (const row of volumes.data || []) result[row.daily_log_id].volumes.push(fromDb(row));
      for (const row of materials.data || []) result[row.daily_log_id].materials.push(fromDb(row));
      for (const row of labor.data || []) result[row.daily_log_id].laborDetails.push(fromDb(row));
      for (const row of machines.data || []) result[row.daily_log_id].machines.push(fromDb(row));
    } catch (error: any) {
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
