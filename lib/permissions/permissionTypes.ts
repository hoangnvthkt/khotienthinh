export type PermissionScopeType =
  | 'global'
  | 'own'
  | 'assigned'
  | 'project'
  | 'construction_site'
  | 'warehouse'
  | 'department'
  | 'direct_reports'
  | 'org_unit'
  | 'work_workspace';

export interface PermissionScope {
  scopeType?: PermissionScopeType;
  scopeId?: string;
}

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

export type PermissionRiskLevel = 'normal' | 'important' | 'sensitive';
export type PermissionGrantReadiness = 'legacy' | 'declared' | 'enforced' | 'verified';

export interface PermissionCatalogAction extends PermissionActionDefinition {
  scopeTypes: readonly PermissionScopeType[];
  riskLevel: PermissionRiskLevel;
  grantReadiness: PermissionGrantReadiness;
  directGrantAllowed: boolean;
  directGrantRequiresExpiry: boolean;
  isDefaultView: boolean;
  defaultScopeType?: PermissionScopeType;
}

export interface PermissionCatalogModule extends Omit<PermissionModuleDefinition, 'actions'> {
  actions: readonly PermissionCatalogAction[];
}

export interface PermissionCatalogApplication extends Omit<PermissionApplicationDefinition, 'modules'> {
  hasDefaultViewBundle: boolean;
  modules: readonly PermissionCatalogModule[];
}

export interface PermissionAdminCatalog {
  generatedAt: string;
  applications: readonly PermissionCatalogApplication[];
}
