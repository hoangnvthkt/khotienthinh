import { supabase } from './supabase';
import { fromDb, toDb } from './dbMapping';
import {
  Employee,
  OrgUnit,
  ProjectStaff,
  ProjectWorkflowBinding,
  ProjectWorkflowAction,
  ProjectWorkflowRollbackDependencyResult,
  ProjectWorkflowSubject,
  ProjectWorkflowSubjectType,
  WorkflowAssignmentTarget,
  WorkflowStepAssignment,
  WorkflowInstance,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTemplate,
} from '../types';
import { projectStaffService } from './projectStaffService';

const SUBJECT_TABLE = 'workflow_subjects';
const BINDING_TABLE = 'project_workflow_bindings';
const ASSIGNMENT_TABLE = 'workflow_step_assignments';

const WORKFLOW_INSTANCE_SELECT = 'id,template_id,template_version_id,current_instance_node_id,code,title,created_by,current_node_id,status,watchers,step_assignees,created_at,updated_at';

const isMissingProjectWorkflowError = (error: any): boolean => {
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return error?.code === '42P01'
    || error?.code === '42883'
    || msg.includes(SUBJECT_TABLE)
    || msg.includes(BINDING_TABLE)
    || msg.includes(ASSIGNMENT_TABLE);
};

const mapWorkflowTemplate = (row: any): WorkflowTemplate | null => {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdBy: row.created_by,
    isActive: row.is_active,
    customFields: row.custom_fields || [],
    managers: row.managers || [],
    defaultWatchers: row.default_watchers || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapWorkflowNode = (row: any): WorkflowNode | null => {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    type: row.type as WorkflowNodeType,
    label: row.label,
    config: row.config || {},
    positionX: row.position_x || 0,
    positionY: row.position_y || 0,
  };
};

