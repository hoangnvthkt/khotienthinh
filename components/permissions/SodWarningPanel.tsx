import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  AuthorizationPrincipal,
  SodFinding,
  SodWarningAcceptanceInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import { sodWarningKey } from '../../lib/permissions/authorizationGovernanceViewModel';

interface SodWarningPanelProps {
  warnings: readonly SodFinding[];
  acceptances: readonly SodWarningAcceptanceInput[];
  controlOwners: readonly AuthorizationPrincipal[];
  currentUserId?: string;
  affectedPrincipalId?: string;
  disabled?: boolean;
  onChange: (acceptances: SodWarningAcceptanceInput[]) => void;
}

const toLocalDateTime = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const toIsoDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
};

const emptyAcceptance = (warning: SodFinding): SodWarningAcceptanceInput => ({
  ruleCode: warning.ruleCode,
  scopeType: warning.scopeType,
  scopeId: warning.scopeId,
  reason: '',
  controlOwnerUserId: '',
  compensatingControls: '',
  expiresAt: '',
});

const SodWarningPanel: React.FC<SodWarningPanelProps> = ({
  warnings,
  acceptances,
  controlOwners,
  currentUserId,
  affectedPrincipalId,
  disabled = false,
  onChange,
}) => {
  const availableOwners = controlOwners.filter(owner =>
    owner.accountStatus === 'ACTIVE' &&
    owner.userId !== currentUserId &&
    owner.userId !== affectedPrincipalId
  );

  const updateAcceptance = (warning: SodFinding, patch: Partial<SodWarningAcceptanceInput>) => {
    const warningKey = sodWarningKey(warning);
    const current = acceptances.find(item => sodWarningKey(item) === warningKey) || emptyAcceptance(warning);
    const next = acceptances.filter(item => sodWarningKey(item) !== warningKey);
    onChange([...next, { ...current, ...patch }]);
  };

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex items-center gap-2 text-xs font-black text-amber-800">
        <AlertTriangle size={15} /> Cần xác nhận kiểm soát SoD
      </div>
      {warnings.map(warning => {
        const acceptance = acceptances.find(item => sodWarningKey(item) === sodWarningKey(warning)) || emptyAcceptance(warning);
        return (
          <section key={sodWarningKey(warning)} className="space-y-2 rounded-lg border border-amber-100 bg-white p-3">
            <div className="text-xs font-black text-slate-700">{warning.ruleCode}</div>
            <p className="text-[11px] font-semibold text-slate-500">{warning.message}</p>
            <div className="rounded bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">
              Scope: {warning.scopeType}/{warning.scopeId}
            </div>
            <textarea
              value={acceptance.reason}
              onChange={event => updateAcceptance(warning, { reason: event.target.value })}
              disabled={disabled}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50"
              placeholder="Lý do chấp nhận cảnh báo (ít nhất 10 ký tự)"
            />
            <select
              value={acceptance.controlOwnerUserId}
              onChange={event => updateAcceptance(warning, { controlOwnerUserId: event.target.value })}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 outline-none disabled:bg-slate-50"
            >
              <option value="">Chọn người kiểm soát độc lập</option>
              {availableOwners.map(owner => <option key={owner.userId} value={owner.userId}>{owner.name} · {owner.email}</option>)}
            </select>
            <textarea
              value={acceptance.compensatingControls}
              onChange={event => updateAcceptance(warning, { compensatingControls: event.target.value })}
              disabled={disabled}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50"
              placeholder="Biện pháp kiểm soát bù trừ (ít nhất 10 ký tự)"
            />
            <input
              type="datetime-local"
              value={toLocalDateTime(acceptance.expiresAt)}
              onChange={event => updateAcceptance(warning, { expiresAt: toIsoDateTime(event.target.value) })}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 outline-none disabled:bg-slate-50"
            />
          </section>
        );
      })}
    </div>
  );
};

export default SodWarningPanel;
