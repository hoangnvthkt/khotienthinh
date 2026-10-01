import {
  Employee,
  OrgUnit,
  Role,
  User,
  WorkflowAssignmentTarget,
  WorkflowInstance,
  WorkflowInstanceAction,
  WorkflowInstanceLog,
  WorkflowInstanceStatus,
  WorkflowNode,
  WorkflowNodeType,
} from '../types';

export interface WorkflowAssigneeCandidate {
  id: string;
  name: string;
  role?: Role;
  source: 'fixed' | 'creator' | 'previous' | 'target' | 'department' | 'role';
  sublabel?: string;
}

interface ResolveWorkflowAssigneesInput {
  node?: WorkflowNode | null;
  instance?: WorkflowInstance | null;
  users: User[];
  employees?: Employee[];
  orgUnits?: OrgUnit[];
  logs?: WorkflowInstanceLog[];
}

export const normalizeStepAssigneeIds = (value: string | string[] | null | undefined): string[] => {
  if (Array.isArray(value)) return Array.from(new Set(value.filter(Boolean)));
  return value ? [value] : [];
};

export const getEffectiveStepAssigneeIds = (
  instance: WorkflowInstance,
  node?: Pick<WorkflowNode, 'id' | 'config'> | null,
): string[] => {
  if (!node) return [];
  const override = normalizeStepAssigneeIds(instance.stepAssignees?.[node.id]);
  if (override.length > 0) return override;
  return normalizeStepAssigneeIds(node.config?.assigneeUserId);
};

export const resolveCurrentWorkflowAssignees = (
  instance: WorkflowInstance,
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined,
  users: User[],
): User[] => {
  if (instance.status !== WorkflowInstanceStatus.RUNNING || !node) return [];

  const userById = new Map(users.map(user => [user.id, user]));
  return getEffectiveStepAssigneeIds(instance, node)
    .map(userId => userById.get(userId))
    .filter((user): user is User => Boolean(user));
};

export const getWorkflowAssigneeDisplay = (assignees: User[]) => ({
  visibleAssignees: assignees.slice(0, 2),
  label: assignees.length === 0
    ? 'Chưa phân công'
    : `${getUserLabel(assignees[0])}${assignees.length > 1 ? ` +${assignees.length - 1}` : ''}`,
  overflowCount: Math.max(assignees.length - 2, 0),
});

export const isWorkflowStepAssignedToUser = (
  instance: WorkflowInstance,
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined,
  user: Pick<User, 'id' | 'role'>,
): boolean => {
  if (!node) return false;
  if (getEffectiveStepAssigneeIds(instance, node).includes(user.id)) return true;
  return Boolean(node.config?.assigneeRole && node.config.assigneeRole === user.role);
};

export const canUserActOnWorkflowStep = ({
  instance,
  node,
  user,
  templateManagerIds = [],
  firstTaskNodeId,
  logs = [],
}: {
  instance: WorkflowInstance;
  node: Pick<WorkflowNode, 'id' | 'config' | 'type'> | null | undefined;
  user: Pick<User, 'id' | 'role'>;
  templateManagerIds?: string[];
  firstTaskNodeId?: string | null;
  logs?: WorkflowInstanceLog[];
}): boolean => {
  if (!node || instance.status !== WorkflowInstanceStatus.RUNNING) return false;
  if (node.type === WorkflowNodeType.START || node.type === WorkflowNodeType.END) return false;
  if (user.role === Role.ADMIN || templateManagerIds.includes(user.id)) return true;
  if (isWorkflowStepAssignedToUser(instance, node, user)) return true;
  if (instance.createdBy !== user.id || instance.currentNodeId !== firstTaskNodeId) return false;
  return logs.some(log =>
    log.instanceId === instance.id
    && log.action === WorkflowInstanceAction.REVISION_REQUESTED
  );
};

export const buildInitialWorkflowStepAssignees = (
  firstTaskNodeId: string | null | undefined,
  assigneeUserIds: string | string[] | null | undefined,
): Record<string, string[]> | null => {
  const normalized = normalizeStepAssigneeIds(assigneeUserIds);
  if (!firstTaskNodeId || normalized.length === 0) return null;
  return { [firstTaskNodeId]: normalized };
};

