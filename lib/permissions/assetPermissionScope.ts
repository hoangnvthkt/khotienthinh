import type { Asset, AssetLocationStock, User } from '../../types';
import { canPerform } from './permissionService';
import type { PermissionScope } from './permissionTypes';

export interface AssetPermissionTarget {
  warehouseId?: string | null;
  departmentId?: string | null;
  assignedUserId?: string | null;
}

const present = (value: string | null | undefined): value is string => Boolean(value && value.trim());

export const targetFromAsset = (
  asset: Pick<Asset, 'warehouseId' | 'managingDeptId' | 'assignedToUserId'> | null | undefined,
): AssetPermissionTarget => ({
  warehouseId: asset?.warehouseId,
  departmentId: asset?.managingDeptId,
  assignedUserId: asset?.assignedToUserId,
});

export const targetFromStock = (
  stock: Pick<AssetLocationStock, 'warehouseId' | 'deptId' | 'assignedToUserId'> | null | undefined,
): AssetPermissionTarget => ({
  warehouseId: stock?.warehouseId,
  departmentId: stock?.deptId,
  assignedUserId: stock?.assignedToUserId,
});

export const mergeAssetTargets = (...targets: readonly (AssetPermissionTarget | null | undefined)[]): AssetPermissionTarget => {
  for (const target of targets) {
    if (!target) continue;
    if (present(target.warehouseId) || present(target.departmentId) || present(target.assignedUserId)) return target;
  }
  return {};
};

const candidateScopes = (target?: AssetPermissionTarget): PermissionScope[] => {
  const scopes: PermissionScope[] = [{ scopeType: 'global', scopeId: '*' }];
  if (present(target?.warehouseId)) scopes.push({ scopeType: 'warehouse', scopeId: target.warehouseId });
  if (present(target?.departmentId)) scopes.push({ scopeType: 'department', scopeId: target.departmentId });
  if (present(target?.assignedUserId)) scopes.push({ scopeType: 'assigned', scopeId: target.assignedUserId });
  return scopes;
};

export const hasAssetAction = (
  user: User | null | undefined,
  permissionCode: string,
  target?: AssetPermissionTarget,
): boolean => candidateScopes(target).some(scope => canPerform(user, permissionCode, scope));

export const hasAnyAssetActionSource = (
  user: User | null | undefined,
  permissionCode: string,
): boolean => {
  if (!user) return false;
  if (user.effectivePermissions !== undefined) {
    return user.effectivePermissions.some(source => source.permissionCode === permissionCode);
  }
  return canPerform(user, permissionCode, { scopeType: 'global', scopeId: '*' });
};
