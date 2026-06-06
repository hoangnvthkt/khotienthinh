import { supabase } from './supabase';
import { fromDb, toDb } from './dbMapping';
import {
  Employee,
  OrgUnit,
  ProjectStaff,
  ProjectWorkflowBinding,
  ProjectWorkflowConfiguration,
  ProjectWorkflowAction,
  ProjectWorkflowRollbackDependencyResult,
  ProjectWorkflowRuntimeContext,
  ProjectWorkflowSubject,
  ProjectWorkflowSubjectType,
  WorkflowAssignmentTarget,
  WorkflowParticipant,
  WorkflowStepAssignment,
  WorkflowInstance,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRuntimeEdge,
  WorkflowRuntimeNode,
  WorkflowTemplate,
  WorkflowEdge,
} from '../types';
import { projectStaffService } from './projectStaffService';

const SUBJECT_TABLE = 'workflow_subjects';
const BINDING_TABLE = 'project_workflow_bindings';
const ASSIGNMENT_TABLE = 'workflow_step_assignments';

const WORKFLOW_INSTANCE_SELECT = 'id,template_id,template_version_id,current_instance_node_id,code,title,created_by,current_node_id,status,watchers,step_assignees,created_at,updated_at';
const ASSIGNEE_CANDIDATE_CACHE_TTL_MS = 60_000;
const assigneeCandidateCache = new Map<string, { expiresAt: number; rows: ProjectStaff[] }>();

const getAssigneeCandidateCacheKey = (subject: ProjectWorkflowSubject, node?: WorkflowNode | null): string => JSON.stringify({
  projectId: subject.projectId || null,
  constructionSiteId: subject.constructionSiteId || null,
  subjectId: subject.subjectId,
  nodeId: node?.id || null,
  mode: node?.config?.assignmentMode || null,
  role: node?.config?.assigneeRole || null,
  targets: node?.config?.assignmentTargets || [],
  permissions: node?.config?.eligiblePermissionCodes || [],
});

const isMissingProjectWorkflowError = (error: any): boolean => {
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code);
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

const mapWorkflowRuntimeNode = (row: any): WorkflowRuntimeNode | null => {
  if (!row) return null;
  return {
    id: row.id,
    workflowInstanceId: row.workflow_instance_id ?? row.workflowInstanceId,
    templateVersionId: row.template_version_id ?? row.templateVersionId ?? null,
    templateNodeId: row.template_node_id ?? row.templateNodeId ?? null,
    type: row.type as WorkflowNodeType,
    label: row.label,
    config: row.config || {},
    positionX: row.position_x ?? row.positionX ?? 0,
    positionY: row.position_y ?? row.positionY ?? 0,
    createdAt: row.created_at ?? row.createdAt,
  };
};

const mapWorkflowRuntimeEdge = (row: any): WorkflowRuntimeEdge => ({
  id: row.id,
  workflowInstanceId: row.workflow_instance_id ?? row.workflowInstanceId,
  templateVersionId: row.template_version_id ?? row.templateVersionId ?? null,
  templateEdgeId: row.template_edge_id ?? row.templateEdgeId ?? null,
  sourceInstanceNodeId: row.source_instance_node_id ?? row.sourceInstanceNodeId,
  targetInstanceNodeId: row.target_instance_node_id ?? row.targetInstanceNodeId,
  label: row.label ?? null,
  sortOrder: row.sort_order ?? row.sortOrder ?? 0,
  createdAt: row.created_at ?? row.createdAt,
});

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

const runtimeNodeToWorkflowNode = (node: WorkflowRuntimeNode | null): WorkflowNode | null => node ? ({
  id: node.templateNodeId || node.id,
  templateId: node.templateNodeId || node.templateVersionId || '',
  type: node.type,
  label: node.label,
  config: node.config,
  positionX: node.positionX,
  positionY: node.positionY,
}) : null;

