import { supabase } from './supabase';
import {
  DailyLogLabor,
  DailyLogMachine,
  DailyLogMaterial,
  DailyLogVolume,
} from '../types';
import { fromDb, toDb } from './dbMapping';

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

const attachMeta = (items: any[], dailyLogId: string, constructionSiteId: string) =>
  items.map((item, sourceIndex) => {
    const row = toDb({ ...item, dailyLogId, constructionSiteId, sourceIndex });
    delete row.id;
    return row;
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
        supabase.from('daily_log_volumes').select('*').in('daily_log_id', logIds).order('source_index', { ascending: true }),
        supabase.from('daily_log_materials').select('*').in('daily_log_id', logIds).order('source_index', { ascending: true }),
        supabase.from('daily_log_labor').select('*').in('daily_log_id', logIds).order('source_index', { ascending: true }),
        supabase.from('daily_log_machines').select('*').in('daily_log_id', logIds).order('source_index', { ascending: true }),
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
    constructionSiteId: string,
    details: DailyLogDetails,
  ): Promise<void> {
    try {
      await Promise.all([
        replaceTable('daily_log_volumes', dailyLogId, attachMeta(details.volumes, dailyLogId, constructionSiteId)),
        replaceTable('daily_log_materials', dailyLogId, attachMeta(details.materials, dailyLogId, constructionSiteId)),
        replaceTable('daily_log_labor', dailyLogId, attachMeta(details.laborDetails, dailyLogId, constructionSiteId)),
        replaceTable('daily_log_machines', dailyLogId, attachMeta(details.machines, dailyLogId, constructionSiteId)),
      ]);
    } catch (error: any) {
      console.warn('Cannot write normalized daily log details yet; JSONB copy remains available', error?.message || error);
    }
  },
};
