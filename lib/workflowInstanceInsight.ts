import {
  WorkflowEdge,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowNode,
  WorkflowNodeType,
} from '../types';
import { getEffectiveStepAssigneeIds } from './workflowAssignmentResolver';
import { normalizeWorkflowFiles } from './workflowFiles';

/** A running ticket that has not moved for this long is flagged "đứng yên". */
export const STALE_AFTER_HOURS = 72;

const HOUR_MS = 3_600_000;

/** START → … → END following the template's edges. */
export const orderWorkflowNodes = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] => {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const nextOf = new Map<string, string>();
  edges.forEach(edge => { if (!nextOf.has(edge.sourceNodeId)) nextOf.set(edge.sourceNodeId, edge.targetNodeId); });
  const ordered: WorkflowNode[] = [];
  const seen = new Set<string>();
  let cursor = nodes.find(node => node.type === WorkflowNodeType.START);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ordered.push(cursor);
    const nextId = nextOf.get(cursor.id);
    cursor = nextId ? byId.get(nextId) : undefined;
  }
  return ordered;
};

/** The steps people actually work on (no START / END), per template. */
export const buildWorkSteps = (nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, WorkflowNode[]> => {
  const nodesByTemplate = new Map<string, WorkflowNode[]>();
  nodes.forEach(node => nodesByTemplate.set(node.templateId, [...(nodesByTemplate.get(node.templateId) || []), node]));
  const edgesByTemplate = new Map<string, WorkflowEdge[]>();
  edges.forEach(edge => edgesByTemplate.set(edge.templateId, [...(edgesByTemplate.get(edge.templateId) || []), edge]));
  const result = new Map<string, WorkflowNode[]>();
  nodesByTemplate.forEach((templateNodes, templateId) => {
    result.set(
      templateId,
      orderWorkflowNodes(templateNodes, edgesByTemplate.get(templateId) || [])
        .filter(node => node.type !== WorkflowNodeType.START && node.type !== WorkflowNodeType.END),
    );
  });
  return result;
};

export interface WorkflowInstanceInsight {
  steps: WorkflowNode[];
  /** Index of the current step; steps.length once completed; -1 when unknown. */
  stepIndex: number;
  currentNode: WorkflowNode | null;
  handlerIds: string[];
  /** Hours since the ticket last moved (last log, else creation). */
  sinceHours: number;
  /** Running past the step's SLA. */
  overdue: boolean;
  /** Running, no SLA breach, but not moved for STALE_AFTER_HOURS. */
  stale: boolean;
}

export const getWorkflowInstanceInsight = (
  instance: WorkflowInstance,
  steps: WorkflowNode[],
  lastActivityAt: number | undefined,
  now: number,
): WorkflowInstanceInsight => {
  const running = instance.status === WorkflowInstanceStatus.RUNNING;
  const foundIndex = steps.findIndex(step => step.id === instance.currentNodeId);
  const stepIndex = instance.status === WorkflowInstanceStatus.COMPLETED
    ? steps.length
    : foundIndex;
  const currentNode = running && foundIndex >= 0 ? steps[foundIndex] : null;
  const since = lastActivityAt ?? Date.parse(instance.updatedAt || instance.createdAt);
  const sinceHours = Math.max(0, (now - since) / HOUR_MS);
  const sla = currentNode?.config?.slaHours;
  const overdue = running && Boolean(sla) && sinceHours > (sla as number);
  return {
    steps,
    stepIndex,
    currentNode,
    handlerIds: currentNode ? getEffectiveStepAssigneeIds(instance, currentNode) : [],
    sinceHours,
    overdue,
    stale: running && !overdue && sinceHours > STALE_AFTER_HOURS,
  };
};

export const formatWaitDuration = (hours: number): string => {
  if (hours < 1) return 'vừa xong';
  if (hours < 24) return `${Math.floor(hours)} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
};

const describeFieldValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (Array.isArray(value)) return normalizeWorkflowFiles(value).length > 0 ? null : value.length ? `${value.length} dòng` : null;
  return null;
};

/** Up to `max` "Nhãn: giá trị" parts for a one-line summary of what the ticket is about. */
export const getWorkflowMetaParts = (
  formData: Record<string, unknown> | undefined,
  customFields: Array<{ name: string; label: string }> | undefined,
  max = 2,
): string[] => {
  const data = formData || {};
  const parts: string[] = [];
  (customFields || []).forEach(field => {
    if (parts.length >= max) return;
    const text = describeFieldValue(data[field.name]);
    if (text) parts.push(`${field.label}: ${text}`);
  });
  if (parts.length === 0) {
    Object.entries(data)
      .filter(([key]) => !key.startsWith('step_') && key !== 'note' && key !== 'attachments')
      .forEach(([key, value]) => {
        if (parts.length >= max) return;
        const text = describeFieldValue(value);
        if (text) parts.push(`${key.replace(/_/g, ' ')}: ${text}`);
      });
  }
  return parts;
};

/** Files attached through file fields and the description's document list. */
export const countWorkflowFiles = (formData: Record<string, unknown> | undefined): number =>
  Object.values(formData || {}).reduce<number>((sum, value) => sum + normalizeWorkflowFiles(value).length, 0);
