import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, WorkflowNodeType, type User, type WorkflowTemplate } from '../../types';
import WorkflowTemplates from '../../pages/wf/WorkflowTemplates';

let currentUser: User;
let templates: WorkflowTemplate[];

const template = (id: string, name: string, categoryId: string | null, isActive = true): WorkflowTemplate => ({
  id, name, description: '', createdBy: 'admin', isActive, customFields: [], managers: [], defaultWatchers: [],
  categoryId, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ user: currentUser, users: [currentUser] }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../context/WorkflowContext', () => ({
  useWorkflow: () => ({
    templates,
    categories: [
      { id: 'cat-hr', name: 'Phòng Hành chính nhân sự', sortOrder: 10 },
      { id: 'cat-mat', name: 'Phòng Vật tư', sortOrder: 20 },
    ],
    instances: [],
    getTemplateNodes: (templateId: string) => templateId === 'tpl-recruit'
      ? [
        { id: 's', templateId, type: WorkflowNodeType.START, label: 'Bắt đầu', config: {}, positionX: 0, positionY: 0 },
        { id: 'a', templateId, type: WorkflowNodeType.APPROVAL, label: 'Duyệt', config: {}, positionX: 0, positionY: 100 },
        { id: 'e', templateId, type: WorkflowNodeType.END, label: 'Kết thúc', config: {}, positionX: 0, positionY: 9999 },
      ]
      : [],
    loadTemplateStructures: vi.fn(async () => undefined),
    createTemplate: vi.fn(), updateTemplate: vi.fn(), deleteTemplate: vi.fn(), cloneTemplate: vi.fn(),
    setTemplateCategory: vi.fn(), moveTemplatesToCategory: vi.fn(), saveCategory: vi.fn(), deleteCategory: vi.fn(), reorderCategories: vi.fn(),
  }),
}));

const render = () => renderToStaticMarkup(
  <StaticRouter location="/wf/templates"><WorkflowTemplates /></StaticRouter>,
);

describe('workflow template catalog', () => {
  beforeEach(() => {
    currentUser = { id: 'admin', name: 'Admin', email: 'admin@example.com', role: Role.ADMIN } as User;
    templates = [
      template('tpl-recruit', 'Quy trình tuyển dụng', 'cat-hr'),
      template('tpl-bhxh', 'Quy trình tham gia BHXH', 'cat-hr', false),
      template('tpl-loose', 'Quy trình Quản lý Bếp ăn', null),
    ];
  });

  it('groups templates under their catalog group and keeps ungrouped ones visible', () => {
    const html = render();
    const sections = html.split('<section').slice(1);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('Phòng Hành chính nhân sự');
    expect(sections[0]).toContain('Quy trình tuyển dụng');
    expect(sections[0]).toContain('Quy trình tham gia BHXH');
    expect(sections[1]).toContain('Phòng Vật tư');
    expect(sections[2]).toContain('Chưa phân nhóm');
    expect(sections[2]).toContain('Quy trình Quản lý Bếp ăn');
    // Empty group still shows a hint so admins know where to add.
    expect(html).toContain('Nhóm chưa có quy trình');
    // Step count excludes the automatic Start/End nodes.
    expect(html).toContain('</svg> 1 bước');
  });

  it('hides the ungrouped section when every template has a group', () => {
    templates = [template('tpl-recruit', 'Quy trình tuyển dụng', 'cat-hr')];
    const html = render();
    expect(html).not.toContain('Chưa phân nhóm');
    expect(html.split('<section')).toHaveLength(3);
  });

  it('offers clone and group management only to template admins', () => {
    const adminHtml = render();
    expect(adminHtml).toContain('Nhân bản quy trình');
    expect(adminHtml).toContain('Quản lý nhóm');
    expect(adminHtml).toContain('Chuyển nhóm');
    expect(adminHtml).toContain('Chọn nhiều');

    currentUser = {
      id: 'viewer', name: 'Viewer', email: 'viewer@example.com', role: Role.EMPLOYEE,
      permissionGrants: [{ userId: 'viewer', permissionCode: 'workflow.template.view', scopeType: 'global', scopeId: '*', isActive: true }],
    } as User;
    const viewerHtml = render();
    expect(viewerHtml).toContain('Quy trình tuyển dụng');
    expect(viewerHtml).not.toContain('Nhân bản quy trình');
    expect(viewerHtml).not.toContain('Quản lý nhóm');
    expect(viewerHtml).not.toContain('Chuyển nhóm');
    expect(viewerHtml).not.toContain('Chọn nhiều');
  });
});

describe('clone_workflow_template migration', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260930042944_workflow_template_catalog_clone.sql'),
    'utf8',
  );
  const clone = sql.slice(sql.indexOf('create or replace function public.clone_workflow_template'));

  it('copies settings and steps but starts the copy switched off', () => {
    expect(clone).toContain("v_source.name || ' (copy)'");
    expect(clone).toMatch(/v_actor,\s*false,/);
    for (const column of ['custom_fields', 'managers', 'default_watchers']) {
      expect(clone).toContain(`coalesce(v_source.${column}`);
    }
    expect(clone).toContain("insert into public.workflow_nodes");
    expect(clone).toContain("insert into public.workflow_edges");
    expect(clone).toContain("'__templateRemoved')::boolean, false) = false");
  });

  it('requires template-create permission and read access to the source', () => {
    expect(clone).toContain("workflow_has_action('workflow.template.create'");
    expect(clone).toContain('workflow_template_actor_can_view(p_source_template_id, v_actor)');
    expect(sql).toMatch(/revoke all on function public\.clone_workflow_template\(uuid, text, uuid, uuid\) from public, anon/);
  });
});
