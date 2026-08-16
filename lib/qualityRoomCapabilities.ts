import { QualityChecklistStatus } from '../types';

export interface QualityRoomCapabilities {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canApprove: boolean;
}

export const getQualityRoomCapabilities = (
  actions: Iterable<string>,
): QualityRoomCapabilities => {
  const actionSet = actions instanceof Set ? actions : new Set(actions);
  return {
    canView: actionSet.has('view'),
    canEdit: actionSet.has('edit'),
    canDelete: actionSet.has('delete'),
    canSubmit: actionSet.has('submit') && actionSet.has('edit'),
    canApprove: actionSet.has('approve'),
  };
};

export const getQualityChecklistCapabilities = (
  capabilities: QualityRoomCapabilities,
  status: QualityChecklistStatus,
) => ({
  canEdit: capabilities.canEdit && (status === 'draft' || status === 'returned'),
  canDelete: capabilities.canDelete && status === 'draft',
  canSubmit: capabilities.canSubmit && (status === 'draft' || status === 'returned'),
  canApprove: capabilities.canApprove && status === 'submitted',
});
