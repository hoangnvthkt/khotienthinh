import type {
  RequestApprovalBlock,
  RequestApproverSource,
  RequestCompletionPolicy,
  RequestFlowMode,
  RequestTemplateFieldSchema,
} from '../types';
import { supabase } from './supabase';

export interface SaveRequestTemplateDraftInput {
  templateId?: string;
  expectedUpdatedAt?: string;
  name: string;
  description: string;
  formSchema: RequestTemplateFieldSchema[];
  usageScope: {
    companyWide: boolean;
    orgUnitIds: string[];
    permissionCodes: string[];
    userIds: string[];
  };
  flowMode: RequestFlowMode;
  completionPolicy: RequestCompletionPolicy;
  requestSlaHours?: number | null;
  blocks: RequestApprovalBlock[];
  watcherUserIds: string[];
  printConfig: {
    browserPrintEnabled: boolean;
    docxStoragePath: string | null;
  };
  notificationConfig: Record<string, boolean>;
}

export interface RequestTemplateDraftRecord {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  versionNumber: number | null;
  updatedAt: string;
  payload: SaveRequestTemplateDraftInput;
}

export interface RequestTemplateSummary {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
  publishedVersionNumber: number | null;
  usageScopeLabel: string;
  updatedAt: string;
}

export interface PublishRequestTemplateInput {
  templateId: string;
  expectedUpdatedAt: string;
}

export interface RequestResolverPreview {
  sampleCreatorId: string;
  blocks: Array<{
    blockKey: string;
    source: RequestApproverSource;
    resolvedUserIds: string[];
    errorCode: 'REQUEST_DIRECT_MANAGER_MISSING' | 'REQUEST_APPROVER_INACTIVE' | null;
  }>;
}

export interface PublishRequestTemplateResult {
  requestTemplateId: string;
  requestTemplateVersionId: string;
  versionNumber: number;
  workflowTemplateId: string;
  workflowTemplateVersionId: string;
}

const run = async <T>(name: string, payload: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  if (!data) throw new Error(`${name} không trả về dữ liệu.`);
  return data as T;
};

export const requestTemplateService = {
  getDraft(templateId: string) {
    return run<RequestTemplateDraftRecord>('get_request_template_draft', {
      p_request_template_id: templateId,
    });
  },

  list(filters: {
    status?: 'DRAFT' | 'PUBLISHED' | 'DEACTIVATED';
    search?: string;
  } = {}) {
    return run<{ items: RequestTemplateSummary[] }>('list_request_templates', {
      p_filters: filters,
    });
  },

  saveDraft(input: SaveRequestTemplateDraftInput) {
    return run<RequestTemplateDraftRecord>('save_request_template_draft', {
      p_payload: input,
    });
  },

  publish(input: PublishRequestTemplateInput) {
    return run<PublishRequestTemplateResult>('publish_request_template_version', {
      p_request_template_id: input.templateId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },

  createDraftFromPublished(templateId: string) {
    return run<RequestTemplateDraftRecord>(
      'create_request_template_draft_from_published',
      { p_request_template_id: templateId },
    );
  },

  deactivate(input: PublishRequestTemplateInput) {
    return run<RequestTemplateSummary>('deactivate_request_template', {
      p_request_template_id: input.templateId,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
  },

  previewResolvers(input: SaveRequestTemplateDraftInput, sampleCreatorId: string) {
    return run<RequestResolverPreview>('preview_request_template_resolvers', {
      p_payload: input,
      p_sample_creator_id: sampleCreatorId,
    });
  },
};