const mapWorkflowInstance = (row: any): WorkflowInstance | null => {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    templateVersionId: row.template_version_id,
    code: row.code,
    title: row.title,
    createdBy: row.created_by,
    currentNodeId: row.current_node_id,
    currentInstanceNodeId: row.current_instance_node_id,
    status: row.status,
    formData: row.form_data || {},
    watchers: row.watchers || [],
    stepAssignees: row.step_assignees || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapSubject = (row: any): ProjectWorkflowSubject => ({
  ...(fromDb(row) as ProjectWorkflowSubject),
  currentNode: mapWorkflowNode(row.current_node || row.currentNode),
  workflowInstance: mapWorkflowInstance(row.workflow_instance || row.workflowInstance),
  currentAssigneeUserIds: row.current_assignee_user_ids || row.currentAssigneeUserIds || [],
  returnToAssigneeUserIds: row.return_to_assignee_user_ids || row.returnToAssigneeUserIds || [],
});

const mapBinding = (row: any): ProjectWorkflowBinding => ({
  ...(fromDb(row) as ProjectWorkflowBinding),
  workflowTemplate: mapWorkflowTemplate(row.workflow_template || row.workflowTemplate),
});

const mapAssignment = (row: any): WorkflowStepAssignment => fromDb(row) as WorkflowStepAssignment;

const subjectSelect = `
  *,
  current_node:workflow_nodes(*),
  workflow_instance:workflow_instances(${WORKFLOW_INSTANCE_SELECT})
`;

const bindingSelect = `
  *,
  workflow_template:workflow_templates(*)
`;

export const projectWorkflowService = {
  async resolveBinding(
    subjectType: ProjectWorkflowSubjectType,
    projectId?: string | null,
    constructionSiteId?: string | null,
  ): Promise<ProjectWorkflowBinding | null> {
    const scopes = [
      constructionSiteId ? { projectId: projectId || null, constructionSiteId } : null,
      projectId ? { projectId, constructionSiteId: null } : null,
      { projectId: null, constructionSiteId: null },
    ].filter(Boolean) as Array<{ projectId: string | null; constructionSiteId: string | null }>;

    for (const scope of scopes) {
      let query = supabase
        .from(BINDING_TABLE)
        .select(bindingSelect)
        .eq('subject_type', subjectType)
        .eq('is_active', true)
        .eq('is_default', true)
        .limit(1);

      query = scope.projectId ? query.eq('project_id', scope.projectId) : query.is('project_id', null);
      query = scope.constructionSiteId ? query.eq('construction_site_id', scope.constructionSiteId) : query.is('construction_site_id', null);

      const { data, error } = await query.maybeSingle();
      if (error) {
        if (isMissingProjectWorkflowError(error)) return null;
        throw error;
      }
      if (data) return mapBinding(data);
    }

    return null;
  },

  async listBindings(subjectType: ProjectWorkflowSubjectType = 'material_request'): Promise<ProjectWorkflowBinding[]> {
    const { data, error } = await supabase
      .from(BINDING_TABLE)
      .select(bindingSelect)
      .eq('subject_type', subjectType)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingProjectWorkflowError(error)) return [];
      throw error;
    }
    return (data || []).map(mapBinding);
  },

  async upsertBinding(binding: Partial<ProjectWorkflowBinding> & {
    subjectType: ProjectWorkflowSubjectType;
    workflowTemplateId: string;
  }): Promise<ProjectWorkflowBinding> {
    const payload = toDb({
      subjectType: binding.subjectType,
      projectId: binding.projectId || null,
      constructionSiteId: binding.constructionSiteId || null,
      workflowTemplateId: binding.workflowTemplateId,
      isDefault: binding.isDefault ?? true,
      isActive: binding.isActive ?? true,
      createdBy: binding.createdBy || null,
    });
    const { data, error } = await supabase
      .from(BINDING_TABLE)
      .upsert(binding.id ? { ...payload, id: binding.id } : payload, { onConflict: 'id' })
      .select(bindingSelect)
      .single();
    if (error) throw error;
    return mapBinding(data);
  },

  async listSubjectsByMaterialRequestIds(requestIds: string[]): Promise<Record<string, ProjectWorkflowSubject>> {
    const ids = Array.from(new Set(requestIds.filter(Boolean)));
    if (ids.length === 0) return {};

    const { data, error } = await supabase
      .from(SUBJECT_TABLE)
      .select(subjectSelect)
      .eq('subject_type', 'material_request')
      .in('subject_id', ids);
    if (error) {
      if (isMissingProjectWorkflowError(error)) return {};
      throw error;
    }

    return (data || []).reduce<Record<string, ProjectWorkflowSubject>>((acc, row) => {
      const subject = mapSubject(row);
      acc[subject.subjectId] = subject;
      return acc;
    }, {});
  },

  async getSubjectByMaterialRequestId(requestId: string): Promise<ProjectWorkflowSubject | null> {
    if (!requestId) return null;
    const { data, error } = await supabase
      .from(SUBJECT_TABLE)
      .select(subjectSelect)
      .eq('subject_type', 'material_request')
      .eq('subject_id', requestId)
      .maybeSingle();
    if (error) {
      if (isMissingProjectWorkflowError(error)) return null;
      throw error;
    }
    return data ? mapSubject(data) : null;
  },

  async listAssignmentsBySubjectIds(subjectIds: string[]): Promise<Record<string, WorkflowStepAssignment[]>> {
    const ids = Array.from(new Set(subjectIds.filter(Boolean)));
    if (ids.length === 0) return {};

    const { data, error } = await supabase
      .from(ASSIGNMENT_TABLE)
      .select('*')
      .in('workflow_subject_id', ids)
      .order('assigned_at', { ascending: true });
    if (error) {
      if (isMissingProjectWorkflowError(error)) return {};
      throw error;
    }

    return (data || []).reduce<Record<string, WorkflowStepAssignment[]>>((acc, row) => {
      const assignment = mapAssignment(row);
      if (!acc[assignment.workflowSubjectId]) acc[assignment.workflowSubjectId] = [];
      acc[assignment.workflowSubjectId].push(assignment);
      return acc;
    }, {});
  },

  async getAssigneeCandidates(subject: ProjectWorkflowSubject, node?: WorkflowNode | null): Promise<ProjectStaff[]> {
    const codes = node?.config?.eligiblePermissionCodes?.filter(Boolean) || [];
    const staff = codes.length > 0
      ? await projectStaffService.listProjectStaffWithPermissions(
        subject.projectId || undefined,
        subject.constructionSiteId || null,
        codes,
      )
      : subject.projectId
        ? await projectStaffService.listByProject(subject.projectId, subject.constructionSiteId || undefined)
        : subject.constructionSiteId
          ? await projectStaffService.listBySite(subject.constructionSiteId)
          : [];

    return staff.filter(row => !row.endDate);
  },

  resolveAssignmentTargetUserIds(input: {
    selectedUserIds?: string[];
    targets?: WorkflowAssignmentTarget[];
    employees?: Employee[];
    orgUnits?: OrgUnit[];
    creatorUserId?: string | null;
  }): string[] {
    const userIds = new Set((input.selectedUserIds || []).filter(Boolean));
    const employees = input.employees || [];

    (input.targets || []).forEach(target => {
      if (target.type === 'user' && target.userId) {
        userIds.add(target.userId);
      }
      if (target.type === 'creator' && input.creatorUserId) {
        userIds.add(input.creatorUserId);
      }
      if (target.type === 'department' && target.orgUnitId) {
        employees
          .filter(employee => employee.status === 'Đang làm việc')
          .filter(employee => employee.userId)
          .filter(employee => employee.departmentId === target.orgUnitId || employee.orgUnitId === target.orgUnitId)
          .forEach(employee => userIds.add(employee.userId!));
      }
    });

    return Array.from(userIds);
  },

  async getRollbackDependencies(requestId: string): Promise<ProjectWorkflowRollbackDependencyResult> {
    const { data, error } = await supabase.rpc('get_project_workflow_rollback_dependencies', {
      p_subject_type: 'material_request',
      p_subject_id: requestId,
    });
    if (error) throw error;
    return (data || { allowed: true, activeCount: 0, dependencies: [] }) as ProjectWorkflowRollbackDependencyResult;
  },

  async startMaterialRequestWorkflowV2(input: {
    requestId: string;
    templateId?: string | null;
    firstAssigneeUserIds: string[];
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    const assigneeIds = Array.from(new Set((input.firstAssigneeUserIds || []).filter(Boolean)));
    const { data, error } = await supabase.rpc('start_project_workflow_v2', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_template_id: input.templateId || null,
      p_first_assignee_user_ids: assigneeIds,
      p_comment: input.comment || '',
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },

  async startMaterialRequestWorkflow(input: {
    requestId: string;
    templateId?: string | null;
    firstAssigneeUserId: string;
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    return this.startMaterialRequestWorkflowV2({
      requestId: input.requestId,
      templateId: input.templateId || null,
      firstAssigneeUserIds: [input.firstAssigneeUserId],
      comment: input.comment || '',
    });
  },

  async advanceMaterialRequestWorkflowV2(input: {
    requestId: string;
    nextAssigneeUserIds?: string[];
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    const assigneeIds = Array.from(new Set((input.nextAssigneeUserIds || []).filter(Boolean)));
    const { data, error } = await supabase.rpc('advance_project_workflow_v2', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_next_assignee_user_ids: assigneeIds,
      p_comment: input.comment || '',
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },

  async advanceMaterialRequestWorkflow(input: {
    requestId: string;
    nextAssigneeUserId?: string | null;
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    return this.advanceMaterialRequestWorkflowV2({
      requestId: input.requestId,
      nextAssigneeUserIds: input.nextAssigneeUserId ? [input.nextAssigneeUserId] : [],
      comment: input.comment || '',
    });
  },

  async resubmitMaterialRequestWorkflowV2(input: {
    requestId: string;
    assigneeUserIds?: string[] | null;
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    const assigneeIds = input.assigneeUserIds
      ? Array.from(new Set(input.assigneeUserIds.filter(Boolean)))
      : null;
    const { data, error } = await supabase.rpc('resubmit_project_workflow_v2', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_assignee_user_ids: assigneeIds,
      p_comment: input.comment || '',
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },

  async resubmitMaterialRequestWorkflow(input: {
    requestId: string;
    assigneeUserId?: string | null;
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    return this.resubmitMaterialRequestWorkflowV2({
      requestId: input.requestId,
      assigneeUserIds: input.assigneeUserId ? [input.assigneeUserId] : null,
      comment: input.comment || '',
    });
  },

  async reassignMaterialRequestWorkflowV2(input: {
    requestId: string;
    newAssigneeUserIds: string[];
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    const assigneeIds = Array.from(new Set((input.newAssigneeUserIds || []).filter(Boolean)));
    const { data, error } = await supabase.rpc('reassign_project_workflow_v2', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_new_assignee_user_ids: assigneeIds,
      p_comment: input.comment || '',
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },

  async reassignMaterialRequestWorkflow(input: {
    requestId: string;
    newAssigneeUserId: string;
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    return this.reassignMaterialRequestWorkflowV2({
      requestId: input.requestId,
      newAssigneeUserIds: [input.newAssigneeUserId],
      comment: input.comment || '',
    });
  },

  async transitionMaterialRequestWorkflow(input: {
    action: ProjectWorkflowAction;
    requestId: string;
    assigneeUserId?: string | null;
    assigneeUserIds?: string[];
    comment?: string;
  }): Promise<ProjectWorkflowSubject> {
    if (input.action === 'approve') {
      return this.advanceMaterialRequestWorkflowV2({
        requestId: input.requestId,
        nextAssigneeUserIds: input.assigneeUserIds || (input.assigneeUserId ? [input.assigneeUserId] : []),
        comment: input.comment || '',
      });
    }
    if (input.action === 'return') {
      return this.returnMaterialRequestWorkflow({ requestId: input.requestId, comment: input.comment || '' });
    }
    if (input.action === 'reject') {
      return this.rejectMaterialRequestWorkflow({ requestId: input.requestId, comment: input.comment || '' });
    }
    if (input.action === 'resubmit') {
      return this.resubmitMaterialRequestWorkflowV2({
        requestId: input.requestId,
        assigneeUserIds: input.assigneeUserIds || (input.assigneeUserId ? [input.assigneeUserId] : null),
        comment: input.comment || '',
      });
    }
    const reassignUserIds = input.assigneeUserIds || (input.assigneeUserId ? [input.assigneeUserId] : []);
    if (reassignUserIds.length === 0) {
      throw new Error('Chưa chọn người xử lý mới.');
    }
    return this.reassignMaterialRequestWorkflowV2({
      requestId: input.requestId,
      newAssigneeUserIds: reassignUserIds,
      comment: input.comment || '',
    });
  },

  async returnMaterialRequestWorkflow(input: {
    requestId: string;
    comment: string;
  }): Promise<ProjectWorkflowSubject> {
    const { data, error } = await supabase.rpc('return_project_workflow', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_comment: input.comment,
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },

  async rejectMaterialRequestWorkflow(input: {
    requestId: string;
    comment: string;
  }): Promise<ProjectWorkflowSubject> {
    const { data, error } = await supabase.rpc('reject_project_workflow', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_comment: input.comment,
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
  },
};
