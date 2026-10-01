import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getWorkflowStepAssigneeIssue, getWorkflowStepAssigneeKind } from '../workflowAssignmentResolver';
import { Employee, Role, User, WorkflowNode } from '../../types';

const user = (id: string, role = Role.EMPLOYEE, isActive = true) => ({ id, name: id, role, isActive } as User);
const users = [user('an'), user('binh', Role.WAREHOUSE_KEEPER), user('cuong', Role.EMPLOYEE, false)];
const step = (config: WorkflowNode['config']) => ({ label: 'Duyệt', config });
const issue = (config: WorkflowNode['config'], isFirstStep = false, employees: Employee[] = []) =>
  getWorkflowStepAssigneeIssue({ node: step(config), isFirstStep, users, employees });

describe('getWorkflowStepAssigneeKind', () => {
  it('follows the runtime precedence: mode, fixed user, list, legacy role', () => {
    expect(getWorkflowStepAssigneeKind({ assignmentMode: 'creator', assigneeUserId: 'an' })).toBe('creator');
    expect(getWorkflowStepAssigneeKind({ assignmentMode: 'previous_assignee' })).toBe('previous');
    expect(getWorkflowStepAssigneeKind({ assigneeUserId: 'an', assignmentTargets: [{ type: 'user', userId: 'binh' }] })).toBe('fixed');
    expect(getWorkflowStepAssigneeKind({ assignmentTargets: [{ type: 'department', orgUnitId: 'hr' }] })).toBe('pool');
    expect(getWorkflowStepAssigneeKind({ assigneeRole: Role.WAREHOUSE_KEEPER })).toBe('role');
    expect(getWorkflowStepAssigneeKind({})).toBe('none');
  });
});

describe('getWorkflowStepAssigneeIssue', () => {
  it('flags a step nobody can be picked for', () => {
    expect(issue({})).toBe('Chưa có người xử lý.');
    expect(issue({ assignmentMode: 'select_on_transition' })).toMatch(/Chưa chọn người hoặc phòng ban/);
    expect(issue({ assignmentMode: 'fixed_user' })).toMatch(/Chưa chọn người xử lý cố định/);
  });

  it('accepts creator, fixed active user and a list with an active person', () => {
    expect(issue({ assignmentMode: 'creator' }, true)).toBeNull();
    expect(issue({ assigneeUserId: 'an' })).toBeNull();
    expect(issue({ assignmentTargets: [{ type: 'user', userId: 'an' }] })).toBeNull();
  });

  it('rejects "previous handler" on the first step only', () => {
    expect(issue({ assignmentMode: 'previous_assignee' }, true)).toMatch(/Bước đầu tiên/);
    expect(issue({ assignmentMode: 'previous_assignee' }, false)).toBeNull();
  });

  it('flags lists and fixed users that only point at inactive accounts', () => {
    expect(issue({ assigneeUserId: 'cuong' })).toMatch(/đã nghỉ/);
    expect(issue({ assignmentTargets: [{ type: 'user', userId: 'cuong' }] })).toMatch(/không còn ai/);
    expect(issue({ assignmentTargets: [{ type: 'user', userId: 'an' }], assigneeRole: Role.WAREHOUSE_KEEPER })).toMatch(/không còn ai/);
  });

  it('resolves departments through active employees and defers to the server without HR data', () => {
    const departmentStep = { assignmentTargets: [{ type: 'department' as const, orgUnitId: 'hr' }] };
    expect(issue(departmentStep, false, [])).toBeNull();
    expect(issue(departmentStep, false, [{ id: 'e1', userId: 'an', departmentId: 'hr', status: 'Đang làm việc' } as Employee])).toBeNull();
    expect(issue(departmentStep, false, [{ id: 'e2', userId: 'cuong', departmentId: 'hr', status: 'Đang làm việc' } as Employee])).toMatch(/không còn ai/);
  });

  it('treats an unloaded people list as unknown rather than nobody', () => {
    expect(getWorkflowStepAssigneeIssue({ node: step({ assigneeUserId: 'ghost' }), isFirstStep: false, users: [] })).toBeNull();
  });
});

describe('workflow template assignee validation migration', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930044601_workflow_template_assignee_validation.sql'),
    'utf8',
  );

  it('blocks publishing and saving an active template with unassigned steps', () => {
    const publish = sql.slice(sql.indexOf('create or replace function public.publish_workflow_template'));
    const save = sql.slice(sql.indexOf('create or replace function public.save_workflow_template_structure'));
    expect(publish).toContain('app_private.workflow_template_assignee_errors(p_template_id)');
    expect(publish).toContain("'WORKFLOW_STEP_ASSIGNEE_MISSING'");
    expect(save).toContain("'WORKFLOW_STEP_ASSIGNEE_MISSING'");
  });

  it('leaves project material-request and Request-module templates to their own rules', () => {
    expect(sql).toContain('v_template.owner_subject_type is not null');
    expect(sql).toContain('public.project_workflow_bindings');
    expect(sql).toContain('_requestTemplateId');
  });
});

describe('workflow publish ordering migration', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930045056_workflow_publish_validate_after_activate.sql'),
    'utf8',
  );

  it('switches the template on before validating so an inactive template can be re-enabled', () => {
    const update = sql.indexOf('update public.workflow_templates');
    expect(update).toBeGreaterThan(-1);
    expect(update).toBeLessThan(sql.indexOf('project_workflow_validate_template(p_template_id)'));
    expect(update).toBeLessThan(sql.indexOf('workflow_template_assignee_errors(p_template_id)'));
  });
});
