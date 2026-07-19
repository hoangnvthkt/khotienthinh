import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, History, Loader2, RefreshCcw, ShieldCheck } from 'lucide-react';
import type { User } from '../../types';
import BusinessRoleEditor from '../../components/permissions/BusinessRoleEditor';
import SearchableSelect from '../../components/common/SearchableSelect';
import DirectUserPermissionWorkspace from '../../components/permissions/DirectUserPermissionWorkspace';
import EffectivePermissionSourceList from '../../components/permissions/EffectivePermissionSourceList';
import PrincipalDirectGrantPanel from '../../components/permissions/PrincipalDirectGrantPanel';
import PrincipalRoleAssignmentPanel from '../../components/permissions/PrincipalRoleAssignmentPanel';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { listUserPermissionGrants } from '../../lib/permissions/permissionAdminService';
import { getAllPermissionActions } from '../../lib/permissions/permissionRegistry';
import { canPerform } from '../../lib/permissions/permissionService';
import { authorizationGovernanceService } from '../../lib/permissions/authorizationGovernanceService';
import {
  permissionScopeLookupService,
  type PermissionScopeLookupOptionsByType,
} from '../../lib/permissions/permissionScopeLookupService';
import type {
  AuthorizationAuditEvent,
  AuthorizationDecision,
  AuthorizationPrincipal,
  AuthorizationSodRule,
  BusinessRole,
  BusinessRoleImpactPreview,
  BusinessRoleItem,
  EffectivePermissionSource,
  PrincipalRoleAssignment,
  SaveBusinessRoleInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import type { DirectPermissionClipboard } from '../../lib/permissions/directUserPermissionMatrixViewModel';
import type { UserPermissionGrant } from '../../types';

interface SettingsAuthorizationGovernanceProps {
  currentUser: User;
}

const EMPTY_SCOPE_LOOKUP_OPTIONS: PermissionScopeLookupOptionsByType = {};

const getPrincipalLabel = (principal: AuthorizationPrincipal) => `${principal.name} · ${principal.email}`;

const getPrincipalSearchText = (principal: AuthorizationPrincipal) =>
  `${principal.name} ${principal.email} ${principal.userId} ${principal.accountStatus}`;

const renderPrincipalOption = (principal: AuthorizationPrincipal) => (
  <span className="block">
    <span className="block font-black">{principal.name}</span>
    <span className="block text-[10px] font-semibold text-slate-400">{principal.email}</span>
  </span>
);

const SettingsAuthorizationGovernance: React.FC<SettingsAuthorizationGovernanceProps> = ({ currentUser }) => {
  const canView = canPerform(currentUser, 'system.authorization.view');
  const canManageRoles = canPerform(currentUser, 'system.authorization.manage_roles');
  const canManageGrants = canPerform(currentUser, 'system.authorization.manage_grants');
  const canAudit = canPerform(currentUser, 'system.authorization.audit');
  const canOverride = canPerform(currentUser, 'system.authorization.override');
  const permissionActions = useMemo(() => getAllPermissionActions(), []);
  const [principals, setPrincipals] = useState<AuthorizationPrincipal[]>([]);
  const [roles, setRoles] = useState<BusinessRole[]>([]);
  const [selectedPrincipalId, setSelectedPrincipalId] = useState('');
  const selectedPrincipalIdRef = useRef('');
  const [loadedPrincipalId, setLoadedPrincipalId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [sources, setSources] = useState<EffectivePermissionSource[]>([]);
  const [assignments, setAssignments] = useState<PrincipalRoleAssignment[]>([]);
  const [directGrants, setDirectGrants] = useState<UserPermissionGrant[]>([]);
  const [scopeLookupOptions, setScopeLookupOptions] = useState<PermissionScopeLookupOptionsByType>(EMPTY_SCOPE_LOOKUP_OPTIONS);
  const [auditEvents, setAuditEvents] = useState<AuthorizationAuditEvent[]>([]);
  const [overrideRules, setOverrideRules] = useState<AuthorizationSodRule[]>([]);
  const [roleImpactPreview, setRoleImpactPreview] = useState<BusinessRoleImpactPreview | null>(null);
  const [assignmentDecision, setAssignmentDecision] = useState<AuthorizationDecision | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'advanced'>('users');
  const [directClipboard, setDirectClipboard] = useState<DirectPermissionClipboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const selectedPrincipal = principals.find(principal => principal.userId === selectedPrincipalId) || null;
  const selectedRole = roles.find(role => role.id === selectedRoleId) || null;

  const reportError = useCallback((scope: string, error: unknown, fallback: string) => {
    logApiError(scope, error);
    setErrorMessage(getApiErrorMessage(error, fallback));
  }, []);

  const loadPrincipalDetails = useCallback(async (principalId: string) => {
    if (!principalId) return;
    if (selectedPrincipalIdRef.current === principalId) setLoadedPrincipalId('');
    const [nextSources, nextAssignments, nextDirectGrants] = await Promise.all([
      authorizationGovernanceService.listEffectivePermissionSources(principalId),
      canManageRoles || canAudit
        ? authorizationGovernanceService.listPrincipalRoleAssignments(principalId)
        : Promise.resolve([]),
      canManageGrants ? listUserPermissionGrants(principalId) : Promise.resolve([]),
    ]);
    if (selectedPrincipalIdRef.current !== principalId) return;
    setSources(nextSources);
    setAssignments(nextAssignments);
    setDirectGrants(nextDirectGrants);
    setAssignmentDecision(null);
    setLoadedPrincipalId(principalId);
  }, [canAudit, canManageGrants, canManageRoles]);

  const selectPrincipal = useCallback((principalId: string) => {
    selectedPrincipalIdRef.current = principalId;
    setLoadedPrincipalId('');
    setSelectedPrincipalId(principalId);
    setErrorMessage('');
    if (principalId) {
      loadPrincipalDetails(principalId).catch(error => reportError('authorizationGovernance.selectPrincipal', error, 'Không thể tải nguồn quyền của tài khoản.'));
    }
  }, [loadPrincipalDetails, reportError]);

  const loadPage = useCallback(async () => {
    if (!canView) return;
    const [nextPrincipals, nextRoles, nextAuditEvents, nextOverrideRules, nextScopeLookupOptions] = await Promise.all([
      authorizationGovernanceService.listAuthorizationPrincipals(),
      authorizationGovernanceService.listBusinessRoles(),
      canAudit ? authorizationGovernanceService.listPermissionAuditEvents(100) : Promise.resolve([]),
      canOverride ? authorizationGovernanceService.listOverridableSodRules() : Promise.resolve([]),
      permissionScopeLookupService.listLookupOptions().catch(error => {
        logApiError('authorizationGovernance.loadScopeLookupOptions', error);
        return EMPTY_SCOPE_LOOKUP_OPTIONS;
      }),
    ]);
    setPrincipals(nextPrincipals);
    setRoles(nextRoles);
    setAuditEvents(nextAuditEvents);
    setOverrideRules(nextOverrideRules);
    setScopeLookupOptions(nextScopeLookupOptions);
    const preferredPrincipalId = selectedPrincipalIdRef.current;
    const nextPrincipalId = preferredPrincipalId && nextPrincipals.some(item => item.userId === preferredPrincipalId)
      ? preferredPrincipalId
      : nextPrincipals[0]?.userId || '';
    selectedPrincipalIdRef.current = nextPrincipalId;
    setSelectedPrincipalId(nextPrincipalId);
    if (nextPrincipalId) await loadPrincipalDetails(nextPrincipalId);
  }, [canAudit, canOverride, canView, loadPrincipalDetails]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMessage('');
    loadPage()
      .catch(error => {
        if (active) reportError('authorizationGovernance.load', error, 'Không thể tải dữ liệu quản trị phân quyền.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [loadPage, reportError]);

  const refresh = async () => {
    setRefreshing(true);
    setErrorMessage('');
    try {
      await loadPage();
    } catch (error) {
      reportError('authorizationGovernance.refresh', error, 'Không thể tải lại dữ liệu phân quyền.');
    } finally {
      setRefreshing(false);
    }
  };

  const refreshAfterCommand = async () => {
    if (selectedPrincipalId) await loadPrincipalDetails(selectedPrincipalId);
    const [nextRoles, nextAuditEvents] = await Promise.all([
      authorizationGovernanceService.listBusinessRoles(),
      canAudit ? authorizationGovernanceService.listPermissionAuditEvents(100) : Promise.resolve([]),
    ]);
    setRoles(nextRoles);
    setAuditEvents(nextAuditEvents);
  };

  if (!canView) {
    return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">Bạn không có quyền xem quản trị phân quyền.</div>;
  }

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" /> Đang tải nguồn quyền hiệu lực...</div>;
  }

  return (
    <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-800"><ShieldCheck size={20} className="text-violet-600" /> Quản trị phân quyền</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">Business Role, direct grant, nguồn quyền hiệu lực và bằng chứng SoD.</p>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-50"><RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} /> Tải lại</button>
      </div>

      {errorMessage && <div className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 p-4 text-xs font-bold text-rose-700"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{errorMessage}</div>}

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
        {([
          ['users', 'Phân quyền user'],
          ['advanced', 'Nguồn nâng cao'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-4 py-2 text-xs font-black ${activeTab === tab ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Principal</div>
            <SearchableSelect
              value={selectedPrincipalId}
              options={principals}
              onChange={principal => selectPrincipal(principal?.userId || '')}
              getOptionValue={principal => principal.userId}
              getOptionLabel={getPrincipalLabel}
              getOptionSearchText={getPrincipalSearchText}
              renderOption={renderPrincipalOption}
              placeholder="Gõ tên hoặc email..."
              emptyLabel="Không tìm thấy tài khoản"
              disabled={principals.length === 0}
              clearable={false}
              inputClassName="rounded-xl py-2"
            />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Business Role</div>
            <button type="button" onClick={() => { setSelectedRoleId(null); setRoleImpactPreview(null); }} disabled={!canManageRoles} className="mb-2 w-full rounded-lg border border-dashed border-violet-200 px-3 py-2 text-xs font-black text-violet-700 disabled:opacity-40">+ Role mới</button>
            <div className="max-h-72 space-y-1 overflow-auto">
              {roles.map(role => (
                <button key={role.id} type="button" onClick={() => { setSelectedRoleId(role.id); setRoleImpactPreview(null); }} className={`w-full rounded-lg px-3 py-2 text-left text-xs font-bold ${selectedRoleId === role.id ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="block">{role.name}</span>
                  <span className="mt-0.5 block text-[9px] text-slate-400">{role.code} · v{role.version}{role.isSystem ? ' · SYSTEM' : ''}</span>
                </button>
              ))}
            </div>
          </section>
          {canOverride && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
              Có {overrideRules.length} quy tắc cho phép override. Override chỉ bắt đầu từ đối tượng workflow được khóa sẵn; Settings không tạo override tự do.
            </section>
          )}
        </aside>

        <main className="space-y-5">
          {activeTab === 'users' && selectedPrincipal && loadedPrincipalId === selectedPrincipal.userId && (
            <DirectUserPermissionWorkspace
              key={`direct-user-${selectedPrincipal.userId}`}
              principal={selectedPrincipal}
              grants={directGrants}
              effectiveSources={sources}
              principals={principals}
              currentUserId={currentUser.id}
              disabled={!canManageGrants}
              scopeLookupOptions={scopeLookupOptions}
              clipboard={directClipboard}
              onClipboardChange={setDirectClipboard}
              onSaved={async () => {
                try {
                  await refreshAfterCommand();
                } catch (error) {
                  reportError('authorizationGovernance.refreshDirectWorkspace', error, 'Đã lưu quyền nhưng không thể tải lại dữ liệu mới.');
                  throw error;
                }
              }}
            />
          )}

          {activeTab === 'users' && (!selectedPrincipal || loadedPrincipalId !== selectedPrincipal.userId) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs font-bold text-slate-500">
              Đang tải dữ liệu phân quyền user...
            </div>
          )}

          {activeTab === 'advanced' && (
            <>
          {canManageRoles ? (
            <BusinessRoleEditor
              role={selectedRole}
              permissionActions={permissionActions}
              preview={roleImpactPreview}
              disabled={!canManageRoles}
              onPreview={async (items: BusinessRoleItem[]) => {
                try {
                  setRoleImpactPreview(await authorizationGovernanceService.previewBusinessRoleChange(selectedRole?.id || null, items));
                } catch (error) {
                  reportError('authorizationGovernance.previewRole', error, 'Không thể preview tác động Business Role.');
                  throw error;
                }
              }}
              onSave={async (input: SaveBusinessRoleInput) => {
                try {
                  const savedId = await authorizationGovernanceService.saveBusinessRole(input);
                  setSelectedRoleId(savedId);
                  setRoleImpactPreview(null);
                  await refreshAfterCommand();
                } catch (error) {
                  reportError('authorizationGovernance.saveRole', error, 'Backend đã từ chối thay đổi Business Role.');
                  throw error;
                }
              }}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs font-bold text-slate-500">
              <div>Danh sách Business Role ở chế độ chỉ đọc.</div>
              {selectedRole && (
                <div className="mt-3 space-y-2">
                  <div className="font-black text-slate-700">{selectedRole.name} · {selectedRole.code} · v{selectedRole.version}</div>
                  {selectedRole.items.map(item => (
                    <div key={`${item.permissionCode}-${item.scopeType}-${item.scopeId}`} className="rounded-lg bg-slate-50 px-3 py-2 text-[10px]">
                      {item.permissionCode} · {item.scopeType}/{item.scopeId}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedPrincipal && loadedPrincipalId === selectedPrincipal.userId && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-700">Nguồn quyền hiệu lực</div>
                <EffectivePermissionSourceList sources={sources} />
              </section>

              {(canManageRoles || canAudit) && (
                <PrincipalRoleAssignmentPanel
                  principal={selectedPrincipal}
                  roles={roles}
                  assignments={assignments}
                  decision={assignmentDecision}
                  disabled={!canManageRoles}
                  controlOwners={principals}
                  currentUserId={currentUser.id}
                  scopeLookupOptions={scopeLookupOptions}
                  onPreview={async (roleId, scope) => {
                    try {
                      setAssignmentDecision(await authorizationGovernanceService.previewBusinessRoleAssignment({
                        targetUserId: selectedPrincipal.userId,
                        roleTemplateId: roleId,
                        scopeType: scope.scopeType || 'global',
                        scopeId: scope.scopeId || '*',
                      }));
                    } catch (error) {
                      reportError('authorizationGovernance.previewAssignment', error, 'Không thể preview phân công Business Role.');
                      throw error;
                    }
                  }}
                  onAssign={async input => {
                    try {
                      await authorizationGovernanceService.assignBusinessRole(input);
                      await refreshAfterCommand();
                    } catch (error) {
                      reportError('authorizationGovernance.assignRole', error, 'Backend đã từ chối phân công Business Role.');
                      throw error;
                    }
                  }}
                  onRevoke={async (assignmentId, reason) => {
                    try {
                      await authorizationGovernanceService.revokeBusinessRoleAssignment(assignmentId, reason);
                      await refreshAfterCommand();
                    } catch (error) {
                      reportError('authorizationGovernance.revokeRole', error, 'Backend đã từ chối thu hồi Business Role.');
                      throw error;
                    }
                  }}
                />
              )}

              {canManageGrants && (
                <PrincipalDirectGrantPanel
                  key={selectedPrincipal.userId}
                  principal={selectedPrincipal}
                  grants={directGrants}
                  effectiveSources={sources}
                  permissionActions={permissionActions}
                  disabled={!canManageGrants}
                  controlOwners={principals}
                  currentUserId={currentUser.id}
                  scopeLookupOptions={scopeLookupOptions}
                  onSaved={async () => {
                    try {
                      await refreshAfterCommand();
                    } catch (error) {
                      reportError('authorizationGovernance.refreshDirect', error, 'Đã lưu quyền nhưng không thể tải lại dữ liệu mới.');
                      throw error;
                    }
                  }}
                />
              )}
            </>
          )}

          {canAudit && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-700"><History size={15} /> Audit phân quyền gần đây</div>
              <div className="max-h-80 space-y-2 overflow-auto">
                {auditEvents.length === 0 && <div className="text-xs font-bold text-slate-400">Không có sự kiện được RLS cho phép xem.</div>}
                {auditEvents.map(event => (
                  <div key={event.id} className="grid gap-1 rounded-lg border border-slate-100 p-3 text-[10px] font-bold text-slate-500 sm:grid-cols-[1fr_auto]">
                    <span className="text-slate-700">{event.eventType}</span>
                    <span>{new Date(event.createdAt).toLocaleString('vi-VN')}</span>
                    <span>Target: {event.targetUserId ? principals.find(item => item.userId === event.targetUserId)?.name || 'Tài khoản' : 'Không có'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsAuthorizationGovernance;
