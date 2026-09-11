import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, ShieldAlert } from 'lucide-react';
import { EffectivePermissionSource, UserPermissionGrant } from '../../types';
import {
  PermissionCatalogAction,
  PermissionCatalogApplication,
  PermissionScopeType,
} from '../../lib/permissions/permissionTypes';
import { ApplicationGrantState } from '../../lib/permissions/moduleGrantSelection';

interface PermissionModuleCardProps {
  application: PermissionCatalogApplication;
  state: ApplicationGrantState;
  expanded: boolean;
  grants: readonly UserPermissionGrant[];
  inheritedSources: readonly EffectivePermissionSource[];
  disabled: boolean;
  pendingRemovalCount: number;
  initialExpandedAdvancedModuleCodes?: readonly string[];
  onToggleSelected: (checked: boolean) => void;
  onToggleExpanded: () => void;
  onToggleAction: (
    action: PermissionCatalogAction,
    checked: boolean,
    scopeType: PermissionScopeType,
    scopeId?: string,
    expiresAt?: string,
  ) => void;
  onConfirmRemoval: () => void;
  onCancelRemoval: () => void;
}

const SCOPE_LABELS: Record<PermissionScopeType, string> = {
  global: 'Toàn công ty',
  own: 'Chính mình',
  assigned: 'Được phân công',
  project: 'Dự án',
  construction_site: 'Công trường',
  warehouse: 'Kho',
  department: 'Phòng ban',
  direct_reports: 'Cấp dưới trực tiếp',
  org_unit: 'Đơn vị tổ chức',
  work_workspace: 'Không gian làm việc',
};

const ENTITY_SCOPE_TYPES = new Set<PermissionScopeType>([
  'project',
  'construction_site',
  'warehouse',
  'department',
  'direct_reports',
  'org_unit',
  'work_workspace',
]);

const activeGrantFor = (
  grants: readonly UserPermissionGrant[],
  permissionCode: string,
): UserPermissionGrant | undefined => grants.find(grant =>
  grant.permissionCode === permissionCode
  && grant.isActive !== false
  && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now())
);

const sourceLabel = (source: EffectivePermissionSource): string =>
  source.sourceLabel || source.sourceCode || source.sourceType;

