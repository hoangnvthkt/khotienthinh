import type {
  OrgUnit,
  ProjectWorkflowNodeConfig,
  User,
  WorkflowAssignmentTarget,
} from '../types';

/**
 * Shared "who handles this stage" description. Used by the Quy trình builder
 * and by the read-only step list inside Dự án » Vật tư » Đề xuất vật tư, so
 * both surfaces describe a stage the same way.
 */

export const ASSIGNMENT_MODE_LABELS: Record<string, string> = {
  select_on_submit: 'Chọn khi gửi yêu cầu',
  select_on_transition: 'Chọn khi chuyển giai đoạn',
  fixed_user: 'Người cố định',
  permission_pool: 'Theo nhóm quyền',
  previous_assignee: 'Người đã xử lý trước',
  creator: 'Người tạo nhiệm vụ',
};

export const getTargetUserIds = (targets?: WorkflowAssignmentTarget[]): string[] =>
  (targets || []).filter(target => target.type === 'user' && target.userId).map(target => target.userId!);

export const getTargetDepartmentIds = (targets?: WorkflowAssignmentTarget[]): string[] =>
  (targets || []).filter(target => target.type === 'department' && target.orgUnitId).map(target => target.orgUnitId!);

export type WorkflowStepSummaryLookups = {
  userNameById: Map<string, string>;
  orgUnits: Pick<OrgUnit, 'id' | 'name'>[];
};

export const buildUserNameById = (
  users: Pick<User, 'id' | 'name' | 'username' | 'email'>[],
): Map<string, string> => new Map(
  users.map(item => [item.id, item.name || item.username || item.email || item.id]),
);

export const describeAssignmentTargets = (
  targets: WorkflowAssignmentTarget[] | undefined,
  lookups: WorkflowStepSummaryLookups,
): string | null => {
  const userIds = getTargetUserIds(targets);
  const departmentIds = getTargetDepartmentIds(targets);
  const parts: string[] = [];
  if (userIds.length > 0) {
    parts.push(userIds.map(id => lookups.userNameById.get(id) || id).join(', '));
  }
  if (departmentIds.length > 0) {
    parts.push(departmentIds
      .map(id => lookups.orgUnits.find(unit => unit.id === id)?.name || 'Phòng ban')
      .join(', '));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

/**
 * A bare role string hid whether a stage goes to one person or to a pool, which
 * is the distinction that decides who can move the card.
 */
export const describeStepAssignment = (
  config: ProjectWorkflowNodeConfig,
  lookups: WorkflowStepSummaryLookups,
): string => {
  if (config.assigneeUserId) {
    return lookups.userNameById.get(config.assigneeUserId) || 'Người cố định';
  }
  const targetLabel = describeAssignmentTargets(config.assignmentTargets, lookups);
  if (targetLabel) {
    const poolSize = getTargetUserIds(config.assignmentTargets).length
      + getTargetDepartmentIds(config.assignmentTargets).length;
    return poolSize > 1 ? `Pool: ${targetLabel}` : targetLabel;
  }
  if (config.assignmentMode && ASSIGNMENT_MODE_LABELS[config.assignmentMode]) {
    return ASSIGNMENT_MODE_LABELS[config.assignmentMode];
  }
  if (config.assigneeRole) return `Vai trò ${config.assigneeRole}`;
  return 'Chưa gán người xử lý';
};

/** Pool steps only need one member to move the card — worth flagging in lists. */
export const isConcurrentApprovalStep = (config: ProjectWorkflowNodeConfig): boolean =>
  config.assigneeSelectionMode === 'multiple';
