import React, { useMemo, useState } from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import { isPermissionActionScopeAllowed } from '../../lib/permissions/permissionService';
import type {
  LegacyPermissionState,
  PermissionApplicationDefinition,
  PermissionModuleDefinition,
  PermissionScope,
} from '../../lib/permissions/permissionTypes';
import {
  buildLegacyPermissionCatalog,
  buildUnifiedPermissionRows,
  isLegacyRouteVisible,
  revokeLegacyUmbrella,
  toggleLegacyModuleView,
  toggleLegacyRouteView,
  toggleUnifiedDirectGrant,
} from '../../lib/permissions/unifiedPermissionViewModel';

export interface UnifiedPermissionMatrixProps {
  targetUserId: string;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  scope: PermissionScope;
  legacyState?: LegacyPermissionState;
  disabled?: boolean;
  initialApplicationCode?: string;
  initialModuleCode?: string;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
  onLegacyStateChange?: (state: LegacyPermissionState) => void;
}

const READINESS_LABELS = {
  legacy: 'Legacy',
  declared: 'Chưa xác minh',
  enforced: 'Đã thực thi',
  verified: 'Đã xác minh',
} as const;

const RISK_LABELS = {
  normal: 'Thông thường',
  important: 'Quan trọng',
  sensitive: 'Nhạy cảm',
} as const;

const isRouteDerivedSystemShell = (module: PermissionModuleDefinition): boolean =>
  module.code.startsWith('system.')
  && module.code !== 'system.authorization'
  && module.actions.length === 2
  && module.actions.some(action => action.action === 'view')
  && module.actions.some(action => action.action === 'manage');

const buildVisibleApplications = (): PermissionApplicationDefinition[] => {
  const detailedLegacyKeys = new Set(
    permissionRegistry
      .flatMap(application => application.modules)
      .filter(module => !isRouteDerivedSystemShell(module))
      .map(module => module.legacyModuleKey)
      .filter((key): key is string => Boolean(key)),
  );

  return permissionRegistry
    .map(application => ({
      ...application,
      modules: application.modules.filter(module => !(
        isRouteDerivedSystemShell(module)
        && module.legacyModuleKey
        && detailedLegacyKeys.has(module.legacyModuleKey)
      )),
    }))
    .filter(application => application.modules.length > 0);
};

