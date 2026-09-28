import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Employee, OrgUnit, ProjectWorkflowSubject, User, WorkflowNode } from '../../../types';
import ProjectWorkflowAssigneeSelect from '../ProjectWorkflowAssigneeSelect';

const QUICK_PICK_TITLE = 'Chọn nhanh theo nhóm cấu hình';

const subject = { id: 'subject-1', projectId: 'project-1', constructionSiteId: null } as unknown as ProjectWorkflowSubject;
const users = [
  { id: 'user-1', name: 'Thiện', isActive: true },
  { id: 'user-2', name: 'Lan', isActive: true },
] as unknown as User[];
const orgUnits = [
  { id: 'dept-leadership', name: 'Ban lãnh đạo', type: 'department', orderIndex: 1 },
  { id: 'dept-material', name: 'Phòng Vật tư - Thiết bị', type: 'department', orderIndex: 2 },
] as OrgUnit[];
const employees = [
  { id: 'emp-1', userId: 'user-1', departmentId: 'dept-leadership', status: 'Đang làm việc', title: 'GĐ' },
  { id: 'emp-2', userId: 'user-2', departmentId: 'dept-material', status: 'Đang làm việc', title: 'NV' },
] as unknown as Employee[];

const render = (node: WorkflowNode) => renderToStaticMarkup(
  <ProjectWorkflowAssigneeSelect
    subject={subject}
    node={node}
    users={users}
    employees={employees}
    orgUnits={orgUnits}
    allowedUserIds={['user-1', 'user-2']}
    value={[]}
    onChange={() => undefined}
  />,
);

describe('ProjectWorkflowAssigneeSelect quick pick groups', () => {
  it('does not infer groups from candidates when the step has no department pool', () => {
    const html = render({ id: 'node-1', config: { assignmentTargets: [] } } as unknown as WorkflowNode);

    expect(html).toContain('Thiện');
    expect(html).not.toContain(QUICK_PICK_TITLE);
    expect(html).not.toContain('Ban lãnh đạo');
  });

  it('shows only the departments configured on the step', () => {
    const html = render({
      id: 'node-1',
      config: { assignmentTargets: [{ type: 'department', orgUnitId: 'dept-material' }] },
    } as unknown as WorkflowNode);

    expect(html).toContain(QUICK_PICK_TITLE);
    expect(html).toContain('Phòng Vật tư - Thiết bị');
    expect(html).not.toContain('Ban lãnh đạo');
  });
});