const ActionRow: React.FC<{
  action: PermissionCatalogAction;
  grants: readonly UserPermissionGrant[];
  inheritedSources: readonly EffectivePermissionSource[];
  disabled: boolean;
  onToggle: PermissionModuleCardProps['onToggleAction'];
}> = ({ action, grants, inheritedSources, disabled, onToggle }) => {
  const directGrant = activeGrantFor(grants, action.permissionCode);
  const inherited = inheritedSources.find(source => source.permissionCode === action.permissionCode);
  const initialScope = directGrant?.scopeType || action.defaultScopeType || action.scopeTypes[0] || 'global';
  const [scopeType, setScopeType] = useState<PermissionScopeType>(initialScope);
  const [scopeId, setScopeId] = useState(directGrant?.scopeId === '*' ? '' : directGrant?.scopeId || '');
  const [expiresAt, setExpiresAt] = useState(directGrant?.expiresAt?.slice(0, 16) || '');
  const expiryReady = !action.directGrantRequiresExpiry
    || (Boolean(expiresAt) && Date.parse(expiresAt) > Date.now());
  const entityScope = ENTITY_SCOPE_TYPES.has(scopeType);
  const canToggle = action.directGrantAllowed
    && (!inherited || Boolean(directGrant))
    && expiryReady
    && (!entityScope || Boolean(scopeId.trim()));

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(directGrant)}
            disabled={disabled || !canToggle}
            onChange={event => onToggle(
              action,
              event.target.checked,
              scopeType,
              entityScope ? scopeId : '*',
              expiresAt ? new Date(expiresAt).toISOString() : undefined,
            )}
            className="h-4 w-4 shrink-0 rounded accent-blue-600"
          />
          <span>{action.label}</span>
        </label>
        {action.riskLevel === 'sensitive' && (
          <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">Nhạy cảm</span>
        )}
        {!action.directGrantAllowed && (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Template</span>
        )}
        {action.directGrantRequiresExpiry && (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Cần ngày hết hạn</span>
        )}
      </div>

      {inherited && (
        <p className="mt-1 text-[11px] font-semibold text-slate-500">Kế thừa từ {sourceLabel(inherited)}</p>
      )}

      {action.directGrantAllowed && !inherited && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-[10px] font-bold text-slate-500">Phạm vi</span>
            <select
              value={scopeType}
              disabled={disabled || Boolean(directGrant)}
              onChange={event => setScopeType(event.target.value as PermissionScopeType)}
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
            >
              {action.scopeTypes.map(scope => (
                <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>
              ))}
            </select>
          </label>
          {entityScope && (
            <label className="space-y-1">
              <span className="block text-[10px] font-bold text-slate-500">Mã phạm vi cụ thể</span>
              <input
                value={scopeId}
                disabled={disabled || Boolean(directGrant)}
                onChange={event => setScopeId(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
              />
            </label>
          )}
          {action.directGrantRequiresExpiry && (
            <label className="space-y-1 sm:col-span-2">
              <span className="block text-[10px] font-bold text-slate-500">Ngày hết hạn</span>
              <input
                type="datetime-local"
                value={expiresAt}
                disabled={disabled || Boolean(directGrant)}
                onChange={event => setExpiresAt(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
              />
              {!expiryReady && <span className="block text-[10px] font-semibold text-rose-600">Chọn thời điểm trong tương lai.</span>}
            </label>
          )}
        </div>
      )}
    </div>
  );
};

const PermissionModuleCard: React.FC<PermissionModuleCardProps> = ({
  application,
  state,
  expanded,
  grants,
  inheritedSources,
  disabled,
  pendingRemovalCount,
  initialExpandedAdvancedModuleCodes = [],
  onToggleSelected,
  onToggleExpanded,
  onToggleAction,
  onConfirmRemoval,
  onCancelRemoval,
}) => {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const [advancedModules, setAdvancedModules] = useState<Set<string>>(
    () => new Set(initialExpandedAdvancedModuleCodes),
  );
  const defaultViewCount = useMemo(() => application.modules.reduce(
    (count, module) => count + (module.actions.some(action => action.isDefaultView) ? 1 : 0),
    0,
  ), [application]);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = state === 'indeterminate';
  }, [state]);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
      <div className="flex min-h-[72px] items-center gap-3 px-4 py-3">
        {application.hasDefaultViewBundle ? (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={state === 'checked'}
              disabled={disabled}
              aria-label={`Cấp quyền Xem cho ${application.label}`}
              onChange={event => onToggleSelected(event.target.checked)}
              className="h-5 w-5 shrink-0 rounded accent-blue-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-black text-slate-800">{application.label}</span>
              <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                {defaultViewCount} phân hệ được xem
              </span>
            </span>
          </label>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-slate-800">{application.label}</div>
            {application.code === 'project' ? (
              <a href="/da?tab=permissions" className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
                Quản lý tại Room Dự án <ExternalLink size={12} />
              </a>
            ) : (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">Chưa có gói quyền Xem mặc định</p>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label={`${expanded ? 'Thu gọn' : 'Mở chi tiết'} ${application.label}`}
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
        >
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {pendingRemovalCount > 0 && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Gỡ {pendingRemovalCount} quyền trực tiếp của Module này?</p>
              <p className="mt-1 text-[11px]">Quyền kế thừa từ vai trò vẫn được giữ nguyên.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={onConfirmRemoval} className="rounded-lg bg-amber-700 px-3 py-2 font-bold text-white active:scale-[0.98]">Xác nhận gỡ</button>
                <button type="button" onClick={onCancelRemoval} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold text-amber-800 active:scale-[0.98]">Giữ lại</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-4">
          <div className="space-y-3">
            {application.modules.map(module => {
              const defaultActions = module.actions.filter(action => action.isDefaultView);
              const advancedActions = module.actions.filter(action => !action.isDefaultView);
              const advancedExpanded = advancedModules.has(module.code);
              return (
                <section key={module.code} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-black text-slate-800">{module.label}</h4>
                      {module.description && <p className="mt-0.5 text-[11px] text-slate-500">{module.description}</p>}
                    </div>
                    {advancedActions.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={advancedExpanded}
                        onClick={() => setAdvancedModules(current => {
                          const next = new Set(current);
                          if (next.has(module.code)) next.delete(module.code);
                          else next.add(module.code);
                          return next;
                        })}
                        className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-[0.98]"
                      >
                        Quyền nâng cao
                      </button>
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    {defaultActions.map(action => (
                      <ActionRow
                        key={action.permissionCode}
                        action={action}
                        grants={grants}
                        inheritedSources={inheritedSources}
                        disabled={disabled}
                        onToggle={onToggleAction}
                      />
                    ))}
                    {advancedExpanded && advancedActions.map(action => (
                      <ActionRow
                        key={action.permissionCode}
                        action={action}
                        grants={grants}
                        inheritedSources={inheritedSources}
                        disabled={disabled}
                        onToggle={onToggleAction}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
};

export default PermissionModuleCard;
