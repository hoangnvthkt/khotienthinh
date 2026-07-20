import React, { useEffect, useMemo, useState } from 'react';
import { Clipboard, ClipboardPaste, Eye, Loader2, Save } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import type {
  AuthorizationPrincipal,
  EffectivePermissionSource,
  SodWarningAcceptanceInput,
  UnifiedPermissionPreview,
} from '../../lib/permissions/authorizationGovernanceTypes';
import {
  validateDirectGrantDrafts,
  validateSodWarningAcceptances,
} from '../../lib/permissions/authorizationGovernanceViewModel';
import {
  applyUserPermissionChange,
  previewUserPermissionChange,
} from '../../lib/permissions/permissionAdminService';
import { getAllPermissionActions } from '../../lib/permissions/permissionRegistry';
import {
  copyDirectPermissionDraft,
  pasteDirectPermissionClipboard,
  type DirectPermissionClipboard,
} from '../../lib/permissions/directUserPermissionMatrixViewModel';
import type { LegacyPermissionState, PermissionScope } from '../../lib/permissions/permissionTypes';
import type { PermissionScopeLookupOptionsByType } from '../../lib/permissions/permissionScopeLookupService';
import {
  buildLegacyPermissionCatalog,
  buildCurrentPermissionOverview,
  buildUnifiedPermissionDraftKey,
  type CurrentPermissionOverviewRow,
} from '../../lib/permissions/unifiedPermissionViewModel';
import PermissionChangeSummary from './PermissionChangeSummary';
import PermissionScopePicker from './PermissionScopePicker';
import SodWarningPanel from './SodWarningPanel';
import UnifiedPermissionMatrix from './UnifiedPermissionMatrix';

export interface DirectUserPermissionWorkspaceProps {
  principal: AuthorizationPrincipal;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  principals: readonly AuthorizationPrincipal[];
  currentUserId: string;
  disabled: boolean;
  scopeLookupOptions?: PermissionScopeLookupOptionsByType;
  clipboard: DirectPermissionClipboard | null;
  onClipboardChange: (clipboard: DirectPermissionClipboard | null) => void;
  onSaved: () => Promise<void>;
}

const toLocalDateTime = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const toIsoDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const EMPTY_LEGACY_STATE: LegacyPermissionState = {
  allowedModules: [],
  allowedSubModules: {},
  adminModules: [],
  adminSubModules: {},
};

const cloneLegacyState = (state?: LegacyPermissionState | null): LegacyPermissionState => ({
  allowedModules: [...(state?.allowedModules || [])],
  allowedSubModules: Object.fromEntries(Object.entries(state?.allowedSubModules || {}).map(([key, routes]) => [key, [...routes]])),
  adminModules: [...(state?.adminModules || [])],
  adminSubModules: Object.fromEntries(Object.entries(state?.adminSubModules || {}).map(([key, routes]) => [key, [...routes]])),
});

const hasEditableLegacyState = (state: LegacyPermissionState): boolean =>
  state.allowedModules.length > 0
  || state.adminModules.length > 0
  || Object.keys(state.allowedSubModules).length > 0
  || Object.keys(state.adminSubModules).length > 0;

