import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { EffectivePermissionSource, UserPermissionGrant } from '../../types';
import { PermissionAdminCatalog, PermissionCatalogAction, PermissionScopeType } from '../../lib/permissions/permissionTypes';
import {
  getApplicationGrantState,
  removeApplicationDirectGrants,
  selectApplicationDefaultViews,
  togglePermissionAction,
} from '../../lib/permissions/moduleGrantSelection';
import PermissionModuleCard from './PermissionModuleCard';

interface PermissionModuleEditorProps {
  catalog: PermissionAdminCatalog;
  grants: readonly UserPermissionGrant[];
  inheritedSources: readonly EffectivePermissionSource[];
  targetUserId: string;
  disabled?: boolean;
  initialExpandedApplicationCodes?: readonly string[];
  initialExpandedAdvancedModuleCodes?: readonly string[];
  onChange: (grants: UserPermissionGrant[]) => void;
}

interface PendingRemoval {
  applicationCode: string;
  grants: UserPermissionGrant[];
  removedCount: number;
}

export const PermissionModuleEditorView: React.FC<PermissionModuleEditorProps> = ({
  catalog,
  grants,
  inheritedSources,
  targetUserId,
  disabled = false,
  initialExpandedApplicationCodes = [],
  initialExpandedAdvancedModuleCodes = [],
  onChange,
}) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialExpandedApplicationCodes),
  );
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inheritedPermissionCodes = useMemo(
    () => inheritedSources.map(source => source.permissionCode),
    [inheritedSources],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('vi');
  const applications = useMemo(() => catalog.applications.filter(application => {
    if (!normalizedQuery) return true;
    return application.label.toLocaleLowerCase('vi').includes(normalizedQuery)
      || application.modules.some(module => module.label.toLocaleLowerCase('vi').includes(normalizedQuery));
  }), [catalog, normalizedQuery]);

  const toggleApplication = (applicationCode: string, checked: boolean) => {
    setError(null);
    if (checked) {
      try {
        const next = selectApplicationDefaultViews({
          catalog,
          applicationCode,
          grants,
          targetUserId,
        });
        setExpanded(current => new Set(current).add(applicationCode));
        onChange(next);
      } catch (selectionError) {
        setError(selectionError instanceof Error ? selectionError.message : 'Không thể chọn Module.');
      }
      return;
    }

    const removal = removeApplicationDirectGrants({ catalog, applicationCode, grants });
    if (removal.needsConfirmation) {
      setPendingRemoval({
        applicationCode,
        grants: removal.grants,
        removedCount: removal.removed.length,
      });
      setExpanded(current => new Set(current).add(applicationCode));
      return;
    }
    onChange(removal.grants);
  };

  const toggleAction = (
    action: PermissionCatalogAction,
    checked: boolean,
    scopeType: PermissionScopeType,
    scopeId?: string,
    expiresAt?: string,
  ) => {
    setError(null);
    try {
      onChange(togglePermissionAction({
        catalog,
        grants,
        targetUserId,
        permissionCode: action.permissionCode,
        checked,
        scopeType,
        scopeId,
        expiresAt,
      }));
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Không thể thay đổi quyền.');
    }
  };

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-slate-600">Tìm Module hoặc phân hệ</span>
        <span className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-200"
            placeholder="Ví dụ: Tài sản, bảo trì..."
          />
        </span>
      </label>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {applications.map(application => (
          <PermissionModuleCard
            key={application.code}
            application={application}
            state={getApplicationGrantState({
              catalog,
              applicationCode: application.code,
              grants,
              inheritedPermissionCodes,
            })}
            expanded={expanded.has(application.code)}
            grants={grants}
            inheritedSources={inheritedSources}
            disabled={disabled}
            pendingRemovalCount={pendingRemoval?.applicationCode === application.code
              ? pendingRemoval.removedCount
              : 0}
            initialExpandedAdvancedModuleCodes={initialExpandedAdvancedModuleCodes}
            onToggleSelected={checked => toggleApplication(application.code, checked)}
            onToggleExpanded={() => setExpanded(current => {
              const next = new Set(current);
              if (next.has(application.code)) next.delete(application.code);
              else next.add(application.code);
              return next;
            })}
            onToggleAction={toggleAction}
            onConfirmRemoval={() => {
              if (pendingRemoval?.applicationCode === application.code) onChange(pendingRemoval.grants);
              setPendingRemoval(null);
            }}
            onCancelRemoval={() => setPendingRemoval(null)}
          />
        ))}
      </div>

      {applications.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
          Không tìm thấy Module phù hợp.
        </div>
      )}
    </div>
  );
};

export default PermissionModuleEditorView;
