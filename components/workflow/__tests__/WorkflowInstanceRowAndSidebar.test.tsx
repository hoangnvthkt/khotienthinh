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
import { getWorkflowInstanceInsight } from '../../../lib/workflowInstanceInsight';
import WorkflowInstanceRow from '../WorkflowInstanceRow';
import WorkflowSidebar from '../WorkflowSidebar';

const step = (id: string, label: string, config: Record<string, unknown> = {}) =>
  ({ id, templateId: 't1', type: 'APPROVAL', label, config }) as unknown as WorkflowNode;
const steps = [step('a', 'BCH CT duyệt'), step('b', 'Phòng QLDA duyệt', { slaHours: 24 }), step('c', 'Phòng vật tư duyệt')];
const users = [{ id: 'u-1', name: 'Bùi Thuỳ Linh' }, { id: 'u-2', name: 'Nguyễn Thành Đô' }] as User[];
const NOW = Date.parse('2026-10-05T00:00:00.000Z');

const instance = (patch: Partial<WorkflowInstance> = {}) => ({
  id: 'i1',
  code: 'WF-2026-117',
  title: 'Cấp máy móc, thiết bị về dự án',
  templateId: 't1',
  status: WorkflowInstanceStatus.RUNNING,
  currentNodeId: 'b',
  createdBy: 'u-1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  stepAssignees: { b: ['u-1', 'u-2'] },
  formData: {},
  ...patch,
}) as unknown as WorkflowInstance;

const renderRow = (item: WorkflowInstance, waitingForMe: boolean, lastActivityAt = NOW - 3_600_000) => renderToStaticMarkup(
  <WorkflowInstanceRow
    instance={item}
    templateName="Xin Hai công trường"
    insight={getWorkflowInstanceInsight(item, steps, lastActivityAt, NOW)}
    users={users}
    creatorName="Bùi Thuỳ Linh"
    metaLine="Công trường: CT Sơn Miền Bắc"
    fileCount={2}
    waitingForMe={waitingForMe}
    onOpen={() => undefined}
    onAction={() => undefined}
    onOpenCanonical={() => undefined}
  />,
);

describe('WorkflowInstanceRow', () => {
  it('answers: which step, who holds it, what to do', () => {
    const html = renderRow(instance(), true);

    expect(html).toContain('WF-2026-117');
    expect(html).toContain('Bước 2/3');
    expect(html).toContain('Phòng QLDA duyệt');
    expect(html).toContain('Bùi Thuỳ Linh');
    expect(html).toContain('+1');
    expect(html).toContain('Chờ bạn duyệt');
    expect(html).toContain('Duyệt');
    expect(html).toContain('Từ chối');
    expect(html).toContain('Công trường: CT Sơn Miền Bắc');
  });

  it('shows only "Xem" when the ticket is not waiting on the user', () => {
    const html = renderRow(instance(), false);

    expect(html).not.toContain('Chờ bạn duyệt');
    expect(html).not.toContain('Từ chối');
    expect(html).toContain('Xem');
  });

  it('flags overdue and stale tickets with the slow pulse and warns when nobody holds the step', () => {
    expect(renderRow(instance(), false, NOW - 30 * 3_600_000)).toContain('Quá hạn');
    expect(renderRow(instance({ currentNodeId: 'c', stepAssignees: {} }), false, NOW - 100 * 3_600_000)).toContain('Đứng yên 4 ngày');
    expect(renderRow(instance({ currentNodeId: 'c', stepAssignees: {} }), false)).toContain('Chưa giao người xử lý');
    expect(renderRow(instance(), true, NOW - 30 * 3_600_000)).toContain('wf-pulse');
  });

  it('offers "Tiếp tục soạn" for drafts instead of approval buttons', () => {
    const html = renderRow(instance({ status: WorkflowInstanceStatus.DRAFT, currentNodeId: null }), false);

    expect(html).toContain('Tiếp tục soạn');
    expect(html).not.toContain('Từ chối');
  });
});

describe('WorkflowSidebar', () => {
  const categories: WorkflowTemplateCategory[] = [{ id: 'cat-1', name: 'Phòng Vật tư', sortOrder: 1 }];
  const templates = [
    { id: 't1', name: 'Xin Hai công trường', categoryId: null },
    { id: 't2', name: 'CT Rico Tiền Hải', categoryId: 'cat-1' },
  ] as unknown as WorkflowTemplate[];
  const html = renderToStaticMarkup(
    <WorkflowSidebar
      activeNav="pending"
      counts={{ pending: 9, mine: 0, watching: 8 }}
      onNav={() => undefined}
      onCreate={() => undefined}
      templates={templates}
      categories={categories}
      userId="u-1"
      selectedTemplateId="t1"
      onSelectTemplate={() => undefined}
      getTemplateCount={id => (id === 't1' ? 10 : 0)}
    />,
  );

  it('lists the three views with counts and groups the templates', () => {
    expect(html).toContain('Chờ tôi duyệt');
    expect(html).toContain('Phiếu của tôi');
    expect(html).toContain('Theo dõi');
    expect(html).toContain('Phòng Vật tư');
    expect(html).toContain('Chưa phân nhóm');
    expect(html).toContain('Xin Hai công trường');
    expect(html).toContain('CT Rico Tiền Hải');
  });

  it('makes the waiting count breathe and uses the tinted sidebar colours', () => {
    expect(html).toContain('wf-pulse');
    expect(html).toContain('bg-[var(--wf-side-bg)]');
    expect(html).toContain('text-[var(--wf-side-text)]');
  });

  it('marks the active view and the selected template', () => {
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-pressed="true"');
  });
});
