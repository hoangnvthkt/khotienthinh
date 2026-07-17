import React, { useMemo, useState } from 'react';
import { Eye, Loader2, Plus, ShieldX } from 'lucide-react';
import type {
  AssignBusinessRoleInput,
  AuthorizationDecision,
  AuthorizationPrincipal,
  BusinessRole,
  PrincipalRoleAssignment,
  SodWarningAcceptanceInput,
} from '../../lib/permissions/authorizationGovernanceTypes';
import { validateSodWarningAcceptances } from '../../lib/permissions/authorizationGovernanceViewModel';
import type { PermissionScope, PermissionScopeType } from '../../lib/permissions/permissionTypes';
import PermissionScopePicker from './PermissionScopePicker';
import SodWarningPanel from './SodWarningPanel';

interface PrincipalRoleAssignmentPanelProps {
  principal: AuthorizationPrincipal;
  roles: readonly BusinessRole[];
  assignments: readonly PrincipalRoleAssignment[];
  decision: AuthorizationDecision | null;
  disabled: boolean;
  controlOwners?: readonly AuthorizationPrincipal[];
  currentUserId?: string;
  onPreview: (roleId: string, scope: PermissionScope) => Promise<void>;
  onAssign: (input: AssignBusinessRoleInput) => Promise<void>;
  onRevoke: (assignmentId: string, reason: string) => Promise<void>;
}

const assignmentDraftKey = (principalId: string, roleId: string, scope: PermissionScope) =>
  `${principalId}::${roleId}::${scope.scopeType || 'global'}::${scope.scopeId || '*'}`;

