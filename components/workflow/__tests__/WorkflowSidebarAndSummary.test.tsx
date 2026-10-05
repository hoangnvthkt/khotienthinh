import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  WorkflowInstanceStatus,
  type User,
  type WorkflowInstance,
  type WorkflowNode,
  type WorkflowTemplate,
  type WorkflowTemplateCategory,
} from '../../../types';
import WorkflowInstanceSummaryPanel from '../WorkflowInstanceSummaryPanel';
import WorkflowTemplateGroupList from '../WorkflowTemplateGroupList';

const template = (id: string, name: string, categoryId: string | null) => ({ id, name, categoryId, customFields: [] }) as unknown as WorkflowTemplate;
const categories: WorkflowTemplateCategory[] = [
  { id: 'cat-site', name: 'Công trường', sortOrder: 1 },
  { id: 'cat-hr', name: 'Nhân sự', sortOrder: 2 },
];

describe('WorkflowTemplateGroupList', () => {
  it('renders every group with its templates, in category order', () => {
    const html = renderToStaticMarkup(
      <WorkflowTemplateGroupList
        templates={[template('t1', 'Xin Hai công trường', 'cat-site'), template('t2', 'Gia hạn HĐLĐ', 'cat-hr'), template('t3', 'Mẫu lẻ', null)]}
        categories={categories}
        userId="user-1"
        renderTemplate={item => <span>{item.name}</span>}
      />,
    );

    expect(html.indexOf('Công trường')).toBeLessThan(html.indexOf('Nhân sự'));
    expect(html.indexOf('Nhân sự')).toBeLessThan(html.indexOf('Chưa phân nhóm'));
    expect(html).toContain('Xin Hai công trường');
    expect(html).toContain('Gia hạn HĐLĐ');
    expect(html).toContain('Mẫu lẻ');
  });
});

describe('WorkflowInstanceSummaryPanel', () => {
  const instance = {
    id: 'wf-1',
    code: 'WF-2026-195',
    title: 'LXH cầu thang bộ X3',
    status: WorkflowInstanceStatus.RUNNING,
    createdBy: 'user-1',
    createdAt: '2026-10-04T01:00:00.000Z',
    currentNodeId: 'node-1',
    formData: { cong_truong: 'CT Sơn Miền Bắc', bang_ke: [{}], tai_lieu: { fileName: 'ban-ve.pdf' }, step_x: 'ẩn' },
  } as unknown as WorkflowInstance;
  const tpl = {
    ...template('t1', 'Xuất kho nhà máy', null),
    customFields: [{ id: 'f1', name: 'cong_truong', label: 'Công trường', type: 'text', required: false }],
  } as unknown as WorkflowTemplate;
  const users = [{ id: 'user-1', name: 'Nguyễn Văn Quân' }] as User[];
  const node = { id: 'node-1', label: 'Xuất kho nhà máy', config: {} } as unknown as WorkflowNode;

  it('shows the key facts and ends with a "Xem chi tiết" action', () => {
    const html = renderToStaticMarkup(
      <WorkflowInstanceSummaryPanel instance={instance} template={tpl} currentNode={node} users={users} logs={[]} onClose={() => undefined} onOpenDetail={() => undefined} />,
    );

    expect(html).toContain('WF-2026-195');
    expect(html).toContain('Xuất kho nhà máy');
    expect(html).toContain('CT Sơn Miền Bắc');
    expect(html).toContain('1 dòng');
    expect(html).toContain('ban-ve.pdf');
    expect(html).not.toContain('ẩn');
    expect(html).toContain('chưa được giao');
    expect(html.lastIndexOf('Xem chi tiết')).toBeGreaterThan(html.indexOf('Nội dung phiếu'));
  });
});
