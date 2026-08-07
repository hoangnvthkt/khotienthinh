import { Role, User, WorkflowTemplate } from '../types';

export const MATERIAL_REQUEST_WORKFLOW_NAME = 'Quy trình cấp vật tư công trường';

const normalizeWorkflowName = (value?: string | null) =>
  (value || '').trim().toLocaleLowerCase('vi-VN');

export const isMaterialRequestWorkflowTemplate = (template?: Pick<WorkflowTemplate, 'name'> | null) =>
  normalizeWorkflowName(template?.name) === normalizeWorkflowName(MATERIAL_REQUEST_WORKFLOW_NAME);

export const isRequestModuleWorkflowTemplate = (
  template?: Pick<WorkflowTemplate, 'customFields'> | null,
) => Array.isArray(template?.customFields) && template.customFields.some(field => {
  if (!field || typeof field !== 'object') return false;
  const requestTemplateId = (field as unknown as Record<string, unknown>)._requestTemplateId;
  return typeof requestTemplateId === 'string' && requestTemplateId.trim().length > 0;
});

export const canSeeMaterialRequestWorkflowOnKanban = (user?: Pick<User, 'role'> | null) =>
  user?.role === Role.ADMIN;
