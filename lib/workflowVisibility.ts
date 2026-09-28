import { Role, User, WorkflowTemplate } from '../types';

export const MATERIAL_REQUEST_WORKFLOW_NAME = 'Quy trình cấp vật tư công trường';

const normalizeWorkflowName = (value?: string | null) =>
  (value || '').trim().toLocaleLowerCase('vi-VN');

type MaterialRequestTemplateProbe = Pick<WorkflowTemplate, 'name'> & Partial<Pick<WorkflowTemplate, 'ownerSubjectType'>>;

export const isMaterialRequestWorkflowTemplate = (template?: MaterialRequestTemplateProbe | null) =>
  template?.ownerSubjectType === 'material_request'
  || normalizeWorkflowName(template?.name) === normalizeWorkflowName(MATERIAL_REQUEST_WORKFLOW_NAME);

/** A private copy one project configured from Dự án » Vật tư; never listed in Quy trình. */
export const isProjectOwnedWorkflowTemplate = (
  template?: Partial<Pick<WorkflowTemplate, 'ownerProjectId'>> | null,
) => Boolean(template?.ownerProjectId);

export const isRequestModuleWorkflowTemplate = (
  template?: Pick<WorkflowTemplate, 'customFields'> | null,
) => Array.isArray(template?.customFields) && template.customFields.some(field => {
  if (!field || typeof field !== 'object') return false;
  const requestTemplateId = (field as unknown as Record<string, unknown>)._requestTemplateId;
  return typeof requestTemplateId === 'string' && requestTemplateId.trim().length > 0;
});

export const canSeeMaterialRequestWorkflowOnKanban = (user?: Pick<User, 'role'> | null) =>
  user?.role === Role.ADMIN;