const sortedUnique = (values: readonly string[]): string[] =>
  [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();

const addRoute = (
  routesByModule: Record<string, string[]>,
  legacyModuleKey: string,
  route: string,
) => {
  routesByModule[legacyModuleKey] = sortedUnique([...(routesByModule[legacyModuleKey] || []), route]);
};

const buildLegacyStateFromEffectiveSources = (
  effectiveSources: readonly EffectivePermissionSource[],
): LegacyPermissionState => {
  const permissionActionByCode = new Map(getAllPermissionActions().map(action => [action.permissionCode, action]));
  const routeCountByLegacyKey = new Map(
    buildLegacyPermissionCatalog().map(entry => [entry.legacyModuleKey, entry.routes.length]),
  );
  const allowedModules: string[] = [];
  const allowedSubModules: Record<string, string[]> = {};
  const adminModules: string[] = [];
  const adminSubModules: Record<string, string[]> = {};

  effectiveSources
    .filter(source => source.sourceType === 'LEGACY')
    .forEach(source => {
      const metadata = source.metadata || {};
      const legacyModuleKey = typeof metadata.legacyModuleKey === 'string'
        ? metadata.legacyModuleKey
        : source.sourceCode || source.sourceId;
      if (!legacyModuleKey) return;

      const action = permissionActionByCode.get(source.permissionCode);
      const isAdminSource = Boolean(action?.legacyAdminOnly || action?.action === 'manage');
      const legacyRoute = typeof metadata.legacyRoute === 'string' ? metadata.legacyRoute : '';
      if (legacyRoute) {
        addRoute(isAdminSource ? adminSubModules : allowedSubModules, legacyModuleKey, legacyRoute);
        return;
      }

      if ((routeCountByLegacyKey.get(legacyModuleKey) || 0) === 0) {
        (isAdminSource ? adminModules : allowedModules).push(legacyModuleKey);
      }
    });

  return {
    allowedModules: sortedUnique(allowedModules),
    allowedSubModules,
    adminModules: sortedUnique(adminModules),
    adminSubModules,
  };
};

const getInitialLegacyState = (
  principal: AuthorizationPrincipal,
  effectiveSources: readonly EffectivePermissionSource[],
): LegacyPermissionState => {
  const principalLegacyState = cloneLegacyState(principal.legacyState || EMPTY_LEGACY_STATE);
  return hasEditableLegacyState(principalLegacyState)
    ? principalLegacyState
    : buildLegacyStateFromEffectiveSources(effectiveSources);
};

const SOURCE_TYPE_LABELS = {
  ROLE: 'Business Role',
  DIRECT: 'Direct',
  LEGACY: 'Legacy',
} as const;

const getInitialPermissionSelection = (
  grants: readonly UserPermissionGrant[],
  effectiveSources: readonly EffectivePermissionSource[],
) => {
  const first = buildCurrentPermissionOverview({ directGrants: grants, effectiveSources })[0];
  return {
    applicationCode: first?.applicationCode || 'wms',
    moduleCode: first?.moduleCode || 'wms.inventory',
  };
};

const DirectUserPermissionWorkspace: React.FC<DirectUserPermissionWorkspaceProps> = ({
  principal,
  grants,
  effectiveSources,
  principals,
  currentUserId,
  disabled,
  scopeLookupOptions,
  clipboard,
  onClipboardChange,
  onSaved,
}) => {
  const [drafts, setDrafts] = useState<UserPermissionGrant[]>([...grants]);
  const [persistedLegacyState, setPersistedLegacyState] = useState<LegacyPermissionState>(() =>
    getInitialLegacyState(principal, effectiveSources)
  );
  const [legacyDraft, setLegacyDraft] = useState<LegacyPermissionState>(() =>
    getInitialLegacyState(principal, effectiveSources)
  );
  const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [permissionChangeReason, setPermissionChangeReason] = useState('');
  const [preview, setPreview] = useState<UnifiedPermissionPreview | null>(null);
  const [previewedDraftKey, setPreviewedDraftKey] = useState<string | null>(null);
  const [warningAcceptances, setWarningAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
  const [busy, setBusy] = useState<'load' | 'preview' | 'save' | null>(null);
  const [message, setMessage] = useState('');
  const [permissionSelection, setPermissionSelection] = useState(() =>
    getInitialPermissionSelection(grants, effectiveSources)
  );

  const permissionActions = useMemo(() => getAllPermissionActions(), []);
  const riskByPermissionCode = useMemo(
    () => new Map(permissionActions.map(action => [action.permissionCode, action.riskLevel || 'normal'] as const)),
    [permissionActions],
  );
  const normalizedScope = useMemo(() => ({
    scopeType: scope.scopeType || 'global',
    scopeId: scope.scopeId || '*',
  }), [scope.scopeId, scope.scopeType]);
  const currentDraftKey = preview
    ? buildUnifiedPermissionDraftKey(principal.userId, legacyDraft, drafts)
    : null;
  const previewMatches = preview !== null && previewedDraftKey === currentDraftKey;
  const unifiedDraftChanged = buildUnifiedPermissionDraftKey(principal.userId, persistedLegacyState, grants)
    !== buildUnifiedPermissionDraftKey(principal.userId, legacyDraft, drafts);
  const panelDisabled = disabled || principal.accountStatus !== 'ACTIVE' || busy !== null;
  const sensitiveDrafts = drafts.filter(grant =>
    grant.isActive !== false && riskByPermissionCode.get(grant.permissionCode) === 'sensitive'
  );
  const currentPermissionOverview = useMemo(
    () => buildCurrentPermissionOverview({ directGrants: drafts, effectiveSources }),
    [drafts, effectiveSources],
  );
  const sourceSummary = useMemo(() => ({
    role: effectiveSources.filter(source => source.sourceType === 'ROLE').length,
    legacy: effectiveSources.filter(source => source.sourceType === 'LEGACY').length,
    direct: effectiveSources.filter(source => source.sourceType === 'DIRECT').length,
  }), [effectiveSources]);

  useEffect(() => {
    const nextLegacy = getInitialLegacyState(principal, effectiveSources);
    setDrafts([...grants]);
    setPersistedLegacyState(nextLegacy);
    setLegacyDraft(cloneLegacyState(nextLegacy));
    setPreview(null);
    setPreviewedDraftKey(null);
    setWarningAcceptances([]);
    setMessage('');
    setPermissionSelection(getInitialPermissionSelection(grants, effectiveSources));
  }, [effectiveSources, grants, principal.legacyState, principal.userId]);

  const updateDrafts = (next: UserPermissionGrant[]) => {
    setDrafts(next);
    setPreview(null);
    setPreviewedDraftKey(null);
    setWarningAcceptances([]);
    setMessage('');
  };

  const updateLegacyDraft = (next: LegacyPermissionState) => {
    setLegacyDraft(next);
    setPreview(null);
    setPreviewedDraftKey(null);
    setWarningAcceptances([]);
    setMessage('');
  };

  const selectPermissionLocation = (selection: { applicationCode: string; moduleCode: string }) => {
    setPermissionSelection(selection);
    setPreview(null);
    setPreviewedDraftKey(null);
    setWarningAcceptances([]);
    setMessage('');
  };

  const handleOpenPermissionLocation = (row: CurrentPermissionOverviewRow) => {
    selectPermissionLocation({
      applicationCode: row.applicationCode,
      moduleCode: row.moduleCode,
    });
    setScope({ scopeType: row.scopeType, scopeId: row.scopeId });
  };

  const handleRevokeDirectGrant = (row: CurrentPermissionOverviewRow) => {
    handleOpenPermissionLocation(row);
    updateDrafts(drafts.filter(grant => !(
      grant.isActive !== false
      && grant.permissionCode === row.permissionCode
      && (grant.scopeType || 'global') === row.scopeType
      && (grant.scopeId || '*') === row.scopeId
    )));
  };

  const updateExpiry = (grant: UserPermissionGrant, value: string) => {
    updateDrafts(drafts.map(candidate => candidate === grant ? {
      ...candidate,
      expiresAt: toIsoDateTime(value),
    } : candidate));
  };

  const handleCopy = () => {
    onClipboardChange(copyDirectPermissionDraft(drafts));
    setMessage('Da copy quyen Direct trong draft.');
  };

  const handlePaste = () => {
    if (!clipboard) return;
    updateDrafts(pasteDirectPermissionClipboard(principal.userId, clipboard));
    setMessage('Da dan quyen Direct vao draft cua user nhan.');
  };

  const handlePreview = async () => {
    setBusy('preview');
    setMessage('');
    setWarningAcceptances([]);
    try {
      const nextPreview = await previewUserPermissionChange(principal.userId, legacyDraft, drafts);
      setPreview(nextPreview);
      setLegacyDraft(cloneLegacyState(nextPreview.legacyAfter));
      setPreviewedDraftKey(buildUnifiedPermissionDraftKey(principal.userId, nextPreview.legacyAfter, drafts));
    } catch {
      setMessage('Khong the preview thay doi quyen.');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    const validationErrors = validateDirectGrantDrafts(grants, drafts, riskByPermissionCode, new Date(), permissionChangeReason);
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }

    let previewToApply: UnifiedPermissionPreview | null = previewMatches ? preview : null;
    let legacyToApply = legacyDraft;
    if (!previewToApply) {
      setBusy('preview');
      setMessage('');
      setWarningAcceptances([]);
      try {
        previewToApply = await previewUserPermissionChange(principal.userId, legacyDraft, drafts);
        legacyToApply = cloneLegacyState(previewToApply.legacyAfter);
        setPreview(previewToApply);
        setLegacyDraft(cloneLegacyState(legacyToApply));
        setPreviewedDraftKey(buildUnifiedPermissionDraftKey(principal.userId, legacyToApply, drafts));
      } catch {
        setMessage('Khong the preview thay doi quyen.');
        setBusy(null);
        return;
      }
    }
    if (previewToApply.decision.hardDenies.length > 0) {
      setMessage('Backend tu choi do quy tac SoD bat buoc.');
      setBusy(null);
      return;
    }
    const acceptanceErrors = validateSodWarningAcceptances(previewToApply.decision, warningAcceptances, new Date());
    if (acceptanceErrors.length > 0) {
      setMessage(acceptanceErrors[0]);
      setBusy(null);
      return;
    }

    setBusy('save');
    setMessage('');
    try {
      const result = await applyUserPermissionChange(principal.userId, previewToApply.beforeFingerprint, legacyToApply, drafts, {
        reason: permissionChangeReason.trim(),
        warningAcceptances,
      });
      const nextLegacy = cloneLegacyState(result.legacyAfter);
      setPersistedLegacyState(nextLegacy);
      setLegacyDraft(cloneLegacyState(nextLegacy));
      setDrafts(result.directAfter);
      await onSaved();
      setPermissionChangeReason('');
      setPreview(null);
      setPreviewedDraftKey(null);
      setWarningAcceptances([]);
      setMessage('Da luu phan quyen.');
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      setMessage(code === '40001'
        ? 'Du lieu quyen da doi; hay tai lai va preview lai.'
        : 'Khong the luu phan quyen. Backend da tu choi thay doi.');
    } finally {
      setBusy(null);
    }
  };

  const saveDisabled = panelDisabled
    || !unifiedDraftChanged
    || Boolean(previewMatches && preview?.decision.hardDenies.length)
    || (unifiedDraftChanged && permissionChangeReason.trim().length < 10);

  return (
    <section className="grid min-h-[680px] gap-4 xl:grid-cols-[300px_1fr]">
      <aside className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <div className="text-sm font-black text-slate-800">{principal.name}</div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-500">{principal.email}</div>
          <div className="mt-2 text-[10px] font-black uppercase text-slate-400">{principal.accountStatus}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-blue-50 px-2 py-2 text-[10px] font-black text-blue-700">Direct {sourceSummary.direct}</div>
          <div className="rounded-lg bg-violet-50 px-2 py-2 text-[10px] font-black text-violet-700">Role {sourceSummary.role}</div>
          <div className="rounded-lg bg-amber-50 px-2 py-2 text-[10px] font-black text-amber-700">Legacy {sourceSummary.legacy}</div>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-slate-600">Scope dang chinh</div>
          <PermissionScopePicker
            value={scope}
            onChange={nextScope => {
              setScope(nextScope);
              setPreview(null);
              setPreviewedDraftKey(null);
              setWarningAcceptances([]);
              setMessage('');
            }}
            disabled={panelDisabled}
            lookupOptions={scopeLookupOptions}
          />
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-slate-500">
            Không bắt buộc chọn Dự án. Chọn Toàn hệ thống, Của mình, Được giao, Kho, Phòng ban hoặc Công trình theo phạm vi công việc.
            Scope Dự án chỉ cấp được quyền hỗ trợ Dự án; các quyền hệ thống cần scope Toàn hệ thống.
          </div>
        </div>
      </aside>

      <main className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-slate-800">Phân quyền user</div>
            <div className="mt-1 text-[10px] font-bold text-slate-400">Scope {normalizedScope.scopeType}/{normalizedScope.scopeId}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={panelDisabled}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50"
            >
              <Clipboard size={14} /> Copy quyền
            </button>
            <button
              type="button"
              onClick={handlePaste}
              disabled={panelDisabled || !clipboard}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50"
            >
              <ClipboardPaste size={14} /> Dán quyền
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={panelDisabled}
              className="flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-50"
            >
              {busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Preview backend
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {busy === 'save' || busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Lưu phân quyền
            </button>
          </div>
        </div>

        {principal.accountStatus !== 'ACTIVE' && (
          <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
            Principal dang bi vo hieu hoa.
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black uppercase tracking-wide text-slate-700">
              Quyền đang có ({currentPermissionOverview.length})
            </div>
            <div className="text-[10px] font-bold text-slate-400">
              Direct / Role / Legacy
            </div>
          </div>
          {currentPermissionOverview.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs font-bold text-slate-400">
              Chưa có quyền hiệu lực.
            </div>
          ) : (
            <div className="grid max-h-64 gap-2 overflow-auto lg:grid-cols-2">
              {currentPermissionOverview.map(row => (
                <article key={row.key} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-slate-800">
                        {row.applicationLabel} · {row.moduleLabel}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-500">
                        {row.actionLabel} · {row.scopeType}/{row.scopeId}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenPermissionLocation(row)}
                      disabled={panelDisabled}
                      className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-black text-slate-600 disabled:opacity-50"
                    >
                      Mở module
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {row.sourceTypes.map(sourceType => (
                      <span
                        key={sourceType}
                        className={`rounded px-2 py-1 text-[10px] font-black ${
                          sourceType === 'DIRECT'
                            ? 'bg-blue-100 text-blue-700'
                            : sourceType === 'ROLE'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {SOURCE_TYPE_LABELS[sourceType]}
                      </span>
                    ))}
                    {row.sourceTypes.includes('LEGACY') && (
                      <span className="text-[10px] font-bold text-amber-700">Bỏ tích Legacy ở module này để thu hồi.</span>
                    )}
                    {row.canRevokeDirect && (
                      <button
                        type="button"
                        onClick={() => handleRevokeDirectGrant(row)}
                        disabled={panelDisabled}
                        className="rounded border border-rose-200 px-2 py-1 text-[10px] font-black text-rose-700 disabled:opacity-50"
                      >
                        Thu hồi Direct
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <UnifiedPermissionMatrix
          targetUserId={principal.userId}
          grants={drafts}
          effectiveSources={effectiveSources}
          scope={scope}
          legacyState={legacyDraft}
          disabled={panelDisabled}
          selectedApplicationCode={permissionSelection.applicationCode}
          selectedModuleCode={permissionSelection.moduleCode}
          onSelectionChange={selectPermissionLocation}
          onGrantsChange={updateDrafts}
          onLegacyStateChange={updateLegacyDraft}
        />

        {sensitiveDrafts.length > 0 && (
          <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50/50 p-3">
            <div className="text-[10px] font-black uppercase text-rose-700">Han bat buoc cho quyen nhay cam</div>
            {sensitiveDrafts.map(grant => (
              <label
                key={`${grant.permissionCode}-${grant.scopeType}-${grant.scopeId}`}
                className="grid items-center gap-2 text-[10px] font-bold text-slate-600 sm:grid-cols-[1fr_220px]"
              >
                <span>{grant.permissionCode} · {grant.scopeType}/{grant.scopeId}</span>
                <input
                  type="datetime-local"
                  value={toLocalDateTime(grant.expiresAt)}
                  onChange={event => updateExpiry(grant, event.target.value)}
                  disabled={panelDisabled}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold disabled:bg-slate-50"
                />
              </label>
            ))}
          </div>
        )}

        <textarea
          value={permissionChangeReason}
          onChange={event => setPermissionChangeReason(event.target.value)}
          disabled={panelDisabled}
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50"
          placeholder="Ly do thay doi phan quyen"
        />

        {preview && (
          <PermissionChangeSummary
            beforeGrants={grants}
            afterGrants={drafts}
            beforeLegacy={preview.legacyBefore}
            afterLegacy={legacyDraft}
            effectiveSources={effectiveSources}
          />
        )}

        {preview && previewMatches && preview.decision.hardDenies.length > 0 && (
          <div className="space-y-1 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
            {preview.decision.hardDenies.map(finding => (
              <div key={`${finding.ruleCode}-${finding.scopeType}-${finding.scopeId}`}>{finding.message}</div>
            ))}
          </div>
        )}

        {preview && previewMatches && (
          <SodWarningPanel
            warnings={preview.decision.warnings}
            acceptances={warningAcceptances}
            controlOwners={principals}
            currentUserId={currentUserId}
            affectedPrincipalId={principal.userId}
            disabled={panelDisabled}
            onChange={setWarningAcceptances}
          />
        )}

        {message && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">
            {message}
          </div>
        )}
      </main>
    </section>
  );
};

export default DirectUserPermissionWorkspace;
