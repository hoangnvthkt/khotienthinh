import { Role, User } from '../types';

export type HomeCapabilities = {
  admin: boolean;
  approver: boolean;
  material: boolean;
  project: boolean;
  warehouse: boolean;
};

export const canUseModule = (user: User, moduleKey: string): boolean => {
  if (user.role === Role.ADMIN) return true;
  if (user.allowedModules === undefined) return true;
  return user.allowedModules.includes(moduleKey);
};

export const resolveHomeCapabilities = (
  user: User,
  signals: { hasApprovalWork?: boolean } = {},
): HomeCapabilities => ({
  admin: user.role === Role.ADMIN || Boolean(user.adminModules?.length),
  approver: Boolean(signals.hasApprovalWork),
  material: canUseModule(user, 'WMS'),
  project: canUseModule(user, 'DA'),
  warehouse: user.role === Role.WAREHOUSE_KEEPER || Boolean(user.assignedWarehouseId),
});