const mapSubject = (row: any): ProjectWorkflowSubject => {
  const currentRuntimeNode = mapWorkflowRuntimeNode(row.current_instance_node || row.currentRuntimeNode);
  return {
    ...(fromDb(row) as ProjectWorkflowSubject),
    currentNode: runtimeNodeToWorkflowNode(currentRuntimeNode) || mapWorkflowNode(row.current_node || row.currentNode),
    workflowInstance: mapWorkflowInstance(row.workflow_instance || row.workflowInstance),
    currentAssigneeUserIds: row.current_assignee_user_ids || row.currentAssigneeUserIds || [],
    returnToAssigneeUserIds: row.return_to_assignee_user_ids || row.returnToAssigneeUserIds || [],
    returnToInstanceNodeId: row.return_to_instance_node_id ?? row.returnToInstanceNodeId ?? null,
    lastActionInstanceNodeId: row.last_action_instance_node_id ?? row.lastActionInstanceNodeId ?? null,
    currentRuntimeNode,
    participants: (row.participants || []).map(mapParticipant),
  };
};

const mapBinding = (row: any): ProjectWorkflowBinding => ({
  ...(fromDb(row) as ProjectWorkflowBinding),
  workflowTemplate: mapWorkflowTemplate(row.workflow_template || row.workflowTemplate),
});

const mapAssignment = (row: any): WorkflowStepAssignment => fromDb(row) as WorkflowStepAssignment;
const mapParticipant = (row: any): WorkflowParticipant => fromDb(row) as WorkflowParticipant;

const subjectSelect = `
  *,
  current_node:workflow_nodes!workflow_subjects_current_node_id_fkey(*),
  current_instance_node:workflow_instance_nodes!workflow_subjects_current_instance_node_id_fkey(*),
  workflow_instance:workflow_instances(${WORKFLOW_INSTANCE_SELECT}),
  participants:workflow_participants(*)
`;

const bindingSelect = `
  *,
  workflow_template:workflow_templates(*)
`;

