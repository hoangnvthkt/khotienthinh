import { describe, expect, it } from 'vitest';
import { WorkflowNode, WorkflowNodeType } from '../../types';
import {
  appendStep,
  buildAssignmentTargets,
  buildLinearTemplateStructure,
  createStep,
  moveStep,
  moveStepTo,
  orderSteps,
  removeStep,
  updateStepConfig,
} from '../workflowStepDraft';

const node = (id: string, positionY: number, type = WorkflowNodeType.APPROVAL): WorkflowNode => ({
  id, templateId: 't', type, label: id, config: {}, positionX: 0, positionY,
});

const fiveSteps = (): WorkflowNode[] => [
  node('start', 0, WorkflowNodeType.START),
  node('s3', 300),
  node('s1', 100),
  node('s5', 500),
  node('s2', 200),
  node('s4', 400),
  node('end', 9999, WorkflowNodeType.END),
];

const ids = (nodes: WorkflowNode[]) => orderSteps(nodes).map(step => step.id);

const sequence = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

describe('workflow step draft', () => {
  it('orders steps by positionY and hides START/END', () => {
    expect(ids(fiveSteps())).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('appends a step at the end with the next dense position', () => {
    const step = createStep({ id: 's6', templateId: 't', existingSteps: 5 });
    expect(step.label).toBe('Giai đoạn 6');
    const next = appendStep(fiveSteps(), step);
    expect(ids(next)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(next.find(n => n.id === 's6')?.positionY).toBe(600);
  });

  it('closes the gap after removing a middle step', () => {
    const next = removeStep(fiveSteps(), 's3');
    expect(ids(next)).toEqual(['s1', 's2', 's4', 's5']);
    expect(orderSteps(next).map(step => step.positionY)).toEqual([100, 200, 300, 400]);
  });

  it('moves steps up/down and ignores moves past either edge', () => {
    expect(ids(moveStep(fiveSteps(), 's3', 'up'))).toEqual(['s1', 's3', 's2', 's4', 's5']);
    expect(ids(moveStep(fiveSteps(), 's3', 'down'))).toEqual(['s1', 's2', 's4', 's3', 's5']);
    const original = fiveSteps();
    expect(moveStep(original, 's1', 'up')).toBe(original);
    expect(moveStep(original, 's5', 'down')).toBe(original);
  });

  it('drags a step to an arbitrary index', () => {
    const next = moveStepTo(fiveSteps(), 's5', 0);
    expect(ids(next)).toEqual(['s5', 's1', 's2', 's3', 's4']);
    expect(next.find(n => n.id === 'start')?.positionY).toBe(0);
    expect(next.find(n => n.id === 'end')?.positionY).toBe(9999);
  });

  it('clears a config key when given an empty string', () => {
    const withSla = updateStepConfig(fiveSteps(), 's1', 'slaHours', 24);
    expect(withSla.find(n => n.id === 's1')?.config.slaHours).toBe(24);
    const cleared = updateStepConfig(withSla, 's1', 'slaHours', '');
    expect(cleared.find(n => n.id === 's1')?.config.slaHours).toBeUndefined();
  });

  it('builds user then department targets', () => {
    expect(buildAssignmentTargets(['u1'], ['d1'])).toEqual([
      { type: 'user', userId: 'u1' },
      { type: 'department', orgUnitId: 'd1' },
    ]);
  });

  it('chains START → steps → END linearly with fresh edge ids', () => {
    const reordered = moveStepTo(removeStep(fiveSteps(), 's2'), 's5', 1);
    const { nodes, edges } = buildLinearTemplateStructure('t', reordered, sequence('e'));
    expect(nodes).toHaveLength(6);
    expect(edges.map(edge => [edge.sourceNodeId, edge.targetNodeId])).toEqual([
      ['start', 's1'], ['s1', 's5'], ['s5', 's3'], ['s3', 's4'], ['s4', 'end'],
    ]);
    expect(edges.map(edge => edge.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('creates missing START and END nodes', () => {
    const { nodes, edges } = buildLinearTemplateStructure('t', [node('only', 100)], sequence('x'));
    const start = nodes.find(n => n.type === WorkflowNodeType.START);
    const end = nodes.find(n => n.type === WorkflowNodeType.END);
    expect(start?.positionY).toBe(0);
    expect(end?.positionY).toBe(9999);
    expect(edges.map(edge => [edge.sourceNodeId, edge.targetNodeId])).toEqual([
      [start?.id, 'only'], ['only', end?.id],
    ]);
  });
});
