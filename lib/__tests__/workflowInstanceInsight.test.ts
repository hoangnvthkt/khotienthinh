import { describe, expect, it } from 'vitest';
import {
  WorkflowInstanceStatus,
  WorkflowNodeType,
  type WorkflowEdge,
  type WorkflowInstance,
  type WorkflowNode,
} from '../../types';
import {
  buildWorkSteps,
  countWorkflowFiles,
  getWorkflowMetaParts,
  formatWaitDuration,
  getWorkflowInstanceInsight,
  STALE_AFTER_HOURS,
} from '../workflowInstanceInsight';

const node = (id: string, type: WorkflowNodeType, label: string, config: Record<string, unknown> = {}) =>
  ({ id, templateId: 't1', type, label, config, positionX: 0, positionY: 0 }) as unknown as WorkflowNode;
const edge = (id: string, source: string, target: string) =>
  ({ id, templateId: 't1', sourceNodeId: source, targetNodeId: target }) as WorkflowEdge;

const nodes = [
  node('end', WorkflowNodeType.END, 'Kết thúc'),
  node('b', WorkflowNodeType.APPROVAL, 'Phòng QLDA duyệt', { slaHours: 24 }),
  node('start', WorkflowNodeType.START, 'Bắt đầu'),
  node('a', WorkflowNodeType.APPROVAL, 'BCH CT duyệt', { assigneeUserId: 'u-default' }),
  node('orphan', WorkflowNodeType.ACTION, 'Bước mồ côi'),
];
const edges = [edge('e1', 'start', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'end')];
const steps = buildWorkSteps(nodes, edges).get('t1')!;

const instance = (patch: Partial<WorkflowInstance> = {}) => ({
  id: 'i1',
  templateId: 't1',
  status: WorkflowInstanceStatus.RUNNING,
  currentNodeId: 'a',
  stepAssignees: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
}) as unknown as WorkflowInstance;

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-05T00:00:00.000Z');

describe('buildWorkSteps', () => {
  it('orders steps along the edges and drops START, END and steps off the path', () => {
    expect(steps.map(step => step.label)).toEqual(['BCH CT duyệt', 'Phòng QLDA duyệt']);
  });
});

describe('getWorkflowInstanceInsight', () => {
  it('finds the current step and its handlers, falling back to the step default', () => {
    expect(getWorkflowInstanceInsight(instance(), steps, NOW - HOUR, NOW)).toMatchObject({ stepIndex: 0, handlerIds: ['u-default'], overdue: false, stale: false });
    expect(getWorkflowInstanceInsight(instance({ stepAssignees: { a: ['u-1', 'u-2'] } }), steps, NOW - HOUR, NOW).handlerIds).toEqual(['u-1', 'u-2']);
  });

  it('flags overdue against the step SLA, and stale only when there is no SLA breach', () => {
    const atB = instance({ currentNodeId: 'b' });
    expect(getWorkflowInstanceInsight(atB, steps, NOW - 30 * HOUR, NOW)).toMatchObject({ overdue: true, stale: false });
    expect(getWorkflowInstanceInsight(atB, steps, NOW - 5 * HOUR, NOW)).toMatchObject({ overdue: false, stale: false });
    expect(getWorkflowInstanceInsight(instance(), steps, NOW - (STALE_AFTER_HOURS + 1) * HOUR, NOW)).toMatchObject({ overdue: false, stale: true });
  });

  it('never flags finished tickets and reports completion past the last step', () => {
    const done = getWorkflowInstanceInsight(instance({ status: WorkflowInstanceStatus.COMPLETED, currentNodeId: null }), steps, NOW - 500 * HOUR, NOW);
    expect(done).toMatchObject({ stepIndex: 2, currentNode: null, overdue: false, stale: false });
  });

  it('falls back to the update time when there is no activity log', () => {
    const insight = getWorkflowInstanceInsight(instance({ updatedAt: '2026-10-04T00:00:00.000Z' }), steps, undefined, NOW);
    expect(Math.round(insight.sinceHours)).toBe(24);
  });
});

describe('formatWaitDuration', () => {
  it('uses hours under a day and days after', () => {
    expect(formatWaitDuration(0.2)).toBe('vừa xong');
    expect(formatWaitDuration(5.9)).toBe('5 giờ');
    expect(formatWaitDuration(49)).toBe('2 ngày');
  });
});

describe('getWorkflowMetaParts / countWorkflowFiles', () => {
  const fields = [{ name: 'cong_truong', label: 'Công trường' }, { name: 'ngay', label: 'Ngày cần' }, { name: 'ghi_chu', label: 'Ghi chú' }];

  it('summarises declared fields in order and skips empty values', () => {
    expect(getWorkflowMetaParts({ ngay: '2026-10-10', cong_truong: 'CT Sơn Miền Bắc', ghi_chu: '  ' }, fields)).toEqual(['Công trường: CT Sơn Miền Bắc', 'Ngày cần: 2026-10-10']);
    expect(getWorkflowMetaParts({ cong_truong: 'A', ngay: 'B', ghi_chu: 'C' }, fields, 1)).toEqual(['Công trường: A']);
    // A file-only field adds nothing; the summary then falls back to the other values.
    expect(getWorkflowMetaParts({ bang_ke: [['x']], tep: { fileName: 'a.pdf' } }, [{ name: 'tep', label: 'Tệp' }])).toEqual(['bang ke: 1 dòng']);
  });

  it('falls back to raw keys for templates without declared fields', () => {
    expect(getWorkflowMetaParts({ muc_dich: 'Sản xuất', step_x: 'ẩn', note: 'bỏ' }, [])).toEqual(['muc dich: Sản xuất']);
  });

  it('counts single files, file arrays and the description documents', () => {
    expect(countWorkflowFiles({ a: { fileName: 'a.pdf' }, b: [{ fileName: 'b.png' }, { fileName: 'c.png' }], attachments: [{ fileName: 'd.pdf' }], t: [['1']] })).toBe(4);
    expect(countWorkflowFiles(undefined)).toBe(0);
  });
});
