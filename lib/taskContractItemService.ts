import { supabase } from './supabase';
import { TaskContractItem } from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';

const TABLE = 'task_contract_items';

export interface TaskContractQuantityFactor {
  taskId: string;
  contractItemId: string;
  quantityFactor: number;
}

export const buildTaskContractQuantityFactors = (
  links: TaskContractItem[],
  allowedContractItemIds?: Set<string>,
): TaskContractQuantityFactor[] => {
  const byTask = links.reduce<Map<string, TaskContractItem[]>>((acc, link) => {
    if (!link.taskId || !link.contractItemId) return acc;
    if (allowedContractItemIds && !allowedContractItemIds.has(link.contractItemId)) return acc;
    if (!acc.has(link.taskId)) acc.set(link.taskId, []);
    acc.get(link.taskId)!.push(link);
    return acc;
  }, new Map());

  const factors: TaskContractQuantityFactor[] = [];
  byTask.forEach((rows, taskId) => {
    const positiveWeightTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weightPercent || 0)), 0);
    const equalShare = rows.length > 0 ? 1 / rows.length : 0;
    rows.forEach(row => {
      factors.push({
        taskId,
        contractItemId: row.contractItemId,
        quantityFactor: positiveWeightTotal > 0
          ? Math.max(0, Number(row.weightPercent || 0)) / positiveWeightTotal
          : equalShare,
      });
    });
  });

  return factors;
};

export const taskContractItemService = {
  async listBySite(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<TaskContractItem[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('task_contract_items unavailable', error.message);
      return [];
    }
    return dedupeRowsById(data || []).map(fromDb);
  },

  async replaceForTask(taskId: string, projectIdOrSiteId: string, constructionSiteId: string | null, contractItemIds: string[]): Promise<void> {
    try {
      const { error: deleteError } = await supabase.from(TABLE).delete().eq('task_id', taskId);
      if (deleteError) throw deleteError;
      const uniqueIds = Array.from(new Set(contractItemIds.filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const rows = uniqueIds.map(contractItemId => toDb({
        taskId,
        projectId: projectIdOrSiteId,
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
