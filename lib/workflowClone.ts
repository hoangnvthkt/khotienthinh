import type { WorkflowInstance, WorkflowTemplate } from '../types';
import { isMaterialRequestWorkflowTemplate, isRequestModuleWorkflowTemplate } from './workflowVisibility';

export const WORKFLOW_CLONE_PARAM = 'clone';
const COPY_SUFFIX = ' (copy)';

/** Tickets of Mua hàng / Yêu cầu templates are created in their own modules, never from Quy trình. */
export const canCloneWorkflowInstance = (template?: WorkflowTemplate | null) =>
  Boolean(template?.isActive)
  && !isMaterialRequestWorkflowTemplate(template)
  && !isRequestModuleWorkflowTemplate(template);

// Keys owned by the run of the ticket (step notes/files, module links), not by what the creator typed.
const isRunOnlyKey = (key: string) =>
  key === 'note' || key === 'requestCode' || key === 'subjectType' || key === 'subjectId'
  || key.startsWith('step_') || key.startsWith('_');

export interface WorkflowCloneDraft {
  templateId: string;
  title: string;
  note: string;
  formData: Record<string, unknown>;
}

export const buildWorkflowCloneDraft = (
  instance: Pick<WorkflowInstance, 'templateId' | 'title' | 'formData'>,
): WorkflowCloneDraft => {
  const source = instance.formData || {};
  const formData: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!isRunOnlyKey(key)) formData[key] = structuredClone(value);
  });
  const title = (instance.title || '').trim();
  return {
    templateId: instance.templateId,
    title: title.endsWith(COPY_SUFFIX.trim()) ? title : `${title}${COPY_SUFFIX}`,
    note: typeof source.note === 'string' ? source.note : '',
    formData,
  };
};
