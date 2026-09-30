import { WorkflowInstance, WorkflowNode, WorkflowNodeType } from '../types';
import { getEffectiveStepAssigneeIds } from './workflowAssignmentResolver';

// "Duyệt" steps ask for a decision; "Hành động" steps ask someone to do a task
// and report it done. Both advance with the same APPROVED transition, only the
// wording differs, and an action step cannot reject the whole ticket.
export const isWorkflowActionStep = (node?: Pick<WorkflowNode, 'type'> | null) =>
  node?.type === WorkflowNodeType.ACTION;

export const canRejectAtWorkflowStep = (node?: Pick<WorkflowNode, 'type' | 'config'> | null) =>
  Boolean(node) && !isWorkflowActionStep(node) && node?.config?.allowReject !== false;

export const getWorkflowStepActionCopy = (node?: Pick<WorkflowNode, 'type' | 'config'> | null) => {
  const isAction = isWorkflowActionStep(node);
  return {
    isAction,
    canReject: canRejectAtWorkflowStep(node),
    primaryLabel: isAction ? 'Hoàn thành' : 'Chuyển tiếp / Duyệt',
    dialogTitle: isAction ? 'Hoàn thành & chuyển bước' : 'Phê duyệt & chuyển bước',
    dragConfirm: isAction
      ? 'Bạn sẽ đánh dấu HOÀN THÀNH bước này và chuyển phiếu sang bước tiếp theo.'
      : 'Bạn sẽ DUYỆT phiếu này và chuyển sang bước tiếp theo.',
    dragButton: isAction ? '✓ Hoàn thành' : '✓ Duyệt',
    doneBy: isAction ? 'Hoàn thành bởi' : 'Duyệt bởi',
  };
};

export interface WorkflowStepApprovalState {
  /** Stage uses "tất cả phải duyệt" and has more than one assignee. */
  requiresAll: boolean;
  required: string[];
  approved: string[];
  pending: string[];
}

/** Progress of the current "tất cả phải duyệt" round; mirrors process_workflow_instance_fast. */
export const getWorkflowStepApprovalState = (
  instance: Pick<WorkflowInstance, 'stepAssignees' | 'stepApprovals'> | null | undefined,
  node: Pick<WorkflowNode, 'id' | 'config'> | null | undefined,
): WorkflowStepApprovalState => {
  if (!instance || !node) return { requiresAll: false, required: [], approved: [], pending: [] };
  const required = getEffectiveStepAssigneeIds(instance as WorkflowInstance, node);
  const requiresAll = node.config?.approvalPolicy === 'ALL' && required.length > 1;
  if (!requiresAll) return { requiresAll: false, required, approved: [], pending: required };
  const approved = (instance.stepApprovals?.[node.id] || []).filter(id => required.includes(id));
  return { requiresAll, required, approved, pending: required.filter(id => !approved.includes(id)) };
};

/**
 * Whether this user's approval moves the ticket to the next stage. Only then does
 * the approver need to pick the next stage's handlers. Admins / template managers
 * outside the assignee list override and advance.
 */
export const approvalAdvancesStage = (state: WorkflowStepApprovalState, userId: string) =>
  !state.requiresAll
  || !state.required.includes(userId)
  || state.pending.every(id => id === userId);
