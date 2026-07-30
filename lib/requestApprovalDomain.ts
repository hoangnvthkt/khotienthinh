import type {
  RequestApprovalPolicyInput,
  RequestApprovalProjection,
  RequestAssignmentStatus,
} from '../types';

const terminalApproved = (status: RequestAssignmentStatus) => status === 'APPROVED';

export const projectRequestApproval = (
  input: RequestApprovalPolicyInput,
): RequestApprovalProjection => {
  const ordered = [...input.assignments].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );

  if (input.flowMode === 'PARALLEL') {
    const pending = ordered.filter(item => item.status === 'PENDING');
    const approved = ordered.filter(item => terminalApproved(item.status));
    if (input.completionPolicy === 'ANY_ONE' && approved.length > 0) {
      return {
        isApproved: true,
        activeBlockKeys: [],
        assignmentIdsToSkip: pending.map(item => item.id),
      };
    }
    return {
      isApproved: ordered.length > 0 && ordered.every(item => terminalApproved(item.status)),
      activeBlockKeys: [...new Set(pending.map(item => item.blockKey))],
      assignmentIdsToSkip: [],
    };
  }

  const currentBlockKey = input.currentBlockKey ?? input.orderedBlockKeys[0];
  const currentAssignments = ordered.filter(item => item.blockKey === currentBlockKey);
  const currentPending = currentAssignments.filter(item => item.status === 'PENDING');
  const currentComplete = input.completionPolicy === 'ANY_ONE'
    ? currentAssignments.some(item => terminalApproved(item.status))
    : currentAssignments.length > 0
      && currentAssignments.every(item => terminalApproved(item.status));
  if (!currentComplete) {
    return {
      isApproved: false,
      activeBlockKeys: currentBlockKey ? [currentBlockKey] : [],
      assignmentIdsToSkip: [],
    };
  }
  const currentIndex = input.orderedBlockKeys.indexOf(currentBlockKey);
  const nextBlockKey = input.orderedBlockKeys[currentIndex + 1];
  return {
    isApproved: !nextBlockKey,
    activeBlockKeys: nextBlockKey ? [nextBlockKey] : [],
    assignmentIdsToSkip: input.completionPolicy === 'ANY_ONE'
      ? currentPending.map(item => item.id)
      : [],
    nextBlockKey,
  };
};
