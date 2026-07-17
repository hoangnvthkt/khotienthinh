import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, Save } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import type {
  AuthorizationDecision,
  AuthorizationPrincipal,
  EffectivePermissionSource,
  SodWarningAcceptanceInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import {
  buildDirectGrantDraftKey,
  validateDirectGrantDrafts,
  validateSodWarningAcceptances,
} from '../../lib/permissions/authorizationGovernanceViewModel';
import type { PermissionActionDefinition, PermissionScope } from '../../lib/permissions/permissionTypes';
import PermissionDiffPreview from './PermissionDiffPreview';
import PermissionMatrix from './PermissionMatrix';
import PermissionScopePicker from './PermissionScopePicker';
import SodWarningPanel from './SodWarningPanel';

interface PrincipalDirectGrantPanelProps {
  principal: AuthorizationPrincipal;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  permissionActions: readonly PermissionActionDefinition[];
  disabled: boolean;
  controlOwners?: readonly AuthorizationPrincipal[];
  currentUserId?: string;
  onPreview: (grants: readonly UserPermissionGrant[]) => Promise<AuthorizationDecision>;
  onSave: (
    grants: readonly UserPermissionGrant[],
    reason: string,
    acceptances: readonly SodWarningAcceptanceInput[],
  ) => Promise<void>;
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

const PrincipalDirectGrantPanel: React.FC<PrincipalDirectGrantPanelProps> = ({
  principal,
  grants,
  effectiveSources,
  permissionActions,
  disabled,
  controlOwners = [],
  currentUserId,
  onPreview,
  onSave,
}) => {
  const [drafts, setDrafts] = useState<UserPermissionGrant[]>([...grants]);
  const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<AuthorizationDecision | null>(null);
  const [acceptances, setAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
  const [previewedDraftKey, setPreviewedDraftKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDrafts([...grants]);
    setDecision(null);
    setAcceptances([]);
    setPreviewedDraftKey(null);
  }, [grants, principal.userId]);

  const riskByPermissionCode = useMemo(
    () => new Map(permissionActions.map(action => [action.permissionCode, action.riskLevel || 'normal'] as const)),
    [permissionActions],
  );
  const currentDraftKey = buildDirectGrantDraftKey(principal.userId, drafts);
  const previewMatches = decision !== null && previewedDraftKey === currentDraftKey;
  const panelDisabled = disabled || principal.accountStatus !== 'ACTIVE';
  const sensitiveDrafts = drafts.filter(grant =>
    grant.isActive !== false && riskByPermissionCode.get(grant.permissionCode) === 'sensitive'
  );

  const updateDrafts = (next: UserPermissionGrant[]) => {
    setDrafts(next);
    setDecision(null);
    setAcceptances([]);
    setPreviewedDraftKey(null);
    setMessage('');
  };

  const updateExpiry = (grant: UserPermissionGrant, value: string) => {
    updateDrafts(drafts.map(candidate => candidate === grant ? {
      ...candidate,
      expiresAt: toIsoDateTime(value),
    } : candidate));
  };

  const handlePreview = async () => {
    setBusy('preview');
    setMessage('');
    setAcceptances([]);
    try {
      const nextDecision = await onPreview(drafts);
      setDecision(nextDecision);
      setPreviewedDraftKey(buildDirectGrantDraftKey(principal.userId, drafts));
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
    if (!decision || !previewMatches) {
      setMessage('Draft đã thay đổi; hãy preview lại toàn bộ quyền trực tiếp.');
      return;
    }
    if (decision.hardDenies.length > 0) {
      setMessage('Backend từ chối thay đổi do quy tắc SoD bắt buộc.');
      return;
    }
    const acceptanceErrors = validateSodWarningAcceptances(decision, acceptances, new Date());
    if (acceptanceErrors.length > 0) {
      setMessage(acceptanceErrors[0]);
      return;
    }
    setBusy('save');
    setMessage('');
    try {
      await onSave(drafts, reason.trim(), acceptances);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-700">Direct grant của {principal.name}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-400">Checkbox chỉ thay đổi direct draft; badge Role/Legacy không bị gỡ.</div>
      </div>
      {principal.accountStatus !== 'ACTIVE' && <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">Principal đang bị vô hiệu hóa; direct grant không thể thay đổi.</div>}
      <PermissionScopePicker value={scope} onChange={setScope} disabled={panelDisabled} />
      <PermissionMatrix grants={drafts} effectiveSources={effectiveSources} targetUserId={principal.userId} scope={scope} disabled={panelDisabled} onChange={updateDrafts} />
      {sensitiveDrafts.length > 0 && (
        <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50/50 p-3">
          <div className="text-[10px] font-black uppercase text-rose-700">Hạn bắt buộc cho quyền nhạy cảm</div>
          {sensitiveDrafts.map(grant => (
            <label key={`${grant.permissionCode}-${grant.scopeType}-${grant.scopeId}`} className="grid items-center gap-2 text-[10px] font-bold text-slate-600 sm:grid-cols-[1fr_220px]">
              <span>{grant.permissionCode} · {grant.scopeType}/{grant.scopeId}</span>
              <input type="datetime-local" value={toLocalDateTime(grant.expiresAt)} onChange={event => updateExpiry(grant, event.target.value)} disabled={panelDisabled} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold disabled:bg-slate-50" />
            </label>
          ))}
        </div>
      )}
      <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={panelDisabled} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50" placeholder="Lý do thay đổi direct grant (ít nhất 10 ký tự)" />
      <PermissionDiffPreview before={grants} after={drafts} effectiveSources={effectiveSources} />
      {decision && previewMatches && decision.hardDenies.length > 0 && (
        <div className="space-y-1 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
          {decision.hardDenies.map(finding => <div key={`${finding.ruleCode}-${finding.scopeType}-${finding.scopeId}`}>{finding.message}</div>)}
        </div>
      )}
      {decision && previewMatches && <SodWarningPanel warnings={decision.warnings} acceptances={acceptances} controlOwners={controlOwners} currentUserId={currentUserId} affectedPrincipalId={principal.userId} disabled={panelDisabled} onChange={setAcceptances} />}
      {message && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">{message}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handlePreview} disabled={panelDisabled || busy !== null} className="flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-50">{busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview backend</button>
        <button type="button" onClick={handleSave} disabled={panelDisabled || busy !== null || !previewMatches || Boolean(decision?.hardDenies.length)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu direct grant</button>
      </div>
    </section>
  );
};

export default PrincipalDirectGrantPanel;
