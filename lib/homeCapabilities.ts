import { Role, User } from '../types';
import { canPerform, canViewModule } from './permissions/permissionService';

export type HomeCapabilities = {
  admin: boolean;
  approver: boolean;
  material: boolean;
  project: boolean;
  warehouse: boolean;
};

export const canUseModule = (user: User, moduleKey: string): boolean => {
  return canViewModule(user, moduleKey);
};

export const resolveHomeCapabilities = (
  user: User,
  signals: { hasApprovalWork?: boolean } = {},
): HomeCapabilities => ({
  admin: user.role === Role.ADMIN || canPerform(user, 'system.settings.manage'),
  approver: Boolean(signals.hasApprovalWork),
  material: canUseModule(user, 'WMS'),
  project: canUseModule(user, 'DA'),
  warehouse: user.role === Role.WAREHOUSE_KEEPER || Boolean(user.assignedWarehouseId),
});
