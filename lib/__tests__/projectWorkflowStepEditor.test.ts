import { describe, expect, it } from 'vitest';
import { ProjectWorkflowNodeConfig, WorkflowNode, WorkflowNodeType } from '../../types';
import {
  checkStepRecipients,
  getDepartmentMemberUserIds,
  getPreservedTargets,
  getStepAssigneeKind,
  validateStepDraft,
  withStepAssigneeKind,
} from '../projectWorkflowStepEditor';

const node = (
  id: string,
  positionY: number,
  config: ProjectWorkflowNodeConfig = {},
  type = WorkflowNodeType.APPROVAL,
  label: string = id,
): WorkflowNode => ({ id, templateId: 't', type, label, config, positionX: 0, positionY });

const employees = [
  { userId: 'u1', status: 'Đang làm việc', departmentId: 'd1' },
  { userId: 'u2', status: 'Đã nghỉ việc', departmentId: 'd1' },
  { userId: 'u3', orgUnitId: 'd1' },
  { userId: 'u4', departmentId: 'd2' },
] as any[];

describe('getStepAssigneeKind', () => {
  it('detects every assignee shape', () => {
    expect(getStepAssigneeKind()).toBe('transition');
    expect(getStepAssigneeKind({ assignmentMode: 'select_on_transition' })).toBe('transition');
    expect(getStepAssigneeKind({ assigneeUserId: 'u1' })).toBe('fixed');
    expect(getStepAssigneeKind({ assignmentMode: 'fixed_user' })).toBe('fixed');
    expect(getStepAssigneeKind({ assignmentMode: 'creator' })).toBe('creator');
    expect(getStepAssigneeKind({ assignmentMode: 'permission_pool' })).toBe('pool');
    expect(getStepAssigneeKind({ assignmentTargets: [{ type: 'user', userId: 'u1' }] })).toBe('pool');
  });
});

describe('withStepAssigneeKind', () => {
  const mixed: ProjectWorkflowNodeConfig = {
    assigneeUserId: 'u1',
    assignmentTargets: [{ type: 'department', orgUnitId: 'd1' }],
    assigneeSelectionMode: 'multiple',
    slaHours: 24,
  };

  it('keeps only the fields of the chosen kind', () => {
    expect(withStepAssigneeKind(mixed, 'fixed')).toEqual({ assignmentMode: 'fixed_user', assigneeUserId: 'u1', slaHours: 24 });
    expect(withStepAssigneeKind(mixed, 'pool')).toEqual({
      assignmentMode: 'permission_pool',
      assignmentTargets: [{ type: 'department', orgUnitId: 'd1' }],
      assigneeSelectionMode: 'multiple',
      slaHours: 24,
    });
    expect(withStepAssigneeKind(mixed, 'creator')).toEqual({ assignmentMode: 'creator', slaHours: 24 });
    expect(withStepAssigneeKind(mixed, 'transition')).toEqual({ assignmentMode: 'select_on_transition', slaHours: 24 });
  });
});

describe('getPreservedTargets', () => {
  it('keeps only targets the project editor does not edit', () => {
    expect(getPreservedTargets([
      { type: 'user', userId: 'u1' },
      { type: 'department', orgUnitId: 'd1' },
      { type: 'project_permission', permissionCode: 'material_request.approve' },
    ])).toEqual([{ type: 'project_permission', permissionCode: 'material_request.approve' }]);
    expect(getPreservedTargets()).toEqual([]);
  });
});

describe('validateStepDraft', () => {
  it('requires at least one approval step', () => {
    const issues = validateStepDraft([node('start', 0, {}, WorkflowNodeType.START), node('end', 999, {}, WorkflowNodeType.END)]);
    expect(issues.general).toHaveLength(1);
    expect(issues.count).toBe(1);
  });

  it('reports each broken step by id', () => {
    const issues = validateStepDraft([
      node('a', 100, {}, WorkflowNodeType.APPROVAL, '   '),
      node('b', 200, { assignmentMode: 'fixed_user' }),
      node('c', 300, { assignmentMode: 'permission_pool' }),
      node('d', 400, { approvalPolicy: 'ALL' as any }),
      node('ok', 500, { assignmentMode: 'permission_pool', eligiblePermissionCodes: ['x'] }),
    ]);
    expect(Object.keys(issues.byStepId).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(issues.count).toBe(4);
  });
});

describe('getDepartmentMemberUserIds', () => {
  it('returns active members matched by department or org unit', () => {
    expect(getDepartmentMemberUserIds(employees, 'd1').sort()).toEqual(['u1', 'u3']);
  });
});

describe('checkStepRecipients', () => {
  const eligible = new Set(['u1', 'u4']);

  it('stays unchecked when the room is unknown or the server resolves the assignee', () => {
    expect(checkStepRecipients({ assigneeUserId: 'u9' }, null, employees)).toEqual({ state: 'unchecked' });
    expect(checkStepRecipients({ assignmentMode: 'creator' }, eligible, employees)).toEqual({ state: 'unchecked' });
    expect(checkStepRecipients({ assignmentMode: 'permission_pool', eligiblePermissionCodes: ['x'] }, eligible, employees))
      .toEqual({ state: 'unchecked' });
  });

  it('flags a room with nobody who can approve', () => {
    expect(checkStepRecipients({}, new Set(), employees)).toEqual({ state: 'empty_room' });
    expect(checkStepRecipients({}, eligible, employees)).toEqual({ state: 'ok', candidateCount: 2 });
  });

  it('checks a fixed assignee', () => {
    expect(checkStepRecipients({ assigneeUserId: 'u1' }, eligible, employees)).toEqual({ state: 'ok', candidateCount: 1 });
    expect(checkStepRecipients({ assigneeUserId: 'u3' }, eligible, employees))
      .toEqual({ state: 'blocked', ineligibleUserIds: ['u3'] });
  });

  it('expands departments and reports partial pools', () => {
    const config: ProjectWorkflowNodeConfig = { assignmentTargets: [{ type: 'department', orgUnitId: 'd1' }] };
    expect(checkStepRecipients(config, eligible, employees))
      .toEqual({ state: 'partial', ineligibleUserIds: ['u3'], eligibleCount: 1 });
  });

  it('never blocks a pool that also has server-resolved targets', () => {
    const config: ProjectWorkflowNodeConfig = {
      assignmentTargets: [
        { type: 'user', userId: 'u3' },
        { type: 'project_permission', permissionCode: 'material_request.approve' },
      ],
    };
    expect(checkStepRecipients(config, eligible, employees))
      .toEqual({ state: 'partial', ineligibleUserIds: ['u3'], eligibleCount: 0 });
  });
});
