import React, { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { UserPermissionGrant } from '../../types';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import { PermissionScope } from '../../lib/permissions/permissionTypes';
import { isPermissionActionScopeAllowed } from '../../lib/permissions/permissionService';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { buildPermissionSourceBadges } from '../../lib/permissions/authorizationGovernanceViewModel';
import { isIdentityBoundPermission } from '../../lib/permissions/permissionRisk';

interface PermissionMatrixProps {
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  applicationCodes?: readonly string[];
  targetUserId?: string;
  scope: PermissionScope;
  disabled?: boolean;
  onChange: (grants: UserPermissionGrant[]) => void;
}

const grantKey = (permissionCode: string, scope: PermissionScope) =>
  `${permissionCode}::${scope.scopeType || 'global'}::${scope.scopeId || '*'}`;

const PermissionMatrix: React.FC<PermissionMatrixProps> = ({
  grants,
  effectiveSources,
  applicationCodes,
  targetUserId = '',
  scope,
  disabled = false,
  onChange,
}) => {
  const visibleApplications = useMemo(() => {
    if (!applicationCodes?.length) return permissionRegistry;
    const allowed = new Set(applicationCodes);
    return permissionRegistry.filter(application => allowed.has(application.code));
  }, [applicationCodes]);
  const explicitGrantKeys = useMemo(() => new Set(
    grants
      .filter(grant => grant.isActive !== false)
      .map(grant => `${grant.permissionCode}::${grant.scopeType || 'global'}::${grant.scopeId || '*'}`)
  ), [grants]);

  const sourceIsCurrent = (source: EffectivePermissionSource) => {
    const now = Date.now();
    const startsAt = source.startsAt !== undefined && source.startsAt !== null
      ? new Date(source.startsAt).getTime()
      : null;
    const expiresAt = source.expiresAt !== undefined && source.expiresAt !== null
      ? new Date(source.expiresAt).getTime()
      : null;
    return (startsAt === null || (Number.isFinite(startsAt) && startsAt <= now)) &&
      (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now));
  };

  const sourceCoversScope = (source: EffectivePermissionSource) => {
    const scopeType = scope.scopeType || 'global';
    const scopeId = scope.scopeId || '*';
    return source.scopeType === 'global' || (
      source.scopeType === scopeType && (source.scopeId === '*' || source.scopeId === scopeId)
    );
  };

  const toggleGrant = (permissionCode: string, checked: boolean) => {
    if (disabled) return;
    const currentKey = grantKey(permissionCode, scope);
    if (!checked) {
      onChange(grants.filter(grant =>
        `${grant.permissionCode}::${grant.scopeType || 'global'}::${grant.scopeId || '*'}` !== currentKey
      ));
      return;
    }
    if (explicitGrantKeys.has(currentKey)) return;
    onChange([
      ...grants,
      {
        id: `local-${permissionCode}-${scope.scopeType || 'global'}-${scope.scopeId || '*'}`,
        userId: targetUserId,
        permissionCode,
        scopeType: scope.scopeType || 'global',
        scopeId: scope.scopeId || '*',
        isActive: true,
      },
    ]);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <ShieldCheck size={15} className="text-blue-600" />
        <span className="text-xs font-black uppercase tracking-wide text-slate-700">Ma trận quyền mới</span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        {visibleApplications.map(application => (
          <div key={application.code} className="border-b border-slate-100 last:border-b-0">
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-xs font-black text-slate-700">
              {application.label}
            </div>
            {application.modules.map(module => (
              <div key={module.code} className="grid grid-cols-1 gap-2 border-b border-slate-50 px-3 py-3 last:border-b-0 lg:grid-cols-[180px_1fr]">
                <div>
                  <div className="text-xs font-black text-slate-700">{module.label}</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">{module.code}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {module.actions.map(action => {
                    const currentKey = grantKey(action.permissionCode, scope);
                    const explicit = explicitGrantKeys.has(currentKey);
                    const sources = effectiveSources.filter(source =>
                      source.permissionCode === action.permissionCode &&
                      sourceIsCurrent(source) &&
                      sourceCoversScope(source)
                    );
                    const effective = sources.length > 0;
                    const scopeAllowed = isPermissionActionScopeAllowed(action.permissionCode, scope);
                    const identityBound = isIdentityBoundPermission(action.permissionCode);
                    return (
                      <label
                        key={action.permissionCode}
                        className={`flex min-h-[48px] items-start gap-2 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition ${explicit ? 'border-blue-300 bg-blue-50 text-blue-700' : effective ? 'border-violet-200 bg-violet-50/60 text-violet-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'} ${!scopeAllowed || identityBound ? 'opacity-55' : ''}`}
                        title={!scopeAllowed ? `${action.permissionCode} không hỗ trợ scope hiện tại` : identityBound ? 'Quyền định danh chỉ do hệ thống quản lý' : action.permissionCode}
                      >
                        <input
                          type="checkbox"
                          checked={explicit}
                          disabled={disabled || !scopeAllowed || identityBound}
                          onChange={event => toggleGrant(action.permissionCode, event.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-blue-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{action.label}</span>
                          {effective && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {buildPermissionSourceBadges(sources).map(badge => (
                                <span key={badge.key} className="rounded bg-white/80 px-1 py-0.5 text-[8px] font-black text-violet-600 ring-1 ring-violet-100">
                                  {badge.label}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        {action.riskLevel === 'sensitive' && <span className="rounded bg-rose-100 px-1 py-0.5 text-[8px] font-black uppercase text-rose-600">Nhạy cảm</span>}
                        {action.riskLevel === 'important' && <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-black uppercase text-amber-600">Quan trọng</span>}
                        {!scopeAllowed && <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] font-black uppercase text-slate-400">Scope</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PermissionMatrix;
