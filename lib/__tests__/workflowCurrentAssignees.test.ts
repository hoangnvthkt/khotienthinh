import { describe, expect, it } from 'vitest';
import * as workflowAssignmentResolver from '../workflowAssignmentResolver';
import { Role, User, WorkflowInstance, WorkflowInstanceAction, WorkflowInstanceLog, WorkflowNode } from '../../types';

type ResolveCurrentWorkflowAssignees = (
  instance: WorkflowInstance,
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined,
  users: User[],
) => User[];

type GetWorkflowAssigneeDisplay = (assignees: User[]) => {
  visibleAssignees: User[];
  label: string;
  overflowCount: number;
};

const resolveCurrentWorkflowAssignees = (
  workflowAssignmentResolver as unknown as Record<string, unknown>
).resolveCurrentWorkflowAssignees as ResolveCurrentWorkflowAssignees | undefined;

const getWorkflowAssigneeDisplay = (
  workflowAssignmentResolver as unknown as Record<string, unknown>
).getWorkflowAssigneeDisplay as GetWorkflowAssigneeDisplay | undefined;

type CanUserActOnWorkflowStep = (input: {
  instance: WorkflowInstance;
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined;
  user: Pick<User, 'id' | 'role'>;
  templateManagerIds?: string[];
  firstTaskNodeId?: string | null;
  logs?: WorkflowInstanceLog[];
}) => boolean;

type BuildInitialWorkflowStepAssignees = (
  firstTaskNodeId: string | null | undefined,
  assigneeUserIds: string | string[] | null | undefined,
) => Record<string, string[]> | null;

type GetWorkflowProcessErrorMessage = (error: { code?: string; message?: string } | null | undefined) => string;

const canUserActOnWorkflowStep = (
  workflowAssignmentResolver as unknown as Record<string, unknown>
).canUserActOnWorkflowStep as CanUserActOnWorkflowStep | undefined;

const buildInitialWorkflowStepAssignees = (
  workflowAssignmentResolver as unknown as Record<string, unknown>
).buildInitialWorkflowStepAssignees as BuildInitialWorkflowStepAssignees | undefined;

const getWorkflowProcessErrorMessage = (
  workflowAssignmentResolver as unknown as Record<string, unknown>
).getWorkflowProcessErrorMessage as GetWorkflowProcessErrorMessage | undefined;

const users = [
  { id: 'user-1', name: 'Nguyễn Văn An', avatar: 'an.jpg' },
  { id: 'user-2', name: 'Trần Thị Bình', avatar: 'binh.jpg' },
  { id: 'fixed-user', name: 'Lê Cố Định', avatar: 'fixed.jpg' },
] as User[];

const runningInstance = {
  id: 'instance-1',
  templateId: 'template-1',
  code: 'WF-001',
  title: 'Phiếu kiểm thử',
  createdBy: 'creator-1',
  currentNodeId: 'current-step',
  status: 'RUNNING',
  formData: {},
  watchers: [],
  stepAssignees: {
    'current-step': ['user-2', 'user-1', 'user-2'],
  },
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
} as WorkflowInstance;

const currentNode = {
  id: 'current-step',
  config: {
    assigneeUserId: 'fixed-user',
    assigneeRole: 'WAREHOUSE_KEEPER',
  },
} as WorkflowNode;

describe('resolveCurrentWorkflowAssignees', () => {
  it('uses the explicit current-step recipients in assignment order', () => {
    expect(resolveCurrentWorkflowAssignees).toBeTypeOf('function');
    if (!resolveCurrentWorkflowAssignees) return;

    expect(resolveCurrentWorkflowAssignees(runningInstance, currentNode, users).map(user => user.id))
      .toEqual(['user-2', 'user-1']);
  });

  it('falls back to the fixed step recipient when there is no explicit assignment', () => {
    expect(resolveCurrentWorkflowAssignees).toBeTypeOf('function');
    if (!resolveCurrentWorkflowAssignees) return;

    const instance = { ...runningInstance, stepAssignees: {} } as WorkflowInstance;

    expect(resolveCurrentWorkflowAssignees(instance, currentNode, users).map(user => user.id))
      .toEqual(['fixed-user']);
  });

  it('does not guess a recipient from a role when no concrete user was assigned', () => {
    expect(resolveCurrentWorkflowAssignees).toBeTypeOf('function');
    if (!resolveCurrentWorkflowAssignees) return;

    const roleOnlyNode = {
      id: 'current-step',
      config: { assigneeRole: 'WAREHOUSE_KEEPER' },
    } as WorkflowNode;
    const instanceWithoutAssignment = { ...runningInstance, stepAssignees: {} } as WorkflowInstance;

    expect(resolveCurrentWorkflowAssignees(instanceWithoutAssignment, roleOnlyNode, users)).toEqual([]);
  });

  it('returns no current recipient once the workflow is no longer running', () => {
    expect(resolveCurrentWorkflowAssignees).toBeTypeOf('function');
    if (!resolveCurrentWorkflowAssignees) return;

    const completedInstance = { ...runningInstance, status: 'COMPLETED' } as WorkflowInstance;

    expect(resolveCurrentWorkflowAssignees(completedInstance, currentNode, users)).toEqual([]);
  });
});

