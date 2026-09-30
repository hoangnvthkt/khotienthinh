import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Role, type OrgUnit, type ProjectWorkflowNodeConfig, type User } from '../../types';

vi.mock('../../context/WorkflowContext', () => ({ useWorkflow: () => ({}) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({}) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({}) }));
vi.mock('../../lib/projectWorkflowService', () => ({ projectWorkflowService: {} }));

const { StepAssigneeEditor } = await import('../../pages/wf/WorkflowBuilder');

const users = [
  { id: 'an', name: 'Nguyễn An', role: Role.EMPLOYEE, isActive: true },
  { id: 'binh', name: 'Trần Bình', role: Role.WAREHOUSE_KEEPER, isActive: true },
] as User[];
const orgUnits = [{ id: 'hr', name: 'Phòng HCNS', type: 'department' }] as OrgUnit[];

const render = (config: ProjectWorkflowNodeConfig, extra: Partial<React.ComponentProps<typeof StepAssigneeEditor>> = {}) =>
  renderToStaticMarkup(
    <StepAssigneeEditor
      config={config}
      isFirstStep={false}
      issue={null}
      users={users}
      orgUnits={orgUnits}
      showProjectPermissionField={false}
      disabled={false}
      onPatch={() => undefined}
      {...extra}
    />,
  );

describe('StepAssigneeEditor', () => {
  it('asks one question with four ways to pick the handler', () => {
    const html = render({});
    expect(html).toContain('Ai xử lý giai đoạn này?');
    for (const title of ['Chọn từ danh sách', 'Một người cố định', 'Người tạo nhiệm vụ', 'Người xử lý giai đoạn trước']) {
      expect(html).toContain(title);
    }
    // Old overlapping fields are gone.
    expect(html).not.toContain('Rule duyệt');
    expect(html).not.toContain('Phân công theo vai trò');
    expect(html).not.toContain('Quyền được chọn');
  });

  it('shows only the fields of the chosen way', () => {
    const fixed = render({ assignmentMode: 'fixed_user', assigneeUserId: 'an' });
    expect(fixed).toContain('-- Chọn một người --');
    expect(fixed).not.toContain('Hoặc cả phòng ban');

    const pool = render({ assignmentTargets: [{ type: 'user', userId: 'an' }] });
    expect(pool).toContain('Hoặc cả phòng ban');
    expect(pool).toContain('Cho phép giao cho nhiều người cùng lúc');
    expect(pool).not.toContain('-- Chọn một người --');

    const creator = render({ assignmentMode: 'creator' });
    expect(creator).not.toContain('Hoặc cả phòng ban');
    expect(creator).not.toContain('-- Chọn một người --');
  });

  it('disables "previous handler" on the first step and surfaces legacy roles and issues', () => {
    const first = render({}, { isFirstStep: true, issue: 'Chưa có người xử lý.' });
    expect(first).toContain('Không dùng được ở giai đoạn đầu tiên');
    expect(first).toContain('Chưa có người xử lý.');

    const legacy = render({ assigneeRole: Role.WAREHOUSE_KEEPER });
    expect(legacy).toContain('giao theo vai trò');
    expect(legacy).toContain('Thủ kho');
    expect(legacy).toContain('Bỏ vai trò');
  });

  it('keeps the project permission field only where it applies', () => {
    expect(render({}, { showProjectPermissionField: true })).toContain('giới hạn theo quyền trong dự án');
  });

  it('offers "tất cả phải duyệt" once several people can be assigned', () => {
    expect(render({ assignmentTargets: [{ type: 'user', userId: 'an' }] })).not.toContain('Tất cả phải duyệt');
    const multiple = render({ assignmentTargets: [{ type: 'user', userId: 'an' }], assigneeSelectionMode: 'multiple' });
    expect(multiple).toContain('Chỉ cần một người duyệt');
    expect(multiple).toContain('Tất cả phải duyệt');
    expect(render({ assigneeSelectionMode: 'multiple', assignmentTargets: [{ type: 'user', userId: 'an' }] }, { isActionStep: true }))
      .toContain('Tất cả phải hoàn thành');
    expect(render({ assigneeSelectionMode: 'multiple', assignmentTargets: [{ type: 'user', userId: 'an' }] }, { allowAllApprovalPolicy: false }))
      .toContain('Chưa hỗ trợ cho quy trình phiếu vật tư dự án');
  });
});
