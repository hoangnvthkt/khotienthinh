import type { Asset, User } from '../types';
import { canPerform } from './permissions/permissionService';

export type AssetAssignmentAction = 'assign' | 'return' | 'transfer';

const permissionCodeFor = (action: AssetAssignmentAction) => `asset.assignment.${action}`;

const canActForSubject = (
  user: User,
  action: AssetAssignmentAction,
  asset: Asset,
  subjectUserId?: string,
): boolean => {
  const permissionCode = permissionCodeFor(action);
  if (canPerform(user, permissionCode, { scopeType: 'global', scopeId: '*' })) return true;
  if (asset.warehouseId && canPerform(user, permissionCode, {
    scopeType: 'warehouse',
    scopeId: asset.warehouseId,
  })) return true;
  if (asset.managingDeptId && canPerform(user, permissionCode, {
    scopeType: 'department',
    scopeId: asset.managingDeptId,
  })) return true;
  return subjectUserId === user.id && canPerform(user, permissionCode, {
    scopeType: 'assigned',
    scopeId: user.id,
  });
};

export const canAssignAsset = (user: User, asset: Asset, targetUserId: string): boolean =>
  canActForSubject(user, 'assign', asset, targetUserId);

export const canReturnAsset = (user: User, asset: Asset): boolean =>
  canActForSubject(user, 'return', asset, asset.assignedToUserId);

export const canTransferAsset = (user: User, asset: Asset, targetUserId: string): boolean =>
  canActForSubject(user, 'transfer', asset, asset.assignedToUserId)
  && canActForSubject(user, 'transfer', asset, targetUserId);

export const canStartAssetAssignmentAction = (
  user: User,
  action: AssetAssignmentAction,
  asset: Asset,
): boolean => {
  if (action === 'return') return canReturnAsset(user, asset);
  if (action === 'transfer') {
    return canActForSubject(user, action, asset, asset.assignedToUserId)
      && canActForSubject(user, action, asset, '__candidate_target__');
  }
  return canActForSubject(user, action, asset, user.id)
    || canActForSubject(user, action, asset, '__candidate_target__');
};
