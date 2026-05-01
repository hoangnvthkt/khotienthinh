import { supabase } from './supabase';
import { TaskContractItem } from '../types';
import { fromDb, toDb } from './dbMapping';

const TABLE = 'task_contract_items';

export const taskContractItemService = {
  async listBySite(constructionSiteId: string): Promise<TaskContractItem[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('task_contract_items unavailable', error.message);
      return [];
    }
    return (data || []).map(fromDb);
  },

  async replaceForTask(taskId: string, constructionSiteId: string, contractItemIds: string[]): Promise<void> {
    try {
      const { error: deleteError } = await supabase.from(TABLE).delete().eq('task_id', taskId);
      if (deleteError) throw deleteError;
      const uniqueIds = Array.from(new Set(contractItemIds.filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const rows = uniqueIds.map(contractItemId => toDb({
        taskId,
        constructionSiteId,
        contractItemId,
      }));
      const { error } = await supabase.from(TABLE).insert(rows);
      if (error) throw error;
    } catch (error: any) {
      console.warn('Cannot write task_contract_items yet', error?.message || error);
    }
  },
};
