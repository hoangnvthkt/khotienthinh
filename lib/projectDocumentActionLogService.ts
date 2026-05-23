import { supabase } from './supabase';
import { ProjectDocumentType } from './projectDocumentPolicy';

export interface ProjectDocumentActionLogInput {
  projectId?: string | null;
  constructionSiteId?: string | null;
  documentType: ProjectDocumentType;
  documentId: string;
  documentLabel?: string | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  allowed?: boolean;
  reason?: string | null;
  blockedReason?: string | null;
  warningAcknowledged?: boolean;
  requiredRollbackSteps?: string[];
  metadata?: Record<string, any>;
  createdBy?: string | null;
}

export const projectDocumentActionLogService = {
  async log(input: ProjectDocumentActionLogInput): Promise<void> {
    if (!input.projectId && !input.constructionSiteId) return;
    try {
      const { error } = await supabase.from('project_document_action_logs').insert({
        project_id: input.projectId || null,
        construction_site_id: input.constructionSiteId || null,
        document_type: input.documentType,
        document_id: input.documentId,
        document_label: input.documentLabel || null,
        action: input.action,
        from_status: input.fromStatus || null,
        to_status: input.toStatus || null,
        allowed: input.allowed ?? true,
        reason: input.reason || null,
        blocked_reason: input.blockedReason || null,
        warning_acknowledged: input.warningAcknowledged ?? false,
        required_rollback_steps: input.requiredRollbackSteps || [],
        metadata: input.metadata || {},
        created_by: input.createdBy || null,
      });
      if (error) throw error;
    } catch (error: any) {
      console.warn('project_document_action_logs unavailable; skipped action log', error?.message || error);
    }
  },

  async logBlocked(input: Omit<ProjectDocumentActionLogInput, 'allowed'>): Promise<void> {
    await this.log({ ...input, allowed: false });
  },
};
