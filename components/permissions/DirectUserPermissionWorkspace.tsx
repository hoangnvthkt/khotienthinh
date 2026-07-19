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
  buildDirectGrantDraftKey,
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
import type { PermissionScope } from '../../lib/permissions/permissionTypes';
import type { PermissionScopeLookupOptionsByType } from '../../lib/permissions/permissionScopeLookupService';
import { buildUnifiedPermissionDraftKey } from '../../lib/permissions/unifiedPermissionViewModel';
import CompactDirectPermissionTree from './CompactDirectPermissionTree';
import PermissionChangeSummary from './PermissionChangeSummary';
import PermissionScopePicker from './PermissionScopePicker';
import SodWarningPanel from './SodWarningPanel';

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
  const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<UnifiedPermissionPreview | null>(null);
  const [previewedDraftKey, setPreviewedDraftKey] = useState<string | null>(null);
  const [acceptances, setAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
  const [busy, setBusy] = useState<'load' | 'preview' | 'save' | null>(null);
  const [message, setMessage] = useState('');

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
    ? buildUnifiedPermissionDraftKey(principal.userId, preview.legacyAfter, drafts)
    : null;
  const previewMatches = preview !== null && previewedDraftKey === currentDraftKey;
  const draftChanged = buildDirectGrantDraftKey(principal.userId, grants) !== buildDirectGrantDraftKey(principal.userId, drafts);
  const panelDisabled = disabled || principal.accountStatus !== 'ACTIVE' || busy !== null;
  const sensitiveDrafts = drafts.filter(grant =>
    grant.isActive !== false && riskByPermissionCode.get(grant.permissionCode) === 'sensitive'
  );
  const sourceSummary = useMemo(() => ({
    role: effectiveSources.filter(source => source.sourceType === 'ROLE').length,
    legacy: effectiveSources.filter(source => source.sourceType === 'LEGACY').length,
    direct: effectiveSources.filter(source => source.sourceType === 'DIRECT').length,
  }), [effectiveSources]);

  useEffect(() => {
    setDrafts([...grants]);
    setPreview(null);
    setPreviewedDraftKey(null);
    setAcceptances([]);
    setMessage('');
  }, [grants, principal.userId]);

  const updateDrafts = (next: UserPermissionGrant[]) => {
    setDrafts(next);
    setPreview(null);
    setPreviewedDraftKey(null);
    setAcceptances([]);
    setMessage('');
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
    setAcceptances([]);
    try {
      const nextPreview = await previewUserPermissionChange(principal.userId, null, drafts);
      setPreview(nextPreview);
      setPreviewedDraftKey(buildUnifiedPermissionDraftKey(principal.userId, nextPreview.legacyAfter, drafts));
    } catch {
      setMessage('Khong the preview thay doi quyen.');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    const validationErrors = validateDirectGrantDrafts(grants, drafts, riskByPermissionCode, new Date(), reason);
    if (validationErrors.length > 0) {
      setMessage(validationErrors[0]);
      return;
    }
    if (!preview || !previewMatches) {
      setMessage('Draft da thay doi; hay preview lai.');
      return;
    }
    if (preview.decision.hardDenies.length > 0) {
      setMessage('Backend tu choi do quy tac SoD bat buoc.');
      return;
    }
    const acceptanceErrors = validateSodWarningAcceptances(preview.decision, acceptances, new Date());
    if (acceptanceErrors.length > 0) {
      setMessage(acceptanceErrors[0]);
      return;
    }

    setBusy('save');
    setMessage('');
    try {
      await applyUserPermissionChange(principal.userId, preview.beforeFingerprint, null, drafts, {
        reason: reason.trim(),
        warningAcceptances: acceptances,
      });
      await onSaved();
      setReason('');
      setPreview(null);
      setPreviewedDraftKey(null);
      setAcceptances([]);
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
    || !previewMatches
    || Boolean(preview?.decision.hardDenies.length)
    || (draftChanged && reason.trim().length < 10);

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
              setAcceptances([]);
              setMessage('');
            }}
            disabled={panelDisabled}
            lookupOptions={scopeLookupOptions}
          />
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
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Lưu phân quyền
            </button>
          </div>
        </div>

        {principal.accountStatus !== 'ACTIVE' && (
          <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
            Principal dang bi vo hieu hoa.
          </div>
        )}

        <CompactDirectPermissionTree
          targetUserId={principal.userId}
          grants={drafts}
          effectiveSources={effectiveSources}
          scope={scope}
          disabled={panelDisabled}
          onGrantsChange={updateDrafts}
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
          value={reason}
          onChange={event => setReason(event.target.value)}
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
            afterLegacy={preview.legacyAfter}
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
            acceptances={acceptances}
            controlOwners={principals}
            currentUserId={currentUserId}
            affectedPrincipalId={principal.userId}
            disabled={panelDisabled}
            onChange={setAcceptances}
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
