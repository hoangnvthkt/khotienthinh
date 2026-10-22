import { describe, expect, it } from 'vitest';
import { WorkflowNodeType, type WorkflowRuntimeEdge, type WorkflowRuntimeNode } from '../../types';
import { getRuntimeWorkflowFlowNodes, getRuntimeWorkflowLaneNodes } from '../projectWorkflowService';
import type { ProjectWorkflowSubject } from '../../types';

const node = (id: string, label: string, type: WorkflowNodeType, positionY: number) =>
  ({ id, label, type, positionX: 0, positionY, workflowInstanceId: 'instance-1', config: {} }) as unknown as WorkflowRuntimeNode;
const edge = (source: string, target: string, sortOrder = 0) =>
  ({ id: `${source}-${target}`, workflowInstanceId: 'instance-1', sourceInstanceNodeId: source, targetInstanceNodeId: target, sortOrder }) as WorkflowRuntimeEdge;

describe('getRuntimeWorkflowFlowNodes', () => {
  it('drops steps unlinked from the flow and keeps flow order', () => {
    // Snapshot shape of MR-2026-9831..9834: "Tạo đề xuất" shares position 100 with BCH but has no edges.
    const nodes = [
      node('start', 'Bắt đầu', WorkflowNodeType.START, 0),
      node('create', 'Tạo đề xuất', WorkflowNodeType.ACTION, 100),
      node('bch', 'BCH CT Duyệt', WorkflowNodeType.APPROVAL, 100),
      node('qlda', 'Phòng QLDA duyệt', WorkflowNodeType.APPROVAL, 200),
      node('end', 'Kết thúc', WorkflowNodeType.END, 9999),
    ];
    const edges = [edge('qlda', 'end'), edge('start', 'bch'), edge('bch', 'qlda')];

    expect(getRuntimeWorkflowFlowNodes({ nodes, edges }).map(item => item.label))
      .toEqual(['Bắt đầu', 'BCH CT Duyệt', 'Phòng QLDA duyệt', 'Kết thúc']);
  });

  it('keeps nodes unchanged while only the current node is known', () => {
    const nodes = [node('qlda', 'Phòng QLDA duyệt', WorkflowNodeType.APPROVAL, 200)];

    expect(getRuntimeWorkflowFlowNodes({ nodes, edges: [] })).toEqual(nodes);
  });
});

describe('getRuntimeWorkflowLaneNodes', () => {
  // DA29 on 22/10: MR-2026-9865 still runs the old shared template, already past "Phòng QLDA duyệt".
  const nodes = [
    node('start', 'Bắt đầu', WorkflowNodeType.START, 0),
    node('bch', 'BCH CT Duyệt', WorkflowNodeType.APPROVAL, 100),
    node('qlda', 'Phòng QLDA duyệt', WorkflowNodeType.APPROVAL, 200),
    node('vt', 'Phòng vật tư duyệt', WorkflowNodeType.APPROVAL, 300),
    node('tkdt', 'Phòng TKĐT duyệt', WorkflowNodeType.APPROVAL, 400),
    node('end', 'Kết thúc', WorkflowNodeType.END, 9999),
  ];
  const edges = [edge('start', 'bch'), edge('bch', 'qlda'), edge('qlda', 'vt'), edge('vt', 'tkdt'), edge('tkdt', 'end')];
  const subject = (status: string, currentInstanceNodeId: string | null) =>
    ({ id: 'subject-1', status, currentInstanceNodeId }) as unknown as ProjectWorkflowSubject;

  it('keeps only the current step and the step it can move to', () => {
    expect(getRuntimeWorkflowLaneNodes({ subject: subject('RUNNING', 'vt'), nodes, edges }).map(item => item.label))
      .toEqual(['Phòng vật tư duyệt', 'Phòng TKĐT duyệt']);
  });

  it('adds no lanes for finished or returned requests', () => {
    expect(getRuntimeWorkflowLaneNodes({ subject: subject('COMPLETED', 'end'), nodes, edges })).toEqual([]);
    expect(getRuntimeWorkflowLaneNodes({ subject: subject('RETURNED', 'bch'), nodes, edges })).toEqual([]);
  });

  it('keeps the current node while only it is known', () => {
    const current = [nodes[3]];
    expect(getRuntimeWorkflowLaneNodes({ subject: subject('RUNNING', 'vt'), nodes: current, edges: [] })).toEqual(current);
  });
});