export const getWorkflowProcessErrorMessage = (
  error: { code?: string; message?: string } | null | undefined,
): string => {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('user is not allowed to process current workflow step')) {
    return 'Bạn không phải người được phân công xử lý bước hiện tại.';
  }
  if (message.includes('workflow instance is not running')) {
    return 'Phiếu đã được người khác xử lý hoặc không còn ở trạng thái đang chạy.';
  }
  if (message.includes('workflow_already_approved')) {
    return 'Bạn đã duyệt giai đoạn này rồi, đang chờ những người còn lại.';
  }
  if (message.includes('workflow_reject_not_allowed')) {
    return 'Bước này không cho phép từ chối. Hãy hoàn thành hoặc yêu cầu bổ sung.';
  }
  if (message.includes('request_workflow_use_request_module')) {
    return 'Phiếu này phải được xử lý trong module Yêu cầu.';
  }
  if (error?.code === '57014' || message.includes('statement timeout')) {
    return 'Hệ thống xử lý quá thời gian. Vui lòng tải lại trạng thái phiếu trước khi thử lại.';
  }
  return 'Không xử lý được phiếu. Vui lòng thử lại.';
};

const getUserLabel = (user: User) => user.name || user.username || user.email || user.id;

const employeeBelongsToDepartment = (employee: Employee, orgUnitId: string) =>
  employee.departmentId === orgUnitId || employee.orgUnitId === orgUnitId;

const isActiveEmployee = (employee: Employee) =>
  Boolean(employee.userId) && (!employee.status || employee.status === 'Đang làm việc');

const addCandidate = (
  byId: Map<string, WorkflowAssigneeCandidate>,
  userById: Map<string, User>,
  id: string | null | undefined,
  source: WorkflowAssigneeCandidate['source'],
  sublabel?: string,
) => {
  if (!id || byId.has(id)) return;
  const user = userById.get(id);
  if (!user || user.isActive === false) return;
  byId.set(id, {
    id,
    name: getUserLabel(user),
    role: user.role,
    source,
    sublabel: sublabel || user.role,
  });
};

const getPreviousActorId = (instance?: WorkflowInstance | null, logs: WorkflowInstanceLog[] = []) => {
  if (!instance) return null;
  const orderedLogs = logs
    .filter(log => log.instanceId === instance.id && log.action === WorkflowInstanceAction.APPROVED)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return orderedLogs[0]?.actedBy || null;
};

export const resolveWorkflowStepAssigneeCandidates = ({
  node,
  instance,
  users,
  employees = [],
  orgUnits = [],
  logs = [],
}: ResolveWorkflowAssigneesInput): WorkflowAssigneeCandidate[] => {
  if (!node || node.type === WorkflowNodeType.START || node.type === WorkflowNodeType.END) return [];

  const userById = new Map(users.map(user => [user.id, user]));
  const byId = new Map<string, WorkflowAssigneeCandidate>();
  const config = node.config || {};

  if (config.assignmentMode === 'creator') {
    addCandidate(byId, userById, instance?.createdBy, 'creator', 'Người tạo phiếu');
    return Array.from(byId.values());
  }

  if (config.assignmentMode === 'previous_assignee') {
    addCandidate(byId, userById, getPreviousActorId(instance, logs), 'previous', 'Người đã xử lý trước');
    return Array.from(byId.values());
  }

  if (config.assigneeUserId) {
    addCandidate(byId, userById, config.assigneeUserId, 'fixed', 'Người cố định');
    return Array.from(byId.values());
  }

  const targets: WorkflowAssignmentTarget[] = config.assignmentTargets || [];
  const targetUserIds = targets
    .filter(target => target.type === 'user' && target.userId)
    .map(target => target.userId as string);
  const targetDepartmentIds = targets
    .filter(target => target.type === 'department' && target.orgUnitId)
    .map(target => target.orgUnitId as string);

  targetUserIds.forEach(userId => addCandidate(byId, userById, userId, 'target', 'Pool người mặc định'));

  targetDepartmentIds.forEach(orgUnitId => {
    const unitName = orgUnits.find(unit => unit.id === orgUnitId)?.name || 'Phòng ban';
    employees
      .filter(isActiveEmployee)
      .filter(employee => employeeBelongsToDepartment(employee, orgUnitId))
      .forEach(employee => addCandidate(byId, userById, employee.userId, 'department', unitName));
  });

  if (byId.size > 0) {
    const candidates = Array.from(byId.values());
    return config.assigneeRole
      ? candidates.filter(candidate => candidate.role === config.assigneeRole)
      : candidates;
  }

  if (config.assigneeRole) {
    users
      .filter(user => user.isActive !== false && user.role === config.assigneeRole)
      .forEach(user => addCandidate(byId, userById, user.id, 'role', user.role));
  }

  return Array.from(byId.values());
};