describe('getWorkflowAssigneeDisplay', () => {
  it('shows a clear fallback when the step has no concrete recipient', () => {
    expect(getWorkflowAssigneeDisplay).toBeTypeOf('function');
    if (!getWorkflowAssigneeDisplay) return;

    expect(getWorkflowAssigneeDisplay([])).toEqual({
      visibleAssignees: [],
      label: 'Chưa phân công',
      overflowCount: 0,
    });
  });

  it('limits avatars to two and summarizes every other recipient after the first name', () => {
    expect(getWorkflowAssigneeDisplay).toBeTypeOf('function');
    if (!getWorkflowAssigneeDisplay) return;

    const assignees = [
      users[1],
      users[0],
      { id: 'user-3', name: 'Phạm Minh Châu', avatar: 'chau.jpg' } as User,
    ];

    const display = getWorkflowAssigneeDisplay(assignees);
    expect(display.visibleAssignees.map(user => user.id)).toEqual(['user-2', 'user-1']);
    expect(display.label).toBe('Trần Thị Bình +2');
    expect(display.overflowCount).toBe(1);
  });
});

describe('workflow step authorization', () => {
  const creator = { id: 'creator-1', role: Role.EMPLOYEE } as User;
  const firstNode = { id: 'current-step', config: {} } as WorkflowNode;

  it('does not let the creator approve an unassigned first step before a revision request', () => {
    expect(canUserActOnWorkflowStep).toBeTypeOf('function');
    if (!canUserActOnWorkflowStep) return;

    expect(canUserActOnWorkflowStep({
      instance: { ...runningInstance, stepAssignees: {} },
      node: firstNode,
      user: creator,
      firstTaskNodeId: firstNode.id,
      logs: [],
    })).toBe(false);
  });

  it('lets the creator handle the first step after it was returned for revision', () => {
    expect(canUserActOnWorkflowStep).toBeTypeOf('function');
    if (!canUserActOnWorkflowStep) return;

    const revisionLog = {
      id: 'log-1',
      instanceId: runningInstance.id,
      nodeId: 'later-step',
      action: WorkflowInstanceAction.REVISION_REQUESTED,
      actedBy: 'reviewer-1',
      comment: 'Bổ sung hồ sơ',
      createdAt: '2026-08-30T00:00:00.000Z',
    } as WorkflowInstanceLog;

    expect(canUserActOnWorkflowStep({
      instance: { ...runningInstance, stepAssignees: {} },
      node: firstNode,
      user: creator,
      firstTaskNodeId: firstNode.id,
      logs: [revisionLog],
    })).toBe(true);
  });
});

describe('initial workflow assignment', () => {
  it('normalizes and persists the selected recipients for the first task node', () => {
    expect(buildInitialWorkflowStepAssignees).toBeTypeOf('function');
    if (!buildInitialWorkflowStepAssignees) return;

    expect(buildInitialWorkflowStepAssignees('first-step', ['user-2', 'user-1', 'user-2']))
      .toEqual({ 'first-step': ['user-2', 'user-1'] });
  });

  it('refuses to build a running first step without a concrete recipient', () => {
    expect(buildInitialWorkflowStepAssignees).toBeTypeOf('function');
    if (!buildInitialWorkflowStepAssignees) return;

    expect(buildInitialWorkflowStepAssignees('first-step', [])).toBeNull();
  });
});

describe('workflow process errors', () => {
  it('turns the database step-assignee denial into an actionable message', () => {
    expect(getWorkflowProcessErrorMessage).toBeTypeOf('function');
    if (!getWorkflowProcessErrorMessage) return;

    expect(getWorkflowProcessErrorMessage({
      code: 'P0001',
      message: 'user is not allowed to process current workflow step',
    })).toBe('Bạn không phải người được phân công xử lý bước hiện tại.');
  });
});
