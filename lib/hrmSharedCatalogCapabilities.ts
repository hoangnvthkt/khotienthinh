import { canPerform } from './permissions/permissionService';

export interface HrmSharedCatalogCapabilities {
  canViewOrganization: boolean;
  canManageOrganization: boolean;
  canViewStaffing: boolean;
  canAdjustStaffing: boolean;
  canAssignEmployee: boolean;
  canSetManager: boolean;
  canViewMasterData: boolean;
  canManageMasterData: boolean;
}

export const getHrmSharedCatalogCapabilities = (
  user: Parameters<typeof canPerform>[0],
): HrmSharedCatalogCapabilities => ({
  canViewOrganization: canPerform(user, 'hrm.organization.view'),
  canManageOrganization: canPerform(user, 'hrm.organization.manage'),
  canViewStaffing: canPerform(user, 'hrm.staffing.view'),
  canAdjustStaffing: canPerform(user, 'hrm.staffing.manage'),
  canAssignEmployee: canPerform(user, 'hrm.staffing.assign'),
  canSetManager: canPerform(user, 'hrm.staffing.set_manager'),
  canViewMasterData: canPerform(user, 'hrm.master_data.view'),
  canManageMasterData: canPerform(user, 'hrm.master_data.manage'),
});