const UnifiedPermissionMatrix: React.FC<UnifiedPermissionMatrixProps> = ({
  targetUserId,
  grants,
  effectiveSources,
  scope,
  legacyState,
  disabled = false,
  initialApplicationCode,
  initialModuleCode,
  onGrantsChange,
  onLegacyStateChange,
}) => {
  const applications = useMemo(buildVisibleApplications, []);
  const initialApplication = applications.find(item => item.code === initialApplicationCode) || applications[0];
  const [selectedApplicationCode, setSelectedApplicationCode] = useState(initialApplication?.code || '');
  const initialModule = initialApplication?.modules.find(item => item.code === initialModuleCode)
    || initialApplication?.modules[0];
  const [selectedModuleCode, setSelectedModuleCode] = useState(initialModule?.code || '');

  const selectedApplication = applications.find(item => item.code === selectedApplicationCode) || applications[0];
  const selectedModule = selectedApplication?.modules.find(item => item.code === selectedModuleCode)
    || selectedApplication?.modules[0];
  const rows = useMemo(() => selectedModule ? buildUnifiedPermissionRows({
    module: selectedModule,
    grants,
    effectiveSources,
    scope,
  }) : [], [effectiveSources, grants, scope, selectedModule]);
  const legacyCatalog = useMemo(buildLegacyPermissionCatalog, []);
  const legacyEntry = selectedModule?.legacyModuleKey
    ? legacyCatalog.find(entry => entry.legacyModuleKey === selectedModule.legacyModuleKey)
    : undefined;
  const canEditLegacy = Boolean(
    legacyState
    && onLegacyStateChange
    && (scope.scopeType || 'global') === 'global',
  );
  const hasLegacyUmbrella = Boolean(
    legacyState
    && selectedModule?.legacyModuleKey
    && (
      legacyState.adminModules.includes(selectedModule.legacyModuleKey)
      || Object.prototype.hasOwnProperty.call(
        legacyState.adminSubModules,
        selectedModule.legacyModuleKey,
      )
    ),
  );

  if (!selectedApplication || !selectedModule) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        Chưa có module quyền phù hợp để hiển thị.
      </div>
    );
  }

  const changeApplication = (applicationCode: string) => {
    const application = applications.find(item => item.code === applicationCode);
    setSelectedApplicationCode(applicationCode);
    setSelectedModuleCode(application?.modules[0]?.code || '');
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
          <ShieldCheck size={16} className="text-blue-600" />
          Phân quyền theo khu vực và tác vụ
        </div>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          View mở quyền nhìn thấy. Mỗi tác vụ bên trong được cấp riêng theo đúng scope.
        </p>
      </header>

      <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700">
        <label className="space-y-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span>Ứng dụng</span>
          <select
            value={selectedApplication.code}
            disabled={disabled}
            onChange={event => changeApplication(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-900"
          >
            {applications.map(application => (
              <option key={application.code} value={application.code}>{application.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span>Module</span>
          <select
            value={selectedModule.code}
            disabled={disabled}
            onChange={event => setSelectedModuleCode(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-900"
          >
            {selectedApplication.modules.map(module => (
              <option key={module.code} value={module.code}>{module.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{selectedModule.label}</h3>
          {selectedModule.description && (
            <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{selectedModule.description}</p>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => {
            const scopeAllowed = isPermissionActionScopeAllowed(row.permissionCode, scope);
            const additionBlocked = !row.hasDirectGrant && (!row.canAdd || !scopeAllowed);
            const inputDisabled = disabled || (row.hasDirectGrant ? !row.canRemove : additionBlocked);
            const disabledReason = !scopeAllowed
              ? 'Tác vụ không hỗ trợ scope đang chọn.'
              : row.readiness === 'declared'
                ? 'Chưa có đủ bằng chứng thực thi để cấp mới.'
                : row.readiness === 'legacy'
                  ? 'Quyền umbrella Legacy chỉ có thể được thu hồi.'
                  : undefined;

            return (
              <label
                key={row.permissionCode}
                className={`flex min-h-[108px] flex-col rounded-xl border p-3 ${
                  row.hasDirectGrant
                    ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40'
                    : row.isEffective
                      ? 'border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                } ${inputDisabled && !row.hasDirectGrant ? 'opacity-65' : ''}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-black text-slate-800 dark:text-slate-100">{row.label}</span>
                    <span className="mt-1 block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      {READINESS_LABELS[row.readiness]} · {RISK_LABELS[row.riskLevel]}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={row.hasDirectGrant}
                    disabled={inputDisabled}
                    onChange={event => onGrantsChange(toggleUnifiedDirectGrant({
                      module: selectedModule,
                      grants,
                      targetUserId,
                      permissionCode: row.permissionCode,
                      checked: event.target.checked,
                      scope,
                    }))}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-blue-600"
                  />
                </span>

                <span className="mt-2 flex flex-wrap gap-1.5">
                  {row.hasDirectGrant && (
                    <span className="rounded-md bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                      Direct {row.canRemove ? '· Có thể thu hồi' : ''}
                    </span>
                  )}
                  {row.sourceBadges.map(badge => (
                    <span key={badge.key} className="rounded-md bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700 dark:bg-violet-900 dark:text-violet-200">
                      {badge.label}
                    </span>
                  ))}
                </span>

                {disabledReason && !row.hasDirectGrant && (
                  <span className="mt-auto flex items-start gap-1.5 pt-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    <Info size={12} className="mt-0.5 shrink-0" /> {disabledReason}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {legacyState && legacyEntry && selectedModule.legacyModuleKey && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/25">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-xs font-black text-amber-900 dark:text-amber-200">Hiển thị tương thích Legacy</h4>
                <p className="mt-1 text-[11px] font-medium text-amber-800/80 dark:text-amber-300/80">
                  Chỉ chỉnh tại scope toàn hệ thống. Quyền quản trị Legacy không được cấp mới tại đây.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-black text-amber-900 dark:text-amber-200">
                <span>View module</span>
                <input
                  type="checkbox"
                  checked={legacyState.allowedModules.includes(selectedModule.legacyModuleKey)}
                  disabled={disabled || !canEditLegacy}
                  onChange={event => onLegacyStateChange?.(toggleLegacyModuleView(
                    legacyState,
                    selectedModule.legacyModuleKey as string,
                    event.target.checked,
                  ))}
                  className="h-4 w-4 rounded accent-amber-600"
                />
              </label>
            </div>

            {legacyEntry.routes.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {legacyEntry.routes.map(item => (
                  <label key={item.route} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-200">
                    <span>{item.label}</span>
                    <input
                      type="checkbox"
                      checked={isLegacyRouteVisible(legacyState, selectedModule.legacyModuleKey as string, item.route)}
                      disabled={disabled || !canEditLegacy}
                      onChange={event => onLegacyStateChange?.(toggleLegacyRouteView(
                        legacyState,
                        selectedModule.legacyModuleKey as string,
                        item.route,
                        event.target.checked,
                        legacyEntry.routes.map(routeItem => routeItem.route),
                      ))}
                      className="h-4 w-4 rounded accent-amber-600"
                    />
                  </label>
                ))}
              </div>
            )}

            {hasLegacyUmbrella && (
              <button
                type="button"
                disabled={disabled || !canEditLegacy}
                onClick={() => onLegacyStateChange?.(revokeLegacyUmbrella(
                  legacyState,
                  selectedModule.legacyModuleKey as string,
                ))}
                className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-300"
              >
                Thu hồi quyền quản trị Legacy
              </button>
            )}
          </section>
        )}

        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <summary className="cursor-pointer text-xs font-black text-slate-700 dark:text-slate-200">
            Vì sao người dùng có quyền này?
          </summary>
          <div className="mt-3 space-y-2">
            {rows.map(row => (
              <div key={row.permissionCode} className="rounded-lg bg-white p-2 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <code className="font-bold text-slate-800 dark:text-slate-100">{row.permissionCode}</code>
                <span className="ml-2">{row.sourceBadges.map(badge => badge.label).join(', ') || 'Chưa có nguồn hiệu lực'}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
};

export default UnifiedPermissionMatrix;