export const getWorkflowStepSelectionMode = (node?: WorkflowNode | null): 'single' | 'multiple' => {
  if (!node) return 'single';
  if (node.config?.assigneeSelectionMode) return node.config.assigneeSelectionMode;
  const targetCount = (node.config?.assignmentTargets || []).filter(target =>
    (target.type === 'user' && target.userId) || (target.type === 'department' && target.orgUnitId)
  ).length;
  return targetCount > 1 ? 'multiple' : 'single';
};

// How a step picks its handler, as the builder presents it. Legacy role-only
// steps keep working at runtime but are shown so admins can migrate them.
export type WorkflowStepAssigneeKind = 'fixed' | 'pool' | 'creator' | 'previous' | 'role' | 'none';

export const getWorkflowStepAssigneeKind = (config: WorkflowNode['config'] | undefined): WorkflowStepAssigneeKind => {
  const safeConfig = config || {};
  if (safeConfig.assignmentMode === 'creator') return 'creator';
  if (safeConfig.assignmentMode === 'previous_assignee') return 'previous';
  if (safeConfig.assigneeUserId) return 'fixed';
  const hasTargets = (safeConfig.assignmentTargets || []).some(target =>
    (target.type === 'user' && target.userId) || (target.type === 'department' && target.orgUnitId));
  if (hasTargets) return 'pool';
  if (safeConfig.assigneeRole) return 'role';
  if (safeConfig.assignmentMode === 'fixed_user') return 'fixed';
  return safeConfig.assignmentMode ? 'pool' : 'none';
};

// Mirrors app_private.workflow_template_assignee_errors so the builder can warn
// before the server refuses to publish. Returns null when the step is usable.
export const getWorkflowStepAssigneeIssue = ({
  node,
  isFirstStep,
  users,
  employees = [],
}: {
  node: Pick<WorkflowNode, 'label' | 'config'>;
  isFirstStep: boolean;
  users: User[];
  employees?: Employee[];
}): string | null => {
  const config = node.config || {};
  const kind = getWorkflowStepAssigneeKind(config);
  const activeUserIds = new Set(users.filter(user => user.isActive !== false).map(user => user.id));
  // An empty user list means people are still loading: unknown, not "nobody".
  const peopleKnown = users.length > 1;

  if (kind === 'creator') return null;
  if (kind === 'previous') {
    return isFirstStep ? 'Bước đầu tiên không có "người đã xử lý bước trước".' : null;
  }
  if (kind === 'fixed') {
    if (!config.assigneeUserId) return 'Chưa chọn người xử lý cố định.';
    return peopleKnown && !activeUserIds.has(config.assigneeUserId)
      ? 'Người xử lý cố định đã nghỉ hoặc bị khóa tài khoản.'
      : null;
  }
  if (kind === 'pool') {
    const targets = config.assignmentTargets || [];
    const hasTargets = targets.some(target =>
      (target.type === 'user' && target.userId) || (target.type === 'department' && target.orgUnitId));
    if (!hasTargets) return 'Chưa chọn người hoặc phòng ban để chọn người xử lý.';
    if (!peopleKnown) return null;
    const roleOf = new Map(users.map(user => [user.id, user.role]));
    const matchesRole = (userId: string) => !config.assigneeRole || roleOf.get(userId) === config.assigneeRole;
    const hasCandidate = targets.some(target => {
      if (target.type === 'user' && target.userId) return activeUserIds.has(target.userId) && matchesRole(target.userId);
      if (target.type === 'department' && target.orgUnitId) {
        // Department membership needs HR data; without it the server decides.
        if (employees.length === 0) return true;
        return employees.some(employee =>
          isActiveEmployee(employee)
          && employeeBelongsToDepartment(employee, target.orgUnitId!)
          && activeUserIds.has(employee.userId!)
          && matchesRole(employee.userId!));
      }
      return false;
    });
    return hasCandidate ? null : 'Danh sách người xử lý không còn ai đang làm việc.';
  }
  if (kind === 'role') {
    if (!peopleKnown) return null;
    return users.some(user => user.isActive !== false && user.role === config.assigneeRole)
      ? null
      : 'Không có ai thuộc vai trò được chỉ định.';
  }
  return 'Chưa có người xử lý.';
};
