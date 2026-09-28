import { Employee, ProjectWorkflowNodeConfig, WorkflowAssignmentTarget, WorkflowNode } from '../types';
import { getTargetDepartmentIds, getTargetUserIds } from './workflowStepSummary';
import { orderSteps } from './workflowStepDraft';

/**
 * Rules for the step editor in Dự án » Vật tư » Đề xuất vật tư. The editor only
 * offers assignment shapes that
 * app_private.project_workflow_runtime_assignee_is_eligible understands, so a
 * saved step can always be started and advanced.
 */

export type StepAssigneeKind = 'transition' | 'fixed' | 'pool' | 'creator';

export const STEP_ASSIGNEE_KIND_LABELS: Record<StepAssigneeKind, { label: string; hint: string }> = {
  transition: {
    label: 'Chọn khi chuyển bước',
    hint: 'Người chuyển bước tự chọn người duyệt trong số thành viên có quyền Duyệt của room.',
  },
  fixed: {
    label: 'Một người cố định',
    hint: 'Luôn giao cho đúng một người.',
  },
  pool: {
    label: 'Nhóm người / phòng ban',
    hint: 'Chỉ người trong nhóm mới được nhận bước này.',
  },
  creator: {
    label: 'Người tạo phiếu',
    hint: 'Trả về chính người đã gửi đề xuất.',
  },
};

export const getStepAssigneeKind = (config: ProjectWorkflowNodeConfig = {}): StepAssigneeKind => {
  if (config.assigneeUserId) return 'fixed';
  if (config.assignmentMode === 'creator') return 'creator';
  if (config.assignmentMode === 'fixed_user') return 'fixed';
  if (config.assignmentMode === 'permission_pool' || config.assignmentTargets?.length) return 'pool';
  return 'transition';
};

/** Targets the project editor does not edit (e.g. project_permission); kept as-is. */
export const getPreservedTargets = (targets: WorkflowAssignmentTarget[] = []) =>
  targets.filter(target => target.type !== 'user' && target.type !== 'department');

/** Switching kind clears the fields of the other kinds so the server never sees a mixed rule. */
export const withStepAssigneeKind = (
  config: ProjectWorkflowNodeConfig = {},
  kind: StepAssigneeKind,
): ProjectWorkflowNodeConfig => {
  const next: ProjectWorkflowNodeConfig = { ...config };
  delete next.assigneeUserId;
  delete next.assignmentTargets;
  delete next.assigneeSelectionMode;
  if (kind === 'fixed') {
    next.assignmentMode = 'fixed_user';
    if (config.assigneeUserId) next.assigneeUserId = config.assigneeUserId;
  } else if (kind === 'pool') {
    next.assignmentMode = 'permission_pool';
    if (config.assignmentTargets?.length) next.assignmentTargets = config.assignmentTargets;
    if (config.assigneeSelectionMode) next.assigneeSelectionMode = config.assigneeSelectionMode;
  } else if (kind === 'creator') {
    next.assignmentMode = 'creator';
  } else {
    next.assignmentMode = 'select_on_transition';
  }
  return next;
};

export type StepDraftIssues = {
  /** Problems that apply to the whole chain. */
  general: string[];
  byStepId: Record<string, string[]>;
  count: number;
};

export const validateStepDraft = (nodes: WorkflowNode[]): StepDraftIssues => {
  const steps = orderSteps(nodes);
  const general: string[] = [];
  const byStepId: Record<string, string[]> = {};
  if (steps.length === 0) general.push('Cần ít nhất một bước duyệt.');
  steps.forEach(step => {
    const issues: string[] = [];
    const config = step.config || {};
    if (!step.label.trim()) issues.push('Chưa đặt tên bước.');
    const kind = getStepAssigneeKind(config);
    if (kind === 'fixed' && !config.assigneeUserId) issues.push('Chưa chọn người xử lý.');
    if (kind === 'pool'
      && (config.assignmentTargets?.length || 0) === 0
      && (config.eligiblePermissionCodes?.length || 0) === 0) {
      issues.push('Chưa chọn người hoặc phòng ban trong nhóm.');
    }
    if (config.approvalPolicy && config.approvalPolicy !== 'ANY_ONE') {
      issues.push('Luật duyệt này chưa được hỗ trợ cho đề xuất vật tư.');
    }
    if (issues.length) byStepId[step.id] = issues;
  });
  const count = general.length + Object.values(byStepId).reduce((sum, list) => sum + list.length, 0);
  return { general, byStepId, count };
};

const isActiveEmployee = (employee: Pick<Employee, 'userId' | 'status'>) =>
  Boolean(employee.userId) && (!employee.status || employee.status === 'Đang làm việc');

export const getDepartmentMemberUserIds = (
  employees: Pick<Employee, 'userId' | 'status' | 'departmentId' | 'orgUnitId'>[],
  orgUnitId: string,
): string[] => Array.from(new Set(employees
  .filter(isActiveEmployee)
  .filter(employee => employee.departmentId === orgUnitId || employee.orgUnitId === orgUnitId)
  .map(employee => employee.userId as string)));

export type StepRecipientCheck =
  | { state: 'unchecked' }
  | { state: 'ok'; candidateCount: number }
  /** Some named people cannot receive the step; the rest still can. */
  | { state: 'partial'; ineligibleUserIds: string[]; eligibleCount: number }
  /** Nobody the step points at can receive it: the request would stop here. */
  | { state: 'blocked'; ineligibleUserIds: string[] }
  /** The room itself has nobody with Duyệt + Xem. */
  | { state: 'empty_room' };

/**
 * Mirrors app_private.assert_material_request_room_recipients: every assignee
 * needs room `approve` + `view`. `eligibleUserIds` is that intersection.
 */
export const checkStepRecipients = (
  config: ProjectWorkflowNodeConfig = {},
  eligibleUserIds: ReadonlySet<string> | null,
  employees: Pick<Employee, 'userId' | 'status' | 'departmentId' | 'orgUnitId'>[],
): StepRecipientCheck => {
  if (!eligibleUserIds) return { state: 'unchecked' };
  const kind = getStepAssigneeKind(config);
  if (kind === 'creator') return { state: 'unchecked' };
  if (kind === 'transition') {
    return eligibleUserIds.size === 0 ? { state: 'empty_room' } : { state: 'ok', candidateCount: eligibleUserIds.size };
  }
  const candidates = kind === 'fixed'
    ? (config.assigneeUserId ? [config.assigneeUserId] : [])
    : Array.from(new Set([
      ...getTargetUserIds(config.assignmentTargets),
      ...getTargetDepartmentIds(config.assignmentTargets).flatMap(id => getDepartmentMemberUserIds(employees, id)),
    ]));
  // Permission-based pools are resolved by the server; only named people are checked here.
  if (candidates.length === 0) return { state: 'unchecked' };
  const ineligibleUserIds = candidates.filter(id => !eligibleUserIds.has(id));
  const eligibleCount = candidates.length - ineligibleUserIds.length;
  // Permission targets may still supply someone eligible, so never call the step blocked.
  const hasServerResolvedTargets = kind === 'pool' && getPreservedTargets(config.assignmentTargets).length > 0;
  if (eligibleCount === 0 && !hasServerResolvedTargets) return { state: 'blocked', ineligibleUserIds };
  if (ineligibleUserIds.length > 0) return { state: 'partial', ineligibleUserIds, eligibleCount };
  return { state: 'ok', candidateCount: candidates.length };
};
