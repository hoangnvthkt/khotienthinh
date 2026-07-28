import type { RequestRuntimeStatus } from '../types';
import { supabase } from './supabase';

export interface SubmitRequestInput {
  requestTemplateVersionId: string;
  title: string;
  description: string;
  formData: Record<string, unknown>;
  dynamicApproversByBlock: Record<string, string[]>;
  idempotencyKey: string;
}

export interface RequestCommandResult {
  requestId: string;
  requestCode: string;
  status: RequestRuntimeStatus;
  workflowInstanceId: string;
  workflowSubjectId: string;
  currentBlockKeys: string[];
  updatedAt: string;
}

const run = async <T>(name: string, payload: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, payload);
  if (error) throw error;
  if (!data) throw new Error(`${name} không trả về dữ liệu.`);
  return data as T;
};

export const requestRuntimeService = {
  submit(input: SubmitRequestInput) {
    return run<RequestCommandResult>('submit_request', {
      p_request_template_version_id: input.requestTemplateVersionId,
      p_title: input.title,
      p_description: input.description,
      p_form_data: input.formData,
      p_dynamic_approvers_by_block: input.dynamicApproversByBlock,
      p_idempotency_key: input.idempotencyKey,
    });
  },
};