const toIso = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const PrincipalRoleAssignmentPanel: React.FC<PrincipalRoleAssignmentPanelProps> = ({
  principal,
  roles,
  assignments,
  decision,
  disabled,
  controlOwners = [],
  currentUserId,
  onPreview,
  onAssign,
  onRevoke,
}) => {
  const assignableRoles = useMemo(() => roles.filter(role => role.isActive), [roles]);
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<PermissionScope>({ scopeType: 'global', scopeId: '*' });
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [acceptances, setAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
  const [previewedDraftKey, setPreviewedDraftKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'assign' | string | null>(null);
  const [message, setMessage] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const currentDraftKey = assignmentDraftKey(principal.userId, roleId, scope);
  const previewMatches = Boolean(decision && previewedDraftKey === currentDraftKey);
  const principalDisabled = principal.accountStatus !== 'ACTIVE';

  const handlePreview = async () => {
    if (!roleId || !scope.scopeId) {
      setMessage('Chọn role và scope trước khi preview.');
      return;
    }
    setBusy('preview');
    setMessage('');
    setAcceptances([]);
    try {
      await onPreview(roleId, scope);
      setPreviewedDraftKey(currentDraftKey);
    } catch {
      setMessage('Không thể preview phân công Business Role. Vui lòng thử lại.');
    } finally {
      setBusy(null);
    }
  };

  const handleAssign = async () => {
    if (!decision || !previewMatches) {
      setMessage('Draft đã thay đổi; hãy preview lại trước khi phân công.');
      return;
    }
    if (decision.hardDenies.length > 0) {
      setMessage('Backend từ chối phân công do quy tắc SoD bắt buộc.');
      return;
    }
    if (reason.trim().length < 10) {
      setMessage('Lý do phân công phải có ít nhất 10 ký tự.');
      return;
    }
    const acceptanceErrors = validateSodWarningAcceptances(decision, acceptances, new Date());
    if (acceptanceErrors.length > 0) {
      setMessage(acceptanceErrors[0]);
      return;
    }
    setBusy('assign');
    setMessage('');
    try {
      await onAssign({
        targetUserId: principal.userId,
        roleTemplateId: roleId,
        scopeType: (scope.scopeType || 'global') as PermissionScopeType,
        scopeId: scope.scopeId || '*',
        startsAt: null,
        expiresAt: toIso(expiresAt),
        reason: reason.trim(),
        warningAcceptances: acceptances,
      });
      setPreviewedDraftKey(null);
      setAcceptances([]);
      setReason('');
    } catch {
      setMessage('Không thể phân công Business Role. Backend đã từ chối thay đổi.');
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (assignmentId: string) => {
    const revokeReason = revokeReasons[assignmentId]?.trim() || '';
    if (revokeReason.length < 10) {
      setMessage('Lý do thu hồi role phải có ít nhất 10 ký tự.');
      return;
    }
    setBusy(assignmentId);
    setMessage('');
    try {
      await onRevoke(assignmentId, revokeReason);
      setRevokeReasons(current => ({ ...current, [assignmentId]: '' }));
    } catch {
      setMessage('Không thể thu hồi Business Role. Backend đã từ chối thay đổi.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-slate-700">Business Role của {principal.name}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-400">{principal.email}</div>
      </div>
      {principalDisabled && <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">Principal đang bị vô hiệu hóa; không thể tạo assignment mới.</div>}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
        <select value={roleId} onChange={event => { setRoleId(event.target.value); setAcceptances([]); setPreviewedDraftKey(null); }} disabled={disabled || principalDisabled} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold disabled:bg-slate-50">
          <option value="">Chọn Business Role</option>
          {assignableRoles.map(role => <option key={role.id} value={role.id}>{role.name} · {role.code}</option>)}
        </select>
        <input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} disabled={disabled || principalDisabled} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:bg-slate-50" title="Hết hạn (tùy chọn)" />
      </div>
      <PermissionScopePicker value={scope} onChange={value => { setScope(value); setAcceptances([]); setPreviewedDraftKey(null); }} disabled={disabled || principalDisabled} />
      <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={disabled || principalDisabled} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:bg-slate-50" placeholder="Lý do phân công (ít nhất 10 ký tự)" />
      {decision && previewMatches && decision.hardDenies.length > 0 && (
        <div className="space-y-1 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
          {decision.hardDenies.map(finding => <div key={`${finding.ruleCode}-${finding.scopeType}-${finding.scopeId}`}>{finding.message}</div>)}
        </div>
      )}
      {decision && previewMatches && (
        <SodWarningPanel warnings={decision.warnings} acceptances={acceptances} controlOwners={controlOwners} currentUserId={currentUserId} affectedPrincipalId={principal.userId} disabled={disabled || principalDisabled} onChange={setAcceptances} />
      )}
      {message && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">{message}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={handlePreview} disabled={disabled || principalDisabled || busy !== null} className="flex items-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-xs font-black text-blue-700 disabled:opacity-50">{busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview</button>
        <button type="button" onClick={handleAssign} disabled={disabled || principalDisabled || busy !== null || !previewMatches || Boolean(decision?.hardDenies.length)} className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Phân công role</button>
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-4">
        {assignments.length === 0 && <div className="text-xs font-bold text-slate-400">Chưa có lịch sử Business Role.</div>}
        {assignments.map(assignment => {
          const role = roles.find(candidate => candidate.id === assignment.roleTemplateId);
          return (
            <div key={assignment.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-700">{role?.name || assignment.roleTemplateId}</div>
                <span className={`rounded px-2 py-1 text-[9px] font-black ${assignment.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{assignment.status}</span>
              </div>
              <div className="mt-2 grid gap-1 text-[10px] font-bold text-slate-500 sm:grid-cols-2">
                <span>{assignment.scopeType}/{assignment.scopeId}</span>
                <span>Bắt đầu: {new Date(assignment.startsAt).toLocaleString('vi-VN')}</span>
                <span>Hết hạn: {assignment.expiresAt ? new Date(assignment.expiresAt).toLocaleString('vi-VN') : 'Không giới hạn'}</span>
                <span>Lý do: {assignment.assignedReason}</span>
              </div>
              {assignment.status === 'ACTIVE' && !disabled && (
                <div className="mt-3 flex gap-2">
                  <input value={revokeReasons[assignment.id] || ''} onChange={event => setRevokeReasons(current => ({ ...current, [assignment.id]: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-semibold" placeholder="Lý do thu hồi (ít nhất 10 ký tự)" />
                  <button type="button" onClick={() => handleRevoke(assignment.id)} disabled={busy !== null} className="flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-[10px] font-black text-rose-700 disabled:opacity-50">{busy === assignment.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldX size={12} />} Thu hồi</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PrincipalRoleAssignmentPanel;
