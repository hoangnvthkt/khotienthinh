export type PermissionScopeType =
  | 'global'
  | 'own'
  | 'assigned'
  | 'project'
  | 'construction_site'
  | 'warehouse'
  | 'department';

export interface PermissionScope {
  scopeType?: PermissionScopeType;
  scopeId?: string;
}

export interface LegacyPermissionState {
  allowedModules: string[];
  allowedSubModules: Record<string, string[]>;
  adminModules: string[];
  adminSubModules: Record<string, string[]>;
}

export type PermissionRiskLevel = 'normal' | 'important' | 'sensitive';

export type PermissionActionReadiness = 'legacy' | 'declared' | 'enforced' | 'verified';

export type PermissionActionGroup = 'access' | 'action' | 'admin';

export const resolvePermissionActionGroup = (action: string): PermissionActionGroup => {
  if (action === 'view') return 'access';
  if (action === 'manage' || action === 'settings_manage') return 'admin';
  return 'action';
};

export interface PermissionActionDefinition {
  action: string;
  label: string;
  permissionCode: string;
  description?: string;
  scopeTypes?: readonly PermissionScopeType[];
  legacyModuleKey?: string;
  legacyRoute?: string;
  legacyAdminOnly?: boolean;
  sortOrder?: number;
  riskLevel?: PermissionRiskLevel;
  isBusinessAction?: boolean;
  isBusinessApproval?: boolean;
  directGrantRequiresExpiry?: boolean;
  permissionGroup?: PermissionActionGroup;
}

export interface PermissionModuleDefinition {
  code: string;
  label: string;
  description?: string;
  routes?: readonly string[];
  legacyModuleKey?: string;
  sortOrder?: number;
  actions: readonly PermissionActionDefinition[];
}

export interface PermissionApplicationDefinition {
  code: string;
  label: string;
  description?: string;
  sortOrder?: number;
  modules: readonly PermissionModuleDefinition[];
}