export const projectWorkflowService = {
  async getConfiguration(
    subjectType: ProjectWorkflowSubjectType,
    projectId?: string | null,
    constructionSiteId?: string | null,
  ): Promise<ProjectWorkflowConfiguration> {
    const { data, error } = await supabase.rpc('get_project_workflow_configuration', {
      p_subject_type: subjectType,
      p_project_id: projectId || null,
      p_construction_site_id: constructionSiteId || null,
    });
    if (error) throw error;
    const bindingRow = data?.binding;
    return {
      subjectType,
      projectId: data?.projectId ?? projectId ?? null,
      constructionSiteId: data?.constructionSiteId ?? constructionSiteId ?? null,
      binding: bindingRow ? mapBinding(bindingRow) : null,
      scope: data?.scope || null,
      valid: Boolean(data?.valid),
      errors: Array.isArray(data?.errors) ? data.errors : [],
      canManage: Boolean(data?.canManage),
      validation: data?.validation || undefined,
    };
  },

  async setBinding(input: {
    subjectType: ProjectWorkflowSubjectType;
    workflowTemplateId: string;
    projectId?: string | null;
    constructionSiteId?: string | null;
  }): Promise<ProjectWorkflowBinding> {
    const { data, error } = await supabase.rpc('set_project_workflow_binding', {
      p_subject_type: input.subjectType,
      p_workflow_template_id: input.workflowTemplateId,
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return mapBinding(row);
  },

  async removeBinding(input: {
    subjectType: ProjectWorkflowSubjectType;
    projectId?: string | null;
    constructionSiteId?: string | null;
  }): Promise<number> {
    const { data, error } = await supabase.rpc('remove_project_workflow_binding', {
      p_subject_type: input.subjectType,
      p_project_id: input.projectId || null,
      p_construction_site_id: input.constructionSiteId || null,
    });
    if (error) throw error;
    return Number(data || 0);
  },

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
    if (binding.isActive === false) {
      await this.removeBinding({
        subjectType: binding.subjectType,
        projectId: binding.projectId || null,
        constructionSiteId: binding.constructionSiteId || null,
      });
      return mapBinding({ ...toDb(binding), id: binding.id || '', is_active: false });
    }
    return this.setBinding({
      subjectType: binding.subjectType,
      workflowTemplateId: binding.workflowTemplateId,
      projectId: binding.projectId || null,
      constructionSiteId: binding.constructionSiteId || null,
    });
  },

  async getTemplateStartContext(templateId: string): Promise<{ firstNode: WorkflowNode | null; nodes: WorkflowNode[]; edges: WorkflowEdge[] }> {
    const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] = await Promise.all([
      supabase.from('workflow_nodes').select('*').eq('template_id', templateId),
      supabase.from('workflow_edges').select('*').eq('template_id', templateId),
    ]);
    if (nodeError) throw nodeError;
    if (edgeError) throw edgeError;
    const nodes = (nodeRows || []).map(mapWorkflowNode).filter(Boolean) as WorkflowNode[];
    const edges = (edgeRows || []).map((row: any): WorkflowEdge => ({
      id: row.id,
      templateId: row.template_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      label: row.label || '',
    }));
    const start = nodes.find(node => node.type === WorkflowNodeType.START);
    const firstId = start ? edges.find(edge => edge.sourceNodeId === start.id)?.targetNodeId : null;
    return { firstNode: firstId ? nodes.find(node => node.id === firstId) || null : null, nodes, edges };
  },

  async listRuntimeContextsBySubjects(subjects: ProjectWorkflowSubject[]): Promise<Record<string, ProjectWorkflowRuntimeContext>> {
    const instanceIds = Array.from(new Set(subjects.map(subject => subject.workflowInstanceId).filter(Boolean) as string[]));
    if (instanceIds.length === 0) return {};
    const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] = await Promise.all([
      supabase.from('workflow_instance_nodes').select('*').in('workflow_instance_id', instanceIds),
      supabase.from('workflow_instance_edges').select('*').in('workflow_instance_id', instanceIds),
    ]);
    if (nodeError) throw nodeError;
    if (edgeError) throw edgeError;
    const nodes = (nodeRows || []).map(mapWorkflowRuntimeNode).filter(Boolean) as WorkflowRuntimeNode[];
    const edges = (edgeRows || []).map(mapWorkflowRuntimeEdge);
    return subjects.reduce<Record<string, ProjectWorkflowRuntimeContext>>((acc, subject) => {
      acc[subject.id] = {
        subject,
        nodes: nodes.filter(node => node.workflowInstanceId === subject.workflowInstanceId),
        edges: edges.filter(edge => edge.workflowInstanceId === subject.workflowInstanceId),
      };
      return acc;
    }, {});
  },

  async saveTemplateStructure(input: {
    template: WorkflowTemplate;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  }): Promise<void> {
    const { error } = await supabase.rpc('save_workflow_template_structure', {
      p_template_id: input.template.id,
      p_template: {
        name: input.template.name,
        description: input.template.description || '',
        is_active: input.template.isActive,
        custom_fields: input.template.customFields || [],
        managers: input.template.managers || [],
        default_watchers: input.template.defaultWatchers || [],
      },
      p_nodes: input.nodes.map(node => ({
        id: node.id,
        type: node.type,
        label: node.label,
        config: node.config || {},
        position_x: node.positionX,
        position_y: node.positionY,
      })),
      p_edges: input.edges.map(edge => ({
        id: edge.id,
        source_node_id: edge.sourceNodeId,
        target_node_id: edge.targetNodeId,
        label: edge.label || '',
      })),
    });
    if (error) throw error;
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

  clearAssigneeCandidateCache(): void {
    assigneeCandidateCache.clear();
  },

  async getAssigneeCandidates(subject: ProjectWorkflowSubject, node?: WorkflowNode | null): Promise<ProjectStaff[]> {
    const cacheKey = getAssigneeCandidateCacheKey(subject, node);
    const cached = assigneeCandidateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rows;
    }

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

    const rows = staff.filter(row => !row.endDate);
    assigneeCandidateCache.set(cacheKey, {
      rows,
      expiresAt: Date.now() + ASSIGNEE_CANDIDATE_CACHE_TTL_MS,
    });
    return rows;
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

  async rollbackCompletedMaterialRequestWorkflow(input: {
    requestId: string;
    comment: string;
  }): Promise<ProjectWorkflowSubject> {
    const { data, error } = await supabase.rpc('rollback_completed_project_workflow', {
      p_subject_type: 'material_request',
      p_subject_id: input.requestId,
      p_comment: input.comment,
    });
    if (error) throw error;
    const subject = Array.isArray(data) ? data[0] : data;
    return this.getSubjectByMaterialRequestId(subject?.subject_id || input.requestId) as Promise<ProjectWorkflowSubject>;
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
    if (input.action === 'rollback') {
      return this.rollbackCompletedMaterialRequestWorkflow({
        requestId: input.requestId,
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
