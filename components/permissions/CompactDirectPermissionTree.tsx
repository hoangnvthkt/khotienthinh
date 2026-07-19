import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info, ShieldCheck } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import { isPermissionActionScopeAllowed } from '../../lib/permissions/permissionService';
import type { PermissionModuleDefinition, PermissionScope } from '../../lib/permissions/permissionTypes';
import {
  buildUnifiedPermissionRows,
  toggleUnifiedDirectGrant,
} from '../../lib/permissions/unifiedPermissionViewModel';

export interface CompactDirectPermissionTreeProps {
  targetUserId: string;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  scope: PermissionScope;
  disabled?: boolean;
  applicationFilter?: string;
  moduleFilter?: string;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
}

const READINESS_LABELS = {
  legacy: 'Legacy',
  declared: 'Chua xac minh',
  enforced: 'Da thuc thi',
  verified: 'Da xac minh',
} as const;

const RISK_LABELS = {
  normal: 'Thuong',
  important: 'Quan trong',
  sensitive: 'Nhay cam',
} as const;

const sortModules = (modules: readonly PermissionModuleDefinition[]): PermissionModuleDefinition[] =>
  [...modules].sort((left, right) =>
    (left.sortOrder || 0) - (right.sortOrder || 0) || left.label.localeCompare(right.label));

const moduleSupportsScope = (module: PermissionModuleDefinition, scope: PermissionScope): boolean => {
  const scopeType = scope.scopeType || 'global';
  return module.actions.some(action => isPermissionActionScopeAllowed(action.permissionCode, {
    scopeType,
    scopeId: scope.scopeId || '*',
  }));
};

const sortModulesByScopeCompatibility = (
  modules: readonly PermissionModuleDefinition[],
  scope: PermissionScope,
): PermissionModuleDefinition[] => sortModules(modules).sort((left, right) =>
  Number(moduleSupportsScope(right, scope)) - Number(moduleSupportsScope(left, scope))
);

const CompactDirectPermissionTree: React.FC<CompactDirectPermissionTreeProps> = ({
  targetUserId,
  grants,
  effectiveSources,
  scope,
  disabled = false,
  applicationFilter,
  moduleFilter,
  onGrantsChange,
}) => {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const applications = useMemo(() => permissionRegistry
    .filter(application => !applicationFilter || application.code === applicationFilter)
    .map(application => ({
      ...application,
      modules: sortModulesByScopeCompatibility(application.modules, scope)
        .filter(module => !moduleFilter || module.code === moduleFilter),
    }))
    .filter(application => application.modules.length > 0)
    .sort((left, right) =>
      Number(right.modules.some(module => moduleSupportsScope(module, scope))) -
      Number(left.modules.some(module => moduleSupportsScope(module, scope))) ||
      (left.sortOrder || 0) - (right.sortOrder || 0) ||
      left.label.localeCompare(right.label)
    ), [applicationFilter, moduleFilter, scope]);

  const toggleExpanded = (moduleCode: string) => {
    setExpandedModules(previous => {
      const next = new Set(previous);
      if (next.has(moduleCode)) next.delete(moduleCode);
      else next.add(moduleCode);
      return next;
    });
  };

  const renderModule = (module: PermissionModuleDefinition) => {
    const rows = buildUnifiedPermissionRows({ module, grants, effectiveSources, scope });
    const viewRow = rows.find(row => row.action === 'view') || rows[0];
    if (!viewRow) return null;

    const childRows = rows.filter(row => row.permissionCode !== viewRow.permissionCode);
    const expanded = expandedModules.has(module.code);
    const checkedCount = rows.filter(row => row.hasDirectGrant).length;
    const effectiveCount = rows.filter(row => row.isEffective).length;
    const scopeAllowed = isPermissionActionScopeAllowed(viewRow.permissionCode, scope);
    const viewAdditionBlocked = !viewRow.hasDirectGrant && (!viewRow.canAdd || !scopeAllowed);
    const viewDisabled = disabled || (viewRow.hasDirectGrant ? !viewRow.canRemove : viewAdditionBlocked);
    const hasViewAccess = viewRow.hasDirectGrant || viewRow.isEffective;

    return (
      <section key={module.code} className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => toggleExpanded(module.code)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label={expanded ? 'Thu gon quyen con' : 'Mo quyen con'}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-800">{module.label}</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">
              Direct {checkedCount}/{rows.length} · Nguồn quyền {effectiveCount}/{rows.length}
            </div>
          </div>
          <div className="hidden flex-wrap justify-end gap-1 md:flex">
            {viewRow.sourceBadges.map(badge => (
              <span
                key={badge.key}
                className="rounded-md bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700"
              >
                {badge.label}
              </span>
            ))}
          </div>
          <input
            type="checkbox"
            checked={viewRow.hasDirectGrant}
            disabled={viewDisabled}
            onChange={event => onGrantsChange(toggleUnifiedDirectGrant({
              module,
              grants,
              targetUserId,
              permissionCode: viewRow.permissionCode,
              checked: event.target.checked,
              scope,
            }))}
            className="h-4 w-4 rounded accent-blue-600"
          />
        </div>

        {expanded && (
          <div className="space-y-1 border-t border-slate-100 p-2">
            {childRows.map(row => {
              const childScopeAllowed = isPermissionActionScopeAllowed(row.permissionCode, scope);
              const additionBlocked = !row.hasDirectGrant && (!row.canAdd || !childScopeAllowed || !hasViewAccess);
              const inputDisabled = disabled || (row.hasDirectGrant ? !row.canRemove : additionBlocked);
              const disabledReason = !childScopeAllowed
                ? 'Scope này không hỗ trợ tác vụ.'
                : !hasViewAccess
                  ? 'Cần có quyền xem trước khi cấp thao tác này.'
                  : row.readiness === 'declared'
                    ? 'Chưa đủ bằng chứng để cấp mới.'
                    : row.readiness === 'legacy'
                      ? 'Legacy chỉ hiển thị tương thích.'
                      : '';

              return (
                <label
                  key={row.permissionCode}
                  className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md px-3 py-2 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-black text-slate-700">{row.label}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-slate-400">
                      {READINESS_LABELS[row.readiness]} · {RISK_LABELS[row.riskLevel]} · {row.permissionCode}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.hasDirectGrant && (
                        <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                          Direct
                        </span>
                      )}
                      {row.sourceBadges.map(badge => (
                        <span
                          key={badge.key}
                          className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700"
                        >
                          {badge.label}
                        </span>
                      ))}
                    </span>
                    {disabledReason && !row.hasDirectGrant && (
                      <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <Info size={11} />
                        {disabledReason}
                      </span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={row.hasDirectGrant}
                    disabled={inputDisabled}
                    onChange={event => onGrantsChange(toggleUnifiedDirectGrant({
                      module,
                      grants,
                      targetUserId,
                      permissionCode: row.permissionCode,
                      checked: event.target.checked,
                      scope,
                    }))}
                    className="mt-1 h-4 w-4 rounded accent-blue-600"
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-black text-slate-800">
        <ShieldCheck size={16} className="text-blue-600" />
        Ma trận quyền trực tiếp
      </div>
      {applications.map(application => (
        <div key={application.code} className="space-y-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{application.label}</div>
          {application.modules.map(module => renderModule(module))}
        </div>
      ))}
    </section>
  );
};

export default CompactDirectPermissionTree;
