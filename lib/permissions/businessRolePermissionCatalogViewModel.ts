import type { BusinessRoleItem } from './authorizationGovernanceTypes';
import { permissionRegistry } from './permissionRegistry';
import { isPermissionActionScopeAllowed } from './permissionService';
import type {
  PermissionActionDefinition,
  PermissionModuleDefinition,
  PermissionScope,
  PermissionScopeType,
} from './permissionTypes';
import { isIdentityBoundPermission } from './permissionRisk';
import { matchesSearchQueryMultiple } from '../searchUtils';

export interface BusinessRolePermissionActionRow {
  action: PermissionActionDefinition;
  permissionCode: string;
  label: string;
  selectedItem?: BusinessRoleItem;
  isSelected: boolean;
  scopeTypes: readonly PermissionScopeType[];
}

export interface BusinessRolePermissionModuleGroup {
  moduleCode: string;
  moduleLabel: string;
  module: PermissionModuleDefinition;
  selectedCount: number;
  totalCount: number;
  actions: BusinessRolePermissionActionRow[];
}

export interface BusinessRolePermissionApplicationGroup {
  applicationCode: string;
  applicationLabel: string;
  selectedCount: number;
  modules: BusinessRolePermissionModuleGroup[];
}

export interface BuildBusinessRolePermissionGroupsInput {
  actions: readonly PermissionActionDefinition[];
  selectedItems: readonly BusinessRoleItem[];
  query?: string;
  selectedOnly?: boolean;
  includeIdentityBoundSelected?: boolean;
}

const getActionScopeTypes = (action: PermissionActionDefinition): readonly PermissionScopeType[] =>
  action.scopeTypes?.length ? action.scopeTypes : ['global'];

const normalizeScope = (scopeType: PermissionScopeType, scopeId?: string): Required<PermissionScope> => ({
  scopeType,
  scopeId: scopeType === 'global' ? '*' : scopeId || '*',
});

export const resolveBusinessRoleItemScope = (
  action: PermissionActionDefinition,
  requestedScope?: PermissionScope,
): Required<PermissionScope> => {
  const requested = normalizeScope(
    (requestedScope?.scopeType || 'global') as PermissionScopeType,
    requestedScope?.scopeId,
  );
  if (isPermissionActionScopeAllowed(action.permissionCode, requested)) return requested;
  return normalizeScope(getActionScopeTypes(action)[0] || 'global');
};

export const buildBusinessRolePermissionGroups = ({
  actions,
  selectedItems,
  query = '',
  selectedOnly = false,
  includeIdentityBoundSelected = false,
}: BuildBusinessRolePermissionGroupsInput): BusinessRolePermissionApplicationGroup[] => {
  const selectedByPermissionCode = new Map(selectedItems.map(item => [item.permissionCode, item] as const));
  const editableActionByCode = new Map(
    actions
      .filter(action =>
        !isIdentityBoundPermission(action.permissionCode)
        || (includeIdentityBoundSelected && selectedByPermissionCode.has(action.permissionCode)),
      )
      .map(action => [action.permissionCode, action] as const),
  );

  return permissionRegistry
    .map(application => {
      const modules = application.modules
        .map(module => {
          const moduleActions = module.actions
            .map(action => editableActionByCode.get(action.permissionCode))
            .filter((action): action is PermissionActionDefinition => Boolean(action));
          const selectedCount = moduleActions.filter(action => selectedByPermissionCode.has(action.permissionCode)).length;
          const actionRows = moduleActions
            .map<BusinessRolePermissionActionRow>(action => {
              const selectedItem = selectedByPermissionCode.get(action.permissionCode);
              return {
                action,
                permissionCode: action.permissionCode,
                label: action.label,
                selectedItem,
                isSelected: Boolean(selectedItem),
                scopeTypes: getActionScopeTypes(action),
              };
            })
            .filter(row => {
              if (selectedOnly && !row.isSelected) return false;
              return matchesSearchQueryMultiple([
                application.code,
                application.label,
                module.code,
                module.label,
                module.description,
                row.label,
                row.permissionCode,
                row.action.description,
                row.selectedItem?.scopeType,
                row.selectedItem?.scopeId,
              ], query);
            });

          return {
            moduleCode: module.code,
            moduleLabel: module.label,
            module,
            selectedCount,
            totalCount: moduleActions.length,
            actions: actionRows,
          };
        })
        .filter(module => module.actions.length > 0);

      return {
        applicationCode: application.code,
        applicationLabel: application.label,
        selectedCount: modules.reduce((total, module) => total + module.selectedCount, 0),
        modules,
      };
    })
    .filter(application => application.modules.length > 0);
};
