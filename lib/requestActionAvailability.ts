import type { RequestAction } from './requestRuntimeService';
import type { RequestRuntimeStatus } from '../types';

export const getRequestActions = ({
  status,
  canApprove = false,
  canCancel = false,
  canReassign = false,
  isCreator,
}: {
  status: RequestRuntimeStatus;
  canApprove?: boolean;
  canCancel?: boolean;
  canReassign?: boolean;
  isCreator: boolean;
}): RequestAction[] => {
  if (status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'DRAFT') return [];
  if (status === 'RETURNED') return isCreator ? ['RESUBMIT', 'CANCEL'] : (canCancel ? ['CANCEL'] : []);
  const actions: RequestAction[] = [];
  if (canApprove) actions.push('APPROVE', 'REJECT', 'RETURN');
  if (canReassign) actions.push('REASSIGN');
  if (canCancel) actions.push('CANCEL');
  return actions;
};
