import {
  Employee,
  OrgUnit,
  Role,
  User,
  WorkflowAssignmentTarget,
  WorkflowInstance,
  WorkflowInstanceAction,
  WorkflowInstanceLog,
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

export const isWorkflowStepAssignedToUser = (
  instance: WorkflowInstance,
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined,
  user: Pick<User, 'id' | 'role'>,
): boolean => {
  if (!node) return false;
  if (getEffectiveStepAssigneeIds(instance, node).includes(user.id)) return true;
  return Boolean(node.config?.assigneeRole && node.config.assigneeRole === user.role);
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

