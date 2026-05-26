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
    everSubmitted: request.everSubmitted ?? true,
    lastActionBy: request.lastActionBy || request.submittedBy || null,
    lastActionAt: request.lastActionAt || new Date().toISOString(),
  }));
};

const requestPatchToDb = (patch: Partial<ProjectTaskCompletionRequest>): any => {
  return stripGeneratedColumns(toDb({
    ...patch,
    ...(patch.status ? {
      everSubmitted: patch.everSubmitted ?? true,
      lastActionBy: patch.lastActionBy || patch.verifiedBy || patch.approvedBy || patch.returnedBy || patch.cancelledBy || patch.submittedBy || null,
      lastActionAt: patch.lastActionAt || new Date().toISOString(),
    } : {}),
  }));
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
    const { data: current, error: readError } = await supabase
      .from('project_task_completion_requests')
      .select('status')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    if (!['submitted', 'verified', 'returned', 'draft'].includes(current.status) && patch.status !== 'cancelled') {
      throw new Error('Phiếu hoàn thành đã qua bước xử lý, cần rollback/trả lại trước khi sửa.');
    }
    const { error } = await supabase
      .from('project_task_completion_requests')
      .update(requestPatchToDb(patch))
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { data: current, error: readError } = await supabase
      .from('project_task_completion_requests')
      .select('status, ever_submitted')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    if (current.status !== 'draft' || current.ever_submitted) {
      throw new Error('Chỉ xoá cứng phiếu hoàn thành nháp chưa từng gửi duyệt.');
    }
    const { error } = await supabase
      .from('project_task_completion_requests')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
