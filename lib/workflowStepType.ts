import { WorkflowNode, WorkflowNodeType } from '../types';

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
