import type { ProjectTaskCompletionRequest } from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { supabase } from './supabase';

const stripGeneratedColumns = (row: any): any => {
  delete row.created_at;
  delete row.updated_at;
  return row;
};

const requestToDb = (request: ProjectTaskCompletionRequest): any => {
  return stripGeneratedColumns(toDb({
    ...request,
    attachments: request.attachments || [],
  }));
};

const requestPatchToDb = (patch: Partial<ProjectTaskCompletionRequest>): any => {
  return stripGeneratedColumns(toDb(patch));
};

export const taskCompletionRequestService = {
  async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectTaskCompletionRequest[]> {
    const { data, error } = await supabase
      .from('project_task_completion_requests')
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return dedupeRowsById(data || []).map(row => fromDb(row) as ProjectTaskCompletionRequest);
  },

  async upsert(request: ProjectTaskCompletionRequest): Promise<void> {
    const { error } = await supabase
      .from('project_task_completion_requests')
      .upsert(requestToDb(request), { onConflict: 'id' });
    if (error) throw error;
  },

  async update(id: string, patch: Partial<ProjectTaskCompletionRequest>): Promise<void> {
    const { error } = await supabase
      .from('project_task_completion_requests')
      .update(requestPatchToDb(patch))
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('project_task_completion_requests')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
