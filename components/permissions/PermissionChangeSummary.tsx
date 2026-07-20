import React, { useMemo } from 'react';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { getPermissionActionByCode, getPermissionModules } from '../../lib/permissions/permissionRegistry';
import type { LegacyPermissionState } from '../../lib/permissions/permissionTypes';

export interface PermissionChangeSummaryProps {
  beforeGrants: readonly UserPermissionGrant[];
  afterGrants: readonly UserPermissionGrant[];
  beforeLegacy: LegacyPermissionState;
  afterLegacy: LegacyPermissionState;
  effectiveSources: readonly EffectivePermissionSource[];
}

const grantKey = (grant: UserPermissionGrant): string => [
  grant.permissionCode,
  grant.scopeType || 'global',
  grant.scopeId || '*',
  grant.expiresAt || '',
].join('::');

const activeGrantMap = (grants: readonly UserPermissionGrant[]) => new Map(
  grants.filter(grant => grant.isActive !== false).map(grant => [grantKey(grant), grant]),
);

const moduleForPermission = (permissionCode: string) =>
  getPermissionModules().find(module => module.actions.some(action => action.permissionCode === permissionCode));

const formatGrant = (grant: UserPermissionGrant): string => {
  const action = getPermissionActionByCode(grant.permissionCode);
  const module = moduleForPermission(grant.permissionCode);
  return `${module?.label || 'Module'}: ${action?.label || grant.permissionCode} (${grant.scopeType}/${grant.scopeId})`;
};

const sourceCoversGrant = (source: EffectivePermissionSource, grant: UserPermissionGrant): boolean =>
  source.permissionCode === grant.permissionCode
  && (
    source.scopeType === 'global'
    || (source.scopeType === grant.scopeType && source.scopeId === grant.scopeId)
  );

const PermissionChangeSummary: React.FC<PermissionChangeSummaryProps> = ({
  beforeGrants,
  afterGrants,
  beforeLegacy,
  afterLegacy,
  effectiveSources,
}) => {
  const summary = useMemo(() => {
    const before = activeGrantMap(beforeGrants);
    const after = activeGrantMap(afterGrants);
    const added = [...after.entries()].filter(([key]) => !before.has(key)).map(([, grant]) => grant);
    const removed = [...before.entries()].filter(([key]) => !after.has(key)).map(([, grant]) => grant);
    const autoView = added.some(grant => {
      const action = getPermissionActionByCode(grant.permissionCode);
      if (action?.action !== 'view') return false;
      const module = moduleForPermission(grant.permissionCode);
      return added.some(candidate =>
        candidate.permissionCode !== grant.permissionCode
        && module?.actions.some(moduleAction => moduleAction.permissionCode === candidate.permissionCode)
        && candidate.scopeType === grant.scopeType
        && candidate.scopeId === grant.scopeId
      );
    });
    const retained = removed.filter(grant => effectiveSources.some(source =>
      (source.sourceType === 'ROLE' || source.sourceType === 'LEGACY')
      && sourceCoversGrant(source, grant)
    ));
    const addedLegacyModules = afterLegacy.allowedModules.filter(key => !beforeLegacy.allowedModules.includes(key));
    const removedLegacyModules = beforeLegacy.allowedModules.filter(key => !afterLegacy.allowedModules.includes(key));
    const legacyAdminRevoked = beforeLegacy.adminModules.filter(key => !afterLegacy.adminModules.includes(key));

    return { added, removed, autoView, retained, addedLegacyModules, removedLegacyModules, legacyAdminRevoked };
  }, [afterGrants, afterLegacy, beforeGrants, beforeLegacy, effectiveSources]);

  const hasChanges = summary.added.length > 0
    || summary.removed.length > 0
    || summary.addedLegacyModules.length > 0
    || summary.removedLegacyModules.length > 0
    || summary.legacyAdminRevoked.length > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">Tóm tắt thay đổi quyền</h3>

      {!hasChanges && (
        <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Chưa có thay đổi trong draft.</p>
      )}

      {summary.autoView && (
        <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
          View được thêm tự động cùng tác vụ trong đúng scope.
        </p>
      )}

      {summary.retained.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Gỡ Direct Grant không làm mất quyền thực tế vì Business Role vẫn còn hiệu lực.
        </p>
      )}

      {(summary.added.length > 0 || summary.removed.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-black text-emerald-700 dark:text-emerald-300">Cấp Direct</h4>
            <ul className="mt-1 space-y-1">
              {summary.added.map(grant => (
                <li key={grantKey(grant)} className="text-xs font-semibold text-slate-600 dark:text-slate-300">{formatGrant(grant)}</li>
              ))}
              {summary.added.length === 0 && <li className="text-xs text-slate-400">Không có</li>}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] font-black text-rose-700 dark:text-rose-300">Thu hồi Direct</h4>
            <ul className="mt-1 space-y-1">
              {summary.removed.map(grant => (
                <li key={grantKey(grant)} className="text-xs font-semibold text-slate-600 dark:text-slate-300">{formatGrant(grant)}</li>
              ))}
              {summary.removed.length === 0 && <li className="text-xs text-slate-400">Không có</li>}
            </ul>
          </div>
        </div>
      )}

      {(summary.addedLegacyModules.length > 0
        || summary.removedLegacyModules.length > 0
        || summary.legacyAdminRevoked.length > 0) && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3 text-xs font-semibold text-slate-600 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-300">
          {summary.addedLegacyModules.length > 0 && <div>Hiện module Legacy: {summary.addedLegacyModules.join(', ')}</div>}
          {summary.removedLegacyModules.length > 0 && <div>Ẩn module Legacy: {summary.removedLegacyModules.join(', ')}</div>}
          {summary.legacyAdminRevoked.length > 0 && <div>Thu hồi quản trị Legacy: {summary.legacyAdminRevoked.join(', ')}</div>}
        </div>
      )}

      <details className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer font-bold">Chi tiết mã quyền</summary>
        <div className="mt-2 space-y-1 font-mono">
          {summary.added.map(grant => <div key={`add-${grantKey(grant)}`}>+ {grantKey(grant)}</div>)}
          {summary.removed.map(grant => <div key={`remove-${grantKey(grant)}`}>- {grantKey(grant)}</div>)}
        </div>
      </details>
    </section>
  );
};

export default PermissionChangeSummary;
