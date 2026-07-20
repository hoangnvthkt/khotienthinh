import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import type {
  AuthorizationOverrideInput,
  AuthorizationPrincipal,
  AuthorizationSodRule,
} from '../../lib/permissions/authorizationGovernanceTypes';
import type { PermissionScope } from '../../lib/permissions/permissionTypes';

interface AuthorizationOverrideDialogProps {
  rules: readonly AuthorizationSodRule[];
  controlOwners: readonly AuthorizationPrincipal[];
  subject: { subjectType: string; subjectId: string; label?: string };
  scope: Required<PermissionScope>;
  currentUserId?: string;
  affectedPrincipalId?: string;
  onSubmit: (input: AuthorizationOverrideInput) => Promise<void>;
  onClose: () => void;
}

const AuthorizationOverrideDialog: React.FC<AuthorizationOverrideDialogProps> = ({
  rules,
  controlOwners,
  subject,
  scope,
  currentUserId,
  affectedPrincipalId,
  onSubmit,
  onClose,
}) => {
  const eligibleRules = useMemo(
    () => rules.filter(rule => rule.effect === 'REQUIRE_OVERRIDE' && rule.overridable),
    [rules],
  );
  const availableOwners = useMemo(() => controlOwners.filter(owner =>
    owner.accountStatus === 'ACTIVE' && owner.userId !== currentUserId && owner.userId !== affectedPrincipalId
  ), [affectedPrincipalId, controlOwners, currentUserId]);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [ruleCode, setRuleCode] = useState(eligibleRules[0]?.ruleCode || '');
  const [reason, setReason] = useState('');
  const [controlOwnerUserId, setControlOwnerUserId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async () => {
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (!ruleCode || reason.trim().length < 10 || !controlOwnerUserId || !expiry || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      setErrorMessage('Vui lòng nhập đủ lý do, người kiểm soát và hạn override trong tương lai.');
      return;
    }
    setSubmitting(true);
    setErrorMessage('');
    try {
      await onSubmit({
        ruleCode,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        reason: reason.trim(),
        controlOwnerUserId,
        expiresAt: expiry.toISOString(),
        idempotencyKey,
      });
    } catch (error) {
      logApiError('authorizationOverride.submit', error);
      setErrorMessage(getApiErrorMessage(error, 'Backend đã từ chối ghi nhận override.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-black text-slate-800"><ShieldAlert size={18} className="text-amber-600" /> Ghi nhận override có kiểm soát</div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-3 p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600">
            <div>Đối tượng: {subject.label || subject.subjectType}</div>
            <div className="mt-1">Scope: {scope.scopeType}/{scope.scopeId}</div>
          </div>
          <select value={ruleCode} onChange={event => setRuleCode(event.target.value)} disabled={submitting} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold">
            <option value="">Chọn quy tắc override</option>
            {eligibleRules.map(rule => <option key={rule.ruleCode} value={rule.ruleCode}>{rule.name}</option>)}
          </select>
          <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={submitting} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold" placeholder="Lý do nghiệp vụ (ít nhất 10 ký tự)" />
          <select value={controlOwnerUserId} onChange={event => setControlOwnerUserId(event.target.value)} disabled={submitting} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold">
            <option value="">Chọn người kiểm soát độc lập</option>
            {availableOwners.map(owner => <option key={owner.userId} value={owner.userId}>{owner.name} · {owner.email}</option>)}
          </select>
          <input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} disabled={submitting} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold" />
          {errorMessage && <div className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{errorMessage}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">Hủy</button>
          <button type="button" onClick={handleSubmit} disabled={submitting || eligibleRules.length === 0} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
            {submitting && <Loader2 size={14} className="animate-spin" />} Ghi nhận override
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorizationOverrideDialog;
