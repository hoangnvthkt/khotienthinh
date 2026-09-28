import {
  ProjectWorkflowNodeConfig,
  WorkflowAssignmentTarget,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from '../types';

/**
 * Pure step-list operations shared by the Quy trình builder and the project
 * material-request editor. Order is carried by `positionY`; START/END are
 * managed here and never shown as editable steps.
 */

const POSITION_STEP = 100;
const START_POSITION_Y = 0;
const END_POSITION_Y = 9999;

const isTerminal = (node: WorkflowNode) =>
  node.type === WorkflowNodeType.START || node.type === WorkflowNodeType.END;

export const orderSteps = (nodes: WorkflowNode[]): WorkflowNode[] =>
  nodes.filter(node => !isTerminal(node)).sort((a, b) => a.positionY - b.positionY);

/** Rewrites `positionY` so step order is dense and stable: 100, 200, 300… */
const withOrder = (nodes: WorkflowNode[], ordered: WorkflowNode[]): WorkflowNode[] => {
  const positionById = new Map(ordered.map((step, index) => [step.id, (index + 1) * POSITION_STEP]));
  return nodes.map(node => {
    const positionY = positionById.get(node.id);
    return positionY === undefined || positionY === node.positionY ? node : { ...node, positionY };
  });
};

export const createStep = (input: {
  id: string;
  templateId: string;
  existingSteps: number;
  label?: string;
  config?: ProjectWorkflowNodeConfig;
}): WorkflowNode => ({
  id: input.id,
  templateId: input.templateId,
  type: WorkflowNodeType.APPROVAL,
  label: input.label || `Giai đoạn ${input.existingSteps + 1}`,
  config: input.config || {},
  positionX: 0,
  positionY: (input.existingSteps + 1) * POSITION_STEP,
});

export const appendStep = (nodes: WorkflowNode[], step: WorkflowNode): WorkflowNode[] =>
  withOrder([...nodes, step], [...orderSteps(nodes), step]);

export const removeStep = (nodes: WorkflowNode[], stepId: string): WorkflowNode[] => {
  const remaining = nodes.filter(node => node.id !== stepId);
  return withOrder(remaining, orderSteps(remaining));
};

export const moveStepTo = (nodes: WorkflowNode[], stepId: string, toIndex: number): WorkflowNode[] => {
  const ordered = orderSteps(nodes);
  const fromIndex = ordered.findIndex(step => step.id === stepId);
  if (fromIndex === -1) return nodes;
  const target = Math.max(0, Math.min(ordered.length - 1, toIndex));
  if (target === fromIndex) return nodes;
  const reordered = [...ordered];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(target, 0, moved);
  return withOrder(nodes, reordered);
};

export const moveStep = (nodes: WorkflowNode[], stepId: string, direction: 'up' | 'down'): WorkflowNode[] => {
  const index = orderSteps(nodes).findIndex(step => step.id === stepId);
  if (index === -1) return nodes;
  return moveStepTo(nodes, stepId, direction === 'up' ? index - 1 : index + 1);
};

export const updateStep = (
  nodes: WorkflowNode[],
  stepId: string,
  patch: Partial<Pick<WorkflowNode, 'label' | 'type'>>,
): WorkflowNode[] => nodes.map(node => (node.id === stepId ? { ...node, ...patch } : node));

/** Empty strings clear the key so the server falls back to its defaults. */
export const updateStepConfig = <K extends keyof ProjectWorkflowNodeConfig>(
  nodes: WorkflowNode[],
  stepId: string,
  key: K,
  value: ProjectWorkflowNodeConfig[K] | '',
): WorkflowNode[] => nodes.map(node => {
  if (node.id !== stepId) return node;
  return { ...node, config: { ...node.config, [key]: value === '' ? undefined : value } };
});

export const buildAssignmentTargets = (userIds: string[], departmentIds: string[]): WorkflowAssignmentTarget[] => [
  ...userIds.map(userId => ({ type: 'user' as const, userId })),
  ...departmentIds.map(orgUnitId => ({ type: 'department' as const, orgUnitId })),
];

/**
 * Adds START/END if missing and chains them linearly through the ordered
 * steps. Edge ids are fresh because `save_workflow_template_structure`
 * deletes and re-inserts every edge.
 */
export const buildLinearTemplateStructure = (
  templateId: string,
  nodes: WorkflowNode[],
  generateId: () => string,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => {
  const nextNodes = [...nodes];
  let start = nextNodes.find(node => node.type === WorkflowNodeType.START);
  if (!start) {
    start = { id: generateId(), templateId, type: WorkflowNodeType.START, label: 'Bắt đầu', config: {}, positionX: 0, positionY: START_POSITION_Y };
    nextNodes.push(start);
  }
  let end = nextNodes.find(node => node.type === WorkflowNodeType.END);
  if (!end) {
    end = { id: generateId(), templateId, type: WorkflowNodeType.END, label: 'Kết thúc', config: {}, positionX: 0, positionY: END_POSITION_Y };
    nextNodes.push(end);
  }
  const chain = [start, ...orderSteps(nextNodes), end];
  const edges: WorkflowEdge[] = chain.slice(0, -1).map((node, index) => ({
    id: generateId(),
    templateId,
    sourceNodeId: node.id,
    targetNodeId: chain[index + 1].id,
    label: '',
  }));
  return { nodes: nextNodes, edges };
};
